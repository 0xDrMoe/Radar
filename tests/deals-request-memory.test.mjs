// What /api/deals keeps from one request to the next, and the work it no longer does at all.
//
// Every request used to work the catalogue out afresh: whether each deal names a drink - two or
// three times per deal with drinks hidden, which the phone asks for by default - whether each is on
// right now, each stored date read with the slow parser, and the branch, week and lead of every
// card, even a card the filter at the end was sure to drop. The drink check's answers are now kept
// for the life of the snapshot, what is on for the rest of the minute, and a card out of reach
// goes no further than the pruning. These tests hold the route to the answers the fresh work gave:
// the same answer however often a question is asked, a new one when the minute turns or staff
// change what it was worked out from, and counts that still take in the cards a placed search
// leaves early.
//
// Run for real against a SQLite database made from drizzle/*.sql (see tests/route-harness.mjs),
// with the clock set, so that a minute can be crossed on purpose. The route holds its snapshot for
// the life of the module, so the catalogue is written once, before the first request - and changed
// only by the tests at the end, which edit it the way staff do and then put back what they changed.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { freshDatabase } from "./route-harness.mjs";

const { GET } = await import("../app/api/deals/route.ts");

// Tuesday 6 October 2026. Ottawa is four hours behind UTC that day, Vancouver seven.
const utc = (time) => Date.parse(`2026-10-06T${time}Z`);
mock.timers.enable({ apis: ["Date"], now: utc("18:30:00") });

const ZONE = "America/Toronto";
const OTTAWA = [45.4215, -75.6972], KINGSTON = [44.2312, -76.486], REGINA = [50.4452, -104.6189], BUFFALO = [42.8864, -78.8784];

