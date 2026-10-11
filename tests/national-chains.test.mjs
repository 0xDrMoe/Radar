// Nationwide chains in a section of their own, in Canada as in the US.
//
// `chains=separate` is how the homepage asks for it: the local list leaves out every chain marked
// national (restaurants.national_chain, drizzle/0051), and the nationwide list takes in their
// branch deals - near the reader when the page knows where the reader is, in the reader's province
// when a search named one. Canada's chains all have branches, so without the second half Canada
// would have no section at all. A client that does not ask - the phone app - sees both lists as
// they were. These drive the built worker against a real SQLite database made from drizzle/*.sql.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const ALIAS = `data:text/javascript,${encodeURIComponent(`
export const env = new Proxy({}, { get: (_target, key) => globalThis.__CHAINS_TEST_ENV__?.[key] });
export const waitUntil = (promise) => { if (promise && typeof promise.then === "function") globalThis.__CHAINS_TEST_WAITS__.push(promise.catch(() => {})); };
`)}`;
globalThis.__CHAINS_TEST_WAITS__ = [];
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

const OTTAWA = [45.4215, -75.6972];

function database() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const restaurant = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,national_chain,website,country) VALUES (?,?,?,1,?,?,'CA')");
  restaurant.run("timmies", "Tim Hortons", "Cafe", 1, "https://timhortons.example");
  // A chain by `is_chain` - three pubs - and nobody outside Ottawa has heard of it.
  restaurant.run("barley-mow", "The Barley Mow", "Pub", 0, "https://barleymow.example");
  restaurant.run("donuts-ca", "Canadian Donut Chain", "Cafe", 1, "https://donuts.example");
  const branch = db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone) VALUES (?,?,?,?,?,'CA',?,?,?,?)");
  branch.run("th-ottawa", "timmies", "1 Bank St", "Ottawa", "ON", "K1P", 45.4201, -75.6995, "America/Toronto");
  branch.run("th-rideau", "timmies", "200 Rideau St", "Ottawa", "ON", "K1N", 45.4268, -75.6907, "America/Toronto");
  branch.run("th-vancouver", "timmies", "1 Granville St", "Vancouver", "BC", "V6Z", 49.2827, -123.1207, "America/Vancouver");
  branch.run("bm-ottawa", "barley-mow", "1200 Bank St", "Ottawa", "ON", "K1S", 45.3933, -75.6831, "America/Toronto");
  const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,location_scope)
    VALUES (?,?,?,?,?,?,'Food deal',?,'Daily',?,?,?,?,'🍩','https://example.test/offer',?)`);
  deal.run("th-ottawa-deal", "th-ottawa-deal", "Tim Hortons", "timmies", "th-ottawa", "Two donuts", "Cafe", "Ottawa", "K1P", "1 Bank St", "$2", null);
  // The same offer at a second Ottawa branch, a little further from the reader.
  deal.run("th-rideau-deal", "th-rideau-deal", "Tim Hortons", "timmies", "th-rideau", "Two donuts", "Cafe", "Ottawa", "K1N", "200 Rideau St", "$2", null);
  deal.run("th-vancouver-deal", "th-vancouver-deal", "Tim Hortons", "timmies", "th-vancouver", "Timbits box", "Cafe", "Vancouver", "V6Z", "1 Granville St", "$4", null);
  // The Ottawa offer again, as another source worded it: the same offer, which the words alone miss.
  deal.run("th-vancouver-donuts", "th-vancouver-donuts", "Tim Hortons", "timmies", "th-vancouver", "Two donuts", "Cafe", "Vancouver", "V6Z", "1 Granville St", "Only $2", null);
  // And the Timbits box at other hours: a different offer, whatever it shares with the first.
  deal.run("th-vancouver-early", "th-vancouver-early", "Tim Hortons", "timmies", "th-vancouver", "Timbits box", "Cafe", "Vancouver", "V6Z", "1 Granville St", "$4", null);
  db.prepare("UPDATE deals SET schedule='Daily 6-9 AM' WHERE id='th-vancouver-early'").run();
  deal.run("bm-ottawa-deal", "bm-ottawa-deal", "The Barley Mow", "barley-mow", "bm-ottawa", "Wing night", "Pub", "Ottawa", "K1S", "1200 Bank St", "$0.75 wings", null);
  // A promotion with no branch at all, which the nationwide list has always carried.
  deal.run("ca-daily", "ca-daily", "Canadian Donut Chain", "donuts-ca", null, "Coffee and a donut", "Cafe", "", "", "", "$3", "national");
  // More nationwide offers than one page of any other list holds - in the US, out of Canada's way.
  db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,national_chain,website,country) VALUES ('us-many','Many Offers Burgers','American',1,1,'https://many.example','US')").run();
  for (let n = 0; n < 60; n++) deal.run(`us-offer-${n}`, `us-offer-${n}`, "Many Offers Burgers", "us-many", null, `Offer ${n}`, "American", "", "", "", `$${n}`, "national");
  // The same name in Canada, with a branch in Calgary: another country's card.
  restaurant.run("many-ca", "Many Offers Burgers", "American", 1, "https://many.example");
  branch.run("many-calgary", "many-ca", "1 Stephen Ave", "Calgary", "AB", "T2P", 51.0447, -114.0719, "America/Edmonton");
  deal.run("many-ca-deal", "many-ca-deal", "Many Offers Burgers", "many-ca", "many-calgary", "Canadian combo", "American", "Calgary", "T2P", "1 Stephen Ave", "$9", null);
  // One brand as two restaurant rows, each named for its branch (drizzle/0052).
  const branded = db.prepare("INSERT INTO restaurants (id,name,brand,cuisine,is_chain,national_chain,website,country) VALUES (?,?,'JOEY','Bar',1,1,'https://joeyrestaurants.example','CA')");
  branded.run("joey-burnaby", "JOEY Burnaby");
  branded.run("joey-rideau", "JOEY Rideau");
  branch.run("joey-burnaby-branch", "joey-burnaby", "4750 Kingsway", "Burnaby", "BC", "V5H", 49.2276, -123.0026, "America/Vancouver");
  branch.run("joey-rideau-branch", "joey-rideau", "50 Rideau St", "Ottawa", "ON", "K1N", 45.4254, -75.6921, "America/Toronto");
  deal.run("joey-burnaby-deal", "joey-burnaby-deal", "JOEY Burnaby", "joey-burnaby", "joey-burnaby-branch", "Half-price wine", "Bar", "Burnaby", "V5H", "4750 Kingsway", "50% off", null);
  deal.run("joey-rideau-deal", "joey-rideau-deal", "JOEY Rideau", "joey-rideau", "joey-rideau-branch", "Happy hour", "Bar", "Ottawa", "K1N", "50 Rideau St", "$6 cocktails", null);
  // One happy hour at two branches that keep different hours, and a second window at one of them.
  restaurant.run("pint-house", "Pint House", "Pub", 1, "https://pinthouse.example");
  branch.run("ph-elgin", "pint-house", "10 Elgin St", "Ottawa", "ON", "K1P", 45.4231, -75.6955, "America/Toronto");
  branch.run("ph-calgary", "pint-house", "10 Stephen Ave", "Calgary", "AB", "T2P", 51.0452, -114.0655, "America/Edmonton");
  deal.run("ph-elgin-happy", "ph-elgin-happy", "Pint House", "pint-house", "ph-elgin", "Happy hour", "Pub", "Ottawa", "K1P", "10 Elgin St", "$5 pints", null);
  deal.run("ph-elgin-late", "ph-elgin-late", "Pint House", "pint-house", "ph-elgin", "Happy hour", "Pub", "Ottawa", "K1P", "10 Elgin St", "$5 pints", null);
  deal.run("ph-calgary-happy", "ph-calgary-happy", "Pint House", "pint-house", "ph-calgary", "Happy hour", "Pub", "Calgary", "T2P", "10 Stephen Ave", "$5 pints", null);
  db.prepare("UPDATE deals SET schedule = CASE id WHEN 'ph-elgin-happy' THEN 'Daily 3-6 PM' WHEN 'ph-elgin-late' THEN 'Daily 9 PM-close' ELSE 'Daily 2-5 PM' END WHERE restaurant_id = 'pint-house'").run();
  return db;
}

const answers = new Map();
globalThis.caches = {
  default: {
    match: async (request) => { const hit = answers.get(request.url); return hit ? new Response(hit.body, hit.init) : undefined; },
    put: async (request, response) => { answers.set(request.url, { body: await response.text(), init: { status: response.status, headers: [...response.headers] } }); },
  },
};
globalThis.__CHAINS_TEST_ENV__ = { DB: d1(database()), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };

const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
async function call(path) {
  const response = await worker.fetch(new Request(`https://radar.cheap${path}`), globalThis.__CHAINS_TEST_ENV__, { waitUntil() {}, passThroughOnException() {} });
  for (let i = 0; i < 5 && globalThis.__CHAINS_TEST_WAITS__.length; i++) { const pending = globalThis.__CHAINS_TEST_WAITS__; globalThis.__CHAINS_TEST_WAITS__ = []; await Promise.all(pending); }
  assert.equal(response.status, 200, `${path} answered ${response.status}`);
  return response.json();
}
const near = `lat=${OTTAWA[0]}&lng=${OTTAWA[1]}&radius=25`;
const restaurants = (body) => body.results.map((deal) => deal.restaurant);
const ids = (body) => body.results.map((deal) => deal.id);

