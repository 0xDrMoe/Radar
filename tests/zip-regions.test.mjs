import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { code } from "./source.mjs";
import { ZIP_RANGES_FOR_TEST, provinceForPostal, regionForZip } from "../app/zip-regions.ts";

// Turning a US ZIP into the state it is in.
//
// This is reference data, and the failure mode is quiet: a wrong range does not throw, it narrows
// somebody's deal page to a state they are not in and tells them so in a sentence. So the tests are
// real ZIP codes of real cities rather than a restatement of the table.

const page = code(readFileSync(new URL("../app/[locale]/deals/[slug]/page.tsx", import.meta.url), "utf8"));

test("a real ZIP from each corner of the country lands in the right state", () => {
  const cities = {
    "78701": ["TX", "Austin"], "79901": ["TX", "El Paso"], "88510": ["TX", "El Paso (885)"],
    "90012": ["CA", "Los Angeles"], "94103": ["CA", "San Francisco"], "96813": ["HI", "Honolulu"],
    "99501": ["AK", "Anchorage"], "98101": ["WA", "Seattle"], "97201": ["OR", "Portland"],
    "10001": ["NY", "Manhattan"], "00501": ["NY", "Holtsville (005)"], "02108": ["MA", "Boston"],
    "60601": ["IL", "Chicago"], "48226": ["MI", "Detroit"], "33101": ["FL", "Miami"],
    "32801": ["FL", "Orlando"], "80202": ["CO", "Denver"], "89101": ["NV", "Las Vegas"],
    "87101": ["NM", "Albuquerque"], "20001": ["DC", "Washington"], "37201": ["TN", "Nashville"],
    "37901": ["TN", "Knoxville"], "83701": ["ID", "Boise"], "59601": ["MT", "Helena"],
    "04101": ["ME", "Portland ME"], "99201": ["WA", "Spokane"],
  };
  for (const [zip, [region, where]] of Object.entries(cities)) {
    assert.equal(regionForZip(zip), region, `${zip} is ${where}`);
  }
});

test("the two states that share a border in the table are not swapped", () => {
  // 799 and 885 are both El Paso and both Texas, with New Mexico's 870-884 sitting between them.
  // An off-by-one at either edge puts an El Paso reader in New Mexico.
  assert.equal(regionForZip("79999"), "TX");
  assert.equal(regionForZip("87000"), "NM");
  assert.equal(regionForZip("88499"), "NM");
  assert.equal(regionForZip("88500"), "TX");
  assert.equal(regionForZip("88600"), null, "886-888 belong to no state");
});

test("ZIP+4 works and anything that is not a ZIP does not", () => {
  assert.equal(regionForZip("787011234"), "TX", "ZIP+4 still names Texas");
  // A Canadian postal code goes through postal_cache instead, which is where Canada actually is.
  assert.equal(regionForZip("K2C0J4"), null);
  assert.equal(regionForZip(""), null);
  assert.equal(regionForZip("7870"), null, "four digits is not a ZIP");
  assert.equal(regionForZip("ABCDE"), null);
});

test("military and territory prefixes name no state rather than the wrong one", () => {
  // 006-009 is Puerto Rico, 340 and 962-966 are military. Radar has no locations in any of them, and
  // a reader there should get the whole list and the prompt - not a silent narrowing to nothing.
  for (const zip of ["00601", "34000", "96201", "96999", "09000"]) {
    assert.equal(regionForZip(zip), null, `${zip} must not be claimed by a state`);
  }
});