const db = freshDatabase();
for (const table of ["deals", "restaurants", "restaurant_locations", "deal_locations", "deal_schedules", "market_coverage", "search_terms", "deal_translations", "deal_aliases", "postal_cache"]) {
  db.exec(`DELETE FROM ${table}`);
}
{
  const restaurant = db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES (?,?,'American',?,'https://example.test',?)");
  const branch = db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone) VALUES (?,?,?,?,?,?,'K1S',?,?,?)");
  const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,verification_status,verified_at,created_at,status,active,location_scope,expires_at)
    VALUES (?,?,?,?,?,?,?,'American',?,?,'K1S',?,'$5','🍔','https://example.test/offer','verified',?,?,'live',1,?,NULL)`);
  const place = (id, name, { chain = 0, country = "CA" } = {}) => restaurant.run(id, name, chain, country);
  const at = (id, restaurantId, address, city, region, [latitude, longitude], country = "CA", zone = ZONE) =>
    branch.run(id, restaurantId, address, city, region, country, latitude, longitude, zone);
  const offer = (id, name, restaurantId, locationId, title, category, schedule, city, address, verified, scope = null) =>
    deal.run(id, id, name, restaurantId, locationId, title, category, schedule, city, address, verified, verified, scope);

  // A bar with a happy hour and a wing night, and a taproom whose only offer is a drink.
  place("hometown", "Hometown Sports Grill");
  at("hometown-bank", "hometown", "1525 Bank St", "Ottawa", "ON", [45.3905, -75.6771]);
  offer("hometown-hh", "Hometown Sports Grill", "hometown", "hometown-bank", "Happy hour: $5 pints", "Happy hour", "Daily 3-6 PM", "Ottawa", "1525 Bank St", "2026-09-30 12:00:00");
  offer("hometown-wings", "Hometown Sports Grill", "hometown", "hometown-bank", "Half-price wings Tuesday", "Food deal", "Tuesday", "Ottawa", "1525 Bank St", "2026-09-29 12:00:00");
  place("taproom", "Kingston Taproom");
  at("taproom-at", "taproom", "1 Ontario St", "Kingston", "ON", KINGSTON);
  offer("taproom-flight", "Kingston Taproom", "taproom", "taproom-at", "Beer flight $10", "Happy hour", "Daily 4-7 PM", "Kingston", "1 Ontario St", "2026-09-25 12:00:00");
  // A diner with two food offers, for an edit that should cost a card one offer and not the card.
  place("prairie", "Prairie Diner");
  at("prairie-at", "prairie", "30 Scarth St", "Regina", "SK", [50.4475, -104.6106], "CA", "America/Regina");
  offer("prairie-pancakes", "Prairie Diner", "prairie", "prairie-at", "Pancake breakfast $6", "Food deal", "Daily", "Regina", "30 Scarth St", "2026-09-20 12:00:00");
  offer("prairie-burger", "Prairie Diner", "prairie", "prairie-at", "Burger and fries $10", "Food deal", "Daily", "Regina", "30 Scarth St", "2026-09-19 12:00:00");

  // Soup from four, every day: off at 3:59 in Ottawa, on at 4:00.
  place("evening", "Evening Diner");
  at("evening-at", "evening", "12 Elgin St", "Ottawa", "ON", [45.4205, -75.6935]);
  offer("evening-soup", "Evening Diner", "evening", "evening-at", "Soup and sandwich $9", "Food deal", "Every day, 4-6 PM", "Ottawa", "12 Elgin St", "2026-09-27 12:00:00");

  // A chain led from Ottawa with a Regina branch, and one with a branch on each side of the border.
  place("pizza-chain", "Pizza Chain", { chain: 1 });
  at("pc-ottawa", "pizza-chain", "10 Bank St", "Ottawa", "ON", [45.41, -75.69]);
  at("pc-regina", "pizza-chain", "20 Albert St", "Regina", "SK", REGINA);
  offer("chain-ottawa", "Pizza Chain", "pizza-chain", "pc-ottawa", "Pasta Tuesday", "Food deal", "Tuesday", "Ottawa", "10 Bank St", "2026-09-28 12:00:00");
  offer("chain-regina", "Pizza Chain", "pizza-chain", "pc-regina", "Wing Monday", "Food deal", "Monday", "Regina", "20 Albert St", "2026-09-26 12:00:00");
  place("border", "Border Burger", { chain: 1 });
  at("border-ottawa", "border", "100 Rideau St", "Ottawa", "ON", [45.427, -75.692]);
  at("border-buffalo", "border", "200 Main St", "Buffalo", "NY", [42.89, -78.87], "US", "America/New_York");
  offer("border-ottawa-deal", "Border Burger", "border", "border-ottawa", "Burger Wednesday $9", "Food deal", "Wednesday", "Ottawa", "100 Rideau St", "2026-09-29 18:00:00");
  offer("border-buffalo-deal", "Border Burger", "border", "border-buffalo", "Two burgers $12", "Food deal", "Friday", "Buffalo", "200 Main St", "2026-09-28 18:00:00");

  // An American independent, and a nationwide lunch read in each reader's own zone.
  place("buffalo", "Buffalo Wing House", { country: "US" });
  at("buffalo-at", "buffalo", "1 Main St", "Buffalo", "NY", BUFFALO, "US", "America/New_York");
  offer("buffalo-wings", "Buffalo Wing House", "buffalo", "buffalo-at", "Ten wings $8", "Food deal", "Daily", "Buffalo", "1 Main St", "2026-09-24 12:00:00");
  place("taco-brand", "Taco Brand", { chain: 1, country: "US" });
  offer("taco-lunch", "Taco Brand", "taco-brand", null, "Two tacos $3", "Food deal", "Daily 11 AM-2 PM", "", "", "2026-09-23 12:00:00", "national");

  db.prepare("INSERT INTO market_coverage (market,region,country,status,minimum_offers) VALUES ('Ottawa','ON','CA','covered',3)").run();
}

/** The answer, and its text without the one field two answers cannot share: its own clock reading. */
async function ask(query) {
  const response = await GET(new Request(`https://radar.cheap/api/deals?${query}`));
  assert.equal(response.status, 200, `${query} answered ${response.status}`);
  const text = await response.text();
  return { body: JSON.parse(text), same: text.replace(/"generatedAt":"[^"]*"/, "") };
}
const near = ([latitude, longitude]) => `lat=${latitude}&lng=${longitude}&radius=25&tz=${ZONE}`;

