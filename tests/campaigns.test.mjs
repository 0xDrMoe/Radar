// Tracked campaigns (/api/admin/campaigns) and the affiliate console's access rules, run through
// the real handlers against a database built from drizzle/*.sql.
//
// A campaign record is matched to its campaign_visit events by the link itself, so these tests
// write events the way /api/track does and check what each record, and the untracked list, adds up
// to. The affiliate half pins that the money stays with manage_finance on the server, whatever a
// screen draws.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";
import { code } from "./source.mjs";

const { GET: campaignsGet, POST: campaignsPost } = await import("../app/api/admin/campaigns/route.ts");
const { GET: adminGet, POST: adminPost } = await import("../app/api/admin/route.ts");

const URL_BASE = "https://radar.cheap/api/admin/campaigns";
const staff = (userId, role, permissions) => ({ userId, email: `${userId}@example.test`, role, displayName: userId, permissions: new Set(["read_admin", ...permissions]) });
const MARKETING = staff("mkt", "marketing", ["manage_email", "manage_sponsorships", "view_analytics", "manage_campaigns"]);
const ANALYST = staff("analyst", "analyst", ["view_analytics"]);
const FINANCE = staff("fin", "finance_manager", ["manage_finance", "manage_sponsorships", "view_analytics"]);
const MODERATOR = staff("mod", "moderator", ["moderate_suggestions", "moderate_feedback"]);
const ADMIN = staff("admin", "admin", ["manage_users", "manage_finance", "manage_campaigns", "view_analytics"]);

function seed() {
  const db = freshDatabase();
  const user = db.prepare("INSERT INTO users (id,email,name,role) VALUES (?,?,?,?)");
  user.run("mkt", "mkt@example.test", "Mia Marketing", "marketing");
  user.run("fin", "fin@example.test", "Fin Ance", "finance_manager");
  user.run("reader", "reader@example.test", "A Reader", "user");
  user.run("maya-user", "maya@example.test", "Maya", "creator");
  db.prepare("INSERT INTO creator_profiles (user_id,handle,display_name,status) VALUES ('maya-user','maya','Maya Eats','active')").run();
  return db;
}

/** One visit, as /api/track writes it. `daysAgo` places it in or out of the window. */
function visit(db, { source, campaign = null, creator = null, creatorCampaign = null, market = null, daysAgo = 1 }) {
  db.prepare(`INSERT INTO product_events (id,type,market,properties,created_at) VALUES (?,?,?,?,datetime('now',?))`).run(
    crypto.randomUUID(), "campaign_visit", market,
    JSON.stringify({ source, campaign, medium: null, path: "/", creator, creatorCampaign }),
    `-${daysAgo} days`,
  );
}

const create = async (body) => {
  const response = await campaignsPost(post(URL_BASE, { op: "create", ...body }));
  return { status: response.status, body: await response.json() };
};
const list = async () => {
  const response = await campaignsGet(new Request(URL_BASE));
  return { status: response.status, body: await response.json() };
};
const detail = async (id) => {
  const response = await campaignsGet(new Request(`${URL_BASE}?id=${encodeURIComponent(id)}`));
  return { status: response.status, body: await response.json() };
};

// ── Who can read and write ───────────────────────────────────────────────────────────────────

test("campaign, analytics and finance staff can read campaigns; nobody else can", async () => {
  seed();
  for (const user of [MARKETING, ANALYST, FINANCE]) {
    harness.user = user;
    assert.equal((await list()).status, 200, `${user.role} reads campaigns`);
  }
  harness.user = MODERATOR;
  assert.equal((await list()).status, 403);
  harness.user = null;
  assert.equal((await list()).status, 401);
});

test("only manage_campaigns creates or edits, and only from the workspace's own origin", async () => {
  const db = seed();
  harness.user = ANALYST;
  const refused = await create({ name: "Spring", source: "instagram" });
  assert.equal(refused.status, 403);
  harness.user = FINANCE;
  assert.equal((await create({ name: "Spring", source: "instagram" })).status, 403, "finance reads campaigns but does not edit them");
  harness.user = MARKETING;
  const crossSite = await campaignsPost(post(URL_BASE, { op: "create", name: "Spring", source: "instagram" }, { origin: "https://evil.example" }));
  assert.equal(crossSite.status, 403);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM campaigns").get().n, 0);
  const made = await create({ name: "Spring", source: "instagram" });
  assert.equal(made.status, 201, JSON.stringify(made.body));
});

