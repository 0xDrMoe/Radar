import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { code } from "./source.mjs";

// The deal page for a venue that runs a different special every night.
//
// Each night is its own deal row, so the page for Montana's Wing Monday knew nothing about Taco
// Tuesday except by accident: the "Similar offers" list at the very bottom, below the terms, the
// locations, the map and the feedback widget, and mixed in with the same brand's Kingston and
// Kitchener deals. The week is the thing a reader is actually trying to see.
const source = () =>
  code(readFileSync(new URL("../app/[locale]/deals/[slug]/page.tsx", import.meta.url), "utf8"));

const alsoHere = () =>
  code(readFileSync(new URL("../app/[locale]/deals/[slug]/AlsoHere.tsx", import.meta.url), "utf8"));
const messages = (locale) =>
  JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));

test("the page lists the rest of the week at the same address", () => {
  const page = source();
  assert.match(page, /SELECT d\.id,d\.slug,d\.title,d\.price,d\.schedule,d\.emoji FROM deals d/);
  assert.match(page, /<AlsoHere offers=\{alsoHereOffers\} timezone=\{deal\.timezone\}\/>/);
  assert.match(alsoHere(), /t\("alsoHere"\)/);
});

// The page is prerendered once per deploy, so "today" cannot be decided on the server: the HTML
// would say the build day's night for as long as the build lived. The marker waits for hydration,
// and asks the venue's timezone rather than the reader's.
test("the week marks today in the browser, in the venue's timezone", () => {
  const component = alsoHere();
  assert.match(component, /^"use client";/);
  assert.match(component, /useSyncExternalStore\(subscribeToNothing, \(\) => true, \(\) => false\)/);
  assert.match(component, /const now = hydrated \? new Date\(\) : null/);
  assert.match(component, /availabilityFromSchedule\(offer\.schedule, now, timezone\)\.eligibleToday/);
  assert.match(component, /t\("alsoHereToday"\)/);
  for (const locale of ["en", "fr", "es"]) {
    assert.ok(messages(locale).dealDetail.alsoHereToday, `${locale} needs the Today label`);
  }
});

// Scoped to the address, not the brand. On a chain that is the difference between "also here" and
// "also somewhere in this brand", and only the first is true of the page you are looking at.
test("the week is scoped to this address, not the whole brand", () => {
  const page = source();
  const start = page.indexOf("SELECT d.id,d.slug,d.title,d.price,d.schedule,d.emoji FROM deals d");
  assert.ok(start > -1);
  const query = page.slice(start, start + 300);
  assert.match(query, /d\.restaurant_id=\? AND d\.location_id=\? AND d\.id<>\?/);
  assert.match(query, /AND \$\{publicDealPredicate\}/, "a deal scheduled for later has no page to link to");
  assert.match(page, /\.bind\(deal\.restaurant_id,deal\.location_id,deal\.id\)/);
});

// Nightly specials have an order, and it is not the order rows were inserted in. This used
// parseScheduleText, which finds no days in a bare "Wed", so Montana's week sorted as unknown and
// only looked right because D1 happened to return it in order. weekRank reads a schedule the way
// the availability line does; tests/week-order.test.mjs covers what it returns.
test("the week is ordered as a week", () => {
  const page = source();
  assert.match(page, /import \{ kmBetween, safeReturnPath, weekRank \} from "\.\.\/\.\.\/\.\.\/search"/);
  assert.match(page, /\[\.\.\.alsoHere\.results\]\.sort\(\(a, b\) => weekRank\(a\.schedule\) - weekRank\(b\.schedule\)\)/);
  assert.doesNotMatch(page, /parseScheduleText\(/);
});

// The locations query orders by eligibility then city. Once a national promotion is confirmed at
// every branch that leaves the alphabet in charge, and an Ottawa deal page opened its location
// list on Guelph and pointed Directions there. A prerendered page and a shared link both arrive
// with no reference point, so the distance sort cannot save it.
test("the page leads with its own address", () => {
  const page = source();
  assert.match(page, /ordered\.filter\(\(location\) => location\.id === deal\.location_id\)/);
  assert.match(page, /ordered\.filter\(\(location\) => location\.id !== deal\.location_id\)/);
});

// The related list ranked the deal's own restaurant first, so Wing Monday's page listed Taco
// Tuesday, rib Wednesday and the Thursday platter - the week already shown under "Also at this
// location" - and a reader choosing between places got nothing to choose between. The query now
// lives in app/similar-deals.ts (see tests/similar-deals.test.mjs for what it returns); this pins
// that the page uses it and heads it for what it now always is.
test("the related list is other restaurants, headed as such", () => {
  const page = source();
  assert.match(page, /const similarQuery = similarDealsQuery\(deal\)/);
  assert.match(page, /env\.DB\.prepare\(similarQuery\.sql\)\.bind\(\.\.\.similarQuery\.params\)/);
  assert.doesNotMatch(page, /CASE WHEN restaurant_id=\? THEN 0/, "the old query ranked this restaurant first");
  assert.match(page, /<h2>\{t\("similarOffers"\)\}<\/h2><div className="similar-deals">/);
  assert.doesNotMatch(page, /moreFromRestaurant/);
  for (const locale of ["en", "fr", "es"]) {
    assert.equal(messages(locale).dealDetail.moreFromRestaurant, undefined, `${locale}: the heading is gone`);
    assert.equal(messages(locale).dealDetail.moreFromRestaurantOnly, undefined, `${locale}: the heading is gone`);
  }
});
