import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";

// The daily renew-or-confirm reminders (drizzle/0066, app/staff-reminders.ts), run against a
// database built from the real migrations and through the real admin handler.

const { isReminderHour, sweepStaffReminders } = await import("../app/staff-reminders.ts");
const { GET: adminGet, POST: adminPost } = await import("../app/api/admin/route.ts");

const ADMIN = "https://radar.cheap/api/admin";
const NOON_EDT = new Date("2026-10-07T16:00:00Z");
const ONE_PM_EDT = new Date("2026-10-07T17:00:00Z");
const NOON_EST = new Date("2026-12-07T17:00:00Z");

const EDITOR = { userId: "staff", email: "s@example.test", role: "deal_editor", permissions: new Set(["read_admin", "verify_deals"]) };
const ANALYST = { userId: "analyst", email: "a@example.test", role: "analyst", permissions: new Set(["read_admin"]) };

function addDeal(db, id, { status = "live", expires = null, verified = "datetime('now','-1 days')", verification = "verified" } = {}) {
  db.prepare(
    `INSERT INTO deals (id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active,verification_status,expires_at,verified_at)
     VALUES (?,'Spot',?,'Food','Pub','Mon','Ottawa','K1P','1 Main','$6','🍗','https://spot.example',?,?,?,${expires ?? "NULL"},${verified})`,
  ).run(id, `Deal ${id}`, status, status === "live" ? 1 : 0, verification);
}
const reminders = (db) => db.prepare("SELECT kind,deal_id,status,resolution FROM staff_reminders ORDER BY deal_id,kind,created_at").all().map((row) => ({ ...row }));
const open = (db) => reminders(db).filter((r) => r.status === "open").map((r) => `${r.kind}:${r.deal_id}`);
const D1 = () => harness.env.DB;
// The daily research migrations seed reminders of their own; each test here starts from none.
function freshDatabaseWithoutReminders() {
  const db = freshDatabase();
  db.prepare("DELETE FROM staff_reminders").run();
  return db;
}

test("reminders open on the noon hour in New York, summer and winter", () => {
  assert.equal(isReminderHour(NOON_EDT), true);
  assert.equal(isReminderHour(ONE_PM_EDT), false);
  assert.equal(isReminderHour(NOON_EST), true);
  assert.equal(isReminderHour(new Date("2026-12-07T16:00:00Z")), false);
});

test("noon opens one reminder per deal ending this week or about to lose its check, and only then", async () => {
  const db = freshDatabaseWithoutReminders();
  addDeal(db, "ends-soon", { expires: "datetime('now','+3 days')" });
  addDeal(db, "ended-yesterday", { expires: "datetime('now','-1 days')" });
  addDeal(db, "ends-later", { expires: "datetime('now','+20 days')" });
  addDeal(db, "draft-ending", { status: "draft", expires: "datetime('now','+3 days')" });
  addDeal(db, "check-lapsing", { verified: "datetime('now','-28 days')" });
  addDeal(db, "check-fresh", { verified: "datetime('now','-10 days')" });
  addDeal(db, "check-overdue", { verified: "datetime('now','-45 days')" });
  addDeal(db, "never-checked", { verified: "datetime('now','-28 days')", verification: "needs_review" });

  assert.deepEqual(await sweepStaffReminders(D1(), ONE_PM_EDT), { cleared: 0, opened: 0 });
  assert.deepEqual(open(db), []);

  assert.deepEqual(await sweepStaffReminders(D1(), NOON_EDT), { cleared: 0, opened: 3 });
  assert.deepEqual(open(db).sort(), ["expiring:ended-yesterday", "expiring:ends-soon", "recheck:check-lapsing"]);

  assert.equal((await sweepStaffReminders(D1(), NOON_EDT)).opened, 0, "a second noon opens nothing new");
  assert.equal(reminders(db).length, 3);
});