// ── Validation ───────────────────────────────────────────────────────────────────────────────

test("a campaign needs a name, a slug source and dates that make sense", async () => {
  const db = seed();
  harness.user = MARKETING;
  const fields = async (body) => (await create(body)).body.error?.fields || {};
  assert.ok((await fields({ name: "", source: "instagram" })).name);
  assert.ok((await fields({ name: "x".repeat(81), source: "instagram" })).name, "names stop at 80 characters");
  assert.ok((await fields({ name: "Spring", source: "" })).source);
  assert.ok((await fields({ name: "Spring", source: "Insta gram!" })).source, "a source is a slug");
  assert.ok((await fields({ name: "Spring", source: "instagram", startsAt: "2026-02-30" })).startsAt, "a date that does not exist is refused");
  assert.ok((await fields({ name: "Spring", source: "instagram", startsAt: "2026-05-10", endsAt: "2026-05-01" })).endsAt, "the end cannot come before the start");
  assert.ok((await fields({ name: "Spring", source: "instagram", status: "running" })).status);
  assert.ok((await fields({ name: "Spring", source: "instagram", ownerId: "reader" })).ownerId, "an owner is a member of staff");
  assert.ok((await fields({ name: "Spring", creatorHandle: "nobody" })).creatorHandle, "an affiliate handle has to exist");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM campaigns").get().n, 0, "nothing invalid was stored");

  const ok = await create({ name: "Spring", source: "instagram", campaign: "patio", landingCity: "Toronto", startsAt: "2026-05-01", endsAt: "2026-05-01" });
  assert.equal(ok.status, 201, "a one-day campaign is fine");
  const row = db.prepare("SELECT * FROM campaigns WHERE id=?").get(ok.body.id);
  assert.deepEqual([row.owner_id, row.created_by, row.status, row.landing_city], ["mkt", "mkt", "active", "Toronto"]);
});

test("one record per link, and every write is audited", async () => {
  const db = seed();
  harness.user = MARKETING;
  const first = await create({ name: "Spring", source: "instagram", campaign: "patio" });
  const again = await create({ name: "Spring again", source: "Instagram", campaign: "PATIO" });
  assert.equal(again.status, 409, "the same link, however it is typed, has one record");
  assert.ok(again.body.error.fields.campaign);
  assert.equal((await create({ name: "Other", source: "instagram", campaign: "fall" })).status, 201, "a different label is a different link");

  const updated = await campaignsPost(post(URL_BASE, { op: "update", id: first.body.id, name: "Spring patio", source: "instagram", campaign: "patio", status: "paused", ownerId: "fin", notes: "Paused for the rain" }));
  assert.equal(updated.status, 200, JSON.stringify(await updated.clone().json()));
  const row = db.prepare("SELECT * FROM campaigns WHERE id=?").get(first.body.id);
  assert.deepEqual([row.name, row.status, row.owner_id, row.created_by], ["Spring patio", "paused", "fin", "mkt"]);
  // Moving it onto a link another record owns is the same clash.
  const clash = await campaignsPost(post(URL_BASE, { op: "update", id: first.body.id, name: "Spring patio", source: "instagram", campaign: "fall" }));
  assert.equal(clash.status, 409);

  const ended = await campaignsPost(post(URL_BASE, { op: "status", id: first.body.id, status: "ended" }));
  assert.equal(ended.status, 200);
  assert.equal(db.prepare("SELECT status FROM campaigns WHERE id=?").get(first.body.id).status, "ended");

  const audit = db.prepare("SELECT action,actor_id,target_type,details FROM audit_log WHERE target_type='campaign' ORDER BY id").all();
  assert.deepEqual(audit.map((entry) => entry.action), ["campaign_create", "campaign_create", "campaign_update", "campaign_update"]);
  assert.ok(audit.every((entry) => entry.actor_id === "mkt"));
  assert.deepEqual(JSON.parse(audit[2].details).status, { from: "active", to: "paused" });
  assert.deepEqual(JSON.parse(audit[3].details).status, { from: "paused", to: "ended" });
});