test("without chains=separate, both lists are as they were", async () => {
  const local = restaurants(await call(`/api/deals?${near}`));
  assert.ok(local.includes("Tim Hortons"), "a national chain's branch deal is in the local list");
  assert.ok(local.includes("The Barley Mow"));
  const national = ids(await call(`/api/deals?scope=national&country=CA&${near}`));
  assert.deepEqual(national, ["ca-daily"], "and the nationwide list is the branchless promotions alone");
});

test("with chains=separate, the local list leaves national chains out and keeps local ones", async () => {
  const local = restaurants(await call(`/api/deals?${near}&chains=separate`));
  assert.ok(!local.includes("Tim Hortons"), "Tim Hortons has moved to the nationwide section");
  assert.ok(local.includes("The Barley Mow"), "three Ottawa pubs are a chain, not a national one");
});

test("the nationwide list takes in a national chain's branch deals near the reader", async () => {
  const national = ids(await call(`/api/deals?scope=national&chains=separate&country=CA&${near}`));
  assert.ok(national.includes("th-ottawa-deal"), "the Ottawa branch's deal is within the radius");
  assert.ok(!national.includes("th-vancouver-deal"), "the Vancouver branch's is not");
  assert.ok(!national.includes("bm-ottawa-deal"), "a local chain never lands in the nationwide list");
  assert.ok(national.includes("ca-daily"), "and the branchless promotion is still there");
});

