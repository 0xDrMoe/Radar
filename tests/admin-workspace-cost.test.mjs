// What one load of the staff workspace (GET /api/admin) reads.
//
// It used to read deal_schedules, deal_locations and deal_items whole on every load, every save
// (the client reloads after each) and every keystroke of the deal search. deal_locations still
// holds one row per branch behind the US chains, thousands of them, and parsing those took more CPU
// than a request is allowed, so staff got the runtime's error page. These pin the three reads to
// the deals on the page, keep chain-wide deals' branch rows out of the answer, and keep the deal
// search from running every other workspace read. The side queries run against the real schema
// built from drizzle/*.sql, so a renamed column fails here rather than in production.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const route = readFileSync(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const getHandler = route.slice(route.indexOf("export async function GET("), route.indexOf("export async function POST("));
const readAdminDeals = route.slice(route.indexOf("async function readAdminDeals("), route.indexOf("export async function GET("));

function sideQuery(table) {
  const match = readAdminDeals.match(new RegExp(`"(SELECT [^"]*FROM ${table}[^"]*)"`));
  assert.ok(match, `expected readAdminDeals to read ${table}`);
  return match[1];
}

test("every side table is read for the deals on the page, not whole", () => {
  for (const table of ["deal_schedules", "deal_locations", "deal_items"]) {
    assert.match(sideQuery(table), /deal_id IN \(SELECT value FROM json_each\(\?\)\)/, `${table} is scoped to the page`);
    assert.doesNotMatch(getHandler, new RegExp(`FROM ${table} ORDER BY`), `GET no longer reads ${table} whole`);
  }
  assert.doesNotMatch(getHandler, /FROM deal_locations dl JOIN restaurant_locations l ON l\.id=dl\.location_id ORDER BY/);
});

test("chain-wide deals carry no branch rows into the workspace", () => {
  assert.match(readAdminDeals, /location_scope !== "brand" && deal\.location_scope !== "national"/);
  assert.match(readAdminDeals, /\.bind\(branchIds\)/, "deal_locations is read for the per-branch deals only");
});

test("the deal search answers with the deal list alone, before the rest of the workspace is read", () => {
  const early = getHandler.indexOf("if (dealConditions.length) return Response.json({ deals: await readAdminDeals(");
  assert.ok(early > 0, "expected the search to return early");
  assert.ok(early < getHandler.indexOf("await Promise.all(["), "and before the workspace reads");
});

test("reads the client never used are gone", () => {
  assert.doesNotMatch(getHandler, /FROM restaurant_locations ORDER BY city,address/);
  assert.doesNotMatch(getHandler, /FROM verification_events ORDER BY verified_at DESC LIMIT/);
  assert.doesNotMatch(getHandler, /FROM email_deliveries GROUP BY status/);
});

test("the side queries return only the requested deals' rows on the real schema", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  db.exec("INSERT INTO restaurants(id,name,cuisine,slug) VALUES('r1','Chain','Burgers','chain')");
  for (const n of [1, 2, 3]) {
    db.exec(`INSERT INTO restaurant_locations(id,restaurant_id,address,city,postal_prefix,timezone,slug) VALUES('l${n}','r1','${n} Main St','Ottawa','K1A','America/Toronto','chain-${n}')`);
  }
  for (const id of ["shown", "other"]) {
    db.exec(`INSERT INTO deals(id,slug,restaurant_id,location_id,restaurant,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url) VALUES('${id}','${id}','r1','l1','Chain','Deal','Food','Burgers','Mon 3-6 PM','Ottawa','K1A','1 Main St','$9','🍔','https://example.com')`);
    db.exec(`INSERT INTO deal_schedules(deal_id,display_text,timezone,days,start_time,end_time) VALUES('${id}','Mon 3-6 PM','America/Toronto','["mon"]','15:00','18:00')`);
    db.exec(`INSERT INTO deal_items(deal_id,name,discounted_price,sort_order) VALUES('${id}','Wings','$9',0)`);
  }
  for (const location of ["l1", "l2", "l3"]) {
    db.exec(`INSERT INTO deal_locations(deal_id,location_id,eligibility) VALUES('shown','${location}','confirmed'),('other','${location}','confirmed')`);
  }
  const page = JSON.stringify(["shown"]);
  for (const table of ["deal_schedules", "deal_locations", "deal_items"]) {
    const rows = db.prepare(sideQuery(table)).all(page);
    assert.ok(rows.length > 0, `${table} returns the page's rows`);
    assert.ok(rows.every((row) => row.deal_id === "shown"), `${table} returns nothing for a deal not on the page`);
    assert.equal(db.prepare(sideQuery(table)).all("[]").length, 0, `${table} with no deals reads nothing`);
  }
  assert.equal(db.prepare(sideQuery("deal_locations")).all(page).length, 3);
});

