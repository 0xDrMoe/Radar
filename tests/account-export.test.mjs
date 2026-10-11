// "Download my data" has to be everything, and the way it stops being everything is a new table
// nobody remembers to add (the export once left out subscriptions, referrals, devices, cancellations
// and creator earnings). So the tables it reads are checked against the migrations, and the route is
// run for real (tests/route-harness.mjs) to check it returns this person's rows, nobody else's, and
// no credentials.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { freshDatabase, harness } from "./route-harness.mjs";

const { GET } = await import("../app/api/user/export/route.ts");
const source = await readFile(new URL("../app/account-export.ts", import.meta.url), "utf8");

/** Every table in the migrations with a user_id column, as tests/account-deletion.test.mjs finds them. */
async function tablesWithUserId() {
  const dir = new URL("../drizzle/", import.meta.url);
  const found = new Set();
  for (const name of (await readdir(dir)).filter((file) => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(name, dir), "utf8");
    for (const match of sql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+[`"]?(\w+)[`"]?\s*\(([\s\S]*?)\n\)/g)) {
      if (/\buser_id\b/.test(match[2])) found.add(match[1]);
    }
    for (const match of sql.matchAll(/ALTER TABLE\s+[`"]?(\w+)[`"]?\s+ADD(?: COLUMN)?\s+[`"]?user_id[`"]?/gi)) found.add(match[1]);
  }
  return found;
}

test("every table holding personal rows is in the export", async () => {
  const read = new Set([...source.matchAll(/\bFROM (\w+)/g)].map((match) => match[1]));
  const missing = [...(await tablesWithUserId())].filter((table) => !read.has(table)).sort();
  assert.deepEqual(missing, [], `These tables have a user_id and are missing from app/account-export.ts: ${missing.join(", ")}`);
});

test("signed out gets nothing", async () => {
  freshDatabase();
  const response = await GET();
  assert.equal(response.status, 401);
});

/** Two accounts with a row in every personal table; the export for "me" must hold only mine. */
function seed(db) {
  db.prepare(`INSERT INTO users (id,email,name,plan,plan_status,stripe_customer_id,stripe_subscription_id,referred_by,referred_campaign,hidden)
    VALUES ('me','Me@Example.test','Me','pro','active','cus_SECRET','sub_SECRET','maple','spring',1), ('other','other@example.test','Other','free','inactive',NULL,NULL,NULL,NULL,0)`).run();
  for (const user of ["me", "other"]) {
    const tag = user === "me" ? "mine" : "theirs";
    db.prepare("INSERT INTO auth_identities (provider,subject,user_id,verified_email) VALUES ('clerk',?,?,?)").run(`subject_${tag}`, user, `${tag}@example.test`);
    db.prepare("INSERT INTO user_permissions (user_id,permission) VALUES (?,?)").run(user, `perm_${tag}`);
    db.prepare("INSERT INTO favorites (user_id,deal_id) VALUES (?,?)").run(user, `deal_${tag}`);
    db.prepare("INSERT INTO saved_locations (user_id,label,postal,radius) VALUES (?,?,'K1P',10)").run(user, `area_${tag}`);
    db.prepare("INSERT INTO saved_restaurants (user_id,restaurant_id) VALUES (?,?)").run(user, `saved_${tag}`);
    db.prepare("INSERT INTO excluded_restaurants (user_id,restaurant_id) VALUES (?,?)").run(user, `hidden_${tag}`);
    db.prepare("INSERT INTO device_tokens (id,user_id,token,platform) VALUES (?,?,?,'ios')").run(`dev_${tag}`, user, `ExponentPushToken[${tag}]`);
    db.prepare("INSERT INTO apple_subscriptions (original_transaction_id,user_id,product_id,status,environment) VALUES (?,?,?,'active','Production')").run(`txn_${tag}`, user, `product_${tag}`);
    db.prepare("INSERT INTO plan_grants (user_id,granted_by,reason) VALUES (?,'staff_member',?)").run(user, `grant_${tag}`);
    db.prepare("INSERT INTO cancellation_reasons (user_id,reason,detail) VALUES (?,'price',?)").run(user, `detail_${tag}`);
    db.prepare("INSERT INTO save_offers (user_id,reason,offer) VALUES (?,'price',?)").run(user, `offer_${tag}`);
    db.prepare("INSERT INTO product_events (id,user_id,type) VALUES (?,?,?)").run(`ev_${tag}`, user, `event_${tag}`);
    db.prepare("INSERT INTO creator_commissions (handle,user_id,invoice_id,gross_amount,currency,rate_bps,commission_amount) VALUES ('maple',?,?,999,'cad',2000,200)").run(user, `in_${tag}`);
  }
  db.prepare("INSERT INTO creator_profiles (user_id,handle,notes,stripe_account_id) VALUES ('me','maple','internal staff note','acct_SECRET')").run();
  db.prepare("INSERT INTO creator_payouts (handle,stripe_account_id,stripe_transfer_id,amount,currency,initiated_by) VALUES ('maple','acct_SECRET','tr_SECRET',400,'cad','staff_member')").run();
  db.prepare("INSERT INTO creator_payouts (handle,stripe_account_id,amount,currency) VALUES ('someone-else','acct_x',777,'cad')").run();
  db.prepare("INSERT INTO email_leads (id,email,postal,source) VALUES ('lead1','me@example.test','K1P','homepage'), ('lead2','other@example.test','M5V','homepage')").run();
  db.prepare("INSERT INTO email_suppressions (email,reason) VALUES ('me@example.test','unsubscribed')").run();
}

test("the export holds every kind of data for the signed-in person, and only theirs", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = { userId: "me", email: "me@example.test" };
  const response = await GET();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-disposition"), /attachment; filename="radar-account-export-\d{4}-\d{2}-\d{2}\.json"/);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const text = await response.text();
  const data = JSON.parse(text);

  assert.equal(data.profile.plan, "pro");
  assert.equal(data.profile.plan_status, "active");
  assert.equal(data.profile.referred_by, "maple");
  assert.equal(data.profile.referred_campaign, "spring");
  // saved_restaurants once read columns that do not exist (note, notifications), which failed every export.
  assert.deepEqual(data.savedRestaurants.map((row) => row.restaurant_id), ["saved_mine"]);
  assert.deepEqual(data.trackedAreas.map((row) => row.label), ["area_mine"]);
  assert.deepEqual(data.excludedRestaurants.map((row) => row.restaurant_id), ["hidden_mine"]);
  assert.deepEqual(data.devices.map((row) => row.platform), ["ios"]);
  assert.deepEqual(data.subscription.appleSubscriptions.map((row) => row.product_id), ["product_mine"]);
  assert.deepEqual(data.subscription.planGrants.map((row) => row.reason), ["grant_mine"]);
  assert.deepEqual(data.subscription.cancellationReasons.map((row) => row.detail), ["detail_mine"]);
  assert.deepEqual(data.subscription.saveOffers.map((row) => row.offer), ["offer_mine"]);
  assert.deepEqual(data.signInMethods.map((row) => row.verified_email), ["mine@example.test"]);
  assert.deepEqual(data.permissions.map((row) => row.permission), ["perm_mine"]);
  assert.deepEqual(data.activity.map((row) => row.type), ["event_mine"]);
  assert.deepEqual(data.referralCredits, [{ handle: "maple", campaign: null, created_at: data.referralCredits[0].created_at }]);
  assert.equal(data.creator.profile.handle, "maple");
  // Both subscribers' payments credited the "maple" link, so the creator sees both commissions.
  assert.equal(data.creator.commissions.length, 2);
  assert.deepEqual(data.creator.payouts.map((row) => row.amount), [400]);
  // Email-keyed tables match regardless of case.
  assert.deepEqual(data.emailSignups.map((row) => row.postal), ["K1P"]);
  assert.deepEqual(data.emailSuppressions.map((row) => row.reason), ["unsubscribed"]);

  assert.doesNotMatch(text, /theirs|other@example|M5V|someone-else|777/, "another person's data leaked into the export");
  assert.doesNotMatch(text, /SECRET|ExponentPushToken|subject_|txn_|in_mine|in_theirs/, "a credential or processor id leaked into the export");
  assert.doesNotMatch(text, /staff_member|internal staff note/, "staff-only fields leaked into the export");
  assert.equal("hidden" in data.profile, false);
  for (const row of data.creator.commissions) assert.equal("user_id" in row || "invoice_id" in row, false);
});

test("an account with no creator profile exports empty creator data", async () => {
  const db = freshDatabase();
  db.prepare("INSERT INTO users (id,email) VALUES ('plain','plain@example.test')").run();
  harness.user = { userId: "plain", email: "plain@example.test" };
  const data = await (await GET()).json();
  assert.deepEqual(data.creator, { profile: null, applications: [], commissions: [], payouts: [] });
  assert.deepEqual(data.devices, []);
});

test("an account that no longer exists gets a 404 rather than an empty file", async () => {
  freshDatabase();
  harness.user = { userId: "gone", email: "gone@example.test" };
  assert.equal((await GET()).status, 404);
});
