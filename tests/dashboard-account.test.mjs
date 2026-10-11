import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";

// The personal dashboard's server side, run for real against the migrations: what Free and Pro may
// do with tracked areas and alerts, the saved-deal list, withdrawing alert consent, and the
// contributions list. The page is a courtesy; these routes are the boundary.

const { GET: userGet, POST: userPost } = await import("../app/api/user/route.ts");
const { GET: contributionsGet } = await import("../app/api/user/contributions/route.ts");
const { POST: confirmPost } = await import("../app/api/email/confirm/route.ts");
const { signEmailAction } = await import("../app/email.ts");

const USER = "https://radar.cheap/api/user";
const act = (body) => userPost(post(USER, body));
const errorCode = async (response) => (await response.json()).error?.code;

function account(db, { pro = false, id = "me" } = {}) {
  db.prepare("INSERT INTO users (id,email,timezone) VALUES (?,?,'America/Toronto')").run(id, `${id}@example.test`);
  harness.user = { userId: id, email: `${id}@example.test`, role: "user", pro };
}
function area(db, { id, label, radius = 25, active = 1, isDefault = 0, user = "me" }) {
  db.prepare("INSERT INTO saved_locations (id,user_id,label,postal,radius,active,is_default) VALUES (?,?,?,?,?,?,?)").run(id, user, label, `K1P ${id}A${id}`, radius, active, isDefault);
}
const areas = (db) => db.prepare("SELECT id,radius,active,is_default FROM saved_locations WHERE user_id='me' ORDER BY id").all().map((row) => ({ ...row }));

// ── Tracked areas ─────────────────────────────────────────────────────────────────────────────

test("an area kept from Pro can still be paused and renamed on Free, without its radius changing", async () => {
  // The dashboard used to send label, radius and active together, and a 100 km radius failed the
  // Free check, so an account that left Pro could not pause the area at all.
  const db = freshDatabase();
  account(db);
  area(db, { id: 1, label: "Cottage", radius: 100, isDefault: 1 });
  assert.equal((await act({ action: "update_location", id: 1, active: false })).status, 200);
  assert.equal((await act({ action: "update_location", id: 1, label: "Lake" })).status, 200);
  assert.deepEqual(areas(db), [{ id: 1, radius: 100, active: 0, is_default: 1 }]);
  assert.equal(db.prepare("SELECT label FROM saved_locations WHERE id=1").get().label, "Lake");
  // A new radius is still checked against the plan.
  const wider = await act({ action: "update_location", id: 1, radius: 75 });
  assert.equal(wider.status, 422);
  assert.equal((await act({ action: "update_location", id: 1, radius: 50 })).status, 200);
  assert.equal(areas(db)[0].radius, 50);
});

test("Free keeps one area active: a second is refused, and making one the default pauses the rest", async () => {
  const db = freshDatabase();
  account(db);
  area(db, { id: 1, label: "Home", isDefault: 1 });
  area(db, { id: 2, label: "Work", active: 0 });
  const resumed = await act({ action: "update_location", id: 2, active: true });
  assert.equal(resumed.status, 402);
  assert.equal(await errorCode(resumed), "AREA_LIMIT_ACTIVE");
  assert.equal(areas(db)[1].active, 0, "the refused area stays paused");
  assert.equal((await act({ action: "set_default_location", id: 2 })).status, 200);
  assert.deepEqual(areas(db).map(({ id, active, is_default }) => [id, active, is_default]), [[1, 0, 0], [2, 1, 1]]);
});

test("Pro may run several areas, and changing the default leaves the others running", async () => {
  const db = freshDatabase();
  account(db, { pro: true });
  area(db, { id: 1, label: "Home", isDefault: 1 });
  area(db, { id: 2, label: "Work", active: 0 });
  assert.equal((await act({ action: "update_location", id: 2, active: true })).status, 200);
  assert.equal((await act({ action: "set_default_location", id: 2 })).status, 200);
  assert.deepEqual(areas(db).map(({ id, active, is_default }) => [id, active, is_default]), [[1, 1, 0], [2, 1, 1]]);
});

test("an area belongs to its account: another account's id is not found", async () => {
  const db = freshDatabase();
  account(db, { id: "other" });
  area(db, { id: 9, label: "Theirs", user: "other" });
  account(db);
  const response = await act({ action: "update_location", id: 9, active: false });
  assert.equal(response.status, 404);
  assert.equal(db.prepare("SELECT active FROM saved_locations WHERE id=9").get().active, 1);
});

// ── Alerts ────────────────────────────────────────────────────────────────────────────────────

test("alerts need no postal code when an active area places them, and still need one without", async () => {
  const db = freshDatabase();
  account(db);
  const noArea = await act({ action: "preferences", days: ["1"], time: "08:00" });
  assert.equal(noArea.status, 422);
  assert.equal(await errorCode(noArea), "INVALID_POSTAL");
  area(db, { id: 1, label: "Home", isDefault: 1 });
  assert.equal((await act({ action: "preferences", days: ["1"], time: "08:00" })).status, 200);
  assert.equal(db.prepare("SELECT home_postal FROM users WHERE id='me'").get().home_postal, null, "an area does not invent a home postal");
});

test("Free saves one day at the free hour, whatever was asked for", async () => {
  const db = freshDatabase();
  account(db);
  assert.equal((await act({ action: "preferences", postal: "K1P 1J1", days: ["3", "5"], time: "19:30" })).status, 200);
  const saved = db.prepare("SELECT days,delivery_time FROM notification_preferences WHERE user_id='me'").get();
  assert.deepEqual({ days: JSON.parse(saved.days), time: saved.delivery_time }, { days: [3], time: "08:00" });
});

