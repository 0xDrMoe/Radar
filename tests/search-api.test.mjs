// /api/deals and the favorites half of /api/user, run for real against a SQLite database made from
// drizzle/*.sql (see tests/route-harness.mjs). Each section pins a bug that was fixed:
//
//   - a device point or a postal code in Ottawa was told "coverage is still growing"
//   - with drinks hidden, a bar's food card went with its happy hour
//   - a saved deal folded into another by drizzle/0056 dropped out of Saved
//   - day=Mon read "Daily", "Mon-Fri" and "Every day" as not Monday
//   - a signed-in reader's answer went out public
//   - nationwide brands whose every offer had ended sat among live ones
//   - the homepage's city count and the place picker's list counted different things
//
// The deals route holds its snapshot for the life of the module, so the catalogue is written once,
// before the first request, and every test reads the same one.
import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness, post } from "./route-harness.mjs";

const { GET } = await import("../app/api/deals/route.ts");
const { GET: userGet, POST: userPost } = await import("../app/api/user/route.ts");
const { marketCenters, marketFor, foldPlaceName } = await import("../app/market-coverage.ts");
const { offerRunsOn, weekdayNumber } = await import("../app/search.ts");

const ZONE = "America/Toronto";
const TOMORROW = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, weekday: "long" }).format(new Date(Date.now() + 86_400_000));
const sqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

const OTTAWA = [45.4215, -75.6972], REGINA = [50.4452, -104.6189], SUDBURY = [46.49, -80.99], NOWHERE = [60.0, -100.0];

