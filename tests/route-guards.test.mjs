import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { freshDatabase, harness, post } from "./route-harness.mjs";
import { code } from "./source.mjs";

// The front door of three API routes, run for real: who gets past the origin check, what a body
// that is not JSON gets back, and what the profile form may store as a timezone.

const { POST: affiliatePost } = await import("../app/api/affiliate/route.ts");
const { POST: iapPost } = await import("../app/api/iap/apple/route.ts");
const { POST: userPost } = await import("../app/api/user/route.ts");

const AFFILIATE = "https://radar.cheap/api/affiliate";
const IAP = "https://radar.cheap/api/iap/apple";
const USER = "https://radar.cheap/api/user";

function affiliateAccount(db) {
  db.prepare("INSERT INTO users (id,email,role) VALUES ('aff','aff@example.test','creator')").run();
  db.prepare("INSERT INTO creator_profiles (handle,user_id,status) VALUES ('aff','aff','active')").run();
  harness.user = { userId: "aff", email: "aff@example.test", role: "creator" };
  // Connect switched on, as it is in production, so an action gets as far as its own handler.
  harness.env.STRIPE_SECRET_KEY = "sk_test_unused";
  harness.env.STRIPE_CONNECT_ENABLED = "true";
}

const errorCode = async (response) => (await response.json()).error?.code;

// ── The affiliate portal's origin check ───────────────────────────────────────────────────────

test("a same-origin affiliate request reaches the action it asked for", async () => {
  const db = freshDatabase();
  affiliateAccount(db);
  // No payout account yet, so connect_sync answers from inside its own branch. Before the fix
  // this request got an empty 500: the guard returned `true` as though it were a response.
  const response = await affiliatePost(post(AFFILIATE, { action: "connect_sync" }));
  assert.equal(response.status, 400);
  assert.equal(await errorCode(response), "NO_CONNECT_ACCOUNT");
});

test("a cross-origin affiliate request is refused before anything else happens", async () => {
  const db = freshDatabase();
  affiliateAccount(db);
  const response = await affiliatePost(post(AFFILIATE, { action: "connect_sync" }, { origin: "https://evil.example" }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "INVALID_ORIGIN");
  assert.equal(harness.userLookups, 0, "the guard should stop the request before it looks anyone up");
});

test("an affiliate request with no Origin or Referer is refused", async () => {
  const db = freshDatabase();
  affiliateAccount(db);
  const response = await affiliatePost(post(AFFILIATE, { action: "connect_sync" }, { origin: null }));
  assert.equal(response.status, 403);
  assert.equal(await errorCode(response), "INVALID_ORIGIN");
});

test("every route that checks the origin refuses on false, not on true", () => {
  // The affiliate route was the one caller out of twenty-two that returned the guard's result.
  // Swept rather than spot-checked, so a new route written the same way fails here.
  const routes = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = `${dir}/${name}`;
      if (statSync(path).isDirectory()) walk(path);
      else if (name === "route.ts") routes.push(path);
    }
  };
  walk(fileURLToPath(new URL("../app/api", import.meta.url)));
  let callers = 0;
  for (const path of routes) {
    const source = code(readFileSync(path, "utf8"));
    const calls = source.match(/[^\n]*requireSameOrigin\(request\)[^\n]*/g) || [];
    for (const call of calls) {
      callers += 1;
      assert.match(call, /if \(!\(await requireSameOrigin\(request\)\)\) return apiError\(403, ?"INVALID_ORIGIN"/, `${path}: ${call.trim()}`);
    }
  }
  assert.ok(callers >= 20, `expected the whole set of callers, found ${callers}`);
});

// ── Bodies that are not JSON ──────────────────────────────────────────────────────────────────

test("an affiliate request whose body is not JSON gets a 400, not a 500", async () => {
  const db = freshDatabase();
  affiliateAccount(db);
  const response = await affiliatePost(post(AFFILIATE, "not json"));
  assert.equal(response.status, 400);
  assert.equal(await errorCode(response), "INVALID_REQUEST");
});