test("a reminder clears itself once the deal moves on, saying how", async () => {
  const db = freshDatabaseWithoutReminders();
  addDeal(db, "renewed", { expires: "datetime('now','+3 days')" });
  addDeal(db, "lapsed", { expires: "datetime('now','+3 days')" });
  addDeal(db, "rechecked", { verified: "datetime('now','-28 days')" });
  addDeal(db, "found");
  db.prepare("UPDATE deals SET status='draft',active=0 WHERE id='found'").run();
  db.prepare("INSERT INTO staff_reminders (id,kind,deal_id,basis,details) VALUES ('r-found','new_draft','found','research','{\"note\":\"Menu page lists it\"}')").run();
  await sweepStaffReminders(D1(), NOON_EDT);
  assert.equal(open(db).length, 4);

  db.prepare("UPDATE deals SET expires_at=datetime('now','+60 days') WHERE id='renewed'").run();
  db.prepare("UPDATE deals SET status='expired',active=0 WHERE id='lapsed'").run();
  db.prepare("UPDATE deals SET verified_at=datetime('now') WHERE id='rechecked'").run();
  db.prepare("UPDATE deals SET status='live',active=1 WHERE id='found'").run();

  // Clearing runs every hour, not only at noon.
  assert.deepEqual(await sweepStaffReminders(D1(), ONE_PM_EDT), { cleared: 4, opened: 0 });
  assert.deepEqual(
    reminders(db).map((r) => [r.deal_id, r.status, r.resolution]),
    [["found", "cleared", "published"], ["lapsed", "cleared", "expired"], ["rechecked", "cleared", "rechecked"], ["renewed", "cleared", "renewed"]],
  );
});

test("a new end date that is itself ending soon gets a new reminder", async () => {
  const db = freshDatabaseWithoutReminders();
  addDeal(db, "deal", { expires: "datetime('now','+2 days')" });
  await sweepStaffReminders(D1(), NOON_EDT);
  db.prepare("UPDATE deals SET expires_at=datetime('now','+6 days') WHERE id='deal'").run();
  await sweepStaffReminders(D1(), NOON_EDT);
  assert.deepEqual(reminders(db).map((r) => r.status), ["cleared", "open"]);
});

test("staff see open reminders and can mark one done, which keeps it closed", async () => {
  const db = freshDatabaseWithoutReminders();
  addDeal(db, "ends-soon", { expires: "datetime('now','+3 days')" });
  addDeal(db, "check-lapsing", { verified: "datetime('now','-28 days')" });
  await sweepStaffReminders(D1(), NOON_EDT);

  // Reminders are deal work: a role that cannot create, publish or verify deals is sent none, so
  // the overview shows it no panel rather than one it could only look at.
  harness.user = ANALYST;
  assert.deepEqual((await (await adminGet(new Request(ADMIN))).json()).staffReminders, [], "read-only staff are sent no reminders");

  harness.user = EDITOR;
  const listed = await (await adminGet(new Request(ADMIN))).json();
  assert.deepEqual(listed.staffReminders.map((r) => r.kind), ["expiring", "recheck"], "endings first");
  harness.user = ANALYST;
  const [ending] = listed.staffReminders;
  assert.equal(ending.restaurant, "Spot");

  const denied = await adminPost(post(ADMIN, { action: "resolve_staff_reminder", id: ending.id }));
  assert.equal(denied.status, 403, "read-only staff cannot close one");

  harness.user = EDITOR;
  const done = await adminPost(post(ADMIN, { action: "resolve_staff_reminder", id: ending.id, notes: "Called, ends Sunday" }));
  assert.equal(done.status, 200, await done.clone().text());
  const row = db.prepare("SELECT status,resolution,resolved_by,note FROM staff_reminders WHERE id=?").get(ending.id);
  assert.deepEqual({ ...row }, { status: "done", resolution: "confirmed", resolved_by: "staff", note: "Called, ends Sunday" });
  assert.equal(db.prepare("SELECT action FROM audit_log WHERE target_type='staff_reminder'").get()?.action, "resolve_staff_reminder");

  const again = await adminPost(post(ADMIN, { action: "resolve_staff_reminder", id: ending.id }));
  assert.equal(again.status, 409);

  await sweepStaffReminders(D1(), NOON_EDT);
  assert.deepEqual(open(db), ["recheck:check-lapsing"], "done for this end date stays done");
});

test("a daily research migration only ever adds drafts for review", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const { statementsOf } = await import("./migration-d1-limits.test.mjs");
  const dir = new URL("../drizzle/", import.meta.url);
  for (const file of readdirSync(dir).filter((name) => /_daily_research_/.test(name))) {
    for (const { text, literals } of statementsOf(readFileSync(new URL(file, dir), "utf8"))) {
      assert.doesNotMatch(text, /\bUPDATE\b|\bDELETE\b|\bREPLACE\b/i, `${file}: research only adds rows`);
      if (!/INSERT\s+INTO\s+deals\s*\(/i.test(text)) continue;
      assert.ok(literals.includes("draft"), `${file}: a research deal is a draft`);
      assert.ok(literals.includes("needs_review"), `${file}: a research deal waits for review`);
      assert.ok(!literals.includes("live") && !literals.includes("verified"), `${file}: research never publishes or verifies`);
    }
  }
});