// The catalog cache (adminCatalog in the route): the deal list and the drink-rule check, kept per
// isolate under a fingerprint of what they are built from.
const catalogCache = route.slice(route.indexOf("const CATALOG_MAX_AGE_MS"), route.indexOf("export async function GET("));
const postHandler = route.slice(route.indexOf("export async function POST("));

test("a workspace load takes the deal list and drink-rule check from the catalog cache", () => {
  assert.match(getHandler, /loadAdminCatalog\(Date\.now\(\)\)/);
  assert.doesNotMatch(getHandler, /DRINK_RULE_LIVE_SQL/, "the drink-rule read lives in the cache, not in every load");
  assert.match(getHandler, /`\{"deals":\$\{catalog\.dealsJson\},"drinkRuleAlerts":\$\{catalog\.drinkRuleAlertsJson\},\$\{rest\.slice\(1\)\}`/);
});

test("the fingerprint is read before the catalog, so a copy is never older than its key", () => {
  const load = catalogCache.slice(catalogCache.indexOf("async function loadAdminCatalog("));
  const fingerprint = load.indexOf("await readCatalogRevision()");
  assert.ok(fingerprint > 0 && fingerprint < load.indexOf("readAdminDeals("), "readCatalogRevision runs first");
  assert.match(load, /kept\.revision === revision && now - kept\.readAt < CATALOG_MAX_AGE_MS/, "reused only for the same fingerprint, and never past the max age");
});

test("the fingerprint covers every table the catalog is built from", () => {
  const sql = catalogCache.slice(catalogCache.indexOf("async function readCatalogRevision("), catalogCache.indexOf("async function loadAdminCatalog("));
  for (const table of ["deals", "restaurants", "restaurant_locations", "deal_locations"]) {
    assert.ok(sql.includes(`MAX(updated_at) FROM ${table})`), `edits to ${table}`);
    assert.ok(sql.includes(`MAX(rowid) FROM ${table})`), `inserts into ${table}`);
  }
  for (const table of ["deal_items", "verification_events", "audit_log"]) assert.ok(sql.includes(`MAX(rowid) FROM ${table})`), `appends to ${table}`);
  assert.ok(sql.includes("FROM data_changes"), "deletes, schedules and search terms");
});

test("a workspace action drops this isolate's copy before it writes anything", () => {
  const forget = postHandler.indexOf("forgetAdminCatalog();");
  assert.ok(forget > 0, "POST forgets the catalog");
  assert.ok(forget < postHandler.indexOf("env.DB.prepare("), "before the first write");
});

test("the fingerprint query runs on the real schema and moves when a deal is sponsored", () => {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  const sql = [...catalogCache.matchAll(/"((?:SELECT| )[^"]*)"/g)].map((match) => match[1]).filter((part) => part.includes("MAX(") || part.includes("data_changes") || part.startsWith("SELECT")).join("");
  const read = () => JSON.stringify(db.prepare(sql).get());
  const before = read();
  // What the sponsorship action does: an UPDATE that leaves updated_at alone, then its audit row.
  db.exec("INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,details) VALUES('u','owner','sponsorship','deal','d','{}')");
  assert.notEqual(read(), before);
});