test("stopping alert email withdraws consent and suppresses the address, and a new confirmation lifts it", async () => {
  const db = freshDatabase();
  account(db);
  harness.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
  db.prepare("INSERT INTO email_consents (user_id,email,status,source,policy_version) VALUES ('me','me@example.test','confirmed','dashboard','2026-08-20')").run();
  db.prepare("INSERT INTO notification_preferences (user_id,enabled) VALUES ('me',1)").run();
  assert.equal((await act({ action: "revoke_email_consent" })).status, 200);
  assert.equal(db.prepare("SELECT status FROM email_consents WHERE user_id='me'").get().status, "revoked");
  assert.equal(db.prepare("SELECT enabled FROM notification_preferences WHERE user_id='me'").get().enabled, 0);
  assert.equal(db.prepare("SELECT reason FROM email_suppressions WHERE email='me@example.test'").get().reason, "user_unsubscribe");
  // Signing up again and confirming is newer consent than the unsubscribe.
  db.prepare("INSERT INTO email_consents (user_id,email,status,source,policy_version) VALUES ('me','me@example.test','pending','dashboard','2026-08-20')").run();
  const token = await signEmailAction("consent", "me", "me@example.test");
  const confirmed = await confirmPost(post("https://radar.cheap/api/email/confirm", { email: "me@example.test", token }));
  assert.equal(confirmed.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM email_suppressions").get().n, 0);
});

test("a confirmation does not lift a bounce or a complaint", async () => {
  const db = freshDatabase();
  account(db);
  harness.env.EMAIL_UNSUBSCRIBE_SECRET = "test-secret";
  db.prepare("INSERT INTO email_suppressions (email,reason) VALUES ('me@example.test','email.bounced')").run();
  db.prepare("INSERT INTO email_consents (user_id,email,status,source,policy_version) VALUES ('me','me@example.test','pending','dashboard','2026-08-20')").run();
  const token = await signEmailAction("consent", "me", "me@example.test");
  assert.equal((await confirmPost(post("https://radar.cheap/api/email/confirm", { email: "me@example.test", token }))).status, 200);
  assert.equal(db.prepare("SELECT reason FROM email_suppressions").get().reason, "email.bounced");
});

// ── Saved deals and contributions ─────────────────────────────────────────────────────────────

function deal(db, id, { status = "live", active = 1, expiresAt = null, deletedAt = null } = {}) {
  db.prepare(`INSERT INTO deals (id,slug,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active,expires_at,deleted_at)
    VALUES (?,?,'Somewhere','Two tacos','Food deal','Mexican','Daily','Ottawa','K1P','1 Bank St','$5','🌮','https://example.test',?,?,?,?)`).run(id, id, status, active, expiresAt, deletedAt);
}

test("every saved deal comes back, ended ones marked, rather than only those in a 50-deal feed", async () => {
  const db = freshDatabase();
  account(db);
  deal(db, "running");
  deal(db, "expired", { status: "expired", active: 0 });
  deal(db, "past-date", { expiresAt: "2020-01-01 00:00:00" });
  deal(db, "removed", { deletedAt: "2026-01-01 00:00:00" });
  for (const id of ["running", "expired", "past-date", "removed"]) db.prepare("INSERT INTO favorites (user_id,deal_id) VALUES ('me',?)").run(id);
  const body = await (await userGet()).json();
  const byId = Object.fromEntries(body.savedDeals.map((row) => [row.id, { live: row.live, page: row.page }]));
  assert.deepEqual(byId, {
    running: { live: true, page: "public" },
    expired: { live: false, page: "retired" },
    "past-date": { live: false, page: "public" },
    removed: { live: false, page: "hidden" },
  });
  assert.equal(body.favorites.length, 4, "the id list the app reads is unchanged");
});

test("contributions are the reader's own, and a report's staff note never leaves the workspace", async () => {
  const db = freshDatabase();
  account(db, { id: "other" });
  account(db);
  deal(db, "d1");
  const suggest = (user, status, reason) => db.prepare("INSERT INTO suggestions (restaurant,deal,postal,schedule,email,status,user_id,rejection_reason,reference) VALUES ('Somewhere','Wings','K1P 1J1','Mon','x@example.test',?,?,?,?)").run(status, user, reason, `BL-${user}-${status}`);
  suggest("me", "rejected", "Radar already lists this offer, so it was not added a second time.");
  suggest("me", "approved", "left over");
  suggest("other", "pending", null);
  db.prepare("INSERT INTO reports (user_id,deal_id,category,status,resolution) VALUES ('me','d1','incorrect_price','resolved','Called the owner, fixed price')").run();
  db.prepare("INSERT INTO reports (user_id,deal_id,category,status) VALUES ('other','d1','deal_ended','open')").run();
  const response = await contributionsGet();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.suggestions.map((row) => [row.status, row.reason]).sort(), [["approved", null], ["rejected", "Radar already lists this offer, so it was not added a second time."]]);
  assert.equal(body.reports.length, 1);
  assert.equal(body.reports[0].status, "resolved");
  assert.ok(!JSON.stringify(body).includes("Called the owner"), "the resolution note is staff's");
  harness.user = null;
  assert.equal((await contributionsGet()).status, 401);
});
