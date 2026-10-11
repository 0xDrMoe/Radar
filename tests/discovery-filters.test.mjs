import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { code } from "./source.mjs";

// The three controls the discovery panel gained together: $ / $$ / $$$ instead of five tiers, a
// fast-food / sit-down filter, and a 25 km default radius. All three are the same kind of claim —
// a number or a vocabulary that several files have to agree on — so they are tested together.

const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
};

const read = (path) => code(readFileSync(new URL(path, import.meta.url), "utf8"));
const route = () => read("../app/api/deals/route.ts");
const home = () => read("../app/HomeClient.tsx");
const header = () => read("../app/SiteHeader.tsx");
const messages = (locale) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));

const tiers = await load("../app/price-tiers.ts");
const radius = await load("../app/radius.ts");

test("three price tiers, and an older four or five folds onto them", () => {
  assert.equal(tiers.MAX_PRICE_TIER, 3);
  assert.equal(tiers.priceTierSymbol(3), "$$$");
  assert.equal(tiers.priceTierSymbol(4), null, "a tier above the range has no symbol to print");
  // The rows written under five tiers are still in production. Narrowing keeps them filterable as
  // $$$; rejecting them would have quietly dropped a deal out of every price filter at once.
  assert.equal(tiers.narrowPriceTier(4), 3);
  assert.equal(tiers.narrowPriceTier(5), 3);
  assert.equal(tiers.narrowPriceTier(2), 2);
  assert.equal(tiers.narrowPriceTier(0), null);
  assert.equal(tiers.narrowPriceTier(null), null);
});

test("the tier is read off the price the way a person reads it", () => {
  assert.equal(tiers.estimatePriceTier("$6 wings"), 1);
  assert.equal(tiers.estimatePriceTier("$12.99 pasta"), 2);
  assert.equal(tiers.estimatePriceTier("$29 prime rib"), 3);
  // The lowest figure, not the first or the highest: "$8 starters - $14 mains" is an $8 way in.
  assert.equal(tiers.estimatePriceTier("$14 mains, $8 starters"), 1);
  // Wing nights priced in cents were the cheapest deals on the site and the ones carrying no tag.
  assert.equal(tiers.estimatePriceTier("85¢ per wing"), 1);
  assert.equal(tiers.estimatePriceTier("69 cents each"), 1);
  // "50% off" names no price. Guessing one would put a figure on a card nothing supports.
  assert.equal(tiers.estimatePriceTier("Half price wings"), null);
  assert.equal(tiers.estimatePriceTier(""), null);
});

test("the default radius is one the picker and the server both accept", () => {
  assert.equal(radius.DEFAULT_RADIUS_KM, 25);
  assert.ok(radius.RADIUS_OPTIONS.includes(radius.DEFAULT_RADIUS_KM), "the default has to be selectable");
  assert.ok(radius.allowedRadii(false).includes(25));
  // Pro is sold a radius "up to 100 km"; the free set stops at 50.
  assert.deepEqual(radius.allowedRadii(true).slice(-2), [75, 100]);
  assert.equal(radius.allowedRadii(false).includes(100), false);
});

test("every radius default points at the shared constant", () => {
  // The number lived as a literal 10 in six places. A grep for `|| 10` next to a radius is what
  // this guards: one of them staying behind means the homepage and the digest disagree about how
  // far "near me" is, which is invisible until someone gets an email about a deal 20 km away.
  for (const [name, source] of [
    ["deals route", route()],
    ["home", home()],
    ["digests", read("../app/api/jobs/digests/route.ts")],
    ["user route", read("../app/api/user/route.ts")],
  ]) {
    assert.match(source, /DEFAULT_RADIUS_KM/, `${name} should take the default from app/radius.ts`);
    assert.doesNotMatch(source, /radius[^\n]*\|\|\s*10\b/i, `${name} still has a hardcoded 10 km default`);
  }
});

test("the API filters and faces service style off the restaurant row", () => {
  const source = route();
  assert.match(source, /r\.service_style/, "the snapshot select must read the column");
  assert.match(source, /service_style:\s*string \| null/, "the row type must carry it");
  assert.match(source, /getAll\("serviceStyle"\)/, "the query param must be read");
  // Only the two values the column holds. Anything else in the query string is dropped rather
  // than passed to a comparison that would silently match nothing.
  assert.match(source, /value === "quick" \|\| value === "sit_down"/);
  assert.match(source, /serviceStyles:\s*Object\.entries\(serviceStyles\)/, "the facet must be exposed");
  // A restaurant nobody has classified is not a third kind of restaurant, so it is left out of
  // the facet counts rather than offered as an "Unknown" chip.
  assert.match(source, /deal\.service_style !== "quick" && deal\.service_style !== "sit_down"/);
});

