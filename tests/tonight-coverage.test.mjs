// What /api/deals says about tonight, about the newest source check, and about coverage - driven
// through the built worker against a SQLite database made from drizzle/*.sql, as
// tests/device-location.test.mjs does.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const ALIAS = `data:text/javascript,${encodeURIComponent(`
export const env = new Proxy({}, { get: (_target, key) => globalThis.__TONIGHT_TEST_ENV__?.[key] });
export const waitUntil = (promise) => { if (promise && typeof promise.then === "function") globalThis.__TONIGHT_TEST_WAITS__.push(promise.catch(() => {})); };
`)}`;
globalThis.__TONIGHT_TEST_WAITS__ = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: ALIAS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// D1's API over node:sqlite, as scripts/prerender-deals.mjs does it.
function d1(db) {
  const plain = (row) => ({ ...row });
  const statement = (sql, binds) => ({
    bind: (...args) => statement(sql, args),
    first: async (column) => { const row = db.prepare(sql).get(...binds); if (row === undefined) return null; return column === undefined ? plain(row) : (row[column] ?? null); },
    all: async () => ({ results: db.prepare(sql).all(...binds).map(plain), success: true, meta: {} }),
    run: async () => { const info = db.prepare(sql).run(...binds); return { results: [], success: true, meta: { changes: Number(info.changes ?? 0) } }; },
  });
  return { prepare: (sql) => statement(sql, []), batch: async (list) => Promise.all(list.map((entry) => entry.all())) };
}

// Today and tomorrow where the fixture's restaurants are, which is the clock their offers run on.
const ZONE = "America/Toronto";
const weekday = (date) => new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long" }).format(date);
const TODAY = weekday(new Date());
const TOMORROW = weekday(new Date(Date.now() + 86_400_000));

// A town nowhere near anything the migrations seed, so every deal within reach is one of these.
const TOWN = [60.0, -100.0];
// The newest real check in the catalogue, and a newer import time on a deal nobody has checked.
const CHECKED = "2027-03-01 12:00:00", IMPORTED = "2027-03-02 12:00:00";

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const restaurant = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES (?,?,'American',0,'https://example.test','CA')");
  const branch = db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone) VALUES (?,?,?,'Testville','MB','CA','R0B',?,?,?)");
  const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,verification_status,verified_at,created_at)
    VALUES (?,?,?,?,?,?,?,'American',?,'Testville','R0B',?,'$5','🍔','https://example.test/offer',?,?,?)`);
  const place = (id, name, address, offset) => {
    restaurant.run(id, name);
    branch.run(`${id}-location`, id, address, TOWN[0] + offset, TOWN[1], ZONE);
  };
  place("tv-wings", "Zed's Wings", "1 Main St", 0.001);
  place("tv-pub", "Aardvark Tavern", "2 Main St", 0.002);
  place("tv-diner", "Middle Diner", "3 Main St", 0.003);
  // Tonight's wing night, checked by staff.
  deal.run("tv-today", "tv-today", "Zed's Wings", "tv-wings", "tv-wings-location", "Wing night", "Food deal", TODAY, "1 Main St", "verified", CHECKED, CHECKED);
  // Tomorrow's, still filed under the old "Tonight" category, and only ever imported.
  deal.run("tv-tomorrow", "tv-tomorrow", "Aardvark Tavern", "tv-pub", "tv-pub-location", "Taco night", "Tonight", TOMORROW, "2 Main St", "needs_review", IMPORTED, IMPORTED);
  // Today's lunch, which is over by the evening.
  deal.run("tv-lunch", "tv-lunch", "Middle Diner", "tv-diner", "tv-diner-location", "Lunch special", "Food deal", `${TODAY} 11 AM-3 PM`, "3 Main St", "verified", "2026-09-01 12:00:00", "2026-09-01 12:00:00");
  // Two market rows at the same spot: one that takes twenty offers to cover, one that takes one.
  const market = db.prepare("INSERT INTO market_coverage (market,region,country,status,minimum_offers) VALUES (?,'MB','CA','covered',?)");
  market.run("Testville", 20);
  market.run("Smallville", 1);
  return db;
}

// No shared answer cache: every call reaches the route.
globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
globalThis.__TONIGHT_TEST_ENV__ = { DB: d1(database()), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };

const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
async function call(query) {
  const path = `/api/deals?lat=${TOWN[0]}&lng=${TOWN[1]}&country=CA&tz=${ZONE}&${query}`;
  const response = await worker.fetch(new Request(`https://radar.cheap${path}`), globalThis.__TONIGHT_TEST_ENV__, { waitUntil() {}, passThroughOnException() {} });
  for (let i = 0; i < 5 && globalThis.__TONIGHT_TEST_WAITS__.length; i++) { const pending = globalThis.__TONIGHT_TEST_WAITS__; globalThis.__TONIGHT_TEST_WAITS__ = []; await Promise.all(pending); }
  assert.equal(response.status, 200, `${path} answered ${response.status}`);
  return response.json();
}
const byId = (results) => Object.fromEntries(results.map((deal) => [deal.id, deal]));

test("every deal says whether it is on tonight, from its schedule", async () => {
  const deals = byId((await call("city=Testville")).results);
  assert.equal(deals["tv-today"].tonight, true, `a ${TODAY} wing night on a ${TODAY}`);
  assert.equal(deals["tv-tomorrow"].tonight, false, `a ${TOMORROW} special filed as "Tonight" is not on tonight`);
  assert.equal(deals["tv-lunch"].tonight, false, "a lunch that ends at 3 PM is not tonight's");
  // The phone's compact shape carries the same answer under the same name.
  const compact = byId((await call("city=Testville&view=compact")).results);
  assert.equal(compact["tv-today"].tonight, true);
  assert.equal(compact["tv-tomorrow"].tonight, false);
});

test("the Tonight filter is what runs tonight, not what was filed under the word", async () => {
  const tonight = (await call("city=Testville&category=Tonight")).results.map((deal) => deal.id);
  assert.deepEqual(tonight, ["tv-today"]);
  // Any other category is still the stored one.
  const food = (await call("city=Testville&category=Food%20deal")).results.map((deal) => deal.id).sort();
  assert.deepEqual(food, ["tv-lunch", "tv-today"]);
});

test("the latest source check is the newest real check in the catalogue, not the newest date on the page", async () => {
  // Page one, sorted by name, holds only the imported deal, whose verified_at is newer than any check.
  const page = await call("city=Testville&sort=restaurant&limit=1");
  assert.deepEqual(page.results.map((deal) => deal.id), ["tv-tomorrow"]);
  assert.equal(page.latestVerificationDate, CHECKED);
  // And it is the same on every page and every search.
  assert.equal((await call("city=Testville&sort=restaurant&limit=1&cursor=2")).latestVerificationDate, CHECKED);
  assert.equal((await call("city=Testville&category=Tonight")).latestVerificationDate, CHECKED);
});

test("a market with fewer offers than its minimum is limited", async () => {
  assert.equal((await call("city=Testville")).coverage, "limited", "three offers where the market row asks for twenty");
  assert.equal((await call("city=Smallville")).coverage, "covered", "three offers where one is enough");
  // Filters narrow the answer, not the market: an oyster search in a covered town is still covered.
  assert.equal((await call("city=Smallville&q=oysters")).coverage, "covered");
});
