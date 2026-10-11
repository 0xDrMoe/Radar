import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post, withFetch } from "./route-harness.mjs";

// The hourly jobs, run for real: what a win-back's unsubscribe link carries, what one bad row does
// to everybody else's roundup, and where a billing step that throws leaves its trace.

const { POST: billingPost } = await import("../app/api/jobs/billing/route.ts");
const { POST: digestPost } = await import("../app/api/jobs/digests/route.ts");
const { POST: unsubscribePost } = await import("../app/api/email/unsubscribe/route.ts");

const DAY = 86_400_000;
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const job = (url, secret) => new Request(url, { method: "POST", headers: { authorization: `Bearer ${secret}` } });

/** A fixed-offset zone whose local hour is `hour` right now, so a clock-gated send is due. */
function zoneAtHour(hour) {
  let offset = (hour - new Date().getUTCHours() + 24) % 24;
  if (offset > 14) offset -= 24;
  // POSIX sign convention: Etc/GMT-5 is five hours ahead of UTC.
  return offset === 0 ? "Etc/GMT" : offset > 0 ? `Etc/GMT-${offset}` : `Etc/GMT+${-offset}`;
}

function emailSwitchedOn() {
  Object.assign(harness.env, {
    EMAIL_PILOT_ENABLED: "true",
    EMAIL_KILL_SWITCH: "false",
    RESEND_API_KEY: "re_test",
    RESEND_FROM_EMAIL: "Radar <support@example.test>",
    EMAIL_UNSUBSCRIBE_SECRET: "unsubscribe-secret",
    BILLING_JOB_SECRET: "billing-secret",
    PUBLIC_APP_URL: "https://radar.cheap",
  });
}

/** Somebody who left Pro 45 days ago, gave email consent, and whose city has gained a deal since. */
function lapsed(db, id, email) {
  db.prepare("INSERT INTO users (id,email,plan,plan_status,timezone) VALUES (?,?,'free','canceled',?)").run(id, email, zoneAtHour(10));
  // As /api/user writes it: the address exactly as the account has it.
  db.prepare("INSERT INTO email_consents (user_id,email,status,source,policy_version) VALUES (?,?,'confirmed','dashboard','2026-01')").run(id, email);
  db.prepare("INSERT INTO product_events (id,user_id,type,created_at) VALUES (?,?,'subscription_canceled',?)").run(`${id}-lapse`, id, sqlTime(Date.now() - 45 * DAY));
}

function newDeal(db, id = "new-deal") {
  db.prepare(`INSERT INTO deals (id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,created_at)
    VALUES (?,'Somewhere','Two tacos','Food deal','Mexican','Daily','Ottawa','K1P','1 Bank St','$5','🌮','https://example.test',?)`).run(id, sqlTime(Date.now()));
}

const resendAccepts = () => new Response(JSON.stringify({ id: "re_sent" }), { status: 200, headers: { "content-type": "application/json" } });

// ── The win-back's unsubscribe link ───────────────────────────────────────────────────────────

test("a win-back's unsubscribe link carries the address, and unsubscribes", async () => {
  const db = freshDatabase();
  emailSwitchedOn();
  lapsed(db, "gone", "Gone.Away@Example.test");
  newDeal(db);

  const sent = await withFetch(resendAccepts, async (calls) => {
    const response = await billingPost(job("https://radar.cheap/api/jobs/billing", "billing-secret"));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).winback.sent, 1);
    return calls.filter((call) => call.url.startsWith("https://api.resend.com/"));
  });
  assert.equal(sent.length, 1);
  const { text } = JSON.parse(sent[0].body);
  const link = new URL(text.match(/Unsubscribe: (\S+)/)[1]);
  assert.equal(link.pathname, "/unsubscribe");
  // The page keeps its button disabled without the address, and the route cannot check the token
  // without it, since the token is signed over the address.
  assert.equal(link.searchParams.get("email"), "Gone.Away@Example.test");
  assert.ok(link.searchParams.get("token"));

  harness.headers = new Headers({ host: "radar.cheap" });
  const unsubscribed = await unsubscribePost(post("https://radar.cheap/api/email/unsubscribe", {
    email: link.searchParams.get("email"),
    token: link.searchParams.get("token"),
  }));
  assert.equal(unsubscribed.status, 200, "the link's own parameters should be enough to unsubscribe");
  assert.ok(db.prepare("SELECT 1 FROM email_suppressions WHERE email='gone.away@example.test'").get());
});

