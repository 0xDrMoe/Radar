import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { freshDatabase, harness } from "./route-harness.mjs";

// The daily retention sweep (app/retention.ts) and the parts of account deletion that reach rows
// keyed by something other than user_id, run against a database built from the real migrations.

const { isRetentionHour, sweepRetention, RETENTION_HOUR_UTC } = await import("../app/retention.ts");
const { deleteAccount } = await import("../app/account-deletion.ts");

const count = (db, sql, ...args) => db.prepare(sql).get(...args).n;

test("the sweep runs on one hourly tick a day", () => {
  assert.equal(isRetentionHour(new Date(Date.UTC(2026, 9, 7, RETENTION_HOUR_UTC, 0))), true);
  assert.equal(isRetentionHour(new Date(Date.UTC(2026, 9, 7, RETENTION_HOUR_UTC + 1, 0))), false);
});

test("unconfirmed waitlist addresses go 30 days after their link, never before one was sent", async () => {
  const db = freshDatabase();
  const lead = db.prepare("INSERT INTO email_leads(id,email,source,confirmed_at,confirmation_sent_at) VALUES(?,?,'homepage',?,?)");
  lead.run("stale", "stale@example.test", null, "2026-01-01 00:00:00");
  lead.run("fresh", "fresh@example.test", null, new Date(Date.now() - 2 * 86_400_000).toISOString());
  lead.run("never-sent", "waiting@example.test", null, null);
  lead.run("confirmed", "yes@example.test", "2026-01-02 00:00:00", "2026-01-01 00:00:00");
  const removed = await sweepRetention(harness.env.DB);
  assert.equal(removed.unconfirmed_email_leads, 1);
  assert.deepEqual(db.prepare("SELECT id FROM email_leads ORDER BY id").all().map((r) => r.id), ["confirmed", "fresh", "never-sent"]);
});

test("old provider events and dead push tokens are removed; live ones stay", async () => {
  const db = freshDatabase();
  const event = db.prepare("INSERT INTO email_events(id,delivery_id,provider_event_id,type,payload,created_at) VALUES(?,NULL,?,?,'{}',?)");
  event.run("old", "p-old", "email.bounced", "2024-01-01 00:00:00");
  event.run("new", "p-new", "email.opened", new Date().toISOString());
  db.prepare("INSERT INTO users(id,email) VALUES('u1','u1@example.test')").run();
  const token = db.prepare("INSERT INTO device_tokens(id,user_id,token,platform,status,last_seen_at) VALUES(?,?,?,'ios',?,?)");
  token.run("t1", "u1", "dead-old", "revoked", "2026-01-01 00:00:00");
  token.run("t2", "u1", "dead-new", "revoked", new Date().toISOString());
  token.run("t3", "u1", "alive-old", "active", "2025-01-01 00:00:00");
  db.prepare("INSERT INTO email_suppressions(email,reason) VALUES('gone@example.test','bounce')").run();

  const removed = await sweepRetention(harness.env.DB);
  assert.equal(removed.email_events, 1);
  assert.equal(removed.revoked_device_tokens, 1);
  assert.deepEqual(db.prepare("SELECT id FROM email_events").all().map((r) => r.id), ["new"]);
  assert.deepEqual(db.prepare("SELECT token FROM device_tokens ORDER BY token").all().map((r) => r.token), ["alive-old", "dead-new"]);
  assert.equal(count(db, "SELECT COUNT(*) n FROM email_suppressions"), 1, "suppressions are what keep an address unsent; never swept");
});

test("deleting an account also removes its waitlist signups and its provider events", async () => {
  const db = freshDatabase();
  db.prepare("INSERT INTO users(id,email) VALUES('u1','Person@Example.test')").run();
  db.prepare("INSERT INTO users(id,email) VALUES('u2','other@example.test')").run();
  db.prepare("INSERT INTO email_consents(user_id,email,status,source,policy_version) VALUES('u1','alias@example.test','confirmed','dashboard','2026-08-20')").run();
  const lead = db.prepare("INSERT INTO email_leads(id,email,source) VALUES(?,?,'homepage')");
  lead.run("l1", "person@example.test");
  lead.run("l2", "alias@example.test");
  lead.run("l3", "other@example.test");
  const delivery = db.prepare("INSERT INTO email_deliveries(id,user_id,email,status) VALUES(?,?,?,'sent')");
  delivery.run("d1", "u1", "person@example.test");
  delivery.run("d2", "u2", "other@example.test");
  const event = db.prepare("INSERT INTO email_events(id,delivery_id,provider_event_id,type,payload) VALUES(?,?,?,'email.opened','{}')");
  event.run("e1", "d1", "p1");
  event.run("e2", "d2", "p2");
  db.prepare("INSERT INTO email_suppressions(email,reason) VALUES('person@example.test','unsubscribe')").run();

  const failure = await deleteAccount({ userId: "u1", email: "person@example.test" });
  assert.equal(failure, null);
  assert.deepEqual(db.prepare("SELECT id FROM email_leads").all().map((r) => r.id), ["l3"]);
  assert.deepEqual(db.prepare("SELECT id FROM email_events").all().map((r) => r.id), ["e2"]);
  assert.equal(count(db, "SELECT COUNT(*) n FROM users WHERE id='u1'"), 0);
  assert.equal(count(db, "SELECT COUNT(*) n FROM email_suppressions"), 1, "the unsubscribe outlives the account");
});

test("the worker cron runs the sweep and records failures", async () => {
  const worker = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(worker, /isRetentionHour\(/);
  assert.match(worker, /retention_sweep_failed/);
});