test("with no point, a named province places them instead", async () => {
  const bc = ids(await call("/api/deals?scope=national&chains=separate&country=CA&province=BC"));
  assert.ok(bc.includes("th-vancouver-deal") && !bc.includes("th-ottawa-deal"));
});

test("a branch deal in the nationwide list says where it runs", async () => {
  const { results } = await call(`/api/deals?scope=national&chains=separate&country=CA&${near}&view=compact`);
  const ottawa = results.find((deal) => deal.id === "th-ottawa-deal");
  assert.equal(ottawa.city, "Ottawa");
  assert.notEqual(ottawa.location_scope, "national", "which is how the card knows to print the city");
});

test("an offer run at several branches is one card, led by the nearest and counting them all", async () => {
  const { results } = await call(`/api/deals?scope=national&chains=separate&country=CA&${near}&view=compact`);
  const donuts = results.filter((deal) => deal.title === "Two donuts");
  assert.equal(donuts.length, 1, "Bank St and Rideau St run the same offer");
  assert.equal(donuts[0].id, "th-ottawa-deal", "Bank St is the nearer of the two");
  assert.equal(donuts[0].participating_location_count, 2);
  const everywhere = (await call("/api/deals?scope=national&chains=separate&country=CA&view=compact")).results;
  assert.ok(everywhere.some((deal) => deal.id === "th-vancouver-deal"), "a different offer is a card of its own");
});

// ── group=brand: a card per brand, listing its offers ──────────────────────────────────────────

const brandCards = async (query) => (await call(`/api/deals?scope=national&chains=separate&group=brand&view=compact&limit=200${query}`)).results;

test("group=brand is one card per brand, carrying every offer it runs", async () => {
  const cards = await brandCards(`&country=CA&${near}`);
  const timmies = cards.filter((card) => card.brand_name === "Tim Hortons");
  assert.equal(timmies.length, 1, "Tim Hortons once, however many offers it has");
  const donuts = timmies[0].chain_offers.filter((offer) => offer.title === "Two donuts");
  assert.equal(donuts.length, 1);
  assert.equal(donuts[0].participating_location_count, 2, "an offer at two branches is one line, counting both");
  assert.equal(donuts[0].city, "Ottawa", "and says where it runs");
  // A row with no brand is the card of its own name, and a promotion with no branches counts none.
  const chain = cards.find((card) => card.brand_name === "Canadian Donut Chain");
  assert.deepEqual(chain.chain_offers.map((offer) => [offer.id, offer.participating_location_count]), [["ca-daily", null]]);
});

