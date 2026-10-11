import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminClientSource, code } from "./source.mjs";

// Verifying a deal is two facts, not one: the source was checked (verification_events) and the
// offer's addresses are right (deal_locations.eligibility). Publishing requires both, so a flow
// that records one and not the other produces a deal that looks verified in the editor and is
// still refused by the lifecycle gate with DEAL_NOT_READY. These assert the two stay batched.

const route = code(readFileSync(new URL("../app/api/admin/route.ts", import.meta.url), "utf8"));
const admin = code(adminClientSource());

const verifyAction = route.slice(
  route.indexOf('b.action === "verify"'),
  route.indexOf('b.action === "bulk_lifecycle"'),
);

test("one verify writes the event and confirms the location in the same batch", () => {
  assert.ok(verifyAction, "the verify action must be findable in the route");
  assert.match(verifyAction, /INSERT INTO verification_events/);
  assert.match(verifyAction, /UPDATE deal_locations SET eligibility='confirmed'/);
  // env.DB.batch, not two awaited .run()s: a half-applied verify is the state that reads as done
  // and cannot publish.
  const batchStart = verifyAction.indexOf("env.DB.batch([");
  assert.ok(batchStart !== -1, "both writes must go through env.DB.batch");
  assert.ok(
    verifyAction.indexOf("UPDATE deal_locations") > batchStart,
    "the location confirm must be inside the batch, not a separate write",
  );
});

test("allLocations confirms every address, and only when nothing narrower was asked for", () => {
  // The bypass is `?=1 OR ...` on the UPDATE's WHERE. If an explicit locationId could also set
  // that flag, the per-location control — the one used when a source only covers some of a
  // chain's addresses — would silently confirm all of them.
  assert.match(
    verifyAction,
    /const confirmEveryLocation = !verifyLocationId && b\.allLocations === true/,
    "an explicit locationId must win over allLocations",
  );
  assert.match(
    verifyAction,
    /UPDATE deal_locations SET[^"]*WHERE deal_id=\? AND \(\?=1 OR location_id=COALESCE\(\?,/,
    "the all-locations bypass must sit in the same statement as the single-location default",
  );
  // b.allLocations === true, not a truthy check: the body is unknown-typed JSON from the client.
  assert.doesNotMatch(verifyAction, /b\.allLocations \?\?/);
});

test("a caller that sends neither still confirms the deal's primary location", () => {
  // The deal-list row action and every caller predating allLocations send only an id. They must
  // keep confirming the primary location, which is what makes a single-location deal one click.
  assert.match(verifyAction, /COALESCE\(\?,\(SELECT location_id FROM deals WHERE id=\?\)\)/);
  assert.match(admin, /action\(\{ action: "verify", id: d\.id \}\)/);
});

test("the editor's verify button asks for all of them; the per-location button does not", () => {
  assert.match(
    admin,
    /action\(\{ action: "verify", id: editor\.id, allLocations: true \}\)/,
    "the single editor button must cover every location, or a multi-location deal needs one click each",
  );
  const perLocation = admin.slice(admin.indexOf("async function verifyLocationInEditor"));
  const call = perLocation.slice(0, perLocation.indexOf("}"));
  assert.match(call, /action: "verify", id: editor\.id, locationId/);
  assert.doesNotMatch(call, /allLocations/, "confirming one address must not confirm the rest");
});

test("the button says how many addresses it is about to confirm", () => {
  // Confirming eight addresses off a page that lists three is the failure this makes easy, so the
  // control has to state the claim rather than read as a generic "Verify".
  assert.match(admin, /confirm all \$\{editorLocationCount\} locations/);
  assert.match(admin, /const editorLocationCount = editor\?\.locations\?\.length \|\| 0;/);
});