const db = freshDatabase();
for (const table of ["deals", "restaurants", "restaurant_locations", "deal_locations", "deal_schedules", "market_coverage", "search_terms", "deal_translations", "deal_aliases", "postal_cache"]) {
  db.exec(`DELETE FROM ${table}`);
}
{
  const restaurant = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES (?,?,'American',?,'https://example.test',?)");
  const branch = db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone) VALUES (?,?,?,?,?,?,'K1S',?,?,?)");
  const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,verification_status,verified_at,created_at,status,active,location_scope,expires_at)
    VALUES (?,?,?,?,?,?,?,'American',?,?,'K1S',?,'$5','🍔','https://example.test/offer','verified',?,?,?,?,?,?)`);
  const place = (id, name, { chain = 0, country = "CA" } = {}) => restaurant.run(id, name, chain, country);
  const at = (id, restaurantId, address, city, region, [latitude, longitude], country = "CA") => branch.run(id, restaurantId, address, city, region, country, latitude, longitude, ZONE);
  const offer = (id, name, restaurantId, locationId, title, category, schedule, city, address, verified, { status = "live", scope = null, expires = null } = {}) =>
    deal.run(id, id, name, restaurantId, locationId, title, category, schedule, city, address, verified, verified, status, status === "live" ? 1 : 0, scope, expires);

  // A bar with a happy hour and a wing night at one address. The happy hour was checked last, so it
  // is the one the grouping reads first - the card's lead before anything chooses another.
  place("hometown", "Hometown Sports Grill");
  at("hometown-bank", "hometown", "1525 Bank St", "Ottawa", "ON", [45.3905, -75.6771]);
  offer("hometown-hh", "Hometown Sports Grill", "hometown", "hometown-bank", "Happy hour food & drinks", "Happy hour", "Daily 3-6 PM", "Ottawa", "1525 Bank St", "2026-09-30 12:00:00");
  offer("hometown-wings", "Hometown Sports Grill", "hometown", "hometown-bank", "Half-price pound of wings Tuesday", "Food deal", "Tuesday", "Ottawa", "1525 Bank St", "2026-09-29 12:00:00");
  // And one whose food offer is read first, so it leads before and after the drink is pruned.
  place("corner", "Corner Grill");
  at("corner-at", "corner", "7 Preston St", "Ottawa", "ON", [45.405, -75.713]);
  offer("corner-burger", "Corner Grill", "corner", "corner-at", "Burger and fries $12 Thursday", "Food deal", "Thursday", "Ottawa", "7 Preston St", "2026-09-30 13:00:00");
  offer("corner-pints", "Corner Grill", "corner", "corner-at", "Beer night: $5 pints", "Happy hour", "Friday", "Ottawa", "7 Preston St", "2026-09-28 12:00:00");

  // Four diners whose schedules say their days four ways, and one whose timed row contradicts it.
  const diner = (id, name, schedule, address, [latitude, longitude]) => {
    place(id, name);
    at(`${id}-at`, id, address, "Ottawa", "ON", [latitude, longitude]);
    offer(id, name, id, `${id}-at`, `${name} special`, "Food deal", schedule, "Ottawa", address, "2026-09-20 12:00:00");
  };
  diner("diner-daily", "Daily Diner", "Daily", "1 Elgin St", [45.42, -75.69]);
  diner("diner-weekdays", "Weekday Diner", "Mon-Fri 11 AM-2 PM", "2 Elgin St", [45.421, -75.691]);
  diner("diner-tue", "Tuesday Diner", "Tue", "3 Elgin St", [45.422, -75.692]);
  diner("diner-everyday", "Every Day Diner", "Every day, 4-6 PM", "4 Elgin St", [45.423, -75.693]);
  diner("diner-row", "Timed Diner", "Tuesday 5-8 PM", "5 Elgin St", [45.424, -75.694]);
  db.prepare("INSERT INTO deal_schedules (deal_id,display_text,days,start_time,end_time,timezone) VALUES ('diner-row','Monday 5-8 PM','[\"Mon\"]','17:00','20:00',?)").run(ZONE);

  // A duplicate of the daily diner's offer, folded into it the way drizzle/0056 folds one.
  offer("diner-daily-old", "Daily Diner", "diner-daily", "diner-daily-at", "Daily Diner special (old copy)", "Food deal", "Daily", "Ottawa", "1 Elgin St", "2026-09-01 12:00:00", { status: "archived" });
  db.prepare("INSERT INTO deal_aliases (alias_id,canonical_deal_id) VALUES ('diner-daily-old','diner-daily')").run();

  // A chain led from Ottawa, with its one Regina branch running an offer of its own.
  place("pizza-chain", "Pizza Chain", { chain: 1 });
  at("pc-ottawa", "pizza-chain", "10 Bank St", "Ottawa", "ON", [45.41, -75.69]);
  at("pc-regina", "pizza-chain", "20 Albert St", "Regina", "SK", REGINA);
  offer("chain-ottawa", "Pizza Chain", "pizza-chain", "pc-ottawa", "Pasta Tuesday", "Food deal", "Tuesday", "Ottawa", "10 Bank St", "2026-09-28 12:00:00");
  offer("chain-regina", "Pizza Chain", "pizza-chain", "pc-regina", "Wing Monday", "Food deal", "Monday", "Regina", "20 Albert St", "2026-09-27 12:00:00");

  // A town with a listing and no market row.
  place("sudbury-diner", "Sudbury Diner");
  at("sudbury-at", "sudbury-diner", "1 Elm St", "Sudbury", "ON", SUDBURY);
  offer("sudbury-diner", "Sudbury Diner", "sudbury-diner", "sudbury-at", "Breakfast special", "Food deal", "Daily", "Sudbury", "1 Elm St", "2026-09-20 12:00:00");

  // Two nationwide brands: one whose only offer ended an hour ago, and one running tomorrow.
  place("aaa-donuts", "Aaa Donuts", { chain: 1, country: "US" });
  place("zzz-tacos", "Zzz Tacos", { chain: 1, country: "US" });
  offer("aaa-ended", "Aaa Donuts", "aaa-donuts", null, "Free donut", "Food deal", "Daily", "", "", "2026-09-20 12:00:00", { scope: "national", expires: sqlTime(Date.now() - 3_600_000) });
  offer("zzz-tomorrow", "Zzz Tacos", "zzz-tacos", null, "Two tacos", "Food deal", `${TOMORROW}s only`, "", "", "2026-09-20 12:00:00", { scope: "national" });

  const market = db.prepare("INSERT INTO market_coverage (market,region,country,status,minimum_offers) VALUES (?,?,'CA','covered',?)");
  market.run("Ottawa", "ON", 3);
  market.run("Regina", "SK", 20);

  const cached = db.prepare("INSERT INTO postal_cache (normalized_postal,latitude,longitude,neighborhood,city,region,country,timezone,provider,status,updated_at) VALUES (?,?,?,NULL,?,?,'CA',?,'geocoder','resolved',CURRENT_TIMESTAMP)");
  cached.run("K1S5B6", 45.3957, -75.6852, "Ottawa (The Glebe / Ottawa South / Ottawa East)", "ON", ZONE);
  cached.run("S0K2A0", 52.0, -106.0, "Some Village", "SK", "America/Regina");
  cached.run("city:ottawa, on", OTTAWA[0], OTTAWA[1], "Ottawa", "ON", ZONE);

  db.prepare("INSERT INTO users (id,email) VALUES ('u1','u1@example.test'),('u2','u2@example.test')").run();
}

async function deals(query) {
  const response = await GET(new Request(`https://radar.cheap/api/deals?${query}`));
  assert.equal(response.status, 200, `${query} answered ${response.status}`);
  return { body: await response.json(), headers: response.headers };
}
const point = ([latitude, longitude]) => `lat=${latitude}&lng=${longitude}&radius=25&tz=${ZONE}`;
const ids = (body) => body.results.map((deal) => deal.id);

