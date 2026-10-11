// The city guides (app/city-pages.ts): which deals it lists, which topics become pages, and that
// a topic with too little in it is not one. Run for real against a SQLite database made from
// drizzle/*.sql (tests/route-harness.mjs).
import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness } from "./route-harness.mjs";

const { cityDeals, guideCities, citySlug, cityPath, cityHomeQuery, publishedTopics, restaurantCount, topicBySlug, lastChecked, guidePlacement, MIN_RESTAURANTS, MIN_CITY_RESTAURANTS } = await import("../app/city-pages.ts");
const OTTAWA = { name: "Ottawa", region: "ON", country: "CA" };

const db = freshDatabase();
for (const table of ["deals", "restaurants", "restaurant_locations", "deal_locations", "deal_schedules"]) db.exec(`DELETE FROM ${table}`);

const restaurant = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES (?,?,'American',?,'https://example.test','CA')");
const branch = db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone,status) VALUES (?,?,?,?,?,'CA','K1S',45.4,-75.7,'America/Toronto',?)");
const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,verification_status,verified_at,created_at,status,active,location_scope,description)
  VALUES (?,?,?,?,?,?,?,'American',?,?,'K1S',?,?,'🍔','https://example.test/offer',?,?,?,?,1,?,?)`);
const days = db.prepare("INSERT INTO deal_schedules (deal_id,display_text,days,timezone) VALUES (?,?,?,'America/Toronto')");

let n = 0;
function offer({ name, title, category = "Food deal", price = "$5", city = "Ottawa", status = "live", scope = null, verified = "verified", at = "2026-09-30 12:00:00", on = ["Mon"], branchStatus = "operating", description = null }) {
  n += 1;
  const rid = `r${n}`, lid = `l${n}`, did = `d${n}`;
  restaurant.run(rid, name, 0);
  branch.run(lid, rid, `${n} Bank St`, city, "ON", branchStatus);
  deal.run(did, did, name, rid, lid, title, category, "Mon", city, `${n} Bank St`, price, verified, at, at, status, scope, description);
  days.run(did, "Mon", JSON.stringify(on));
  return { rid, lid, did };
}

// Five Ottawa wing nights, on three different weekdays; the happy hours are six, one a fortnight old.
for (const [name, on] of [["Alpha Pub", ["Mon"]], ["Bravo Pub", ["Mon"]], ["Charlie Pub", ["Tue"]], ["Delta Pub", ["Tue"]], ["Echo Pub", ["Wed"]]]) {
  offer({ name, title: "Half-price wings", on });
}
for (let i = 1; i <= 6; i += 1) offer({ name: `Happy ${i}`, title: "Happy hour", category: "Happy hour", price: "$6 pints", on: ["Fri"], verified: i === 1 ? "needs_review" : "verified" });
// One taco night only: not enough to be a page.
offer({ name: "Taco Place", title: "Taco Tuesday", on: ["Tue"] });
// Things that must not appear: another city, an ended deal, a national chain promotion, a closed branch.
offer({ name: "Toronto Wings", title: "Half-price wings", city: "Toronto" });
offer({ name: "Gone Wings", title: "Half-price wings", status: "archived" });
offer({ name: "National Wings", title: "Wings for everyone", scope: "national" });
offer({ name: "Closed Wings", title: "Half-price wings", branchStatus: "closed" });

const listed = await cityDeals(harness.env.DB, OTTAWA);

test("the guide lists Ottawa's live deals and nothing from elsewhere, ended, closed or national", () => {
  const names = listed.map((entry) => entry.restaurant);
  assert.equal(listed.length, 12);
  for (const left of ["Toronto Wings", "Gone Wings", "National Wings", "Closed Wings"]) assert.ok(!names.includes(left), `${left} is not an Ottawa deal`);
});

test("a topic is a page only with enough restaurants in it", () => {
  const slugs = publishedTopics(listed).map(({ topic }) => topic.slug);
  assert.ok(slugs.includes("wings") && slugs.includes("happy-hour") && slugs.includes("food-deals"));
  assert.ok(!slugs.includes("tacos"), "one taco night is not a page");
  assert.ok(!slugs.includes("pizza") && !slugs.includes("oysters"), "a topic nobody offers is not a page");
  assert.equal(restaurantCount(topicBySlug("wings") && listed.filter(topicBySlug("wings").match)), 5);
  assert.ok(MIN_RESTAURANTS >= 3);
});

test("a weekday page holds the deals that run that day, and only when three restaurants do", () => {
  const published = Object.fromEntries(publishedTopics(listed).map(({ topic, deals }) => [topic.slug, deals]));
  assert.equal(published.monday, undefined, "two Monday restaurants are too few");
  assert.equal(published.wednesday, undefined, "one is too few");
  assert.equal(published.tuesday.length, 3, "Charlie, Delta and the taco place");
  assert.equal(published.friday.length, 6);
});

test("the same offer at several branches is one entry that says how many", () => {
  const { rid } = offer({ name: "Chain Wings", title: "Wing night" });
  for (const suffix of ["a", "b"]) {
    const lid = `extra-${suffix}`;
    branch.run(lid, rid, `${suffix} Elgin St`, "Ottawa", "ON", "operating");
    n += 1;
    const did = `d${n}`;
    deal.run(did, did, "Chain Wings", rid, lid, "Wing night", "Food deal", "Mon", "Ottawa", `${suffix} Elgin St`, "$5", "verified", "2026-09-30 12:00:00", "2026-09-30 12:00:00", "live", null, null);
  }
  return cityDeals(harness.env.DB, OTTAWA).then((entries) => {
    const chain = entries.filter((entry) => entry.restaurant === "Chain Wings");
    assert.equal(chain.length, 1);
    assert.equal(chain[0].locations, 3);
  });
});

test("'last checked' is the newest check, and says nothing when nothing was checked", () => {
  assert.equal(lastChecked(listed), "Sep 30, 2026");
  assert.equal(lastChecked(listed.filter((entry) => !entry.verified)), null);
});

// A guide entry as the topic matchers read it, for the topics that turn on a cuisine.
const entry = (overrides) => ({ id: "x", slug: "x", restaurant: "X", title: "Special", category: "Food deal", cuisine: "American", price: "$5", schedule: "Tue", address: "", verifiedAt: null, verified: true, createdAt: null, updatedAt: null, days: ["Tue"], locations: 1, text: "special $5", ...overrides });

test("a cuisine topic takes the listing's cuisine, or the dish named in the offer", () => {
  assert.ok(topicBySlug("mexican").match(entry({ cuisine: "Mexican", text: "$3 tuesdays" })), "a taqueria's Tuesday is a Mexican food deal");
  assert.ok(!topicBySlug("mexican").match(entry({ title: "Taco Tuesday", text: "taco tuesday $3 tacos" })), "a pub's taco night is a taco deal, not a Mexican restaurant's");
  assert.ok(topicBySlug("sushi").match(entry({ cuisine: "Japanese", text: "half-price maki rolls" })));
  assert.ok(topicBySlug("steak").match(entry({ cuisine: "Steakhouse", text: "$20 prime rib" })));
  assert.ok(!topicBySlug("steak").match(entry({ text: "$9 philly cheesesteak" })), "a cheesesteak is a sandwich");
  assert.ok(topicBySlug("brunch").match(entry({ cuisine: "Breakfast & Brunch" })));
});

test("a deal's place in the guide is its entry and the published topics that list it", () => {
  const alpha = listed.find((candidate) => candidate.restaurant === "Alpha Pub");
  const placed = guidePlacement(listed, { id: alpha.id, restaurant: "Alpha Pub", title: "Half-price wings" });
  assert.equal(placed.entry.id, alpha.id);
  const slugs = placed.topics.map((topic) => topic.slug);
  assert.ok(slugs.includes("wings") && slugs.includes("food-deals"));
  assert.ok(!slugs.includes("monday"), "Monday has too few restaurants to be a page, so nothing links to it");
  // Another branch's row of the same offer finds the entry it was folded into.
  assert.equal(guidePlacement(listed, { id: "another-branch", restaurant: "alpha pub ", title: "Half-price wings" })?.entry.id, alpha.id);
  assert.equal(guidePlacement(listed, { id: "elsewhere", restaurant: "Toronto Wings", title: "Half-price wings" }), null);
});

test("a city is a guide only with enough restaurants in it, at a slug that names its province", async () => {
  const cities = await guideCities(harness.env.DB);
  const ottawa = cities.find((city) => city.name === "Ottawa");
  assert.equal(ottawa.slug, "ottawa-on");
  assert.equal(cityPath(ottawa), "/cities/ottawa-on");
  assert.equal(cityPath(ottawa, "wings"), "/cities/ottawa-on/wings");
  assert.equal(cityHomeQuery(ottawa), "/?city=Ottawa", "a path without its locale, which ChromeLink adds");
  assert.ok(ottawa.restaurants >= MIN_CITY_RESTAURANTS);
  assert.ok(!cities.some((city) => city.name === "Toronto"), "one Toronto restaurant is not a guide");
  assert.ok(MIN_CITY_RESTAURANTS >= MIN_RESTAURANTS);
});

test("slugs keep two cities of one name apart", () => {
  assert.equal(citySlug("Vancouver", "BC"), "vancouver-bc");
  assert.equal(citySlug("Vancouver", "WA"), "vancouver-wa");
  assert.equal(citySlug("Trois-Rivières", "QC"), "trois-rivieres-qc");
  assert.equal(citySlug("Somewhere", ""), "somewhere");
});

test("a topic that is nearly the whole city, or a weekday in a shallow one, is not a page", () => {
  const pub = (name, title, category, on) => ({ id: name, slug: name, restaurant: name, title, category, cuisine: "Pub", price: "$5", schedule: on.join(", "), address: "", verifiedAt: null, verified: true, createdAt: null, updatedAt: null, days: on, locations: 1, text: title.toLowerCase() });
  // Six pubs, every one a Friday happy hour: "happy hours" and "Fridays" would be the hub again.
  const shallow = ["A", "B", "C", "D", "E", "F"].map((name) => pub(name, "Happy hour", "Happy hour", ["Fri"]));
  const slugs = publishedTopics(shallow).map(({ topic }) => topic.slug);
  assert.ok(!slugs.includes("happy-hour"), "every deal in the city is not a topic");
  assert.ok(!slugs.includes("friday"), "nor is a weekday in a city of six restaurants");
});
