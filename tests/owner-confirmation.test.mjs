import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";

// A restaurant manager's "still running" from the portal, and the reader reports they see on their
// own deals (drizzle/0069), run for real against the portal handler.

const { GET: portalGet, POST: portalPost } = await import("../app/api/portal/route.ts");
const { ownerConfirmationCurrent, ownerConfirmationBlocked, reportCategoryLabel, OWNER_CONFIRMATION_DAYS } = await import("../app/owner-confirmation.ts");
const { OPEN_STAFF_REMINDERS_SQL } = await import("../app/staff-reminders.ts");

const PORTAL = "https://radar.cheap/api/portal";
const errorCode = async (response) => (await response.clone().json()).error?.code;

const MANAGER = { userId: "mgr", email: "m@example.test", role: "restaurant", permissions: new Set() };

function seed(db) {
  db.prepare("INSERT INTO users (id,email,role) VALUES ('mgr','m@example.test','restaurant')").run();
  db.prepare("INSERT INTO restaurants (id,name,cuisine) VALUES ('r-1','Spot','Pub'),('r-2','Other','Pub')").run();
  db.prepare("INSERT INTO restaurant_managers (id,restaurant_id,user_id,invited_email,invited_by,status) VALUES ('rm-1','r-1','mgr','m@example.test','staff','active')").run();
  const insert = db.prepare("INSERT INTO deals (id,restaurant_id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active,verification_status,verified_at,updated_at) VALUES (?,?,?,?,'Food','Pub','Mon 4-7pm','Ottawa','K1P','1 Main','$6','🍗','https://spot.example',?,?,'needs_review','2026-01-01 00:00:00','2026-01-01 00:00:00')");
  insert.run("deal-1", "r-1", "Spot", "Wing night", "live", 1);
  insert.run("deal-paused", "r-1", "Spot", "Taco Tuesday", "paused", 0);
  insert.run("deal-other", "r-2", "Other", "Theirs", "live", 1);
}

const confirm = (dealId = "deal-1") => portalPost(post(PORTAL, { action: "confirm_deal", dealId }));
const dealRow = (db, id = "deal-1") => ({ ...db.prepare("SELECT owner_confirmed_at,verified_at,verification_status,updated_at FROM deals WHERE id=?").get(id) });
const audits = (db) => db.prepare("SELECT action,target_id,actor_id FROM audit_log WHERE action='portal_confirm_deal'").all();

test("confirming a live deal records the owner's word and leaves Radar's own check alone", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = MANAGER;
  const response = await confirm();
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.ok(body.confirmed_at);
  const row = dealRow(db);
  assert.equal(row.owner_confirmed_at, body.confirmed_at);
  assert.equal(row.verified_at, "2026-01-01 00:00:00", "a confirmation is not a staff check");
  assert.equal(row.verification_status, "needs_review", "a confirmation never makes a deal Verified");
  assert.equal(row.updated_at, "2026-01-01 00:00:00", "nothing search reads moved, so the snapshot is not rebuilt");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM verification_events WHERE deal_id='deal-1'").get().n, 0, "the deal page lists every verification_events row as a check");
  assert.deepEqual(audits(db).map((a) => ({ ...a })), [{ action: "portal_confirm_deal", target_id: "deal-1", actor_id: "mgr" }], "who confirmed it is in the audit log");
});

test("a second press moments later writes nothing new", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = MANAGER;
  const first = await (await confirm()).json();
  const second = await confirm();
  assert.equal(second.status, 200);
  assert.equal((await second.json()).confirmed_at, first.confirmed_at);
  assert.equal(audits(db).length, 1);
});

test("an old confirmation is renewed", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = MANAGER;
  db.prepare("UPDATE deals SET owner_confirmed_at='2026-01-02 00:00:00' WHERE id='deal-1'").run();
  await confirm();
  assert.notEqual(dealRow(db).owner_confirmed_at, "2026-01-02 00:00:00");
  assert.equal(audits(db).length, 1);
});