// ── coverage for a point and a postal code ─────────────────────────────────────────────

test("a point in a market is that market, whatever it is called", async () => {
  const { body } = await deals(point(OTTAWA));
  assert.equal(body.resolvedLocation.city, "Current location", "the place's own label is left as it was");
  assert.equal(body.coverage, "covered", "a device point in Ottawa is Ottawa");
});

test("a postal code is its own city, without its neighbourhoods", async () => {
  const { body } = await deals("postal=K1S5B6");
  assert.equal(body.resolvedCity, "Ottawa (The Glebe / Ottawa South / Ottawa East)");
  assert.equal(body.coverage, "covered");
});

test("a typed city is still matched by name", async () => {
  assert.equal((await deals("city=Ottawa")).body.coverage, "covered");
});

test("a market with fewer offers than its minimum is thin, by point as by name", async () => {
  assert.equal((await deals(point(REGINA))).body.coverage, "limited", "one offer where the Regina row asks for twenty");
});

test("a place with no market is thin when anything is there, and uncovered when nothing is", async () => {
  assert.equal((await deals(point(SUDBURY))).body.coverage, "limited");
  assert.equal((await deals(point(NOWHERE))).body.coverage, "no_coverage");
  assert.equal((await deals("postal=S0K2A0")).body.coverage, "no_coverage");
  // And no place at all has no area to judge.
  assert.equal((await deals("limit=1")).body.coverage, "covered");
});

test("a name is a market's only in its own province and country, and a point only in its country", () => {
  const rows = [
    { market: "Morristown", region: "TN", country: "US" },
    { market: "Windsor", region: "ON", country: "CA" },
    { market: "Montreal", region: "QC", country: "CA" },
  ];
  const listing = (city, region, country, latitude, longitude) => ({ city, region, country, latitude, longitude });
  const centers = marketCenters(rows, [
    listing("Windsor", "ON", "CA", 42.31, -83.03),
    listing("Windsor", "ON", "CA", 42.30, -83.00),
    listing("Windsor", "NS", "CA", 44.99, -64.13),
    listing("Montréal", "QC", "CA", 45.50, -73.56),
    listing("Morristown", "TN", "US", 36.21, -83.29),
  ]);
  assert.equal(centers.length, 3, "every market with a listing of its own has a centre");
  const windsor = centers.find((center) => center.row.market === "Windsor");
  assert.ok(windsor.latitude < 43, "Windsor, Nova Scotia is not part of Windsor, Ontario's centre");
  const find = (names, region, country, latLng, reachKm = 25) =>
    marketFor(rows, centers, { names, region, country, point: latLng ? { latitude: latLng[0], longitude: latLng[1] } : null, reachKm })?.market;
  assert.equal(find(["Morristown"], "TN", "US"), "Morristown");
  assert.equal(find(["Morristown"], "NJ", "US", [40.7968, -74.4815]), undefined, "New Jersey's Morristown is not Tennessee's");
  assert.equal(find(["Montréal"], "QC", "CA"), "Montreal", "accents fold");
  assert.equal(find(["Current location"], null, "CA", [42.28, -83.0]), "Windsor", "a point near a centre is its market");
  assert.equal(find([], null, "US", [42.3314, -83.0458]), undefined, "Detroit is not Windsor's, however close");
  assert.equal(find([], null, "CA", [44.0, -79.0]), undefined, "a point beyond reach of every centre has no market");
  assert.equal(foldPlaceName("  Québec   City "), "quebec city");
});

// ── The hero's city count and the place picker ────────────────────────────────────────────────

test("the city count is the place picker's list, for either audience", async () => {
  for (const audience of ["", "&hideAlcohol=true"]) {
    const { body } = await deals(`limit=1${audience}`);
    const cities = body.facets.cities.map((facet) => facet.value).sort();
    assert.equal(body.cityCount, cities.length, `hero and picker disagree${audience}`);
    // Regina's only offer is at a chain whose card leads from Ottawa. Counted by lead it was in
    // neither the picker nor anything a reader could choose.
    assert.deepEqual(cities, ["Ottawa", "Regina", "Sudbury"]);
    assert.equal(body.facets.cities.find((facet) => facet.value === "Regina").total, 1);
  }
  // A placed search counts the city each card is at, not the chain's other provinces.
  const placed = (await deals(point(OTTAWA))).body.facets.cities.map((facet) => facet.value);
  assert.deepEqual(placed, ["Ottawa"]);
});

