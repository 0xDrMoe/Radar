import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post, withFetch } from "./route-harness.mjs";

// The fixes from the review made before publishing the source: everything here is something that
// reading the code would have shown an attacker how to do. Each runs against the shipped handler.

const utils = await import("../app/api-utils.ts");
const stripe = await import("../app/stripe.ts");
const { safeAuthRedirect } = await import("../app/auth-redirect.ts");
const { buildDigestEmail } = await import("../app/email.ts");
const { sniffPhotoType } = await import("../app/photo-storage.ts");
const { POST: adminPost } = await import("../app/api/admin/route.ts");
const { POST: portalPost } = await import("../app/api/portal/route.ts");
const { POST: userPost } = await import("../app/api/user/route.ts");
const { POST: webhookPost } = await import("../app/api/stripe/webhook/route.ts");
const { POST: photoUploadPost } = await import("../app/api/admin/photo-upload/route.ts");

const ADMIN = "https://radar.cheap/api/admin";
const PORTAL = "https://radar.cheap/api/portal";
const USER = "https://radar.cheap/api/user";
const WEBHOOK = "https://radar.cheap/api/stripe/webhook";

const errorCode = async (response) => (await response.clone().json()).error?.code;

function signIn(db, id, role, permissions = []) {
  db.prepare("INSERT OR IGNORE INTO users (id,email,role) VALUES (?,?,?)").run(id, `${id}@example.test`, role);
  // Every workspace account holds read_admin, the permission that opens /api/admin at all.
  const workspace = role === "user" ? [] : ["read_admin"];
  harness.user = { userId: id, email: `${id}@example.test`, role, permissions: new Set([...workspace, ...permissions]) };
}

// ── Bot protection ────────────────────────────────────────────────────────────────────────────

test("with no Turnstile secret, public forms are refused unless explicitly disabled", async () => {
  freshDatabase();
  const request = new Request("https://radar.cheap/api/suggestions", { method: "POST" });
  delete harness.env.TURNSTILE_DISABLED;
  assert.equal(await utils.verifyTurnstile(request, "token"), false, "a missing secret must not wave everything through");
  harness.env.TURNSTILE_DISABLED = "1";
  assert.equal(await utils.verifyTurnstile(request, "token"), false, "only the exact value turns it off");
  harness.env.TURNSTILE_DISABLED = "true";
  assert.equal(await utils.verifyTurnstile(request, "token"), true);
});

// ── Stripe ────────────────────────────────────────────────────────────────────────────────────

