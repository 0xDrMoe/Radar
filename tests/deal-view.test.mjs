import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The projection that decides what a phone downloads. Exercised rather than asserted about,
// because the whole point is which keys survive.

const source = await readFile(new URL("../app/dealView.ts", import.meta.url), "utf8");
const { compactDeal, COMPACT_DEAL_FIELDS } = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  ).toString("base64")}`
);

const full = {
  id: "deal:1", slug: "wine-wednesday", restaurant: "Wild Wing", canonical_restaurant: "Wild Wing",
  title: "Wine Wednesday", schedule: "Wed", price: "$6 (6oz) wine", price_tier: 1,
  city: "Ottawa", address: "110 Murray St", emoji: "🍷", source_url: "https://example.test",
  sponsored: 0, verification_status: "verified", verified_at: "2026-09-01", expires_at: null,
  restaurant_photo_url: null, distance_km: 0.1, latitude: 45.42, longitude: -75.69,
  category_label: "Drinks", cuisine_label: "Pub",
  availability: "Later today · 4-6 PM", available_today: true, available_now: false,
  availability_phase: "upcoming",
  // The three the app never reads, and the biggest three on the wire.
  //
  // Sized like a real chain deal rather than one token row each. That matters for the ratio
  // assertion at the bottom: the projection exists because a 41-deal search was 261 KB and 34 KB
  // of it was these, and a fixture carrying one location of three fields cannot show that.
  chain_locations: branches(9),
  brand_offers: Array.from({ length: 4 }, (_unused, index) => ({
    id: `offer:${index}`, title: "Half-price bottles", schedule: "Mon-Thu", price: "50% off",
    terms: "Dine-in only. One bottle per table. Not valid with any other offer or on holidays.",
  })),
  internal_notes: "staff only — must never reach a client",
  search_keywords: "wine wednesday ottawa byward market half price bottles",
  participating_locations: branches(5),
};

/** Full participating-location rows, the shape /api/deals answers with before the projection. */
function branches(count) {
  return Array.from({ length: count }, (_unused, index) => ({
    city: "Ottawa", address: `${110 + index} Murray St`, latitude: 45.42 + index / 1000,
    longitude: -75.69 - index / 1000, postal_prefix: "K1N", region: "ON",
    source_url: "https://example.test/locations", location_id: `loc:${index}`,
    phone: "613-555-0100", hours: "Mon-Sun 11:00-23:00",
    eligibility: "confirmed", offer_available: true,
  }));
}

test("the heavy fields a card never renders are dropped", () => {
  const compact = compactDeal(full);
  for (const field of ["chain_locations", "brand_offers", "search_keywords"]) {
    assert.ok(!(field in compact), `${field} survived the projection`);
  }
});

test("nothing internal can leak through a projection that only picks", () => {
  // Belt and braces: the route already strips these, but a projection that copied unknown keys
  // would quietly undo that if the route ever stopped.
  assert.ok(!("internal_notes" in compactDeal(full)));
});

test("everything a card, a pin and a sort need survives", () => {
  const compact = compactDeal(full);
  for (const field of COMPACT_DEAL_FIELDS) {
    if (full[field] === null || full[field] === undefined) continue;
    assert.deepEqual(compact[field], full[field], `${field} was lost`);
  }
});

test("participating locations are kept, cut to a point and a street", () => {
  const kept = compactDeal(full).participating_locations;
  assert.equal(kept.length, 5, "a chain lost branches that are running the offer");
  assert.deepEqual(kept[0], { city: "Ottawa", address: "110 Murray St", latitude: 45.42, longitude: -75.69 });
});

test("a deal with no participating locations does not gain an empty array", () => {
  const { participating_locations: _drop, ...alone } = full;
  assert.ok(!("participating_locations" in compactDeal(alone)));
  assert.ok(!("participating_locations" in compactDeal({ ...full, participating_locations: [] })));
});

test("null and absent are both simply absent", () => {
  // Bytes spent saying nothing. Every consumer already treats the two the same.
  const compact = compactDeal(full);
  assert.ok(!("expires_at" in compact), "a null field was serialised anyway");
  assert.ok(!("restaurant_photo_url" in compact));
});

test("a zero or empty string is kept, because those mean something", () => {
  const compact = compactDeal({ ...full, sponsored: 0, address: "" });
  assert.equal(compact.sponsored, 0, "sponsored:0 was dropped as falsy");
  assert.equal(compact.address, "", "an empty address was dropped as falsy");
});

test("whether the deal is running right now survives", () => {
  // The app cannot work this out for itself: "Wed-Fri 3-6 PM" needs the restaurant's own clock,
  // not the phone's, so the server computes it per request. Dropping these from the projection
  // does not break a card, it just makes it quietly stop saying whether the deal is on \u2014 and
  // makes the "Available now" filter return a list that never explains why anything matched.
  const compact = compactDeal(full);
  assert.equal(compact.availability, "Later today · 4-6 PM");
  assert.equal(compact.availability_phase, "upcoming");
  assert.equal(compact.available_today, true);
  // Specifically false, not absent: "not on right now" is an answer, and `pick` only drops
  // null and undefined for exactly this reason.
  assert.equal(compact.available_now, false, "available_now:false was dropped as falsy");
});

test("the projection is meaningfully smaller than the row", () => {
  const before = JSON.stringify(full).length;
  const after = JSON.stringify(compactDeal(full)).length;
  assert.ok(after < before * 0.6, `expected well under 60% of the row, got ${Math.round((after / before) * 100)}%`);
});

test("a city-centre point keeps its approximate flag, and a placed one gains none", () => {
  const places = branches(2);
  places[1] = { ...places[1], approximate: true };
  const kept = compactDeal({ ...full, participating_locations: places }).participating_locations;
  assert.ok(!("approximate" in kept[0]), "a placed branch should carry no approximate key");
  assert.equal(kept[1].approximate, true);
});
