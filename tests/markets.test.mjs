import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { appOnly, displayPromoCode, marketOf, noAppNeeded, parseRedemption, redemptionBadge } from "../app/redemption.ts";
import { marketForTimezone, parseMarket } from "../app/market.ts";
import { regionName } from "../app/region-names.ts";

const home = await readFile(new URL("../app/HomeClient.tsx", import.meta.url), "utf8");
const LOCALES = ["en", "fr", "es"];
const catalogs = Object.fromEntries(await Promise.all(LOCALES.map(async (locale) =>
  [locale, JSON.parse(await readFile(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"))])));

// ── How an offer is redeemed ──────────────────────────────────────────────────────────────────

test("a stored redemption set reads back in one order, and unknown words are dropped", () => {
  assert.deepEqual(parseRedemption("online, APP,in_store"), ["in_store", "app", "online"]);
  assert.deepEqual(parseRedemption("app,sms,coupon"), ["app"]);
  assert.deepEqual(parseRedemption(null), []);
  assert.deepEqual(parseRedemption(["code", "online"]), ["online", "code"]);
});

test("a card answers 'do I need their app?' before anything else", () => {
  // The badge is the one line a card has room for, so the most restrictive answer wins: a reader
  // who needs the app must be told, even when a code is also involved.
  assert.equal(redemptionBadge(parseRedemption("app")), "appOnly");
  assert.equal(redemptionBadge(parseRedemption("app,code")), "appOnly");
  assert.equal(redemptionBadge(parseRedemption("online,app,code")), "code");
  assert.equal(redemptionBadge(parseRedemption("in_store,app,online")), "inStore");
  assert.equal(redemptionBadge(parseRedemption("app,online")), "online");
  assert.equal(appOnly(parseRedemption("app,online")), false, "a digital deal that works on the website needs no app");
  assert.equal(noAppNeeded(parseRedemption("app,online")), true);
});

test("an unclassified offer makes no claim at all", () => {
  // NULL is "we have not said", never "no app needed" - the one wrong answer the badge exists to prevent.
  assert.equal(redemptionBadge(parseRedemption(null)), null);
  assert.equal(redemptionBadge(parseRedemption("")), null);
  assert.equal(noAppNeeded(parseRedemption(null)), false);
});

test("only something shaped like a checkout code is shown as one", () => {
  assert.equal(displayPromoCode(" 3OFF18 "), "3OFF18");
  assert.equal(displayPromoCode("WEB-BOGO"), "WEB-BOGO");
  assert.equal(displayPromoCode("see the app"), null);
  assert.equal(displayPromoCode("<script>"), null);
  assert.equal(displayPromoCode(""), null);
});

// ── Radar Canada and Radar US ─────────────────────────────────────────────────────────────────

test("a market is Canada or the US and nothing else", () => {
  for (const parse of [marketOf, parseMarket]) {
    assert.equal(parse("us"), "US");
    assert.equal(parse(" CA "), "CA");
    assert.equal(parse("MX"), null);
    assert.equal(parse(null), null);
    assert.equal(parse("all"), null);
  }
});

test("the first visit's country is guessed from the device's timezone, never more than that", () => {
  assert.equal(marketForTimezone("America/Toronto"), "CA");
  assert.equal(marketForTimezone("America/Vancouver"), "CA");
  assert.equal(marketForTimezone("America/St_Johns"), "CA");
  assert.equal(marketForTimezone("America/New_York"), "US", "Knoxville and Morristown");
  assert.equal(marketForTimezone("America/Chicago"), "US");
  assert.equal(marketForTimezone("America/Indiana/Indianapolis"), "US");
  assert.equal(marketForTimezone("America/Kentucky/Louisville"), "US");
  assert.equal(marketForTimezone("Pacific/Honolulu"), "US");
  // A third country, or no zone at all, is no guess: the reader chooses.
  assert.equal(marketForTimezone("America/Mexico_City"), null);
  assert.equal(marketForTimezone("Europe/London"), null);
  assert.equal(marketForTimezone(""), null);
});

test("'CA' is California in the US and Canada nowhere else", () => {
  // Both tables exist because the codes collide: a Knoxville reader's nationwide list names states,
  // a Toronto reader's names provinces, and "CA" means something different in each.
  assert.equal(regionName("CA", "US"), "California");
  assert.equal(regionName("TN", "US"), "Tennessee");
  assert.equal(regionName("ON", "CA"), "Ontario");
  assert.equal(regionName("QC", "CA"), "Quebec");
});

test("a searched place decides the country by itself", () => {
  // A browsing market left in the URL beside a postal code, a city or a device location would filter
  // the reader's own area out whenever the two disagreed - a Knoxville ZIP with ?country=CA is an
  // empty page that looks like Radar has nothing in Knoxville.
  assert.match(home, /runDiscovery\(\{ postal: locationInput \|\| null, city: null, lat: null, lng: null, q: dealQuery \|\| null, \.\.\.\(locationInput \? \{ country: null \} : \{\}\) \}\)/);
  assert.match(home, /city: knownName \? null : locationInput, q: dealQuery \|\| null, country: null \}/);
  assert.match(home, /searchParams\(\{ postal:null, city:null, country:null(?:, vertical:null)? \}\)/, "use my location");
  assert.match(home, /scoped\.delete\("country"\)/, "a signed-in reader's home postal code");
});

test("choosing a country is a browse of that country, and the choice is remembered", () => {
  const choose = home.slice(home.indexOf("function chooseMarket("), home.indexOf("async function savePrefs("));
  assert.ok(choose.length > 0, "chooseMarket should exist");
  assert.match(choose, /rememberMarket\(next \|\| "all"\)/);
  assert.match(choose, /searchParams\(\{ postal: null, city: null, lat: null, lng: null, country: next \}\)/);
  // Returning from a place goes back to the country being browsed, not to both at once.
  assert.match(home, /const params = searchParams\(\{ postal: null, country: market \}\);/);
});

test("a card names its currency whenever the page could hold both countries", () => {
  assert.match(home, /const showCurrency = !activeMarket \|\| resultMarkets\.size > 1;/);
  assert.match(home, /showCurrency && marketOf\(d\.country\) && \(/);
});

test("the national chains are off until the reader turns them on, and the choice is remembered", () => {
  // A panel of national chains above the local list read as a paid placement. It is the reader's to
  // open, and until they do the section is neither rendered nor fetched.
  assert.match(home, /const \[showChains, setShowChains\] = useState\(false\);/);
  assert.match(home, /setShowChains\(storedShowChains\(\)\);/);
  assert.match(home, /role="switch" aria-checked=\{showChains\}/);
  assert.match(home, /vertical === defaultVertical && showChains && \(\s*<NationalDeals/);
  assert.match(home, /localStorage\.setItem\(CHAINS_KEY, next \? "1" : "0"\)/);
  // With chains off, a list with nothing in it says they are hidden rather than absent.
  assert.match(home, /!showChains && \(\s*<p className="empty-chains">/);
});

test("the nationwide section asks for a card per brand", async () => {
  const section = await readFile(new URL("../app/NationalDeals.tsx", import.meta.url), "utf8");
  assert.match(section, /chains: "separate", group: "brand"/);
  // An answer from before the grouping is still a list of cards, each its own one offer.
  assert.match(section, /deal\.chain_offers\?\.length \? deal\.chain_offers : \[deal\]/);
});

test("every locale has the market, redemption and nationwide strings", () => {
  const keys = {
    market: ["switchAria", "all", "CA", "US", "pricesCA", "pricesUS", "chipCA", "chipUS", "acrossCA", "acrossUS"],
    redemption: ["heading", "badgeAppOnly", "badgeCode", "badgeCodeNamed", "badgeInStore", "badgeOnline", "copyCode", "codeCopied", "appOnlyNote"],
    national: ["heading", "subUS", "subCA", "subRegion", "filterAll", "filterNoApp", "filterApp", "filterCode", "showAll", "showFewer", "empty", "endsOn", "count", "locations", "moreOffers", "toggle", "hidden", "showChains", "scheduleVaries"],
  };
  for (const locale of LOCALES) {
    for (const [namespace, names] of Object.entries(keys)) {
      for (const name of names) {
        assert.ok(catalogs[locale][namespace]?.[name], `${locale}.${namespace}.${name}`);
      }
    }
    assert.ok(catalogs[locale].redemption.badgeCodeNamed.includes("{code}"), `${locale} names the code`);
    assert.ok(catalogs[locale].national.subRegion.includes("{region}"), `${locale} names the region`);
    assert.ok(catalogs[locale].national.moreOffers.includes("{count}"), `${locale} counts the offers not shown`);
  }
});
