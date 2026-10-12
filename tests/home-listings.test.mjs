// The home page's server-rendered list (app/home-listings.ts, app/HomeRecentChecks.tsx): the deals
// most recently checked against their source, one per restaurant, and the city guides. It is the
// home page's only set of deal links a crawler sees, since the cards are drawn from /api/deals,
// which robots.txt blocks. Run against a SQLite database made from drizzle/*.sql.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { freshDatabase, harness } from "./route-harness.mjs";

const { recentChecks, homeListings, catalogStats, roundedDown, RECENT_CHECKS } = await import("../app/home-listings.ts");

const db = freshDatabase();
for (const table of ["deals", "restaurants", "restaurant_locations", "deal_locations", "deal_schedules"]) db.exec(`DELETE FROM ${table}`);

const restaurant = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES (?,?,'American',0,'https://example.test','CA')");
const branch = db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone,status) VALUES (?,?,?,?,'ON','CA','K1S',45.4,-75.7,'America/Toronto','operating')");
const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,verification_status,verified_at,created_at,status,active,location_scope,expires_at,publish_at)
  VALUES (?,?,?,?,?,?,'Food deal','American','Mon',?,'K1S',?,'$5','🍔','https://example.test/offer',?,?,?,?,1,?,?,?)`);

let n = 0;
function offer({ name, title = "Half-price wings", city = "Ottawa", status = "live", scope = null, verified = "verified", at, expires = null, publish = null }) {
  n += 1;
  const rid = `r-${name}`, lid = `l${n}`, did = `d${n}`;
  if (!db.prepare("SELECT 1 FROM restaurants WHERE id=?").get(rid)) restaurant.run(rid, name);
  branch.run(lid, rid, `${n} Bank St`, city);
  deal.run(did, `deal-${n}`, name, rid, lid, title, city, `${n} Bank St`, verified, at, at, status, scope, expires, publish);
  return did;
}

// Twenty restaurants, each checked a day apart: the newest is Pub 20.
for (let i = 1; i <= 20; i += 1) offer({ name: `Pub ${i}`, at: `2026-09-${String(i).padStart(2, "0")} 12:00:00` });
// A second, older offer at the newest restaurant: one restaurant, one line.
offer({ name: "Pub 20", title: "Taco night", at: "2026-09-20 11:00:00" });
// A chain-wide offer: no city named, since it runs in many.
offer({ name: "Chain Burgers", title: "$5 burgers", scope: "brand", at: "2026-10-01 09:00:00" });
// Never listed: unverified, ended, expired, scheduled for later, newer than everything above.
offer({ name: "Unchecked", verified: "needs_review", at: "2026-10-05 12:00:00" });
offer({ name: "Archived", status: "archived", at: "2026-10-05 12:00:00" });
offer({ name: "Expired", expires: "2020-01-01 00:00:00", at: "2026-10-05 12:00:00" });
offer({ name: "Scheduled", publish: "2099-01-01 00:00:00", at: "2026-10-05 12:00:00" });

test("lists the newest checks first, one line per restaurant, and only public verified deals", async () => {
  const list = await recentChecks(harness.env.DB);
  assert.equal(list.length, RECENT_CHECKS);
  assert.deepEqual(list.slice(0, 3).map((entry) => entry.restaurant), ["Chain Burgers", "Pub 20", "Pub 19"]);
  assert.equal(list.filter((entry) => entry.restaurant === "Pub 20").length, 1, "a restaurant is listed once");
  assert.equal(list.find((entry) => entry.restaurant === "Pub 20").title, "Half-price wings", "its newest check");
  for (const left of ["Unchecked", "Archived", "Expired", "Scheduled"]) {
    assert.ok(!list.some((entry) => entry.restaurant === left), `${left} is not listed`);
  }
});

test("names the city for a local deal and none for a chain-wide one", async () => {
  const list = await recentChecks(harness.env.DB);
  assert.equal(list.find((entry) => entry.restaurant === "Pub 19").place, "Ottawa, ON");
  assert.equal(list.find((entry) => entry.restaurant === "Chain Burgers").place, "");
});

test("the catalogue's size counts every public deal, the places they run at, and their cities", async () => {
  // 23 public deals: the 21 pub offers, the chain's, and the unchecked one (public, just not
  // verified). Not the archived, expired or scheduled ones. Each offer is at its own address, all
  // in Ottawa.
  assert.deepEqual(await catalogStats(harness.env.DB), { deals: 23, restaurants: 23, cities: 1 });
  const other = offer({ name: "Gatineau Bistro", city: "Gatineau", at: "2026-08-01 12:00:00" });
  const outside = offer({ name: "Nationwide", scope: "national", city: "Toronto", at: "2026-08-01 12:00:00" });
  try {
    // A national offer is a deal but names no place, so it adds neither a restaurant nor a city.
    assert.deepEqual(await catalogStats(harness.env.DB), { deals: 25, restaurants: 24, cities: 2 });
  } finally {
    for (const id of [other, outside]) db.prepare("DELETE FROM deals WHERE id=?").run(id);
  }
});

test("the hero's figures round down, so they stay true as deals come and go", () => {
  assert.deepEqual(roundedDown(1060), { value: 1000, plus: true });
  assert.deepEqual(roundedDown(1999), { value: 1900, plus: true });
  assert.deepEqual(roundedDown(557), { value: 500, plus: true });
  assert.deepEqual(roundedDown(64), { value: 60, plus: true });
  assert.deepEqual(roundedDown(10), { value: 10, plus: true });
  assert.deepEqual(roundedDown(7), { value: 7, plus: false });
  assert.deepEqual(roundedDown(0), { value: 0, plus: false });
});

test("the city guides come with it, and the pair is read once per ten minutes", async () => {
  const first = await homeListings(harness.env.DB, 1_000);
  assert.ok(first.guides.some((city) => city.slug === "ottawa-on"), "Ottawa has enough restaurants for a guide");
  assert.equal(await homeListings(harness.env.DB, 1_000 + 60_000), first, "held within ten minutes");
  assert.notEqual(await homeListings(harness.env.DB, 1_000 + 11 * 60_000), first, "read again after");
});

test("the home page renders the list as links and degrades to nothing without a database", () => {
  const page = readFileSync(new URL("../app/[locale]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /await import\("cloudflare:workers"\)/, "imported lazily, so the page still renders in plain Node");
  assert.match(page, /if \(!db\) return null;/);
  assert.match(page, /console\.error\("home page listings failed"/, "a failed read is logged, not swallowed");
  assert.match(page, /catalogSummary=\{summary\}/, "the hero is handed the catalogue's size");
  const list = readFileSync(new URL("../app/HomeRecentChecks.tsx", import.meta.url), "utf8");
  assert.match(list, /<ChromeLink href=\{`\/deals\/\$\{encodeURIComponent\(deal\.slug \|\| deal\.id\)\}`\}/);
  assert.match(list, /href=\{`\/en\$\{cityPath\(city\)\}`\}/, "guides are English only, linked directly");
});

test("a quick-city chip links to its city's guide when it has one, and still filters on a plain click", () => {
  const client = readFileSync(new URL("../app/HomeClient.tsx", import.meta.url), "utf8");
  assert.match(client, /href=\{`\/en\/cities\/\$\{guide\}`\}/);
  assert.match(client, /event\.preventDefault\(\);\s*city\(c\);/);
  assert.match(client, /if \(!guide\) return <button onClick=\{\(\) => city\(c\)\}/);
});

test("the deploy refuses to bake a home page without the list", () => {
  const script = readFileSync(new URL("../scripts/prerender-deals.mjs", import.meta.url), "utf8");
  assert.match(script, /page === "" && !html\.includes\('class="recent-checks"'\)/);
});

test("the site's share card is the size its metadata declares, and the size of the deal cards", () => {
  const png = readFileSync(new URL("../public/og.png", import.meta.url));
  const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
  assert.deepEqual([width, height], [1200, 630]);
  const metadata = readFileSync(new URL("../app/siteMetadata.ts", import.meta.url), "utf8");
  assert.match(metadata, /const OG_IMAGE = \{ url: "\/og\.png", width: 1200, height: 630 \};/);
  const card = readFileSync(new URL("../scripts/deal-og.mjs", import.meta.url), "utf8");
  assert.match(card, /export const WIDTH = 1200;/);
  assert.match(card, /export const HEIGHT = 630;/);
});

test("the footer's column labels are not headings", () => {
  const footer = readFileSync(new URL("../app/SiteFooter.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(footer, /<h2/);
  assert.match(footer, /<ul aria-labelledby=\{`site-footer-\$\{column\.key\}`\}>/);
});

test("the Organization names its App Store listing once the app has shipped", () => {
  const shell = readFileSync(new URL("../app/RootShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /appStoreListingUrl\(\)/);
  assert.match(shell, /\.\.\.\(sameAs\.length \? \{ sameAs \} : \{\}\)/);
});