test("only a manager's own live deal can be confirmed, and not while an edit waits for review", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = MANAGER;
  const theirs = await confirm("deal-other");
  assert.equal(theirs.status, 403);
  assert.equal(await errorCode(theirs), "NOT_YOUR_DEAL");
  assert.equal(dealRow(db, "deal-other").owner_confirmed_at, null);

  const paused = await confirm("deal-paused");
  assert.equal(paused.status, 409);
  assert.equal(await errorCode(paused), "CANNOT_CONFIRM");

  const edit = await portalPost(post(PORTAL, { action: "update_deal", dealId: "deal-1", title: "Wing night", price: "$5", schedule: "Mon 4-7pm", active: true }));
  assert.equal((await edit.json()).review, "submitted");
  const pending = await confirm();
  assert.equal(pending.status, 409, "vouching for the wording they just asked to change would contradict them");
  assert.equal(dealRow(db).owner_confirmed_at, null);
  assert.equal(audits(db).length, 0);
});

test("signed out, or managing nothing, confirms nothing", async () => {
  const db = freshDatabase();
  seed(db);
  assert.equal((await confirm()).status, 401);
  harness.user = { ...MANAGER, userId: "nobody" };
  assert.equal((await confirm()).status, 403);
  assert.equal(dealRow(db).owner_confirmed_at, null);
});

test("the portal lists open reports on the manager's own deals, without who sent them", async () => {
  const db = freshDatabase();
  seed(db);
  const report = db.prepare("INSERT INTO reports (user_id,email,deal_id,category,notes,source_url,status,created_at) VALUES ('reader','reader@example.test',?,?,?,'https://evil.example',?,?)");
  report.run("deal-1", "incorrect_price", "It is $8 now", "open", "2026-10-01 10:00:00");
  report.run("deal-1", "deal_ended", null, "reviewing", "2026-10-02 10:00:00");
  report.run("deal-1", "incorrect_schedule", "fixed", "resolved", "2026-10-03 10:00:00");
  report.run("deal-paused", "misleading_terms", null, "rejected", "2026-10-03 10:00:00");
  report.run("deal-other", "incorrect_price", "not yours", "open", "2026-10-04 10:00:00");
  harness.user = MANAGER;
  const response = await portalGet();
  assert.equal(response.status, 200, await response.clone().text());
  const body = await response.json();
  assert.deepEqual(body.reports.map((r) => [r.deal_id, r.category, r.status]), [["deal-1", "deal_ended", "reviewing"], ["deal-1", "incorrect_price", "open"]]);
  for (const r of body.reports) {
    assert.deepEqual(Object.keys(r).sort(), ["category", "created_at", "deal_id", "id", "notes", "status"], "no email, account or link from the reader");
  }
  const deal = body.deals.find((d) => d.id === "deal-1");
  assert.equal(deal.owner_confirmed_at, null);
});

test("what the portal and the deal page read from a confirmation", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  assert.equal(ownerConfirmationCurrent(null, now), false);
  assert.equal(ownerConfirmationCurrent("2026-10-06 12:00:00", now), true);
  assert.equal(ownerConfirmationCurrent(new Date(now - OWNER_CONFIRMATION_DAYS * 86_400_000 - 1000).toISOString(), now), false);
  assert.equal(ownerConfirmationCurrent("not a date", now), false);
  assert.equal(ownerConfirmationBlocked({ status: "live", pending_change: null }), null);
  assert.match(ownerConfirmationBlocked({ status: "paused", pending_change: null }), /live/);
  assert.match(ownerConfirmationBlocked({ status: "live", pending_change: { title: "x" } }), /review/);
  assert.equal(reportCategoryLabel("incorrect_price"), "Says the price is wrong");
  assert.equal(reportCategoryLabel("something_new"), "Says something is wrong");
});

test("staff reminders carry the owner's confirmation as context", () => {
  const db = freshDatabase();
  seed(db);
  db.prepare("UPDATE deals SET owner_confirmed_at='2026-10-06 12:00:00' WHERE id='deal-1'").run();
  db.prepare("INSERT INTO staff_reminders (id,kind,deal_id,basis) VALUES ('rem-1','expiring','deal-1','2026-10-09')").run();
  const [row] = db.prepare(OPEN_STAFF_REMINDERS_SQL).all();
  assert.equal(row.owner_confirmed_at, "2026-10-06 12:00:00");
});