test("the API never exposes a tier the filter row does not offer", () => {
  const source = route();
  assert.match(source, /price_tier: narrowPriceTier\(deal\.price_tier\) \?\? estimatePriceTier\(deal\.price\)/);
  // An empty set means "no price filter", so range-checking the query param rather than narrowing
  // it turned ?priceTier=4 into a request for the whole catalog - the opposite of what it asked.
  assert.match(source, /narrowPriceTier\(Number\(value\)\)/, "the query param must be narrowed, not dropped");
  assert.doesNotMatch(source, /tier <= 5/, "a five-tier clamp would accept a chip that cannot be shown");
});

test("the filter row offers exactly the tiers that exist, and both service styles", () => {
  const source = home();
  assert.match(source, /const PRICE_TIERS = Array\.from\(\{ length: MAX_PRICE_TIER \}/);
  assert.doesNotMatch(source, /PRICE_TIERS = \[1, 2, 3, 4, 5\]/);
  assert.match(source, /const SERVICE_STYLES = \["quick", "sit_down"\] as const/);
  assert.match(source, /serviceStyle: serviceStyles\.length/, "the filter has to reach the API");
  // An old ?priceTier=4 link keeps filtering rather than falling back to the whole catalog.
  assert.match(source, /narrowPriceTier\(Number\(part\.trim\(\)\)\)/);
});

test("both new labels are translated everywhere, not just in English", () => {
  for (const locale of ["en", "fr", "es"]) {
    const filters = messages(locale).home.filters;
    for (const key of ["serviceStyle", "quickService", "sitDownService"]) {
      assert.ok(filters[key], `${locale} is missing home.filters.${key}`);
    }
  }
  // Three tier names per locale, matching MAX_PRICE_TIER: priceTierLabel indexes this list by
  // tier - 1, so a locale left at five would keep naming tiers the filter row cannot show.
  const labels = code(readFileSync(new URL("../app/i18n/dealLabels.ts", import.meta.url), "utf8"));
  const lists = labels.split("\n").filter((line) => line.includes("priceTiers: ["));
  assert.equal(lists.length, 3, "one list per locale");
  for (const line of lists) {
    const names = line.slice(line.indexOf("[") + 1, line.lastIndexOf("]")).split(",").filter((part) => part.trim());
    assert.equal(names.length, 3, `three tier names per locale, found: ${line.trim()}`);
  }
});

test("clear filters sits with the chips it clears", () => {
  const source = home();
  // It used to float at the far right of the category row, level with buttons it does not act on
  // and aligned to nothing. In the chip row it is the last thing after the filters it removes.
  assert.match(source, /<button className="clear-filters" onClick=\{clearFilters\}>/);
  assert.doesNotMatch(source, /toolbar-actions/, "the wrapper that held it is gone");
  // One condition behind the row, the button and the reset, rather than three copies that can
  // disagree — a filter added to one and not the others leaves a chip with no way to clear it.
  assert.match(source, /const filtersActive =/);
  assert.match(source, /\{filtersActive && \(/);
  assert.match(source, /serviceStyles\.length > 0/, "the new filter counts as a filter");
  assert.match(source, /setServiceStyles\(\[\]\)/, "and clearing has to clear it");
});

test("the navbar reads brand-first, not one cluster at the right edge", () => {
  const source = header();
  assert.match(source, /<div className="nav-primary">/);
  assert.match(source, /<div className="nav-actions">/);
  // The burger and the shortcut still address the one element they always did.
  assert.match(source, /aria-controls="site-nav-links"/);
  assert.match(source, /id="site-nav-links"/);
  const chrome = readFileSync(new URL("../app/site-chrome.css", import.meta.url), "utf8");
  assert.match(chrome, /\.nav \{ justify-content: flex-start;/);
  // display:contents is what keeps the mobile drawer a single column of links rather than two
  // rows; without it the groups lay out as boxes inside the drawer.
  assert.match(chrome, /\.nav-actions \{ display: contents; \}/);
  const polish = readFileSync(new URL("../app/polish.css", import.meta.url), "utf8");
  assert.doesNotMatch(polish, /\.vertical-switch \{[^}]*margin-left: auto/, "the switch must not push the row right");
});