test("the ranges are ordered, non-overlapping and all real states", () => {
  // The lookup is a linear scan that returns the first match, so an overlap would resolve silently
  // to whichever range was written first.
  const STATES = new Set(("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
    + "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));
  let previousEnd = -1;
  for (const [from, to, region] of ZIP_RANGES_FOR_TEST) {
    assert.ok(from <= to, `${region}: ${from}-${to} is backwards`);
    assert.ok(from > previousEnd, `${region} starts at ${from}, overlapping the range ending ${previousEnd}`);
    assert.ok(from >= 0 && to <= 999, `${region}: a ZIP prefix is three digits`);
    assert.ok(STATES.has(region), `${region} is not a state or DC`);
    previousEnd = to;
  }
  // Every state Radar could have a branch in must be reachable, or its readers can never narrow.
  const covered = new Set(ZIP_RANGES_FOR_TEST.map(([, , region]) => region));
  for (const state of STATES) assert.ok(covered.has(state), `no ZIP range maps to ${state}`);
});

test("the deal page falls back to the prefix only after the cache misses", () => {
  // Order matters. postal_cache carries real coordinates, which is what sorts the list by distance;
  // the prefix only knows the state. Checking the prefix first would throw that away for every
  // Canadian reader, who is the one the cache actually holds.
  assert.match(page, /const row = await lookupPostal\(postal\);[\s\S]{0,200}?if \(row\) return \{[\s\S]{0,120}?\};[\s\S]{0,400}?const region = regionForZip\(postal\);/);
  // And a prefix-derived area carries no point, so nothing may claim a distance from it.
  assert.match(page, /latitude: null, longitude: null, region, country: "US"/);
  assert.match(page, /distance_km: area\?\.latitude != null && area\.longitude != null/);
  assert.match(page, /const ordered = area\?\.latitude != null/);
  // The same for a Canadian code the cache has never seen: after the cache, never before it, and
  // with no point either. The cache is only as trustworthy as it ever was (a Nominatim street
  // match can carry the wrong postcode); the letter adds a province, nothing more.
  assert.match(page, /const row = await lookupPostal\(postal\);[\s\S]{0,200}?if \(row\) return \{[\s\S]{0,1200}?const province = provinceForPostal\(postal\);/);
  assert.match(page, /latitude: null, longitude: null, region: province, country: "CA"/);
});

// A Canadian postal code names its province by its first letter (Canada Post's allocation), so the
// deal page can narrow to the reader's province for a code the geocoder has never resolved.
test("a Canadian postal code's first letter names its province", () => {
  const codes = {
    A1C5M2: ["NL", "St. John's"], B3H4R2: ["NS", "Halifax"], C1A4P3: ["PE", "Charlottetown"],
    E1C4M3: ["NB", "Moncton"], G1R4P5: ["QC", "Quebec City"], H2X1Y4: ["QC", "Montreal"],
    J8Y6T3: ["QC", "Gatineau"], K1K1A1: ["ON", "Ottawa"], L5B2C9: ["ON", "Mississauga"],
    M5V3L9: ["ON", "Toronto"], N2L3G1: ["ON", "Waterloo"], P3E2C6: ["ON", "Sudbury"],
    R3C4T3: ["MB", "Winnipeg"], S4P3Y2: ["SK", "Regina"], T2P2M5: ["AB", "Calgary"],
    V6B1A1: ["BC", "Vancouver"], X1A2L9: ["NT", "Yellowknife"], X0A0H0: ["NU", "Iqaluit"],
    X0B0C0: ["NU", "Cambridge Bay"], X0C0G0: ["NU", "Rankin Inlet"], X0E0N0: ["NT", "Hay River"],
    Y1A6V6: ["YT", "Whitehorse"],
  };
  for (const [postal, [province, where]] of Object.entries(codes)) {
    assert.equal(provinceForPostal(postal), province, `${postal} is ${where}`);
  }
  // D, F, I, O, Q, U, W and Z begin no Canadian postal code.
  for (const postal of ["D1A1A1", "W1A1A1", "Z9Z9Z9"]) assert.equal(provinceForPostal(postal), null, postal);
  // Only a normalized A1A1A1: a ZIP, a forward sortation area alone, or anything else is not one.
  for (const postal of ["78701", "K1K", "K1K 1A1", "k1k1a1", ""]) assert.equal(provinceForPostal(postal), null, postal);
});