test("an answer with drinks hidden is the same however many times it is asked", async () => {
  mock.timers.setTime(utc("18:30:00"));
  for (const query of [
    "country=CA&locale=en&chains=separate&hideAlcohol=true",
    `${near(OTTAWA)}&sort=distance&limit=50&view=compact&hideAlcohol=true`,
    "sort=recommended&limit=50&view=compact&hideAlcohol=true",
    "q=wings&hideAlcohol=true",
    `id=hometown-hh&id=hometown-wings&id=taproom-flight&view=compact&hideAlcohol=true`,
    "scope=national&country=US&hideAlcohol=true&tz=America/Toronto",
  ]) {
    const first = (await ask(query)).same;
    for (let again = 0; again < 2; again++) assert.equal((await ask(query)).same, first, `${query}, asked again`);
  }
  // And what it answers is the drink check's: the bar is its wing night, the taproom is gone, and
  // neither drink is anywhere in the answer. Shown, both are there.
  const { body } = await ask("limit=50&hideAlcohol=true");
  const hometown = body.results.find((deal) => deal.restaurant === "Hometown Sports Grill");
  assert.deepEqual(hometown.brand_offers.map((offer) => offer.id), ["hometown-wings"]);
  assert.ok(!body.results.some((deal) => deal.restaurant === "Kingston Taproom"), "a drink-only place is hidden");
  assert.doesNotMatch(JSON.stringify(body.results), /hometown-hh|taproom-flight/);
  const shown = (await ask("limit=50")).body.results;
  assert.ok(shown.some((deal) => deal.restaurant === "Kingston Taproom"), "and shown when drinks are");
  assert.deepEqual(shown.find((deal) => deal.restaurant === "Hometown Sports Grill").brand_offers.map((offer) => offer.id).sort(), ["hometown-hh", "hometown-wings"]);
  // Asked for by id, each deal is judged on its own words.
  assert.deepEqual((await ask("id=hometown-hh&id=hometown-wings&id=taproom-flight&hideAlcohol=true")).body.results.map((deal) => deal.id), ["hometown-wings"]);
});

test("what is on is worked out again when the minute turns", async () => {
  const soup = (body) => body.results.find((deal) => deal.id === "evening-soup");
  mock.timers.setTime(utc("19:59:05"));
  const before = await ask(near(OTTAWA));
  assert.equal(soup(before.body).available_today, true);
  assert.equal(soup(before.body).available_now, false, "at 3:59 the soup is still to come");
  mock.timers.setTime(utc("19:59:55"));
  assert.equal((await ask(near(OTTAWA))).same, before.same, "later in the same minute, the same answer");
  mock.timers.setTime(utc("20:00:05"));
  const after = await ask(near(OTTAWA));
  assert.equal(soup(after.body).available_now, true, "at 4:00 it is on");
  assert.notEqual(soup(after.body).availability, soup(before.body).availability, "and its line says so");
  // A later request can carry an earlier clock - another isolate's, or a skewed one. It is that
  // minute's answer, not the one worked out last.
  mock.timers.setTime(utc("19:59:30"));
  assert.equal((await ask(near(OTTAWA))).same, before.same);
});

test("in one minute, a nationwide offer is read in each reader's zone and words", async () => {
  mock.timers.setTime(utc("18:30:00"));
  const tacos = async (query) => (await ask(`scope=national&country=US&${query}`)).body.results.find((deal) => deal.id === "taco-lunch");
  const toronto = await tacos("tz=America/Toronto");
  const vancouver = await tacos("tz=America/Vancouver");
  assert.equal(toronto.available_now, false, "at 2:30 lunch is over in Toronto");
  assert.equal(vancouver.available_now, true, "and at 11:30 it is on in Vancouver, in the same minute");
  assert.deepEqual(await tacos("tz=America/Toronto"), toronto, "asked again, Toronto keeps its own answer");
  const french = await tacos("tz=America/Vancouver&locale=fr");
  assert.equal(french.available_now, true);
  assert.notEqual(french.availability, vancouver.availability, "the line is worded in the reader's language");
  assert.deepEqual(await tacos("tz=America/Vancouver"), vancouver, "and the English line is still English");
});

