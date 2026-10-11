import assert from "node:assert/strict";
import test from "node:test";
import {
  VERIFICATION_FRESH_DAYS, dealPageTitle, effectiveVerificationStatus, offerPrice, sentences, splitUsFootprint,
} from "../app/deal-meta.ts";

// What a deal page tells search engines and link previews about itself (app/deal-meta.ts).
//
// The price strings below are real ones from the catalog as it stood on 2026-09-30, not
// restatements of the parser's rules. The parser's failure mode is quiet - a wrong number in
// JSON-LD throws nothing and looks like data - so the cases are the ones that actually shipped wrong.

test("Offer.price takes the one figure a deal states for the thing itself", () => {
  const priced = {
    "$10.99": 10.99,
    "$5 pints": 5,
    "$1 per wing (minimum 5)": 1,
    "85¢ per wing": 0.85,
    "99 cents/wing": 0.99,
    "$10 per pound": 10,
    "2 tacos for $8": 8,
    "10 Timbits for $1": 1,
    "Two pints and 18 oysters for $45": 45,
    "Any 2 for $5: cheeseburger, 2-pc strips, hot dog, chili dog, fries, small sundae & more": 5,
    "Breakfast special $11.99": 11.99,
    "$12 with beverage purchase": 12,
    "$10 + tax, 2oz cocktails": 10,
    "$15 · with any beverage": 15,
    "$8.49 per pound · with any beverage": 8.49,
    // A dash that introduces the offer's details, not a second offer.
    "$5 - McDouble, Junior Chicken or Chicken Snack Wrap with small fries and a small drink": 5,
    "$6 food and drink — VQA wines, gin & tonics, craft beer, poutine pogo, ceviche, wings": 6,
    // "up to" and "or more" about the item, not the figure.
    "$10 large pizza with up to 3 toppings on Hut Crust; higher in some areas incl. CA": 10,
    "$6.99 each when you choose 2 or more select items": 6.99,
    "$8.99 each for 2+ medium 3-topping pizzas": 8.99,
  };
  for (const [text, price] of Object.entries(priced)) assert.equal(offerPrice(text), price, text);
});

test("Offer.price is left out for an amount off, a threshold, a floor, an estimate or a second offer", () => {
  const unpriced = [
    // The pages whose JSON-LD price was a discount, a spend threshold, a donation or another
    // item's price, by the price text each one carried.
    "$5 off burgers & sandwiches",
    "$5 off all pastas",
    "$5 off wings",
    "$2 off all tacos",
    "$2 off burgers on Tuesdays",
    "$3 off any size specialty pizza (except heart-shaped)",
    "25% off pasta · $10 off bottles",
    "Free small chili with a $5+ qualifying purchase (Wendy's Rewards members)",
    "Free fries, any size, with a $5+ order on Fridays (Wendy's Rewards members)",
    "Free 6-piece nuggets with a $5+ order on Wednesdays (Wendy's Rewards members)",
    "Free medium fries with a $1+ purchase, once a week (app, Rewards members)",
    "Free Churro with a $3+ purchase, TJ Rewards members",
    "10% off orders over $15",
    "15% off orders over $15",
    "Kids 10 & under eat free with each adult entree $19.99+",
    "Free small curly fries coupon (next visit, with purchase) for a $1 No Kid Hungry donation",
    "Half-price nachos - $4 tequila shots",
    "Half-price selected pizzas · $6 pints",
    "$8 beer · 50% oysters",
    "25% off burgers · $6.50 tall cans",
    "$6 draft - half-price wine",
    "$1 nigiri - discounted yakitori, sake, soju, wine & beer",
    // Estimates, floors, ceilings and ranges.
    "Half price wings · about $9",
    "Half price · about $8",
    "From $5",
    "Burgers from $12",
    "Shawarma from $6.99 · student discount",
    "Everything under $13",
    "$10 or less",
    "Ten menu items, each $3 or less",
    "$7-9 drinks",
    "$5-$12 drinks - $11-$29 apps & entrees",
    "$5 coupon",
    // More than one figure, and none at all.
    "$8 starters - $10 cocktails",
    "$3.99 each or 2 for $5",
    "Half price wings",
    "2 for 1 wings",
    "",
  ];
  for (const text of unpriced) assert.equal(offerPrice(text), null, text);
  assert.equal(offerPrice(null), null);
});

test("only a verified deal checked within thirty days is verified", () => {
  const now = new Date("2026-09-30T12:00:00Z");
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000);
  assert.equal(VERIFICATION_FRESH_DAYS, 30);
  assert.equal(effectiveVerificationStatus("verified", daysAgo(3), now), "verified");
  assert.equal(effectiveVerificationStatus("verified", daysAgo(30), now), "verified");
  assert.equal(effectiveVerificationStatus("verified", daysAgo(31), now), "stale");
  // An import is stored with verified_at = the moment it arrived. The date says nothing.
  assert.equal(effectiveVerificationStatus("needs_review", daysAgo(0), now), "needs_review");
  assert.equal(effectiveVerificationStatus(null, daysAgo(0), now), "needs_review");
  assert.equal(effectiveVerificationStatus("verified", new Date("not a date"), now), "stale");
});

test("the site name goes on a deal title only while the whole fits in sixty characters", () => {
  assert.equal(dealPageTitle("Wing night at The Corner Pub in Ottawa, ON"), "Wing night at The Corner Pub in Ottawa, ON — Radar");
  const long = "15% student discount on food & drinks at Beyond the Pale ByWard Taproom";
  assert.equal(dealPageTitle(long), long, "the deal's own words are never cut");
});

test("a description is its fragments as sentences, without doubled stops", () => {
  assert.equal(sentences(["$7 wings", "Wed.", "", null, "1200 Bank St, Ottawa", "Last checked Sep 22, 2026"]),
    "$7 wings. Wed. 1200 Bank St, Ottawa. Last checked Sep 22, 2026.");
});

test("a US footprint counts the fifty states and names DC and the territories apart", () => {
  const subway = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME",
    "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "PR", "VI", "DC", "MP", "GU"];
  assert.equal(subway.length, 55, "Subway was said to be in 55 states");
  assert.deepEqual(splitUsFootprint(subway), { states: 50, others: ["DC", "GU", "MP", "PR", "VI"] });
  assert.deepEqual(splitUsFootprint(["TX", "OK", "pr"]), { states: 2, others: ["PR"] });
  assert.deepEqual(splitUsFootprint(["TN", "KY"]), { states: 2, others: [] });
});
