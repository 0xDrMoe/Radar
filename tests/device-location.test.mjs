// A search from "my location": a latitude, a longitude, and nothing else.
//
// Every one used to be filed under Canada on Toronto time, so a reader in Knoxville was handed
// Canada's nationwide chains and a clock an hour off in Chicago. These drive the built worker
// against a real SQLite database made from drizzle/*.sql and assert what such a reader sees: the
// country and zone the answer names, the nationwide list that follows from them, and the clock a
// national offer's "today" is read on. The line itself is tested in tests/country-at.test.mjs.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const ALIAS = `data:text/javascript,${encodeURIComponent(`
export const env = new Proxy({}, { get: (_target, key) => globalThis.__DEVICE_TEST_ENV__?.[key] });
export const waitUntil = (promise) => { if (promise && typeof promise.then === "function") globalThis.__DEVICE_TEST_WAITS__.push(promise.catch(() => {})); };
`)}`;
globalThis.__DEVICE_TEST_WAITS__ = [];
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

const KNOXVILLE = [35.9606, -83.9207], OTTAWA = [45.4215, -75.6972], DETROIT = [42.3314, -83.0458], WINDSOR = [42.3149, -83.0364];

// A weekday that is today on Kiritimati (UTC+14) is never today in Pago Pago (UTC-11), whatever the
// hour: a "that day only" offer is on for a reader in one and off for a reader in the other.
const KIRITIMATI_DAY = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Kiritimati", weekday: "long" }).format(new Date());

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const brand = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES (?,?,?,1,?,?)");
  const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,location_scope)
    VALUES (?,?,?,?,NULL,?,'Food deal','American',?,'','','',?,'🍔','https://example.test/offer','national')`);
  brand.run("burgers-us", "US Burger Chain", "American", "https://burgers.example", "US");
  brand.run("donuts-ca", "Canadian Donut Chain", "Cafe", "https://donuts.example", "CA");
  deal.run("us-daily", "us-daily", "US Burger Chain", "burgers-us", "$5 meal", "Daily", "$5");
  deal.run("us-one-day", "us-one-day", "US Burger Chain", "burgers-us", "One-day burger", `${KIRITIMATI_DAY}s only`, "$3");
  deal.run("ca-daily", "ca-daily", "Canadian Donut Chain", "donuts-ca", "Coffee and a donut", "Daily", "$3");
  // A chain that trades out west and nowhere near Tennessee - Del Taco's shape.
  db.prepare(`INSERT INTO restaurants (id,name,cuisine,is_chain,website,country,footprint) VALUES ('tacos-west','Western Taco Chain','Mexican',1,'https://tacos.example','US','{"CA":300,"AZ":30}')`).run();
  deal.run("west-daily", "west-daily", "Western Taco Chain", "tacos-west", "Two tacos", "Daily", "$2");
  // Two Morristowns, as a geocoder answers them: New Jersey's for the bare name, Tennessee's when
  // the state is named. Only Tennessee's is a market Radar covers.
  const cached = db.prepare("INSERT INTO postal_cache (normalized_postal,latitude,longitude,neighborhood,city,region,country,timezone,provider,status,updated_at) VALUES (?,?,?,NULL,?,?,?,?,'geocoder','resolved',CURRENT_TIMESTAMP)");
  cached.run("city:morristown", 40.7968, -74.4815, "Morristown", "NJ", "US", "America/New_York");
  cached.run("city:morristown, tn", 36.2135, -83.2949, "Morristown", "TN", "US", "America/New_York");
  cached.run("city:morristown, nj", 40.7968, -74.4815, "Morristown", "NJ", "US", "America/New_York");
  db.prepare("INSERT INTO market_coverage (market,region,country,status,minimum_offers) VALUES ('Morristown','TN','US','covered',1)").run();
  return db;
}

const answers = new Map();
globalThis.caches = {
  default: {
    match: async (request) => { const hit = answers.get(request.url); return hit ? new Response(hit.body, hit.init) : undefined; },
    put: async (request, response) => { answers.set(request.url, { body: await response.text(), init: { status: response.status, headers: [...response.headers] } }); },
  },
};
globalThis.__DEVICE_TEST_ENV__ = { DB: d1(database()), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };

const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
async function call(path, headers = {}) {
  const response = await worker.fetch(new Request(`https://radar.cheap${path}`, { headers }), globalThis.__DEVICE_TEST_ENV__, { waitUntil() {}, passThroughOnException() {} });
  for (let i = 0; i < 5 && globalThis.__DEVICE_TEST_WAITS__.length; i++) { const pending = globalThis.__DEVICE_TEST_WAITS__; globalThis.__DEVICE_TEST_WAITS__ = []; await Promise.all(pending); }
  assert.equal(response.status, 200, `${path} answered ${response.status}`);
  return response.json();
}
const at = ([latitude, longitude]) => `lat=${latitude}&lng=${longitude}`;