test("a zone this runtime does not know is ignored, however often it is sent", async () => {
  mock.timers.setTime(utc("18:30:00"));
  const national = "scope=national&country=US";
  const without = (await ask(national)).same;
  for (let again = 0; again < 2; again++) {
    assert.equal((await ask(`${national}&tz=Mars/Olympus_Mons`)).same, without, "an unknown zone is no zone");
  }
  const vancouver = (await ask(`${national}&tz=America/Vancouver`)).same;
  assert.notEqual(vancouver, without, "a zone it knows is the reader's");
  assert.equal((await ask(`${national}&tz=America/Vancouver`)).same, vancouver);
  // Placed, an unknown zone gives way to the zone of the point: Pacific time, where lunch is still
  // on at 11:30 - not the Toronto time a zone nothing can read would be taken for.
  const placed = `${national}&lat=49.2827&lng=-123.1207`;
  const unplaceable = await ask(`${placed}&tz=Mars/Olympus_Mons`);
  assert.equal(unplaceable.body.results.find((deal) => deal.id === "taco-lunch").available_now, true);
  for (let again = 0; again < 2; again++) {
    assert.equal((await ask(`${placed}&tz=Mars/Olympus_Mons`)).same, unplaceable.same, "asked again");
  }
  assert.equal((await ask(placed)).same, unplaceable.same, "the same as sending no zone at all");
});

test("a placed search counts, and prunes, the cards it does not reach as an unplaced one does", async () => {
  mock.timers.setTime(utc("18:30:00"));
  for (const drinks of ["", "&hideAlcohol=true"]) {
    const everywhere = (await ask(`limit=1${drinks}`)).body;
    for (const place of [OTTAWA, KINGSTON, BUFFALO]) {
      const placed = (await ask(`${near(place)}${drinks}`)).body;
      assert.equal(placed.uniqueOfferCount, everywhere.uniqueOfferCount, `every card is counted (${place}${drinks})`);
      assert.equal(placed.cityCount, everywhere.cityCount, `and every city (${place}${drinks})`);
    }
  }
  // With drinks hidden the taproom's one offer is pruned wherever the reader is, so Kingston is in
  // no count; shown, it is.
  const hidden = (await ask("limit=1&hideAlcohol=true")).body;
  assert.deepEqual(hidden.facets.cities.map((facet) => facet.value).sort(), ["Buffalo", "Ottawa", "Regina"]);
  assert.equal(hidden.cityCount, 3);
  assert.equal((await ask("limit=1")).body.cityCount, 4);
  // What a placed search lists is what is within reach of it.
  const listed = async (query) => (await ask(query)).body.results.map((deal) => deal.restaurant).sort();
  assert.deepEqual(await listed(`${near(OTTAWA)}&hideAlcohol=true`), ["Border Burger", "Evening Diner", "Hometown Sports Grill", "Pizza Chain"]);
  assert.deepEqual(await listed(`${near(KINGSTON)}&hideAlcohol=true`), []);
  assert.deepEqual(await listed(near(KINGSTON)), ["Kingston Taproom"]);
});

test("a chain on both sides of the border is answered in the country of the branch it is shown at", async () => {
  mock.timers.setTime(utc("18:30:00"));
  const listed = async (query) => (await ask(query)).body.results.map((deal) => `${deal.restaurant} ${deal.country}`).sort();
  assert.deepEqual(await listed(`country=US&${near(BUFFALO)}`), ["Border Burger US", "Buffalo Wing House US"]);
  assert.deepEqual(await listed(`country=CA&${near(BUFFALO)}`), [], "near Buffalo, Border Burger is its Buffalo branch");
  assert.deepEqual(await listed(`country=CA&${near(OTTAWA)}`), ["Border Burger CA", "Evening Diner CA", "Hometown Sports Grill CA", "Pizza Chain CA"]);
  assert.deepEqual(await listed(`country=US&${near(OTTAWA)}`), []);
  const canadian = await listed("country=CA&limit=50");
  assert.ok(canadian.length > 0 && canadian.every((line) => line.endsWith(" CA")), "unplaced, every card is Canadian");
  assert.ok(canadian.includes("Kingston Taproom CA"));
});