test("an offer worded two ways is one line on its brand's card, and other hours are another", async () => {
  const timmies = (await brandCards("&country=CA")).find((card) => card.brand_name === "Tim Hortons");
  const lines = timmies.chain_offers.map((offer) => offer.title).sort();
  assert.deepEqual(lines, ["Timbits box", "Timbits box", "Two donuts"], "'Daily 6-9 AM' is not 'Daily'");
  const donuts = timmies.chain_offers.find((offer) => offer.title === "Two donuts");
  assert.equal(donuts.participating_location_count, 3, "'$2' in Ottawa and 'Only $2' in Vancouver, three branches");
});

test("one promotion kept at different hours by different branches is one line that says so", async () => {
  const lines = (await brandCards("&country=CA")).find((card) => card.brand_name === "Pint House").chain_offers;
  assert.equal(lines.length, 2, "Elgin St's two windows stay two lines; Calgary's hours join one of them");
  const shared = lines.filter((offer) => offer.schedule_varies);
  assert.equal(shared.length, 1, lines.map((offer) => `${offer.id} ${offer.schedule}`).join(", "));
  assert.equal(shared[0].participating_location_count, 2, "and it counts both restaurants");
  // Near Ottawa only Elgin St is in reach, and one restaurant's two windows never merge.
  const ottawa = (await brandCards(`&country=CA&${near}`)).find((card) => card.brand_name === "Pint House").chain_offers;
  assert.deepEqual(ottawa.map((offer) => offer.id).sort(), ["ph-elgin-happy", "ph-elgin-late"]);
  assert.ok(ottawa.every((offer) => !offer.schedule_varies));
});

test("group=brand puts restaurant rows named for one branch under their brand", async () => {
  const cards = await brandCards("&country=CA");
  const joey = cards.filter((card) => card.brand_name === "JOEY");
  assert.equal(joey.length, 1, "JOEY Burnaby and JOEY Rideau are one card");
  // The seeded JOEY Burnaby's offers (drizzle/0052 names its brand) are on it too.
  const offers = joey[0].chain_offers.map((offer) => offer.id);
  assert.ok(offers.includes("joey-burnaby-deal") && offers.includes("joey-rideau-deal"), offers.join());
  assert.ok(!cards.some((card) => /^JOEY /.test(card.brand_name)), "and neither branch's name is a card of its own");
  // Placed as ever: near Ottawa, the card holds the Ottawa offers alone.
  const nearby = (await brandCards(`&country=CA&${near}`)).find((card) => card.brand_name === "JOEY").chain_offers;
  assert.ok(nearby.some((offer) => offer.id === "joey-rideau-deal"));
  assert.ok(nearby.every((offer) => offer.city === "Ottawa"), nearby.map((offer) => offer.city).join());
});

test("group=brand keeps one name's two countries apart", async () => {
  const cards = (await brandCards("")).filter((card) => card.brand_name === "Many Offers Burgers");
  assert.deepEqual(cards.map((card) => card.country).sort(), ["CA", "US"], "a Canadian price and an American one are two cards");
  assert.equal(cards.find((card) => card.country === "US").chain_offers.length, 60, "and sixty American offers are one");
});

test("only the nationwide list is grouped, and only when it asks", async () => {
  const offers = (await call("/api/deals?scope=national&chains=separate&country=CA&view=compact&limit=200")).results;
  assert.ok(offers.length && offers.every((deal) => deal.chain_offers === undefined), "without group=brand, a card per offer");
  const local = (await call(`/api/deals?${near}&group=brand`)).results;
  assert.ok(local.length && local.every((deal) => deal.chain_offers === undefined), "the local list is a card per place either way");
});

test("every offer on a brand card says its phase, in whatever language its line is written", async () => {
  // The phone app sorts and colours offers by phase. Read off the line, it only works in English.
  const query = "/api/deals?scope=national&chains=separate&country=CA&view=compact&limit=200&locale=fr";
  const phases = new Map((await call(query)).results.map((deal) => [deal.id, deal.availability_phase]));
  const offers = (await call(`${query}&group=brand`)).results.flatMap((card) => card.chain_offers);
  assert.ok(offers.length > 1);
  for (const offer of offers) {
    assert.ok(phases.has(offer.id), `${offer.id} is a card of the ungrouped list`);
    assert.equal(offer.availability_phase, phases.get(offer.id), offer.id);
  }
});

test("the compact nationwide list comes whole in one request; every other list still pages at 50", async () => {
  const whole = await call("/api/deals?scope=national&country=US&view=compact&limit=200");
  assert.equal(whole.results.length, 60, "one request, where it used to take two");
  assert.equal(whole.nextCursor ?? null, null);
  assert.equal((await call("/api/deals?scope=national&country=US&limit=200")).results.length, 50, "the full view is still paged");
});