// ── a drink pruned from a card is not its lead ────────────────────────────────────────

test("with drinks hidden, a bar's food card stays and its happy hour never shows", async () => {
  const shown = (await deals("limit=50")).body.results.find((deal) => deal.restaurant === "Hometown Sports Grill");
  assert.deepEqual(shown.brand_offers.map((offer) => offer.id).sort(), ["hometown-hh", "hometown-wings"], "with drinks shown, one card holds both");
  for (const query of ["limit=50&hideAlcohol=true", `${point(OTTAWA)}&limit=50&hideAlcohol=true`]) {
    const { body } = await deals(query);
    const card = body.results.find((deal) => deal.restaurant === "Hometown Sports Grill");
    assert.ok(card, `the wing night is still listed (${query})`);
    assert.equal(card.id, "hometown-wings");
    assert.equal(card.category, "Food deal");
    assert.deepEqual(card.brand_offers.map((offer) => offer.id), ["hometown-wings"]);
    assert.doesNotMatch(JSON.stringify(body.results), /hometown-hh|Happy hour food/, "and the happy hour is nowhere in the answer");
  }
});

test("with drinks hidden, a card is not found by the drink pruned from it", async () => {
  const places = async (query) => (await deals(query)).body.results.map((deal) => deal.restaurant).sort();
  // Shown, both bars are found by their drinks.
  assert.deepEqual(await places(`q=${encodeURIComponent("happy hour")}&limit=50`), ["Corner Grill", "Hometown Sports Grill"]);
  assert.ok((await places("q=beer&limit=50")).includes("Corner Grill"));
  // Hidden, the offer left on each card is all it is found by - whether the drink led the card
  // (Hometown) or the food did (Corner Grill).
  for (const query of [`q=${encodeURIComponent("happy hour")}`, "q=drinks", "q=beer", "q=pints"]) {
    assert.deepEqual(await places(`${query}&limit=50&hideAlcohol=true`), [], `${query} with drinks hidden`);
  }
  assert.ok((await places("q=wings&limit=50&hideAlcohol=true")).includes("Hometown Sports Grill"));
  const corner = (await deals("q=burger&limit=50&hideAlcohol=true")).body.results.find((deal) => deal.restaurant === "Corner Grill");
  assert.ok(corner, "the burger is still found by its own words");
  assert.equal(corner.verified_at, "2026-09-30 13:00:00", "its check is the burger's own");
  assert.deepEqual(corner.brand_offers.map((offer) => offer.id), ["corner-burger"]);
});

// ── a folded duplicate asked for by its old id ────────────────────────────────────────

test("a saved deal folded into another comes back as the deal it was folded into", async () => {
  const { body } = await deals("id=diner-daily-old&view=compact");
  assert.deepEqual(ids(body), ["diner-daily"]);
  assert.deepEqual(body.appliedFilters.ids, ["diner-daily-old"], "the request is echoed as it was made");
  // Asked for with the deal itself, it is one deal, not two.
  assert.deepEqual(ids((await deals("id=diner-daily-old&id=diner-daily")).body), ["diner-daily"]);
});

test("the account's favorites name the deal kept, and unsaving it takes the old save too", async () => {
  db.prepare("INSERT INTO favorites (user_id,deal_id) VALUES ('u1','diner-daily-old'),('u1','diner-tue'),('u2','diner-daily-old'),('u2','diner-daily')").run();
  const favorites = async (userId) => {
    harness.user = { userId, email: `${userId}@example.test`, role: "user" };
    const response = await userGet();
    assert.equal(response.status, 200);
    return (await response.json()).favorites.sort();
  };
  try {
    assert.deepEqual(await favorites("u1"), ["diner-daily", "diner-tue"]);
    assert.deepEqual(await favorites("u2"), ["diner-daily"], "one id for a reader who saved both copies");
    harness.user = { userId: "u2", email: "u2@example.test", role: "user" };
    const response = await userPost(post("https://radar.cheap/api/user", { action: "favorite", dealId: "diner-daily", saved: false }));
    assert.equal(response.status, 200);
    assert.deepEqual(db.prepare("SELECT deal_id FROM favorites WHERE user_id='u2'").all(), [], "both rows go, or the heart fills again");
    assert.deepEqual(await favorites("u1"), ["diner-daily", "diner-tue"], "and nobody else's");
  } finally {
    harness.user = null;
  }
});

