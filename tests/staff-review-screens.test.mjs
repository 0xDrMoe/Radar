// Draft review, the deal inventory (and Ended & archived), and the suggestions queue: the rules the
// screens follow that are not the server's. The server's own rules (one draft per decision, one
// market per pause, a reason per rejection) are pinned in tests/draft-review.test.mjs and
// tests/staff-access.test.mjs; this file pins that the screens send what those rules expect and
// no longer offer what was taken away.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";
import { adminSource, code } from "./source.mjs";

const { nextDraftAfter } = await import("../app/draft-review.ts");
const inventory = await import("../app/(operator)/admin/deal-inventory.ts");
const { POST: adminPost, GET: adminGet } = await import("../app/api/admin/route.ts");

const ADMIN_URL = "https://radar.cheap/api/admin";
const MODERATOR = { userId: "mod", email: "mod@example.test", role: "moderator", permissions: new Set(["read_admin", "moderate_suggestions"]) };

const drafts = code(adminSource("DraftReview.tsx"));
const draftsTab = code(adminSource("tabs/DraftsTab.tsx"));
const deals = code(adminSource("tabs/DealsTab.tsx"));
const suggestions = code(adminSource("tabs/SuggestionsTab.tsx"));

// ── Draft review ─────────────────────────────────────────────────────────────────────────────

test("after a decision the next draft in the same list is selected, not the first", () => {
  assert.equal(nextDraftAfter(["a", "b", "c", "d"], "b", ["a", "c", "d"]), "c");
  // The last one decided: the one before it.
  assert.equal(nextDraftAfter(["a", "b", "c"], "c", ["a", "b"]), "b");
  // Others left the list meanwhile (somebody else published them): skip to one still there.
  assert.equal(nextDraftAfter(["a", "b", "c", "d"], "b", ["a", "d"]), "d");
  // A draft the reviewer could not see before (it arrived on reload) is not jumped to.
  assert.equal(nextDraftAfter(["a", "b"], "a", ["new", "b"]), "b");
  assert.equal(nextDraftAfter(["a"], "a", []), null);
  assert.equal(nextDraftAfter([], "gone", ["x"]), "x");
});

