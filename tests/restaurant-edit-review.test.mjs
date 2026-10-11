import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";

// A restaurant manager's edit waits for staff before the public listing changes (drizzle/0065),
// run for real against the portal and admin handlers.

const { GET: portalGet, POST: portalPost } = await import("../app/api/portal/route.ts");
const { GET: adminGet, POST: adminPost } = await import("../app/api/admin/route.ts");

const PORTAL = "https://radar.cheap/api/portal";
const ADMIN = "https://radar.cheap/api/admin";
const errorCode = async (response) => (await response.clone().json()).error?.code;

const MANAGER = { userId: "mgr", email: "m@example.test", role: "restaurant", permissions: new Set() };
const EDITOR = { userId: "staff", email: "s@example.test", role: "deal_editor", permissions: new Set(["read_admin", "create_deals"]) };

function seed(db) {
  db.prepare("INSERT INTO users (id,email,role) VALUES ('mgr','m@example.test','restaurant'),('staff','s@example.test','deal_editor')").run();
  db.prepare("INSERT INTO restaurants (id,name,cuisine) VALUES ('r-1','Spot','Pub'),('r-2','Other','Pub')").run();
  db.prepare("INSERT INTO restaurant_managers (id,restaurant_id,user_id,invited_email,invited_by,status) VALUES ('rm-1','r-1','mgr','m@example.test','staff','active')").run();
  db.prepare("INSERT INTO deals (id,restaurant_id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active,updated_at) VALUES ('deal-1','r-1','Spot','Wing night','Food','Pub','Mon 4-7pm','Ottawa','K1P','1 Main','$6','🍗','https://spot.example','live',1,'2026-01-01 00:00:00')").run();
  db.prepare("INSERT INTO deals (id,restaurant_id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,status,active) VALUES ('deal-2','r-2','Other','Theirs','Food','Pub','Mon','Ottawa','K1P','2 Main','$6','🍗','https://other.example','live',1)").run();
}

const asManager = () => { harness.user = MANAGER; };
const asEditor = () => { harness.user = EDITOR; };
const save = (fields = {}) => portalPost(post(PORTAL, { action: "update_deal", dealId: "deal-1", title: "Wing night", price: "$6", schedule: "Mon 4-7pm", active: true, ...fields }));
const review = (id, status, notes) => adminPost(post(ADMIN, { action: "review_deal_change", id, status, notes }));
const deal = (db) => ({ ...db.prepare("SELECT title,price,schedule,status,active,updated_at FROM deals WHERE id='deal-1'").get() });
const requests = (db) => db.prepare("SELECT id,status,title,price,previous FROM deal_change_requests ORDER BY created_at,rowid").all().map((row) => ({ ...row }));

test("a manager's wording change waits for review and leaves the listing alone", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  const response = await save({ price: "$5" });
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).review, "submitted");
  assert.equal(deal(db).price, "$6");
  assert.equal(deal(db).updated_at, "2026-01-01 00:00:00", "nothing about the deal moved, so nothing republishes");
  const [request] = requests(db);
  assert.equal(request.status, "pending");
  assert.equal(request.price, "$5");
  assert.equal(JSON.parse(request.previous).price, "$6", "the reviewer sees what the deal said when the edit was made");
  const audit = db.prepare("SELECT action,details FROM audit_log").get();
  assert.equal(audit.action, "portal_update_deal");
  assert.deepEqual(JSON.parse(audit.details).fields, ["price"]);
});

test("a later save replaces the pending change, a repeat keeps it, and saving the listing again withdraws it", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  await save({ price: "$5" });
  assert.equal((await (await save({ price: "$4" })).json()).review, "submitted");
  assert.deepEqual(requests(db).map((r) => [r.status, r.price]), [["superseded", "$5"], ["pending", "$4"]]);
  assert.equal((await (await save({ price: "$4", active: true })).json()).review, "unchanged");
  assert.equal(requests(db).length, 2, "the same proposal again is not a new request");
  assert.equal((await (await save()).json()).review, "withdrawn");
  assert.deepEqual(requests(db).map((r) => r.status), ["superseded", "withdrawn"]);
});

