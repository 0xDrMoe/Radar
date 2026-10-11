import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { code } from "./source.mjs";

// app/branch-search.ts is pure, so it is transpiled and actually run rather than asserted about.
const moduleSource = readFileSync(new URL("../app/branch-search.ts", import.meta.url), "utf8");
const { BRANCH_SEARCH_MIN, BRANCH_RESULT_LIMIT, normalizeBranchText, branchQueryTerms, indexBranches, matchBranches } =
  await import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(moduleSource, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    ).toString("base64")}`
  );

const read = (path) => code(readFileSync(new URL(path, import.meta.url), "utf8"));
const picker = () => read("../app/BranchPicker.tsx");
const offerLocations = () => read("../app/[locale]/deals/[slug]/OfferLocations.tsx");
const dealMap = () => read("../app/[locale]/deals/[slug]/DealMap.tsx");
const dealPage = () => read("../app/[locale]/deals/[slug]/page.tsx");
const homeClient = () => read("../app/HomeClient.tsx");
const messages = (locale) => JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8"));

const branch = (label, hint) => ({ value: label, label, hint });
const find = (options, query, limit) => matchBranches(indexBranches(options), query, limit);

// Ottawa as the database actually holds it: one city, many branches, every label opening with the
// same word.
const ottawa = [
  branch("Ottawa · 1595 Bank St"),
  branch("Ottawa · 2515 Bank St"),
  branch("Ottawa · 1 Rideau St"),
  branch("Ottawa · 240 Sparks St"),
  branch("Ottawa · 900 Greenbank Rd"),
  branch("Gatineau · 100 Boul. Saint-Joseph"),
];

// ── What was actually broken ────────────────────────────────────────────────
test("a street name in the middle of the line is findable", () => {
  // The whole reason this module exists. A native select's type-ahead matches a prefix of the
  // option's text, and all 120 of Tim Hortons' Timbits Tuesday options start with the city — so
  // typing "bank" to reach the Bank Street branch matched nothing at all.
  const { shown } = find(ottawa, "bank");
  assert.deepEqual(shown.map((option) => option.label), [
    "Ottawa · 1595 Bank St",
    "Ottawa · 2515 Bank St",
    "Ottawa · 900 Greenbank Rd",
  ]);
});

test("terms match in any order", () => {
  for (const query of ["rideau ottawa", "ottawa rideau", "  ottawa   rideau  "]) {
    const { shown } = find(ottawa, query);
    assert.deepEqual(shown.map((option) => option.label), ["Ottawa · 1 Rideau St"], `for ${JSON.stringify(query)}`);
  }
});

test("every term has to appear, not just one of them", () => {
  // An OR would return the whole city for "ottawa sparks", which is the opposite of narrowing.
  assert.equal(find(ottawa, "ottawa sparks").total, 1);
  assert.equal(find(ottawa, "ottawa tokyo").total, 0);
});

test("punctuation in the address is not something the reader has to reproduce", () => {
  // "Boul. Saint-Joseph" is one string with a full stop and a hyphen in it. Nobody types those.
  for (const query of ["boul saint joseph", "boul. saint-joseph", "SAINT joseph"]) {
    assert.equal(find(ottawa, query).total, 1, `for ${JSON.stringify(query)}`);
  }
});

test("accents are optional on both sides", () => {
  const quebec = [branch("Montréal · 1 Rue Sainte-Catherine"), branch("Québec · 2 Grande Allée")];
  assert.equal(find(quebec, "montreal").total, 1);
  assert.equal(find(quebec, "montréal").total, 1);
  assert.equal(find(quebec, "allee").total, 1);
  assert.equal(find(quebec, "allée").total, 1);
});

// ── Order ───────────────────────────────────────────────────────────────────
test("matches keep the order they arrived in", () => {
  // The caller has already sorted: the deal's own branch first, then distance from wherever the
  // reader searched. Re-ranking the survivors by how well each matched would spend information the
  // server computed to answer a question nobody asked.
  const byDistance = [branch("Ottawa · 900 Greenbank Rd", "2 km"), branch("Ottawa · 1595 Bank St", "6 km"), branch("Ottawa · 2515 Bank St", "9 km")];
  const { shown } = find(byDistance, "bank");
  assert.deepEqual(shown.map((option) => option.hint), ["2 km", "6 km", "9 km"]);
});

test("an empty query is not a filter", () => {
  for (const query of ["", "   ", "·", "—"]) {
    assert.equal(find(ottawa, query).total, ottawa.length, `for ${JSON.stringify(query)}`);
  }
  assert.deepEqual(branchQueryTerms("  "), []);
});

// ── What the list leaves out, and says so ───────────────────────────────────
test("a long result set is capped, and the count is the real one", () => {
  // The UI needs to be able to say "showing 50 of 118" rather than implying it drew them all.
  const many = Array.from({ length: 118 }, (_, index) => branch(`Ottawa · ${index} Bank St`));
  const { shown, total } = find(many, "bank", 50);
  assert.equal(shown.length, 50);
  assert.equal(total, 118);
  // And the cap applies to an unfiltered list too — opening the picker must not draw 118 rows.
  assert.equal(find(many, "", 50).shown.length, 50);
  assert.equal(find(many, "", 50).total, 118);
});

test("nothing matching is zero of zero, not everything", () => {
  const { shown, total } = find(ottawa, "kanata");
  assert.equal(total, 0);
  assert.deepEqual(shown, []);
});

// ── The searchable text is the visible text ─────────────────────────────────
test("the hint is searchable because the reader can see it", () => {
  assert.equal(find([branch("Ottawa · 1 Rideau St", "ByWard Market")], "byward").total, 1);
});

test("normalization does not delete a script it was not written for", () => {
  // [^a-z0-9] would have emptied this label, and an empty haystack matches nothing — the branch
  // would have been unreachable rather than merely hard to type.
  assert.equal(normalizeBranchText("多倫多 · 100 Spadina Ave"), "多倫多 100 spadina ave");
  assert.equal(find([branch("多倫多 · 100 Spadina Ave")], "spadina").total, 1);
});

// ── Wiring ──────────────────────────────────────────────────────────────────
test("both pickers switch to search at the same length", () => {
  assert.equal(typeof BRANCH_SEARCH_MIN, "number");
  assert.ok(BRANCH_SEARCH_MIN > 1 && BRANCH_SEARCH_MIN < 20, `threshold was ${BRANCH_SEARCH_MIN}`);
  assert.ok(BRANCH_RESULT_LIMIT >= BRANCH_SEARCH_MIN);
  // Short lists keep the native control — one tap to the system picker on a phone.
  for (const [name, source] of [["the deal page", offerLocations()], ["the deal card", homeClient()]]) {
    assert.match(source, /BRANCH_SEARCH_MIN/, `${name} should share the threshold rather than pick its own`);
    assert.match(source, /<select/, `${name} should still fall back to a native select`);
    assert.match(source, /<BranchPicker/, `${name} should use the shared picker`);
  }
});

test("indexing happens once per list, not once per keystroke", () => {
  // NFD decomposition over 120 labels on every keypress is the one thing here worth memoising.
  assert.match(picker(), /useMemo\(\(\) => indexBranches\(options\), \[options\]\)/);
  assert.match(offerLocations(), /useMemo<BranchOption\[\]>/);
  assert.match(homeClient(), /const chainBranchOptions = useMemo<BranchOption\[\]>/);
});

test("Escape closes the list before it closes the dialog", () => {
  // The deal card listens for Escape on `document`. Without stopping it here, dismissing the
  // branch list would throw away the whole card the reader was in the middle of reading.
  const source = picker();
  const escape = source.slice(source.indexOf('event.key === "Escape"'), source.indexOf('event.key === "ArrowDown"'));
  // stopImmediatePropagation, not stopPropagation. The App Router hydrates the whole document, so
  // React's delegated listener and the dialog's own keydown listener are both on `document` —
  // stopPropagation stops an event moving up to the next ancestor and does nothing about a second
  // listener on the node it is already at. With only stopPropagation the first Escape closed the
  // list and the card together; this was seen happening before it was fixed.
  assert.match(escape, /event\.stopPropagation\(\)/);
  assert.match(escape, /event\.nativeEvent\.stopImmediatePropagation\(\)/);
  assert.match(escape, /if \(open \|\| query\)/, "a press with nothing open must reach the dialog");
});

test("an option is an ARIA option, not fifty new tab stops", () => {
  const source = picker();
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"/);
  assert.match(source, /aria-activedescendant=/, "keyboard position is announced through the input");
  assert.doesNotMatch(source, /<button[\s\S]{0,80}role="option"/, "options must not be focusable controls");
  // Clicking must not blur the input first, or the wrapper's blur handler closes the list out from
  // under the click.
  assert.match(source, /onMouseDown=\{\(event\) => event\.preventDefault\(\)\}/);
});

// ── The map follows the branch ──────────────────────────────────────────────
test("the map is drawn by the picker's own component, not beside it", () => {
  // It used to be rendered by page.tsx against the first location that happened to carry
  // coordinates. Choosing a branch moved the address, the phone number and the Directions link
  // while the pin stayed where it was.
  assert.match(offerLocations(), /<DealMap\s+latitude=\{selected\.latitude\}/);
  assert.doesNotMatch(dealPage(), /<DealMap/, "the page must not render a second, unmoving map");
  assert.doesNotMatch(dealPage(), /import DealMap/);
});

test("a branch with no coordinates gets no map rather than another branch's pin", () => {
  assert.match(offerLocations(), /selected\.latitude != null && selected\.longitude != null/);
});

test("changing the pin does not fill the Back button with map states", () => {
  // Writing a new src onto a live iframe navigates it, and a nested navigation goes into the
  // session history the browser's Back button walks. Keying on the URL remounts the element
  // instead, and a fresh iframe's first load replaces its own initial entry.
  assert.match(dealMap(), /<iframe key=\{src\}/);
});

// ── Copy ────────────────────────────────────────────────────────────────────
test("every locale can render the picker", () => {
  for (const locale of ["en", "fr", "es"]) {
    const strings = messages(locale).branchPicker;
    assert.ok(strings, `${locale} has no branchPicker strings`);
    for (const key of ["placeholder", "noMatches", "showingSome", "showingAll"]) {
      assert.ok(strings[key], `${locale} is missing branchPicker.${key}`);
    }
    // The placeholder is a promise about what matching does, and matching only reads the visible
    // line, so it must not offer a postal code the haystack never contains.
    assert.doesNotMatch(strings.placeholder.toLowerCase(), /postal|código|code postal/);
    for (const token of ["{shown}", "{total}"]) {
      assert.ok(strings.showingSome.includes(token), `${locale}: showingSome needs ${token}`);
    }
  }
});