// ── day= by the days a schedule runs on ───────────────────────────────────────────────

test("a day filter reads the schedule the way the availability line does", async () => {
  const on = async (day) => ids((await deals(`day=${encodeURIComponent(day)}&limit=50`)).body).filter((id) => id.startsWith("diner-")).sort();
  assert.deepEqual(await on("Mon"), ["diner-daily", "diner-everyday", "diner-row", "diner-weekdays"],
    "Daily, Mon-Fri and Every day run on Monday, and a timed row saying Monday beats text saying Tuesday");
  assert.deepEqual(await on("monday"), await on("Mon"));
  assert.deepEqual(await on("1"), await on("Mon"));
  assert.deepEqual(await on("Tue"), ["diner-daily", "diner-everyday", "diner-tue", "diner-weekdays"]);
  assert.deepEqual(await on("Sun"), ["diner-daily", "diner-everyday"]);
  assert.deepEqual(await on("Lemonday"), [], "a word that is not a day matches nothing, not everything");
});

test("the weekday reader behind it", () => {
  assert.equal(weekdayNumber("Tuesdays"), 2);
  assert.equal(weekdayNumber(" THU "), 4);
  assert.equal(weekdayNumber("0"), 0);
  assert.equal(weekdayNumber("7"), null);
  assert.equal(weekdayNumber("Edmonton"), null, "a day's letters inside another word are not the day");
  assert.equal(offerRunsOn(3, "Weekdays 3-6 PM"), true);
  assert.equal(offerRunsOn(6, "Weekdays 3-6 PM"), false);
  assert.equal(offerRunsOn(1, "Tuesday 5-8 PM", '["Mon"]', "17:00", "20:00"), true, "the timed row decides");
  assert.equal(offerRunsOn(1, "Monday 5-8 PM", '["Tue"]', "late", "20:00"), true, "a row without clock times does not");
  // A promotion on dates runs on the weekdays its dates fall on this year.
  const year = new Date().getUTCFullYear();
  const christmas = new Date(Date.UTC(year, 11, 25)).getUTCDay();
  assert.equal(offerRunsOn(christmas, "Dec 25 only"), true);
  assert.equal(offerRunsOn((christmas + 1) % 7, "Dec 25 only"), false);
  for (let day = 0; day < 7; day++) assert.equal(offerRunsOn(day, "Dec 20-31"), true, "twelve days take in every weekday");
});

// ── a signed-in answer is private ─────────────────────────────────────────────────────

test("an answer shaped by who is asking is not cached for anyone else", async () => {
  const anonymous = (await deals("limit=1")).headers;
  assert.equal(anonymous.get("cache-control"), "public, max-age=60, stale-while-revalidate=300");
  assert.equal(anonymous.get("vary"), null);
  harness.user = { userId: "u1", email: "u1@example.test", role: "user" };
  try {
    const signedIn = (await deals("limit=1")).headers;
    assert.equal(signedIn.get("cache-control"), "private, max-age=60");
    assert.equal(signedIn.get("vary"), "Cookie, Authorization");
  } finally {
    harness.user = null;
  }
});

// ── ended nationwide offers go last ───────────────────────────────────────────────────

test("a brand whose every offer has ended is listed last, still saying so", async () => {
  const { body } = await deals(`scope=national&country=US&group=brand&tz=${ZONE}`);
  assert.deepEqual(body.results.map((card) => card.brand_name), ["Zzz Tacos", "Aaa Donuts"],
    "alphabetical order would put the ended brand first");
  const ended = body.results[1].chain_offers[0];
  assert.equal(ended.availability_phase, "ended");
  assert.equal(ended.available_today, false);
});

// ── The 75 and 100 km reach is Pro's ─────────────────────────────────────────────────────────

test("a radius past 50 km reaches that far only for Pro", async () => {
  // About 70 km due north of the Bank St grill: outside 50, inside 100.
  const far = `lat=46.02&lng=-75.6771&radius=100&tz=${ZONE}`;
  // By restaurant, not card id: on a Tuesday the wing night leads the grill's card.
  const reached = async () => (await deals(far)).body.results.some((deal) => deal.restaurant === "Hometown Sports Grill");
  assert.ok(!(await reached()), "a signed-out search reached 100 km");
  harness.user = { userId: "u1", email: "u1@example.test", role: "user" };
  try {
    assert.ok(!(await reached()), "a free account reached 100 km");
    harness.user = { userId: "u2", email: "u2@example.test", role: "user", pro: true };
    assert.ok(await reached(), "Pro did not get the radius it pays for");
  } finally {
    harness.user = null;
  }
});