test("draft review decides one draft at a time and offers no batch", () => {
  for (const removed of [/Select all/, /MAX_DRAFT_BATCH/, /type="checkbox"/, /toggleVisible/]) assert.doesNotMatch(drafts, removed);
  // The request carries exactly the selected draft.
  assert.match(drafts, /items: \[\{ id: draft\.id, schedule: draft\.schedule \|\| "" \}\]/);
  assert.match(drafts, /action: decision === "publish" \? "publish_drafts" : "archive_drafts"/);
  // Archiving cannot be sent without a reason.
  assert.match(drafts, /disabled=\{Boolean\(busy\) \|\| !reason\.trim\(\)\}/);
  // Its place is kept: filters and selection in useTabState, the next draft chosen after acting.
  for (const key of ["drafts.geo", "drafts.ready", "drafts.query", "drafts.selected"]) assert.ok(drafts.includes(`"${key}"`), `${key} must be kept per workspace`);
  assert.match(drafts, /nextDraftAfter\(before, draft\.id, after\)/);
  assert.match(drafts, /geoFromSearch\(window\.location\.search\)/);
  assert.match(drafts, /<GeoFilter/);
  // Editing opens the shared editor over the tab instead of switching to the inventory.
  assert.match(draftsTab, /openEditor\(/);
  assert.doesNotMatch(draftsTab, /openTab\(/);
});

// ── Deal inventory and Ended & archived ──────────────────────────────────────────────────────

test("the inventory builds no CSV and has no every-market control", () => {
  for (const removed of [/exportDeals/, /Export view/, /createObjectURL/, /new Blob/, /ALL MARKETS/, /"All cities"\s*\?/]) assert.doesNotMatch(deals, removed);
  // filterInventory still takes a city, and is handed none: place is GeoFilter's job here.
  assert.match(deals, /city: "All cities",/);
  assert.match(deals, /<GeoFilter/);
});

test("pausing a market is for the one filtered city, typed, confirmed, and honest about approval", () => {
  assert.match(deals, /!ended && geo\.city && \(/, "the control exists only once a single city is chosen");
  assert.match(deals, /const expected = `PAUSED \$\{city\}`/);
  assert.match(deals, /action: "bulk_lifecycle", id: city, city, status: "paused", confirmation: phrase, confirmed: true/);
  assert.match(deals, /response\.status === 202 \|\| result\.pending/);
  assert.match(deals, /Nothing in \$\{city\} is paused yet/);
});

test("a brand-wide or national offer is never shown or filtered as a city", () => {
  const brand = { id: "b", restaurant: "Tim Hortons", city: "Toronto", status: "live", location_scope: "brand", location_country: "CA" };
  const national = { ...brand, location_scope: "national" };
  const local = { id: "l", restaurant: "Joe's", city: "Halifax", status: "live", location_region: "NS", location_country: "CA", full_postal: "B3J 1A1" };
  assert.deepEqual(inventory.dealPlaceLabel(brand), { primary: "Brand-wide", secondary: "Every Tim Hortons branch" });
  assert.deepEqual(inventory.dealPlaceLabel(national), { primary: "National", secondary: "Across Canada" });
  assert.deepEqual(inventory.dealPlaceLabel(local), { primary: "Halifax", secondary: "NS · B3J 1A1" });
  assert.deepEqual(inventory.dealGeoPlace(brand), { country: "CA", region: null, city: null, postal: null });
  assert.deepEqual(inventory.dealGeoPlace(local), { country: "CA", region: "NS", city: "Halifax", postal: "B3J 1A1" });
});

test("deep links name a deal and a status the inventory knows", () => {
  assert.deepEqual(inventory.inventoryLink("?deal=joes-halifax-wings&status=live"), { deal: "joes-halifax-wings", status: "live" });
  assert.deepEqual(inventory.inventoryLink("?status=everything"), { deal: "", status: "" });
  // A linked deal past the loaded rows is searched for by the restaurant word its id starts with.
  assert.equal(inventory.searchTermForDealId("slaymaker-nichols-charlottetown-old-fashioned-happy-hour"), "slaymaker");
  assert.equal(inventory.searchTermForDealId("suggestion-42"), "");
  assert.match(deals, /inventoryLink\(search\)/);
  assert.match(deals, /geoFromSearch\(search\)/);
  assert.match(deals, /searchTermForDealId\(link\.deal\)/);
  assert.match(deals, /scrollIntoView/);
  // Each place level goes to the server search, which already accepts them.
  for (const param of ["deal_city", "deal_region", "deal_country", "deal_postal"]) assert.ok(deals.includes(`"${param}"`), `${param} must be sent`);
});

test("Ended & archived lists every deal the public no longer sees", () => {
  assert.deepEqual([...inventory.ENDED_STATUSES], ["expired", "archived", "paused"]);
  assert.equal(inventory.isEndedStatus("live"), false);
  assert.match(deals, /Deals the public no longer sees/);
  // What can be done with one: back through Draft review, or retired.
  assert.match(deals, /action: "lifecycle", id: d\.id, status: "draft"/);
});

// ── Suggestions ──────────────────────────────────────────────────────────────────────────────

test("who sent a suggestion, and whether they can read why it was rejected", () => {
  assert.equal(inventory.submitterKind({ relationship: "creator", user_id: "u" }), "creator");
  assert.equal(inventory.submitterKind({ relationship: "customer", user_id: "u" }), "account");
  assert.equal(inventory.submitterKind({ relationship: "owner", user_id: null }), "public");
  assert.equal(inventory.submitterSeesReason("creator"), true);
  assert.equal(inventory.submitterSeesReason("public"), false);
  // The screen's promise rests on the creator workspace reading and showing the stored reason.
  const creatorRoute = readFileSync(new URL("../app/api/creator/route.ts", import.meta.url), "utf8");
  assert.match(creatorRoute, /s\.status,s\.rejection_reason/);
  const creatorClient = code(readFileSync(new URL("../app/(operator)/creator/CreatorWorkspaceClient.tsx", import.meta.url), "utf8"));
  assert.match(creatorClient, /s\.status === "rejected" && s\.rejection_reason/);
});

test("possible duplicates match the restaurant's name loosely but exactly", () => {
  const rows = [
    { id: "1", restaurant: "Slaymaker & Nichols", title: "Happy hour", city: "Charlottetown", status: "live" },
    { id: "2", restaurant: "The Slaymaker and Nichols", title: "Brunch", city: "Charlottetown", status: "draft" },
    { id: "3", restaurant: "Slaymaker Pizza", title: "Slice", city: "Charlottetown", status: "live" },
  ];
  assert.deepEqual(inventory.possibleDuplicates("slaymaker & nichols", rows).map((row) => row.id), ["1", "2"]);
  assert.deepEqual(inventory.possibleDuplicates("", rows), []);
});

test("a suggestion is inspected before it is decided, and rejected only with a reason", () => {
  assert.match(suggestions, /possibleDuplicates\(row\.restaurant, deals\)/);
  assert.match(suggestions, /SUGGESTION_REJECTION_REASONS\.map/);
  assert.match(suggestions, /customReasonProblem\(note\)/);
  assert.match(suggestions, /disabled=\{working \|\| !decided\?\.ok\}/);
  assert.match(suggestions, /action: "suggestion", id: current\.id, status: "rejected", reasonCode, reason/);
  assert.match(suggestions, /The submitter will see this reason in their creator workspace\./);
  assert.match(suggestions, /row\.status === "rejected" && row\.rejection_reason/);
  for (const key of ["suggestions.status", "suggestions.kind", "suggestions.geo"]) assert.ok(suggestions.includes(`"${key}"`));
});

test("the queue's rows carry what the inspect view reads, and a withdrawn one is refused", async () => {
  const db = freshDatabase();
  const { lastInsertRowid } = db.prepare(
    "INSERT INTO suggestions (restaurant,deal,postal,schedule,email,user_id,relationship,source,reference,status) VALUES ('Joe''s','2 for 1','K1P1J1','Mon','a@example.test','u1','creator','https://joes.example/specials','BL-2026-TEST','pending')",
  ).run();
  const id = Number(lastInsertRowid);
  harness.user = MODERATOR;
  const row = (await (await adminGet(new Request(ADMIN_URL))).json()).suggestions.find((entry) => entry.id === id);
  for (const field of ["user_id", "relationship", "source", "reference", "created_at", "rejection_reason"]) assert.ok(field in row, `${field} must reach the screen`);
  db.prepare("UPDATE suggestions SET status='withdrawn' WHERE id=?").run(id);
  for (const body of [{ action: "convert_suggestion", id }, { action: "suggestion", id, status: "rejected", reasonCode: "duplicate" }]) {
    const response = await adminPost(post(ADMIN_URL, body));
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "SUGGESTION_WITHDRAWN");
  }
});
