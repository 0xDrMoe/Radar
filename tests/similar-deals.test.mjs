import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { dishStems, similarDealsQuery, SIMILAR_LIMIT } from "../app/similar-deals.ts";

// "Similar offers" on a deal page, run for real. node:sqlite is the engine D1 runs and the one
// scripts/prerender-deals.mjs renders every deal page against, so the window function and the
// LIKE patterns are exercised exactly as they are in production.

const MONTANAS = "montanas-stonerd-guelph-restaurant";

// A row with `latitude`/`longitude` gets a branch in restaurant_locations; one without has no
// location, and is matched by city name alone.
function database(rows) {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE deals (
    id TEXT PRIMARY KEY, slug TEXT, restaurant TEXT NOT NULL, restaurant_id TEXT, location_id TEXT, title TEXT NOT NULL,
    price TEXT, schedule TEXT, city TEXT, cuisine TEXT, category TEXT, emoji TEXT, verified_at TEXT,
    status TEXT DEFAULT 'live', active INTEGER DEFAULT 1, deleted_at TEXT, publish_at TEXT
  )`);
  db.exec("CREATE TABLE restaurant_locations (id TEXT PRIMARY KEY, latitude REAL, longitude REAL)");
  const insert = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,price,schedule,city,cuisine,category,emoji,verified_at,status,active,deleted_at,publish_at)
    VALUES (:id,:id,:restaurant,:restaurant_id,:location_id,:title,'$1',:schedule,:city,:cuisine,:category,NULL,:verified_at,:status,:active,:deleted_at,:publish_at)`);
  const locate = db.prepare("INSERT INTO restaurant_locations (id,latitude,longitude) VALUES (?,?,?)");
  for (const { latitude = null, longitude = null, ...row } of rows) {
    const location_id = latitude == null ? null : `loc-${row.id}`;
    if (location_id) locate.run(location_id, latitude, longitude);
    insert.run({
      restaurant_id: null, schedule: "Mon", city: "Ottawa", cuisine: "American", category: "Food deal",
      verified_at: "2026-09-01", status: "live", active: 1, deleted_at: null, publish_at: null, ...row, location_id,
    });
  }
  return db;
}

const wingMonday = {
  id: "montanas-bankst-wing-monday-ottawa", restaurant: "Montana's", restaurant_id: MONTANAS,
  title: "Wing Monday", city: "Ottawa", cuisine: "BBQ", category: "Food deal", latitude: null, longitude: null,
};

function similar(rows, deal = wingMonday) {
  const { sql, params } = similarDealsQuery(deal);
  return database([deal, ...rows]).prepare(sql).all(...params);
}

test("the restaurant's own deals are not similar offers", () => {
  const found = similar([
    { id: "montanas-taco", restaurant: "Montana's", restaurant_id: MONTANAS, title: "Taco Tuesday", cuisine: "BBQ" },
    { id: "montanas-ribs", restaurant: "Montana's", restaurant_id: MONTANAS, title: "Rib Wednesday wings too", cuisine: "BBQ" },
    // Same brand, written on a row with no restaurant link - the name still identifies it.
    { id: "montanas-unlinked", restaurant: "MONTANA'S", title: "Wing night" },
    { id: "kelseys-wings", restaurant: "Kelseys", restaurant_id: "kelseys", title: "Thursday half-price wings" },
  ]);
  assert.deepEqual(found.map((row) => row.id), ["kelseys-wings"]);
});

test("the same dish outranks the same cuisine, which outranks the same kind of deal", () => {
  const found = similar([
    { id: "category-only", restaurant: "A", restaurant_id: "a", title: "Pasta night", cuisine: "Italian", category: "Food deal" },
    { id: "cuisine-only", restaurant: "B", restaurant_id: "b", title: "Brisket plate", cuisine: "BBQ", category: "Tonight" },
    { id: "dish-only", restaurant: "C", restaurant_id: "c", title: "Half-Price Wings Tuesday", cuisine: "Bar & Pub", category: "Tonight" },
    { id: "dish-and-category", restaurant: "D", restaurant_id: "d", title: "Tuesday $12 wings", cuisine: "American", category: "Food deal" },
  ]);
  assert.deepEqual(found.map((row) => row.id), ["dish-and-category", "dish-only", "cuisine-only", "category-only"]);
});