test("a purchase report whose body is not JSON gets a 400, not a 500", async () => {
  freshDatabase();
  harness.user = { userId: "buyer", email: "buyer@example.test", role: "user" };
  Object.assign(harness.env, {
    APPLE_IAP_KEY_ID: "KEY", APPLE_IAP_ISSUER_ID: "ISSUER", APPLE_IAP_PRIVATE_KEY: "unused", APPLE_IAP_BUNDLE_ID: "cheap.radar.app",
  });
  const request = post(IAP, "{", { origin: null, headers: { authorization: "Bearer token" } });
  const response = await iapPost(request);
  assert.equal(response.status, 400);
  assert.equal(await errorCode(response), "INVALID_REQUEST");

  // A readable body still goes on to be checked as it always was.
  const unreadable = await iapPost(post(IAP, { transactionId: "abc" }, { origin: null, headers: { authorization: "Bearer token" } }));
  assert.equal(unreadable.status, 422);
  assert.equal(await errorCode(unreadable), "TRANSACTION_REQUIRED");
});

// ── The profile's timezone ────────────────────────────────────────────────────────────────────

function profileAccount(db) {
  db.prepare("INSERT INTO users (id,email,timezone) VALUES ('me','me@example.test','America/Vancouver')").run();
  db.prepare("INSERT INTO notification_preferences (user_id,timezone) VALUES ('me','America/Vancouver')").run();
  harness.user = { userId: "me", email: "me@example.test", role: "user" };
}
const stored = (db) => ({
  user: db.prepare("SELECT timezone FROM users WHERE id='me'").get().timezone,
  alerts: db.prepare("SELECT timezone FROM notification_preferences WHERE user_id='me'").get().timezone,
});
const saveProfile = (timezone) => userPost(post(USER, { action: "profile", name: "Me", language: "en", country: "CA", distanceUnit: "km", timezone }));

test("a timezone the runtime does not know is refused, and nothing is stored", async () => {
  // Each of these throws in Intl.DateTimeFormat, which is what the digest job calls with it.
  for (const typed of ["Toronto", "Eastern", "UTC-5", "GMT-5", "America/Torotno"]) {
    const db = freshDatabase();
    profileAccount(db);
    const response = await saveProfile(typed);
    assert.equal(response.status, 422, `${typed} should be refused`);
    assert.equal(await errorCode(response), "INVALID_TIMEZONE");
    assert.deepEqual(stored(db), { user: "America/Vancouver", alerts: "America/Vancouver" }, `${typed} should not reach either table`);
  }
});

test("a known timezone is stored in the runtime's own spelling, on the profile and the alerts", async () => {
  const db = freshDatabase();
  profileAccount(db);
  const response = await saveProfile("america/toronto");
  assert.equal(response.status, 200);
  assert.deepEqual(stored(db), { user: "America/Toronto", alerts: "America/Toronto" });
});

test("a profile saved without a timezone still means Toronto", async () => {
  const db = freshDatabase();
  profileAccount(db);
  assert.equal((await saveProfile("")).status, 200);
  assert.deepEqual(stored(db), { user: "America/Toronto", alerts: "America/Toronto" });
});

test("the dashboard offers the zones as a list rather than a blank box", () => {
  const dashboard = code(readFileSync(new URL("../app/[locale]/dashboard/sections/AccountSection.tsx", import.meta.url), "utf8"));
  assert.doesNotMatch(dashboard, /<input name="timezone"/, "a free-text timezone field lets a typo through to the digest job");
  assert.match(dashboard, /<select name="timezone"[^>]*>\{timezoneChoices\(p\.timezone\)\.map/);
});

test("the list of zones keeps the person's own, even when it is not a canonical name", async () => {
  const { timezoneChoices } = await import("../app/timezones.ts");
  const zones = timezoneChoices("America/Toronto");
  assert.ok(zones.length > 100, "the runtime's own list of zones");
  assert.ok(zones.includes("America/Toronto"));
  // Otherwise the select would show the first zone in the list, and saving an unrelated field
  // would quietly move the person to it.
  assert.equal(timezoneChoices("US/Eastern")[0], "US/Eastern");
  assert.equal(timezoneChoices(null).includes("America/Toronto"), true);
});