async function sign(secret, timestamp, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${payload}`));
  return Array.from(new Uint8Array(mac)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

test("a webhook signed under a rolled secret is accepted from any of its v1 signatures", async () => {
  const now = Math.floor(Date.now() / 1000);
  const good = await sign("whsec_new", now, "{}");
  const stale = await sign("whsec_old", now, "{}");
  assert.equal(await stripe.verifyWebhookSignature("whsec_new", "{}", `t=${now},v1=${stale},v1=${good}`), String(now));
  assert.equal(await stripe.verifyWebhookSignature("whsec_new", "{}", `t=${now},v1=${stale}`), null);
  assert.equal(await stripe.verifyWebhookSignature("whsec_new", "{}", `t=${now}abc,v1=${good}`), null, "a timestamp that is not a number is refused");
  assert.equal(await stripe.verifyWebhookSignature("whsec_new", "{}", `t=${now - 600},v1=${await sign("whsec_new", now - 600, "{}")}`), null, "an old signature is a replay");
});

test("an oversized webhook body is refused before its signature is checked", async () => {
  freshDatabase();
  harness.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  const response = await webhookPost(new Request(WEBHOOK, { method: "POST", headers: { "stripe-signature": "t=1,v1=00" }, body: "x".repeat(1_000_001) }));
  assert.equal(response.status, 413);
});

test("checkout reuses only a Stripe customer this account created, never another with the same email", async () => {
  freshDatabase();
  harness.env.STRIPE_SECRET_KEY = "sk_test_x";
  const someoneElse = { id: "cus_other", metadata: { userId: "user:other" } };
  const mine = { id: "cus_mine", metadata: { userId: "user:me" } };
  await withFetch((call) => {
    if (call.url.startsWith("https://api.stripe.com/v1/customers?")) return Response.json({ data: [someoneElse, mine] });
    throw new Error(`unexpected ${call.url}`);
  }, async () => {
    assert.equal(await stripe.findOrCreateCustomer("user:me", "me@example.test"), "cus_mine");
  });
  await withFetch((call) => {
    if (call.url.startsWith("https://api.stripe.com/v1/customers?")) return Response.json({ data: [someoneElse] });
    if (call.url === "https://api.stripe.com/v1/customers") return Response.json({ id: "cus_new" });
    throw new Error(`unexpected ${call.url}`);
  }, async (calls) => {
    assert.equal(await stripe.findOrCreateCustomer("user:me", "me@example.test"), "cus_new");
    assert.match(calls.at(-1).body, /metadata%5BuserId%5D=user%3Ame/);
  });
});

function creatorSetup(db, { subscriberIsCreator = false } = {}) {
  db.prepare("INSERT INTO users (id,email,role) VALUES ('creator','c@example.test','creator')").run();
  db.prepare("INSERT INTO creator_profiles (user_id,handle,status,commission_rate_bps) VALUES ('creator','eats','active',2000)").run();
  const subscriber = subscriberIsCreator ? "creator" : "fan";
  if (!subscriberIsCreator) db.prepare("INSERT INTO users (id,email,role) VALUES ('fan','f@example.test','user')").run();
  db.prepare("UPDATE users SET referred_by='eats',stripe_customer_id='cus_1' WHERE id=?").run(subscriber);
}

async function deliver(event) {
  const payload = JSON.stringify(event);
  const now = Math.floor(Date.now() / 1000);
  return webhookPost(new Request(WEBHOOK, { method: "POST", headers: { "stripe-signature": `t=${now},v1=${await sign("whsec_test", now, payload)}` }, body: payload }));
}

const paidInvoice = (id) => ({ id: `evt_${id}`, type: "invoice.paid", data: { object: { id, customer: "cus_1", amount_paid: 699, currency: "cad", subscription: "sub_1" } } });

test("a creator earns nothing on their own subscription", async () => {
  const db = freshDatabase();
  harness.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  creatorSetup(db, { subscriberIsCreator: true });
  await withFetch(() => Response.json({}), async () => {
    assert.equal((await deliver(paidInvoice("in_self"))).status, 200);
  });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM creator_commissions").get().n, 0);
});

test("a chargeback voids the commission on the disputed invoice", async () => {
  const db = freshDatabase();
  harness.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  harness.env.STRIPE_SECRET_KEY = "sk_test_x";
  creatorSetup(db);
  await withFetch(() => Response.json({}), async () => {
    assert.equal((await deliver(paidInvoice("in_1"))).status, 200);
  });
  assert.equal(db.prepare("SELECT status FROM creator_commissions WHERE invoice_id='in_1'").get().status, "pending");
  // A dispute names only its charge; the invoice is looked up at Stripe.
  await withFetch((call) => {
    if (call.url === "https://api.stripe.com/v1/charges/ch_1") return Response.json({ invoice: null, payment_intent: "pi_1" });
    if (call.url.startsWith("https://api.stripe.com/v1/invoice_payments?")) return Response.json({ data: [{ invoice: "in_1" }] });
    return Response.json({});
  }, async (calls) => {
    const response = await deliver({ id: "evt_dispute", type: "charge.dispute.created", data: { object: { id: "dp_1", charge: "ch_1", amount: 699, currency: "cad" } } });
    assert.equal(response.status, 200);
    assert.ok(calls.some((call) => call.url.includes("payment%5Bpayment_intent%5D=pi_1")), "the payment intent is what finds the invoice");
  });
  assert.equal(db.prepare("SELECT status FROM creator_commissions WHERE invoice_id='in_1'").get().status, "void");
});

// ── Creator handles and rates ─────────────────────────────────────────────────────────────────

function creatorAccounts(db) {
  db.prepare("INSERT INTO users (id,email,role) VALUES ('c1','c1@example.test','creator'),('c2','c2@example.test','creator')").run();
  db.prepare("INSERT INTO creator_profiles (user_id,handle,status,commission_rate_bps) VALUES ('c1','eats','active',2000)").run();
  db.prepare("INSERT INTO users (id,email,role,referred_by) VALUES ('fan','f@example.test','user','eats')").run();
}

const profile = (id, handle, extra = {}) => adminPost(post(ADMIN, { action: "creator_profile", id, handle, ...extra }));

test("a handle with referrals can neither be renamed nor handed to another account", async () => {
  const db = freshDatabase();
  creatorAccounts(db);
  signIn(db, "staff", "admin", ["manage_users"]);
  assert.equal(await errorCode(await profile("c1", "eats-two")), "HANDLE_HAS_HISTORY", "renaming would orphan the referrals");
  assert.equal((await profile("c1", "eats", { displayName: "Eats" })).status, 200, "other edits still work");
  db.prepare("DELETE FROM creator_profiles WHERE user_id='c1'").run();
  assert.equal(await errorCode(await profile("c2", "eats")), "HANDLE_HAS_HISTORY", "a freed handle still carries its referrals");
  assert.equal((await profile("c2", "fresh")).status, 200);
});

test("only finance can change what a creator earns", async () => {
  const db = freshDatabase();
  creatorAccounts(db);
  signIn(db, "staff", "admin", ["manage_users"]);
  const raise = await profile("c1", "eats", { commissionRateBps: 9000 });
  assert.equal(raise.status, 403);
  assert.equal(db.prepare("SELECT commission_rate_bps r FROM creator_profiles WHERE user_id='c1'").get().r, 2000);
  signIn(db, "finance", "admin", ["manage_users", "manage_finance"]);
  assert.equal((await profile("c1", "eats", { commissionRateBps: 2500 })).status, 200);
  assert.equal(db.prepare("SELECT commission_rate_bps r FROM creator_profiles WHERE user_id='c1'").get().r, 2500);
});

test("an approval id sent by a client never reaches the audit log", async () => {
  const db = freshDatabase();
  db.prepare("INSERT INTO deals (id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active) VALUES ('deal-1','Spot','Wings','Food','Pub','Mon','Ottawa','K1P','1 Main','$6','🍗','https://spot.example','live',1)").run();
  signIn(db, "staff", "admin", ["manage_sponsorships"]);
  const response = await adminPost(post(ADMIN, { action: "sponsorship", id: "deal-1", sponsored: true, approvalId: "approval-forged" }));
  assert.equal(response.status, 200, await response.clone().text());
  const details = JSON.parse(db.prepare("SELECT details FROM audit_log WHERE action='sponsorship'").get().details);
  assert.equal(details.approvalId, undefined);
});

// ── Restaurant portal ─────────────────────────────────────────────────────────────────────────

function portalDeal(db) {
  db.prepare("INSERT INTO users (id,email,role) VALUES ('mgr','m@example.test','restaurant')").run();
  db.prepare("INSERT INTO restaurants (id,name,cuisine) VALUES ('r-1','Spot','Pub')").run();
  db.prepare("INSERT INTO restaurant_managers (id,restaurant_id,user_id,invited_email,invited_by,status) VALUES ('rm-1','r-1','mgr','m@example.test','staff','active')").run();
  db.prepare("INSERT INTO deals (id,restaurant_id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active) VALUES ('deal-1','r-1','Spot','Wings','Food','Pub','Mon','Ottawa','K1P','1 Main','$6','🍗','https://spot.example','live',1)").run();
}
const asManager = () => { harness.user = { userId: "mgr", email: "m@example.test", role: "restaurant", permissions: new Set() }; };
const toggle = (active) => portalPost(post(PORTAL, { action: "update_deal", dealId: "deal-1", title: "Wings", price: "$6", schedule: "Mon", active }));
const dealStatus = (db) => db.prepare("SELECT status FROM deals WHERE id='deal-1'").get().status;

test("a deal Radar paused cannot be resumed from the portal", async () => {
  const db = freshDatabase();
  portalDeal(db);
  signIn(db, "staff", "admin", ["publish_deals"]);
  assert.equal((await adminPost(post(ADMIN, { action: "lifecycle", id: "deal-1", status: "paused" }))).status, 200);
  asManager();
  const response = await toggle(true);
  assert.equal(response.status, 409);
  assert.equal(await errorCode(response), "PAUSED_BY_RADAR");
  assert.equal(dealStatus(db), "paused");
});

test("a deal the manager paused is still theirs to resume, unless Radar acted on it since", async () => {
  const db = freshDatabase();
  portalDeal(db);
  asManager();
  await toggle(false);
  assert.equal((await toggle(true)).status, 200);
  assert.equal(dealStatus(db), "live");

  await toggle(false);
  signIn(db, "owner", "owner", ["publish_deals"]);
  const bulk = await adminPost(post(ADMIN, { action: "bulk_lifecycle", city: "Ottawa", status: "paused", confirmation: "PAUSED Ottawa", confirmed: true }));
  assert.equal(bulk.status, 200, await bulk.clone().text());
  asManager();
  assert.equal(await errorCode(await toggle(true)), "PAUSED_BY_RADAR", "a market paused since stays paused");
});

test("a manager's photo is an upload for their restaurant, not an outside address", async () => {
  const db = freshDatabase();
  portalDeal(db);
  asManager();
  const photo = (photoUrl) => portalPost(post(PORTAL, { action: "update_photo", restaurantId: "r-1", photoUrl }));
  for (const outside of ["https://tracker.example/pixel.jpg", "/api/photo/restaurants/r-2/x.jpg", "/api/photo/restaurants/r-1/../r-2/x.jpg", "//evil.example/api/photo/restaurants/r-1/x.jpg"]) {
    assert.equal((await photo(outside)).status, 422, outside);
  }
  assert.equal(db.prepare("SELECT photo_url FROM restaurants WHERE id='r-1'").get().photo_url, null);
  assert.equal((await photo("/api/photo/restaurants/r-1/1700000000-abcd1234.jpg")).status, 200);
  assert.equal(db.prepare("SELECT photo_url FROM restaurants WHERE id='r-1'").get().photo_url, "/api/photo/restaurants/r-1/1700000000-abcd1234.jpg");
  assert.equal((await photo("")).status, 200, "removing the photo is always allowed");
  assert.equal(db.prepare("SELECT photo_url FROM restaurants WHERE id='r-1'").get().photo_url, null);
});

// ── Uploads ───────────────────────────────────────────────────────────────────────────────────

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

test("an upload is stored as what its bytes are, and refused when they are not an image", async () => {
  assert.equal(sniffPhotoType(PNG), "image/png");
  assert.equal(sniffPhotoType(JPEG), "image/jpeg");
  assert.equal(sniffPhotoType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(sniffPhotoType(new TextEncoder().encode("<svg onload=alert(1)>")), null);

  const db = freshDatabase();
  db.prepare("INSERT INTO restaurants (id,name,cuisine) VALUES ('r-1','Spot','Pub')").run();
  signIn(db, "staff", "admin", ["manage_restaurant_photos"]);
  const stored = [];
  harness.env.PHOTOS = { async put(key, body, options) { stored.push({ key, type: options.httpMetadata.contentType }); } };
  const upload = (type, body) => photoUploadPost(new Request("https://radar.cheap/api/admin/photo-upload?restaurantId=r-1", { method: "POST", headers: { origin: "https://radar.cheap", "content-type": type }, body }));

  assert.equal((await upload("image/png", new TextEncoder().encode("<html><script>alert(1)</script>"))).status, 422);
  assert.equal(stored.length, 0);
  const response = await upload("image/png", JPEG);
  assert.equal(response.status, 200, await response.clone().text());
  assert.deepEqual(stored.map((entry) => entry.type), ["image/jpeg"], "the bytes decide the type, not the header");
  assert.match(stored[0].key, /\.jpg$/);
});

// ── Saved deals ───────────────────────────────────────────────────────────────────────────────

test("a draft cannot be saved, so its id cannot be used to read it", async () => {
  const db = freshDatabase();
  db.prepare("INSERT INTO deals (id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active) VALUES ('draft-1','Secret','Unpublished','Food','Pub','Mon','Ottawa','K1P','1 Main','$6','🍗','https://secret.example','draft',0),('live-1','Spot','Wings','Food','Pub','Mon','Ottawa','K1P','1 Main','$6','🍗','https://spot.example','live',1)").run();
  signIn(db, "reader", "user");
  assert.equal((await userPost(post(USER, { action: "favorite", dealId: "draft-1", saved: true }))).status, 404);
  assert.equal((await userPost(post(USER, { action: "favorite", dealId: "live-1", saved: true }))).status, 200);
  assert.deepEqual(db.prepare("SELECT deal_id FROM favorites").all().map((row) => row.deal_id), ["live-1"]);
});

// ── Redirects and email ───────────────────────────────────────────────────────────────────────

test("a redirect after sign-in that resolves to another site goes to the fallback", () => {
  for (const sneaky of ["/.//evil.example", "/%2e//evil.example", "/a/..//evil.example", "//evil.example", "https://evil.example/"]) {
    assert.equal(safeAuthRedirect(`?redirect_url=${encodeURIComponent(sneaky)}`), "/dashboard", sneaky);
  }
  assert.equal(safeAuthRedirect(`?redirect_url=${encodeURIComponent("/saved?tab=deals")}`), "/saved?tab=deals");
});

test("the digest escapes restaurant text everywhere it appears", () => {
  const { html } = buildDigestEmail({
    recipientName: "Ana", city: "Ottawa", unsubscribeUrl: "https://radar.cheap/u", preferencesUrl: "https://radar.cheap/p", origin: "https://radar.cheap",
    deals: [{ restaurant: "<img src=x onerror=alert(1)>", title: "Wings", price: "$6", schedule: "Mon", emoji: "<b>", category: "Food", url: "https://radar.cheap/d?a=1&b=\"2\"" }],
  });
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<b>/);
  assert.match(html, /href="https:\/\/radar\.cheap\/d\?a=1&amp;b=&quot;2&quot;"/);
});