test("each other restaurant appears once, by its most similar deal", () => {
  const found = similar([
    { id: "wildwing-happy-hour", restaurant: "Wild Wing", restaurant_id: "wildwing", title: "Happy hour", category: "Happy hour", verified_at: "2026-09-20" },
    { id: "wildwing-wings", restaurant: "Wild Wing", restaurant_id: "wildwing", title: "Tuesday $12 wings", verified_at: "2026-08-01" },
    { id: "wildwing-lunch", restaurant: "Wild Wing", restaurant_id: "wildwing", title: "Lunch combo", verified_at: "2026-09-21" },
    // Two unlinked rows under one name are one restaurant too.
    { id: "pub-1", restaurant: "Corner Pub", title: "Wing night" },
    { id: "pub-2", restaurant: "corner pub", title: "Wings and a pint" },
  ]);
  assert.equal(found.length, 2, "two restaurants, so two rows");
  assert.equal(found.filter((row) => row.restaurant === "Wild Wing").length, 1);
  assert.equal(found.find((row) => row.restaurant === "Wild Wing").id, "wildwing-wings");
  assert.equal(found.filter((row) => row.restaurant.toLowerCase() === "corner pub").length, 1);
});

test("a deal with no restaurant link still finds, and is found by, others", () => {
  const unlinked = { ...wingMonday, id: "indie-wings", restaurant: "Indie Bar", restaurant_id: null };
  const found = similar([
    { id: "linked", restaurant: "Kelseys", restaurant_id: "kelseys", title: "Wing Wednesday" },
    { id: "also-unlinked", restaurant: "Other Bar", title: "Wing Thursday" },
  ], unlinked);
  assert.deepEqual(found.map((row) => row.id).sort(), ["also-unlinked", "linked"]);
});

test("nothing in common, another city, or not public means not listed", () => {
  const found = similar([
    { id: "nothing-shared", restaurant: "Sushi Place", restaurant_id: "sushi", title: "Sushi Sunday", cuisine: "Japanese", category: "Happy hour" },
    { id: "gatineau", restaurant: "Kelseys", restaurant_id: "kelseys", title: "Wing Monday", city: "Gatineau" },
    { id: "draft", restaurant: "Draft Bar", restaurant_id: "draft", title: "Wing Monday", status: "draft" },
    { id: "inactive", restaurant: "Closed Bar", restaurant_id: "closed", title: "Wing Monday", active: 0 },
    { id: "deleted", restaurant: "Gone Bar", restaurant_id: "gone", title: "Wing Monday", deleted_at: "2026-09-01" },
    { id: "scheduled", restaurant: "Soon Bar", restaurant_id: "soon", title: "Wing Monday", publish_at: "2099-01-01 00:00:00" },
  ]);
  assert.deepEqual(found, []);
});

test("the list is capped", () => {
  const rows = Array.from({ length: SIMILAR_LIMIT + 4 }, (_, index) => ({
    id: `wings-${index}`, restaurant: `Bar ${index}`, restaurant_id: `bar-${index}`, title: "Wing night",
  }));
  assert.equal(similar(rows).length, SIMILAR_LIMIT);
});

// The dish words match at the start of a word, and the title is read with its hyphens, slashes
// and brackets turned into spaces - in JavaScript for the deal, in SQL for the candidates.
test("dish words match whole-word starts, the same way on both sides", () => {
  assert.ok(dishStems("Half-Price Wings Tuesday").includes("wing"));
  assert.ok(dishStems("Bud & a pound of wings for $18").includes("wing"));
  assert.ok(dishStems("All-You-Can-Eat Rib Wednesday").includes("rib"));
  assert.ok(dishStems("Late-night menu").includes("late night"));
  assert.deepEqual(dishStems("Caribbean patties"), [], "rib is not a word start in Caribbean");
  assert.deepEqual(dishStems("Bowling night"), [], "wing is not a word start in bowling");
  assert.deepEqual(dishStems("Thursday platter deal"), []);

  const ribs = { ...wingMonday, title: "All-You-Can-Eat Rib Wednesday", cuisine: "Steakhouse", category: "Tonight" };
  const found = similar([
    { id: "caribbean", restaurant: "Island", restaurant_id: "island", title: "Caribbean patties", cuisine: "Caribbean", category: "Food deal" },
    { id: "ribs", restaurant: "Smoke", restaurant_id: "smoke", title: "Half-rack (ribs) Thursday", cuisine: "American", category: "Food deal" },
  ], ribs);
  assert.deepEqual(found.map((row) => row.id), ["ribs"]);
});

