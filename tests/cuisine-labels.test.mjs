import assert from "node:assert/strict";
import test from "node:test";
import { CUISINES } from "../app/cuisines.ts";
import { CUISINE_LABELS, LEGACY_CUISINE_LABELS, cuisineLabel } from "../app/i18n/staticEnums.ts";

// A cuisine with no French or Spanish label is printed in English on /fr and /es: on the card, the
// deal page and the cuisine filter. cuisineLabel falls back to the stored value without a word, so
// a missing label shows up only to a reader.
//
// The catalogue is not in the repository, so the live values are a fixed list: every cuisine on a
// live deal in the production catalogue of 2026-10-01 (after drizzle/0058 and the Shenandoah Valley
// seed) that is not in CUISINES. A new free-text value from the admin's "Other" needs adding here
// and in LEGACY_CUISINE_LABELS, or moving onto a canonical value - which, because a deal's cuisine
// decides whether app/alcohol.ts treats it as a drinking venue, is a decision about the restaurant,
// not about its label.
const LIVE_OUTSIDE_THE_LIST = ["Contemporary", "Global", "Southeast Asian", "Southern", "Tex-Mex"];

for (const locale of ["fr", "es"]) {
  test(`every canonical cuisine has a ${locale} label`, () => {
    for (const cuisine of CUISINES) {
      assert.ok(CUISINE_LABELS[cuisine]?.[locale], `${cuisine} has no ${locale} label`);
      assert.equal(cuisineLabel(cuisine, locale), CUISINE_LABELS[cuisine][locale]);
    }
  });

  test(`every cuisine still on a live deal outside the list has a ${locale} label`, () => {
    for (const cuisine of LIVE_OUTSIDE_THE_LIST) {
      assert.ok(!CUISINES.includes(cuisine), `${cuisine} is canonical now: take it off this list`);
      const label = LEGACY_CUISINE_LABELS[cuisine]?.[locale];
      assert.ok(label, `${cuisine} has no ${locale} label, so /${locale} shows it in English`);
      assert.equal(cuisineLabel(cuisine, locale), label);
    }
  });

  test(`no ${locale} label is blank, and the legacy table does not shadow a canonical one`, () => {
    for (const [cuisine, labels] of Object.entries(LEGACY_CUISINE_LABELS)) {
      assert.ok(String(labels?.[locale] || "").trim(), `${cuisine}: blank ${locale} label`);
      assert.ok(!CUISINES.includes(cuisine), `${cuisine} is canonical and belongs in CUISINE_LABELS`);
    }
  });

  // A label is a pill, a dropdown entry and the {cuisine} in the deal page's fallback sentence
  // ("Oferta de {cuisine} en {city}"), so it cannot open on a preposition: "Del sur de EE. UU."
  // made that "Oferta de Del sur de EE. UU. en Ottawa".
  test(`no ${locale} cuisine label opens on a preposition`, () => {
    const labels = [...Object.values(CUISINE_LABELS), ...Object.values(LEGACY_CUISINE_LABELS)].map((entry) => entry[locale]);
    for (const label of labels) assert.doesNotMatch(label, /^(?:(?:de|del|des|du)\s|d['’])/i, `"${label}" opens on a preposition`);
  });
}

test("English is the stored value, and an unknown value still passes through", () => {
  assert.equal(cuisineLabel("Tex-Mex", "en"), "Tex-Mex");
  assert.equal(cuisineLabel("Contemporary", "en"), "Contemporary");
  assert.equal(cuisineLabel("Something New", "fr"), "Something New");
  assert.equal(cuisineLabel("Wine bar", "fr"), cuisineLabel("Wine Bar", "fr"));
});