test("sorted by the latest check, a card is as recent as its newest deal", async () => {
  mock.timers.setTime(utc("18:30:00"));
  for (const [sort, field] of [["recently_verified", "verified_at"], ["recently_added", "created_at"]]) {
    const { body } = await ask(`sort=${sort}&limit=50`);
    const times = body.results.map((deal) => deal[field]);
    assert.deepEqual(times, [...times].sort().reverse(), `${sort} runs newest first`);
  }
  const { body } = await ask("sort=recently_verified&limit=50");
  const hometown = body.results.find((deal) => deal.restaurant === "Hometown Sports Grill");
  assert.equal(hometown.verified_at, "2026-09-30 12:00:00", "the newer of its two deals' checks");
  assert.equal(body.results[0].restaurant, "Hometown Sports Grill");
});

// ---------------------------------------------------------------------------------------------
// A staff edit, landing on an isolate that already remembers the snapshot before it.
//
// What the route keeps - each deal's and each card's drink verdict, each deal's line for the minute
// - is kept beside the snapshot it was worked out from (DRINK_VERDICTS and AVAILABILITY in
// app/api/deals/route.ts), and a rebuilt snapshot starts with none of it. So an edit reaches readers
// with the first request the new snapshot answers, as it did when every request worked everything
// out afresh. Kept anywhere that outlives a snapshot, the memory would go on answering from words
// staff had changed: a deal that now names a drink would stay in the catalogue every phone that
// hides drinks is shown - the one Radar told Apple is 13+ - until the isolate happened to be
// recycled, and a moved schedule would keep its old line for the rest of the minute. No test above
// can see that, because none of them changes the catalogue.
//
// The route asks whether the data has changed at most once a minute (REVISION_CHECK_MS), and the
// request that asks is answered from the snapshot it holds while the new one is built behind it. So
// each test starts with a request that is that minute's check, finding nothing new, and after the
// edit a request more than a minute later notices it; the next one is the new snapshot's. These run
// last, on a clock past every test above, and each puts back what it changed the same way.

let edits = 0;
/** A staff edit: the row changes, and its updated_at passes every other, which moves the revision. */
function staffEdit(id, changes) {
  edits += 1;
  const columns = Object.keys(changes);
  db.prepare(`UPDATE deals SET ${columns.map((column) => `${column}=?`).join(",")},updated_at=? WHERE id=?`)
    .run(...Object.values(changes), `2099-01-01 00:00:${String(edits).padStart(2, "0")}`, id);
}
/** Lets what a request started behind itself - the revision check, the rebuild - finish. */
async function settle() {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
}
/** At `time`, a minute or more after the last check: the request that notices an edit, and the rebuild it starts. */
async function noticeAt(time, query) {
  mock.timers.setTime(time);
  await ask(query);
  await settle();
}

test("a drink word staff add to a food deal hides it from the first request the rebuilt snapshot answers", async () => {
  const wings = "id=hometown-wings&hideAlcohol=true";
  const ottawa = async () => (await ask(`${near(OTTAWA)}&hideAlcohol=true`)).body.results.map((deal) => deal.restaurant);
  // The diner's offers as a reader who hides drinks is shown them. The card's own verdict is
  // worked out on whatever the pruning left, so only these see the verdict each offer was given on
  // its own: kept from before the edit, the burger would stay in the pruning, and the card, now
  // naming a pint, would be dropped whole - the pancakes with it.
  const diner = async () => (await ask(`${near(REGINA)}&hideAlcohol=true`)).body.results
    .find((deal) => deal.restaurant === "Prairie Diner")?.brand_offers.map((offer) => offer.id).sort();
  // 5 PM in Ottawa, the minute's check. With drinks hidden the wing night is shown, asked for by id
  // and nearby, and both the deal and its card are now remembered as food, as are the diner's two
  // offers and its card.
  mock.timers.setTime(utc("21:00:00"));
  assert.deepEqual((await ask(wings)).body.results.map((deal) => deal.id), ["hometown-wings"]);
  assert.ok((await ottawa()).includes("Hometown Sports Grill"));
  assert.deepEqual(await diner(), ["prairie-burger", "prairie-pancakes"]);
  await settle();
  staffEdit("hometown-wings", { title: "Half-price wings Tuesday and a pint" });
  staffEdit("prairie-burger", { title: "Burger and a pint $10" });
  await noticeAt(utc("21:01:05"), wings);
  // The new snapshot has the new words, and the filter reads them rather than what it remembered.
  assert.equal((await ask("id=hometown-wings")).body.results[0]?.title, "Half-price wings Tuesday and a pint", "the edit is in the snapshot");
  assert.deepEqual((await ask(wings)).body.results, [], "a deal that names a drink is hidden");
  assert.ok(!(await ottawa()).includes("Hometown Sports Grill"), "and the bar, its happy hour hidden too, has nothing left to show");
  assert.deepEqual(await diner(), ["prairie-pancakes"], "the diner loses the offer that now names a drink, and keeps its card");
  // And back: food again at the next snapshot.
  staffEdit("hometown-wings", { title: "Half-price wings Tuesday" });
  staffEdit("prairie-burger", { title: "Burger and fries $10" });
  await noticeAt(utc("21:02:10"), wings);
  assert.deepEqual((await ask(wings)).body.results.map((deal) => deal.id), ["hometown-wings"]);
  assert.ok((await ottawa()).includes("Hometown Sports Grill"));
  assert.deepEqual(await diner(), ["prairie-burger", "prairie-pancakes"]);
});