// Nearby is a distance, not a city name. Gatineau has five places; a Gatineau wing night could list
// at most four others while Ottawa's sat a bridge away, in the same feed.
test("places across a city line are nearby; places in another region are not", () => {
  const gatineau = { ...wingMonday, id: "la-cage-wings", restaurant: "La Cage", restaurant_id: "la-cage", city: "Gatineau", title: "Half-price wings Thursday", latitude: 45.4765, longitude: -75.7013 };
  const found = similar([
    { id: "byward", restaurant: "Byward Pub", restaurant_id: "byward", title: "Wing Wednesday", city: "Ottawa", latitude: 45.4275, longitude: -75.6927 },
    { id: "kanata", restaurant: "Kanata Pub", restaurant_id: "kanata", title: "Wing Tuesday", city: "Ottawa", latitude: 45.3088, longitude: -75.8987 },
    { id: "kingston", restaurant: "Kingston Pub", restaurant_id: "kingston", title: "Wing Monday", city: "Kingston", latitude: 44.2312, longitude: -76.486 },
    { id: "montreal", restaurant: "Montréal Pub", restaurant_id: "montreal", title: "Wing Monday", city: "Montréal", latitude: 45.5019, longitude: -73.5674 },
  ], gatineau);
  assert.ok(found.some((row) => row.id === "byward"), "downtown Ottawa is across the river from Gatineau");
  assert.ok(found.some((row) => row.id === "kanata"), "Kanata is inside 25 km");
  assert.ok(!found.some((row) => row.id === "kingston" || row.id === "montreal"), "another region is not nearby");
});

test("among equally similar deals, the same city comes first", () => {
  const gatineau = { ...wingMonday, id: "la-cage-wings", restaurant: "La Cage", restaurant_id: "la-cage", city: "Gatineau", title: "Half-price wings Thursday", latitude: 45.4765, longitude: -75.7013 };
  const found = similar([
    { id: "ottawa-newer", restaurant: "Byward Pub", restaurant_id: "byward", title: "Wing Wednesday", city: "Ottawa", latitude: 45.4275, longitude: -75.6927, verified_at: "2026-09-20" },
    { id: "gatineau-older", restaurant: "Hull Pub", restaurant_id: "hull", title: "Wing Monday", city: "Gatineau", latitude: 45.43, longitude: -75.72, verified_at: "2026-08-01" },
  ], gatineau);
  assert.deepEqual(found.map((row) => row.id), ["gatineau-older", "ottawa-newer"]);
});

test("a deal with no location still matches by city name", () => {
  const found = similar([
    { id: "same-city", restaurant: "Kelseys", restaurant_id: "kelseys", title: "Wing Wednesday", city: "Ottawa" },
    { id: "elsewhere", restaurant: "Hull Pub", restaurant_id: "hull", title: "Wing Monday", city: "Gatineau", latitude: 45.43, longitude: -75.72 },
  ]);
  assert.deepEqual(found.map((row) => row.id), ["same-city"]);
});

test("only public deals are offered: not one scheduled for later, which has no page yet", async () => {
  const { publicDealPredicate } = await import("../app/deal-lifecycle.ts");
  const { sql } = similarDealsQuery({ id: "x", title: "Wing night", cuisine: "Pub", category: "Food deal", city: "Ottawa", restaurant: "X", restaurant_id: null, latitude: null, longitude: null });
  assert.ok(sql.includes(publicDealPredicate), sql);
});
