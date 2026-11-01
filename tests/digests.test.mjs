import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import ts from "typescript";

// The digest route imports cloudflare:workers, which cannot be loaded here, so take the pure
// matching layer out of it by source slice rather than re-implementing it — a re-implementation
// would happily keep passing while the shipped predicate drifted.
const routeSource = await readFile(new URL("../app/api/jobs/digests/route.ts", import.meta.url), "utf8");
const start = routeSource.indexOf("const DEAL_SQL");
const end = routeSource.indexOf("export async function POST");
assert.ok(start > 0 && end > start, "matching layer not found in the digest route");

const searchSource = await readFile(new URL("../app/search.ts", import.meta.url), "utf8");
async function load(source) {
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const { kmBetween } = await load(searchSource);
globalThis.__kmBetween = kmBetween;
// The radius rules the route imports from app/radius.ts, which is import-free and loads as is.
globalThis.__radius = await load(await readFile(new URL("../app/radius.ts", import.meta.url), "utf8"));
const slice = routeSource
  .slice(start, end)
  .replace(/^const DEAL_SQL/m, "export const DEAL_SQL")
  .replace(/^function /gm, "export function ");
const { DEAL_SQL, groupDeals, postalPrefix, nearRecipient } = await load(
  `const kmBetween = globalThis.__kmBetween;\nconst { DEFAULT_AREA_RADIUS_KM, MIN_RADIUS_KM, maxRadiusKm } = globalThis.__radius;\n${slice}`,
);

const OTTAWA = { latitude: 45.4215, longitude: -75.6972 };
const AUSTIN = { latitude: 30.2672, longitude: -97.7431 };
const KANATA = { latitude: 45.3088, longitude: -75.8992 }; // ~20 km west of downtown Ottawa

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE deals (id TEXT PRIMARY KEY, slug TEXT, restaurant TEXT, restaurant_id TEXT, location_id TEXT,
      title TEXT, price TEXT, city TEXT, address TEXT, schedule TEXT, emoji TEXT, category TEXT, postal_prefix TEXT,
      status TEXT, active INTEGER, deleted_at TEXT, expires_at TEXT, sponsored INTEGER, verified_at TEXT);
    CREATE TABLE restaurant_locations (id TEXT PRIMARY KEY, restaurant_id TEXT, address TEXT, city TEXT,
      postal_prefix TEXT, latitude REAL, longitude REAL, status TEXT);
    CREATE TABLE deal_locations (deal_id TEXT, location_id TEXT, eligibility TEXT);
  `);
  const deal = (id, city, prefix, restaurantId, locationId, address) =>
    db.prepare("INSERT INTO deals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'live',1,NULL,NULL,0,'2026-09-01')")
      .run(id, id, id, restaurantId, locationId, `${id} title`, "$5", city, address, "Mondays", null, null, prefix);
  const place = (id, restaurantId, address, city, prefix, point) =>
    db.prepare("INSERT INTO restaurant_locations VALUES (?,?,?,?,?,?,?,'operating')")
      .run(id, restaurantId, address, city, prefix, point?.latitude ?? null, point?.longitude ?? null);

  // Single-location Ottawa deal: the restaurant's only location is the deal's own.
  deal("ottawa", "Ottawa", "K1P", "r-ott", "l-ott", "1 Bank St");
  place("l-ott", "r-ott", "1 Bank St", "Ottawa", "K1P", OTTAWA);

  // Austin deal, same shape. The bug this replaces sent this to Ottawa recipients.
  deal("austin", "Austin", "787", "r-aus", "l-aus", "1 Congress Ave");
  place("l-aus", "r-aus", "1 Congress Ave", "Austin", "787", AUSTIN);

  // Chain: flagship in Austin is where the deal row points, but a confirmed Kanata branch also
  // carries the offer, so an Ottawa recipient on a 25 km radius should get it.
  deal("chain", "Austin", "787", "r-chain", "l-chain-aus", "2 Congress Ave");
  place("l-chain-aus", "r-chain", "2 Congress Ave", "Austin", "787", AUSTIN);
  place("l-chain-ott", "r-chain", "2 March Rd", "Kanata", "K2K", KANATA);
  db.prepare("INSERT INTO deal_locations VALUES ('chain','l-chain-aus','confirmed')").run();
  db.prepare("INSERT INTO deal_locations VALUES ('chain','l-chain-ott','confirmed')").run();

  // Same chain, but the Kanata branch is explicitly not honoring this one.
  deal("chain-excluded", "Austin", "787", "r-chain", "l-chain-aus", "2 Congress Ave");
  db.prepare("INSERT INTO deal_locations VALUES ('chain-excluded','l-chain-aus','confirmed')").run();
  db.prepare("INSERT INTO deal_locations VALUES ('chain-excluded','l-chain-ott','unconfirmed')").run();

  // Ottawa deal whose location was never geocoded — only the postal prefix can place it.
  deal("ungeocoded", "Ottawa", "K1P", "r-ung", "l-ung", "9 Elgin St");
  place("l-ung", "r-ung", "9 Elgin St", "Ottawa", "K1P", null);

  // Expired and soft-deleted rows must never reach anybody.
  db.prepare("UPDATE deals SET expires_at='2020-01-01T00:00:00Z' WHERE id='austin'").run();
  deal("deleted", "Ottawa", "K1P", "r-ott", "l-ott", "1 Bank St");
  db.prepare("UPDATE deals SET deleted_at='2026-01-01' WHERE id='deleted'").run();
  // Added last so the positional inserts above keep their shape. NULL on every row here: none of
  // these deals runs brand-wide.
  db.exec("ALTER TABLE deals ADD COLUMN location_scope TEXT");
  return db;
}

const db = fixture();
const rows = db.prepare(DEAL_SQL.replace(/CURRENT_TIMESTAMP/g, "datetime('now')")).all();
const catalog = groupDeals(rows);
const matched = (recipient) => {
  const prefix = postalPrefix(recipient.postal ?? null);
  return catalog.filter((deal) => nearRecipient(deal, recipient, prefix)).map((deal) => deal.id).sort();
};

test("the query drops expired and deleted deals", () => {
  assert.deepEqual(catalog.map((deal) => deal.id).sort(), ["chain", "chain-excluded", "ottawa", "ungeocoded"]);
});

test("a located recipient gets deals within their radius, not the national catalog", () => {
  // 25 km from downtown Ottawa reaches Kanata; the Austin-only chain deal stays out.
  assert.deepEqual(matched({ ...OTTAWA, postal: "K1P 1J1", city: "Ottawa", radius: 25 }), ["chain", "ottawa", "ungeocoded"]);
});

test("a tight radius still keeps the same-prefix deal a distance filter would have dropped", () => {
  // 2 km excludes Kanata, so "chain" goes; "ungeocoded" survives on postal prefix alone.
  assert.deepEqual(matched({ ...OTTAWA, postal: "K1P 1J1", city: "Ottawa", radius: 2 }), ["ottawa", "ungeocoded"]);
});

test("an unconfirmed branch does not put a far-away deal in range", () => {
  assert.ok(!matched({ ...OTTAWA, postal: "K1P 1J1", city: "Ottawa", radius: 50 }).includes("chain-excluded"));
});

test("a recipient with only a postal code falls back to the prefix", () => {
  assert.deepEqual(matched({ latitude: null, longitude: null, postal: "K1P 1J1", city: null, radius: 10 }), ["ottawa", "ungeocoded"]);
});

test("a recipient we cannot place at all still receives mail", () => {
  assert.deepEqual(matched({ latitude: null, longitude: null, postal: null, city: null, radius: null }),
    ["chain", "chain-excluded", "ottawa", "ungeocoded"]);
});

test("an Austin recipient gets the Austin chain deal and none of Ottawa's", () => {
  assert.deepEqual(matched({ ...AUSTIN, postal: "78701", city: "Austin", radius: 25 }), ["chain", "chain-excluded"]);
});

test("a brand-wide deal reaches every branch of its brand with no deal_locations rows at all", () => {
  // A national promotion is one deal with location_scope='brand' (drizzle/0049) rather than a
  // confirmed row per branch. Its Kanata branch has to put it in range of an Ottawa recipient exactly
  // as a confirmed row did, and its closed branch must not.
  const brandDb = fixture();
  brandDb.prepare("INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,price,city,address,schedule,postal_prefix,status,active,sponsored,verified_at,location_scope) VALUES ('national','national','Brand','r-brand','l-brand-aus','Value menu','$5','Austin','3 Congress Ave','Daily','787','live',1,0,'2026-09-01','brand')").run();
  brandDb.prepare("INSERT INTO restaurant_locations VALUES ('l-brand-aus','r-brand','3 Congress Ave','Austin','787',30.2672,-97.7431,'operating')").run();
  brandDb.prepare("INSERT INTO restaurant_locations VALUES ('l-brand-kan','r-brand','4 March Rd','Kanata','K2K',45.3088,-75.8992,'operating')").run();
  brandDb.prepare("INSERT INTO restaurant_locations VALUES ('l-brand-shut','r-brand','5 Bank St','Ottawa','K1P',45.4215,-75.6972,'closed')").run();
  const brandCatalog = groupDeals(brandDb.prepare(DEAL_SQL.replace(/CURRENT_TIMESTAMP/g, "datetime('now')")).all());
  const national = brandCatalog.find((deal) => deal.id === "national");
  assert.ok(national, "the brand-wide deal is in the catalogue");
  assert.equal(national.points.length, 2, "both operating branches, and not the closed one");
  const recipient = { ...OTTAWA, postal: "K1P 1J1", city: "Ottawa", radius: 25 };
  assert.ok(nearRecipient(national, recipient, postalPrefix(recipient.postal)), "the Kanata branch puts it in range");
  assert.ok(!nearRecipient(national, { ...recipient, radius: 2 }, null), "and a 2 km radius around downtown does not");
});

const postalSource = await readFile(new URL("../app/postal.ts", import.meta.url), "utf8");
const displayStart = postalSource.indexOf("export function displayCity");
const { displayCity } = await load(postalSource.slice(displayStart));

test("an FSA place name is trimmed to something worth showing a person", () => {
  assert.equal(displayCity("Ottawa (Queensway / Copeland / Carlington / Carleton Heights)"), "Ottawa");
  assert.equal(displayCity("Ottawa"), "Ottawa");
  assert.equal(displayCity("(Unnamed)"), "(Unnamed)");
  assert.equal(displayCity(null), null);
  assert.equal(displayCity(""), null);
});