test("a point in Knoxville is answered as the US, on Eastern time", async () => {
  const { resolvedLocation } = await call(`/api/deals?${at(KNOXVILLE)}`);
  assert.equal(resolvedLocation.accuracy, "device");
  assert.equal(resolvedLocation.country, "US");
  assert.equal(resolvedLocation.timezone, "America/New_York");
});

test("a point in Ottawa is still Canada", async () => {
  const { resolvedLocation } = await call(`/api/deals?${at(OTTAWA)}`);
  assert.equal(resolvedLocation.country, "CA");
  assert.equal(resolvedLocation.timezone, "America/Toronto");
});

test("the nationwide list for a point is its own country's chains", async () => {
  const us = (await call(`/api/deals?scope=national&${at(KNOXVILLE)}`)).results.map((deal) => deal.id);
  assert.ok(us.includes("us-daily"), "the US chain is there for a Knoxville reader");
  assert.ok(!us.includes("ca-daily"), "and the Canadian one is not");
  const ca = (await call(`/api/deals?scope=national&${at(OTTAWA)}`)).results.map((deal) => deal.id);
  assert.ok(ca.includes("ca-daily") && !ca.includes("us-daily"), "and the other way round for Ottawa");
});

test("across the Detroit River, the visitor's network decides", async () => {
  assert.equal((await call(`/api/deals?${at(DETROIT)}`, { "cf-ipcountry": "CA" })).resolvedLocation.country, "CA");
  assert.equal((await call(`/api/deals?${at(WINDSOR)}`, { "cf-ipcountry": "US" })).resolvedLocation.country, "US");
  // The same point with no network country to go on: the line's own answer, not a cached one.
  assert.equal((await call(`/api/deals?${at(DETROIT)}`)).resolvedLocation.country, "US");
  assert.equal((await call(`/api/deals?${at(WINDSOR)}`)).resolvedLocation.country, "CA");
});

test("a country the client names still wins, and so does the clock it sends", async () => {
  const named = (await call(`/api/deals?${at(KNOXVILLE)}&country=CA`)).resolvedLocation;
  assert.equal(named.country, "CA");
  const clocked = (await call(`/api/deals?${at(KNOXVILLE)}&tz=America/Chicago`)).resolvedLocation;
  assert.equal(clocked.timezone, "America/Chicago");
  const nonsense = (await call(`/api/deals?${at(KNOXVILLE)}&tz=Not/AZone`)).resolvedLocation;
  assert.equal(nonsense.timezone, "America/New_York", "a zone the runtime does not know is ignored, not thrown on");
});

test("a national offer's today is the reader's today", async () => {
  const oneDay = async (tz) => (await call(`/api/deals?scope=national&country=US&tz=${tz}`)).results.find((deal) => deal.id === "us-one-day");
  assert.equal((await oneDay("Pacific/Kiritimati")).available_today, true, `${KIRITIMATI_DAY} on Kiritimati`);
  assert.equal((await oneDay("Pacific/Pago_Pago")).available_today, false, "and not yet, or no longer, in Pago Pago");
});

test("a bare name that is one of Radar's markets is that market", async () => {
  const { resolvedLocation } = await call("/api/deals?city=Morristown");
  assert.equal(resolvedLocation.region, "TN", "Morristown, Tennessee - the one with deals - not New Jersey's");
  const named = (await call(`/api/deals?city=${encodeURIComponent("Morristown, NJ")}`)).resolvedLocation;
  assert.notEqual(named.region, "TN", "a reader who names another state is taken at their word");
});

test("a point's nationwide list keeps to the state its network places the reader in", async () => {
  const network = (region, [latitude, longitude]) => ({ "cf-ipcountry": "US", "cf-region-code": region, "cf-iplatitude": String(latitude), "cf-iplongitude": String(longitude) });
  const ids = async (headers) => (await call(`/api/deals?scope=national&${at(KNOXVILLE)}`, headers)).results.map((deal) => deal.id);
  const home = await ids(network("TN", KNOXVILLE));
  assert.ok(!home.includes("west-daily"), "a chain with no restaurant in Tennessee is not offered in Knoxville");
  assert.ok(home.includes("us-daily"), "one with no recorded footprint still is");
  const away = await ids(network("CA", [34.0522, -118.2437]));
  assert.ok(away.includes("west-daily"), "a network in Los Angeles places a Knoxville point nowhere, so every chain is shown");
  assert.ok((await ids({ "cf-ipcountry": "US" })).includes("west-daily"), "and so does a network with no region");
});