// ── Performance and untracked traffic ────────────────────────────────────────────────────────

test("each record counts its own link's visits, and traffic nobody tracks is listed, not lost", async () => {
  const db = seed();
  visit(db, { source: "instagram", campaign: "patio", market: "Toronto" });
  visit(db, { source: "instagram", campaign: "patio", market: "Toronto", daysAgo: 3 });
  visit(db, { source: "instagram", campaign: "patio", market: "Ottawa", daysAgo: 40 });
  visit(db, { source: "instagram", campaign: "patio", market: "Toronto", daysAgo: 400 }); // outside the window
  visit(db, { source: "newsletter", campaign: "october" });
  // An affiliate's labeled link, and their plain link.
  visit(db, { source: "creator", campaign: "tiktok-1", creator: "maya", creatorCampaign: "tiktok-1", market: "Halifax" });
  visit(db, { source: "creator", campaign: "tiktok-1", creator: "maya", creatorCampaign: "tiktok-1", market: "Halifax", daysAgo: 2 });
  visit(db, { source: "creator", campaign: "maya", creator: "maya", creatorCampaign: null });
  // Two accounts the labeled link brought in, one the plain link did.
  const referred = db.prepare("INSERT INTO users (id,email,role,referred_by,referred_campaign) VALUES (?,?,'user',?,?)");
  referred.run("r1", "r1@example.test", "maya", "tiktok-1");
  referred.run("r2", "r2@example.test", "maya", "tiktok-1");
  referred.run("r3", "r3@example.test", "maya", null);

  harness.user = MARKETING;
  const utm = await create({ name: "Patio", source: "instagram", campaign: "patio" });
  const affiliate = await create({ name: "Maya TikTok", creatorHandle: "maya", campaign: "tiktok-1", source: "ignored" });
  assert.equal(affiliate.status, 201, JSON.stringify(affiliate.body));
  const stored = db.prepare("SELECT source,medium,creator_handle FROM campaigns WHERE id=?").get(affiliate.body.id);
  assert.deepEqual({ ...stored }, { source: "creator", medium: "link", creator_handle: "maya" }, "an affiliate link records source creator");
  // The affiliate's name and rate are never copied onto the campaign.
  const columns = db.prepare("PRAGMA table_info(campaigns)").all().map((column) => column.name);
  assert.ok(!columns.includes("commission_rate_bps") && !columns.includes("display_name"));

  const { body } = await list();
  const byId = new Map(body.campaigns.map((row) => [row.id, row]));
  assert.equal(byId.get(utm.body.id).visits, 3, "three visits in the window; the 400-day-old one is outside it");
  assert.equal(byId.get(utm.body.id).visits30, 2);
  assert.equal(byId.get(utm.body.id).signups, null, "a utm link has no attributable sign-ups");
  assert.equal(byId.get(affiliate.body.id).visits, 2, "only the labeled link's visits, not the plain link's");
  assert.equal(byId.get(affiliate.body.id).signups, 2);
  assert.equal(byId.get(affiliate.body.id).owner_name, "Mia Marketing");

  const untracked = body.untracked.map((row) => `${row.creator || "-"}|${row.source}|${row.campaign || ""}|${row.visits}`).sort();
  assert.deepEqual(untracked, ["-|newsletter|october|1", "maya|creator||1"]);

  const one = await detail(utm.body.id);
  assert.equal(one.status, 200);
  assert.equal(one.body.totals.visits, 3);
  assert.deepEqual(one.body.markets.map((row) => [row.market, row.visits]), [["Toronto", 2], ["Ottawa", 1]]);
  assert.equal(one.body.trend.length, 3, "one entry per day with traffic");
  const theirs = await detail(affiliate.body.id);
  assert.equal(theirs.body.totals.signups, 2);
  assert.deepEqual(theirs.body.markets.map((row) => row.market), ["Halifax"]);
  assert.equal((await detail("campaign-missing")).status, 404);
});