test("a happy hour staff re-file as food shows at the first request the rebuilt snapshot answers", async () => {
  const flight = "id=taproom-flight&hideAlcohol=true";
  const kingston = async () => (await ask(`${near(KINGSTON)}&hideAlcohol=true`)).body.results.map((deal) => deal.restaurant);
  mock.timers.setTime(utc("21:10:00"));
  assert.deepEqual((await ask(flight)).body.results, [], "a happy hour is hidden with drinks");
  assert.deepEqual(await kingston(), []);
  await settle();
  staffEdit("taproom-flight", { category: "Food deal", title: "Ten wings $10" });
  await noticeAt(utc("21:11:05"), flight);
  assert.deepEqual((await ask(flight)).body.results.map((deal) => `${deal.id}: ${deal.title}`), ["taproom-flight: Ten wings $10"], "re-filed as food, it is shown");
  // With the offer it lists. The card's own verdict is worked out afresh on what the pruning left,
  // so only this sees the offer's: kept from before the edit, it pruned the offer, and the card was
  // shown listing nothing.
  assert.deepEqual((await ask(flight)).body.results[0].brand_offers.map((offer) => offer.id), ["taproom-flight"], "and lists its offer");
  assert.deepEqual(await kingston(), ["Kingston Taproom"], "and so is its place");
  staffEdit("taproom-flight", { category: "Happy hour", title: "Beer flight $10" });
  await noticeAt(utc("21:12:10"), flight);
  assert.deepEqual((await ask(flight)).body.results, []);
  assert.deepEqual(await kingston(), []);
});

test("a schedule staff move is read anew by the rebuilt snapshot inside the minute it was moved in", async () => {
  const soup = async () => {
    const { schedule, availability, available_now } = (await ask("id=evening-soup")).body.results[0];
    return { schedule, availability, available_now };
  };
  // 5:29:30 PM in Ottawa, the minute's check.
  mock.timers.setTime(utc("21:29:30"));
  await soup();
  await settle();
  // 5:30: the soup is on from four to six, and that is remembered for the rest of the minute.
  mock.timers.setTime(utc("21:30:05"));
  const before = await soup();
  assert.equal(before.available_now, true);
  staffEdit("evening-soup", { schedule: "Daily 6-9 PM" });
  await noticeAt(utc("21:30:35"), "id=evening-soup");
  // Still 5:30, and the new snapshot's line is the new hours', not the one this minute remembered.
  mock.timers.setTime(utc("21:30:40"));
  const after = await soup();
  assert.equal(after.schedule, "Daily 6-9 PM", "the edit is in the snapshot");
  assert.equal(after.available_now, false, "from six, the soup is not on at 5:30");
  assert.notEqual(after.availability, before.availability, "and its line says so");
  staffEdit("evening-soup", { schedule: "Every day, 4-6 PM" });
  await noticeAt(utc("21:31:40"), "id=evening-soup");
  assert.deepEqual(await soup(), before);
});