test("a marketing email carries one-click unsubscribe headers that work without the site's origin", async () => {
  const db = freshDatabase();
  emailSwitchedOn();
  lapsed(db, "gone", "Gone.Away@Example.test");
  newDeal(db);
  const sent = await withFetch(resendAccepts, async (calls) => {
    await billingPost(job("https://radar.cheap/api/jobs/billing", "billing-secret"));
    return calls.filter((call) => call.url.startsWith("https://api.resend.com/"));
  });
  const { headers } = JSON.parse(sent[0].body);
  assert.equal(headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  const target = new URL(headers["List-Unsubscribe"].match(/^<([^>]+)>$/)[1]);
  assert.equal(target.pathname, "/api/email/unsubscribe");

  // What Gmail's button sends (RFC 8058): a form POST from its own servers, no Origin, no cookie.
  harness.headers = new Headers({ host: "radar.cheap" });
  const forged = new URL(target); forged.searchParams.set("token", "not-the-token");
  const refused = await unsubscribePost(new Request(forged, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  assert.equal(refused.status, 400, "the signed token is what authenticates it");
  assert.ok(!db.prepare("SELECT 1 FROM email_suppressions WHERE email='gone.away@example.test'").get());
  const response = await unsubscribePost(new Request(target, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }));
  assert.equal(response.status, 200);
  assert.ok(db.prepare("SELECT 1 FROM email_suppressions WHERE email='gone.away@example.test'").get());
});

test("a suppressed address gets no win-back, whatever the case of the users row", async () => {
  // Suppressions are stored lowercased; the users row and its consent keep their capitals. An
  // exact match between the two found no suppression, so a bounced address that still had its
  // consent row would have been mailed again.
  const db = freshDatabase();
  emailSwitchedOn();
  lapsed(db, "gone", "Gone.Away@Example.test");
  newDeal(db);
  db.prepare("INSERT INTO email_suppressions (email,reason) VALUES ('gone.away@example.test','bounced')").run();

  await withFetch(resendAccepts, async (calls) => {
    const response = await billingPost(job("https://radar.cheap/api/jobs/billing", "billing-secret"));
    assert.equal((await response.json()).winback.sent, 0);
    assert.equal(calls.filter((call) => call.url.startsWith("https://api.resend.com/")).length, 0);
  });
});

test("two confirmed consent rows do not send somebody two win-backs", async () => {
  const db = freshDatabase();
  emailSwitchedOn();
  lapsed(db, "gone", "gone@example.test");
  db.prepare("INSERT INTO email_consents (user_id,email,status,source,policy_version) VALUES ('gone','gone@example.test','confirmed','dashboard','2026-02')").run();
  newDeal(db);
  await withFetch(resendAccepts, async (calls) => {
    await billingPost(job("https://radar.cheap/api/jobs/billing", "billing-secret"));
    assert.equal(calls.filter((call) => call.url.startsWith("https://api.resend.com/")).length, 1);
  });
});

// ── A billing step that throws ────────────────────────────────────────────────────────────────

test("a billing step that throws is recorded in audit_log and fails the run", async () => {
  const db = freshDatabase();
  emailSwitchedOn();
  // The grant-expiry step's query breaks, as a bad migration would break it.
  harness.failSql = /FROM plan_grants WHERE revoked_at IS NULL AND expires_at < date\('now'\)/;
  const response = await billingPost(job("https://radar.cheap/api/jobs/billing", "billing-secret"));
  harness.failSql = null;

  // Not a 200: the cron only reads the status, and a 200 is what hid this before.
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.match(body.grants.error, /simulated failure/);
  // The other steps still ran; one failing must not take the rest down.
  assert.deepEqual(body.grace, { canceled: 0, failed: 0 });
  assert.deepEqual(body.pauses, { resumed: 0, failed: 0 });

  const rows = db.prepare("SELECT actor_id,action,target_type,target_id,details FROM audit_log WHERE action='billing_step_failed'").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_id, "billing");
  const details = JSON.parse(rows[0].details);
  assert.deepEqual(Object.keys(details.steps), ["grants"]);
  assert.match(details.steps.grants, /simulated failure/);
});

test("a billing run with nothing failing answers 200 and writes no failure", async () => {
  const db = freshDatabase();
  emailSwitchedOn();
  const response = await billingPost(job("https://radar.cheap/api/jobs/billing", "billing-secret"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action='billing_step_failed'").get().n, 0);
});

// ── One bad timezone in the digest ────────────────────────────────────────────────────────────

test("a recipient with an unknown timezone is skipped, and everybody after them still gets theirs", async () => {
  const db = freshDatabase();
  harness.env.EMAIL_JOB_SECRET = "digest-secret";
  newDeal(db);
  const now = new Date();
  const due = { days: JSON.stringify([now.getUTCDay()]), time: `${String(now.getUTCHours()).padStart(2, "0")}:00` };
  // Push-only recipients (email stays off), so the whole run is visible in one fetch. On Pro, because
  // the hour below is whatever hour the test runs in, and only Pro chooses its hour.
  const recipient = (id, timezone) => {
    db.prepare("INSERT INTO users (id,email,timezone,plan,plan_status) VALUES (?,?,?,'pro','active')").run(id, `${id}@example.test`, timezone);
    db.prepare("INSERT INTO notification_preferences (user_id,days,delivery_time,timezone,enabled) VALUES (?,?,?,?,1)").run(id, due.days, due.time, timezone);
    db.prepare("INSERT INTO device_tokens (id,user_id,token,platform) VALUES (?,?,?,'ios')").run(`device-${id}`, id, `ExponentPushToken[${id}]`);
  };
  // First in the loop, and a value the old free-text field would have stored.
  recipient("typo", "Toronto");
  recipient("fine", "UTC");

  const pushed = await withFetch(
    (call) => new Response(JSON.stringify({ data: JSON.parse(call.body).map(() => ({ status: "ok", id: "ticket" })) }), { status: 200 }),
    async (calls) => {
      const response = await digestPost(job("https://radar.cheap/api/jobs/digests", "digest-secret"));
      assert.equal(response.status, 200, "one bad row used to throw out of the loop and fail the whole run");
      const body = await response.json();
      assert.equal(body.skipped, 1);
      assert.equal(body.push.sent, 1);
      return calls.filter((call) => call.url.includes("exp.host")).flatMap((call) => JSON.parse(call.body));
    },
  );
  assert.deepEqual(pushed.map((message) => message.to), ["ExponentPushToken[fine]"]);

  const run = db.prepare("SELECT status,details FROM email_job_runs").get();
  assert.equal(run.status, "completed_with_errors", "the run should finish, and say it was not clean");
  assert.equal(JSON.parse(run.details).skipped, 1);
  const logged = db.prepare("SELECT details FROM audit_log WHERE action='digest_recipient_failed'").all();
  assert.equal(logged.length, 1);
  const details = JSON.parse(logged[0].details);
  assert.equal(details.recipients[0].userId, "typo");
  assert.match(details.recipients[0].error, /time ?zone/i);
});

test("an account that left Pro gets the free schedule, whatever it saved while it was on Pro", async () => {
  // The dashboard clamps a free account's days and hour when they are saved, but a schedule saved
  // on Pro used to keep sending after the plan lapsed, for as long as nobody re-saved the form.
  // Both accounts saved 19:00 every day on Pro, in a zone where it is 08:00 now: the subscriber is
  // not due, and the lapsed account is, because on Free the roundup goes at 08:00 on the first day.
  const db = freshDatabase();
  harness.env.EMAIL_JOB_SECRET = "digest-secret";
  newDeal(db);
  const zone = zoneAtHour(8);
  const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(new Date().toLocaleString("en-US", { timeZone: zone, weekday: "short" }));
  const days = JSON.stringify([today, ...[0, 1, 2, 3, 4, 5, 6].filter((day) => day !== today)]);
  const recipient = (id, status) => {
    db.prepare("INSERT INTO users (id,email,timezone,plan,plan_status) VALUES (?,?,?,'pro',?)").run(id, `${id}@example.test`, zone, status);
    db.prepare("INSERT INTO notification_preferences (user_id,days,delivery_time,timezone,enabled) VALUES (?,?,'19:00',?,1)").run(id, days, zone);
    db.prepare("INSERT INTO device_tokens (id,user_id,token,platform) VALUES (?,?,?,'ios')").run(`device-${id}`, id, `ExponentPushToken[${id}]`);
  };
  recipient("subscriber", "active");
  recipient("lapsed", "canceled");
  const pushed = await withFetch(
    (call) => new Response(JSON.stringify({ data: JSON.parse(call.body).map(() => ({ status: "ok", id: "ticket" })) }), { status: 200 }),
    async (calls) => {
      const response = await digestPost(job("https://radar.cheap/api/jobs/digests", "digest-secret"));
      assert.equal(response.status, 200);
      return calls.filter((call) => call.url.includes("exp.host")).flatMap((call) => JSON.parse(call.body)).map((message) => message.to);
    },
  );
  assert.deepEqual(pushed, ["ExponentPushToken[lapsed]"], "Pro keeps its 19:00; the lapsed account is sent at the free hour");
});