test("every read of product_events is bounded to the window and limited", async () => {
  const source = code(await readFile(new URL("../app/api/admin/campaigns/route.ts", import.meta.url), "utf8"));
  const reads = source.split("FROM product_events").slice(1);
  assert.ok(reads.length >= 3);
  for (const read of reads) {
    const statement = read.slice(0, read.indexOf("`"));
    assert.match(statement, /type='campaign_visit' AND created_at>=\$\{SINCE\}/, "scoped to campaign visits in the window, so the type/created_at index applies");
    assert.match(statement, /LIMIT/, "and limited");
  }
  assert.match(source, /const WINDOW_DAYS = 180;/);
});

// ── Affiliates are finance's ─────────────────────────────────────────────────────────────────

function seedAffiliateMoney(db) {
  db.prepare("INSERT INTO creator_applications (user_id,email,requested_handle,channel_url) VALUES ('reader','reader@example.test','reader','https://example.test/reader')").run();
  db.prepare("INSERT INTO creator_commissions (handle,invoice_id,gross_amount,currency,rate_bps,commission_amount,status) VALUES ('maya','in_1',1000,'cad',2000,200,'approved')").run();
}

test("a marketing role is refused every affiliate action and is sent no affiliate data", async () => {
  const db = seed();
  seedAffiliateMoney(db);
  const commission = db.prepare("SELECT id FROM creator_commissions").get().id;
  const application = db.prepare("SELECT id FROM creator_applications").get().id;
  harness.user = MARKETING;
  const call = async (body) => (await adminPost(post("https://radar.cheap/api/admin", body))).status;
  assert.equal(await call({ action: "creator_commission", id: commission, status: "void" }), 403);
  assert.equal(await call({ action: "creator_application", id: application, decision: "reject", reason: "No" }), 403);
  assert.equal(await call({ action: "affiliate_payout", handle: "maya", currency: "cad", confirmed: true }), 403);
  assert.equal(db.prepare("SELECT status FROM creator_commissions WHERE id=?").get(commission).status, "approved");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM owner_approvals").get().n, 0);

  const payload = await (await adminGet(new Request("https://radar.cheap/api/admin"))).json();
  for (const key of ["creatorApplications", "creatorCommissions", "creatorPayouts", "affiliateBalances", "creatorRoster", "creatorProfiles"]) {
    assert.deepEqual(payload[key] || [], [], `${key} is finance's`);
  }
  // Campaign traffic is theirs to read, and it is still there.
  assert.ok(Array.isArray(payload.campaignVisits));

  // The same reads for a finance manager are not empty, so the check above means something.
  harness.user = FINANCE;
  const finance = await (await adminGet(new Request("https://radar.cheap/api/admin"))).json();
  assert.equal(finance.creatorCommissions.length, 1);
  assert.equal(finance.creatorApplications.length, 1);
  assert.equal(finance.creatorRoster.length, 1);
});

test("rejecting an application needs a reason, and paying needs a confirmation and an owner", async () => {
  const db = seed();
  seedAffiliateMoney(db);
  const application = db.prepare("SELECT id FROM creator_applications").get().id;
  harness.user = FINANCE;
  const call = async (body) => {
    const response = await adminPost(post("https://radar.cheap/api/admin", body));
    return { status: response.status, body: await response.json() };
  };
  const blank = await call({ action: "creator_application", id: application, decision: "reject", reason: "  " });
  assert.equal(blank.status, 422);
  assert.equal(blank.body.error.code, "REASON_REQUIRED");
  assert.equal(db.prepare("SELECT status FROM creator_applications WHERE id=?").get(application).status, "pending");

  assert.equal((await call({ action: "affiliate_payout", handle: "maya", currency: "cad" })).status, 409, "unconfirmed, nothing happens");
  const asked = await call({ action: "affiliate_payout", handle: "maya", currency: "cad", confirmed: true });
  assert.equal(asked.status, 202, "a finance manager can only ask");
  assert.equal(asked.body.pending, true);
  assert.match(asked.body.warning, /owner/);
  const approval = db.prepare("SELECT action,summary FROM owner_approvals").get();
  assert.equal(approval.action, "affiliate_payout");
  // The Affiliates tab reads this sentence to show the payout as waiting; keep the two in step.
  assert.match(approval.summary, /^Pay maya what they are owed in CAD/);
  harness.user = ADMIN;
  assert.equal((await call({ action: "affiliate_payout", handle: "maya", currency: "cad", confirmed: true })).status, 202, "an admin can only ask too");
});