test("pausing applies at once and makes no request", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  const body = await (await save({ active: false })).json();
  assert.equal(body.review, "none");
  assert.deepEqual({ status: deal(db).status, active: deal(db).active }, { status: "paused", active: 0 });
  assert.equal(requests(db).length, 0);
});

test("a manager cannot propose a change to someone else's deal", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  const response = await portalPost(post(PORTAL, { action: "update_deal", dealId: "deal-2", title: "Mine now", price: "$1", schedule: "Mon", active: true }));
  assert.equal(response.status, 403);
  assert.equal(requests(db).length, 0);
});

test("staff see the pending change beside the live listing, and approving puts it live once", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  await save({ title: "Wing Monday", schedule: "Mon 3-7pm" });
  const id = requests(db)[0].id;

  asEditor();
  const listing = await (await adminGet(new Request(ADMIN))).json();
  assert.equal(listing.dealChangeRequests.length, 1);
  assert.equal(listing.dealChangeRequests[0].current_title, "Wing night");
  assert.equal(listing.dealChangeRequests[0].title, "Wing Monday");

  const response = await review(id, "approved");
  assert.equal(response.status, 200, await response.clone().text());
  assert.match((await response.json()).warning || "", /schedule windows/, "a schedule change is flagged for the structured schedule");
  const after = deal(db);
  assert.equal(after.title, "Wing Monday");
  assert.equal(after.schedule, "Mon 3-7pm");
  assert.notEqual(after.updated_at, "2026-01-01 00:00:00", "updated_at moves, so /api/deals and the translations pick it up");
  assert.equal(requests(db)[0].status, "approved");
  const audit = db.prepare("SELECT details FROM audit_log WHERE action='review_deal_change'").get();
  assert.equal(JSON.parse(audit.details).decision, "approved");

  assert.equal(await errorCode(await review(id, "approved")), "CHANGE_NOT_PENDING", "a decided change cannot be applied twice");

  asManager();
  const portal = await (await portalGet()).json();
  const mine = portal.deals.find((d) => d.id === "deal-1");
  assert.equal(mine.pending_change, null);
  assert.equal(mine.last_review.status, "approved");
});

test("rejecting needs a reason, keeps the listing, and tells the manager why", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  await save({ price: "$1" });
  const id = requests(db)[0].id;

  asEditor();
  assert.equal(await errorCode(await review(id, "rejected", "  ")), "REVIEW_NOTE_REQUIRED");
  assert.equal((await review(id, "rejected", "Your menu still says $6.")).status, 200);
  assert.equal(deal(db).price, "$6");

  asManager();
  const mine = (await (await portalGet()).json()).deals.find((d) => d.id === "deal-1");
  assert.equal(mine.pending_change, null);
  assert.deepEqual({ status: mine.last_review.status, note: mine.last_review.note }, { status: "rejected", note: "Your menu still says $6." });
});

test("the manager's editor opens on the change still waiting", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  await save({ price: "$5" });
  const mine = (await (await portalGet()).json()).deals.find((d) => d.id === "deal-1");
  assert.equal(mine.price, "$6");
  assert.equal(mine.pending_change.price, "$5");
});

test("only a role that can edit deals reviews restaurant edits", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  await save({ price: "$5" });
  const id = requests(db)[0].id;
  harness.user = { userId: "mod", email: "mod@example.test", role: "moderator", permissions: new Set(["read_admin", "moderate_feedback"]) };
  assert.equal((await review(id, "approved")).status, 403);
  assert.deepEqual((await (await adminGet(new Request(ADMIN))).json()).dealChangeRequests, [], "nor is the queue sent to them");
  assert.equal(requests(db)[0].status, "pending");
});

test("a change to a deal deleted since cannot be approved", async () => {
  const db = freshDatabase();
  seed(db);
  asManager();
  await save({ price: "$5" });
  const id = requests(db)[0].id;
  db.prepare("UPDATE deals SET deleted_at=CURRENT_TIMESTAMP WHERE id='deal-1'").run();
  asEditor();
  assert.equal(await errorCode(await review(id, "approved")), "DEAL_MOVED");
  assert.equal(requests(db)[0].status, "pending", "a refused approval claims nothing");
  assert.equal((await review(id, "rejected", "The deal is gone.")).status, 200);
});
