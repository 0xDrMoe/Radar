import { test } from "node:test";
import assert from "node:assert/strict";
import { slugify, uniqueSlug } from "../app/slug.ts";

// A deal's slug is its URL, and app/[locale]/deals/[slug]/page.tsx resolves a URL with
// `WHERE d.slug=? OR d.id=? ... LIMIT 1`. Two rows can therefore answer to the same string, and
// the one that loses is simply never reachable — nothing errors, nothing logs. These tests hold
// the two properties that prevent it: the format is deterministic, and uniqueSlug refuses
// anything the caller says is spoken for.

test("slugify folds accents rather than dropping the letter", () => {
  // North & Navy's deal is titled "5 à 7 Aperitivo". Dropping the accented letter would give
  // "5-7-aperitivo", which reads as a range.
  assert.equal(slugify("5 à 7 Aperitivo"), "5-a-7-aperitivo");
  assert.equal(slugify("Café Böulud"), "cafe-boulud");
});

test("slugify collapses every run of punctuation and whitespace to one hyphen", () => {
  assert.equal(slugify("Whalesbone on Elgin — Oysters & Pints"), "whalesbone-on-elgin-oysters-pints");
  assert.equal(slugify("feast + revel"), "feast-revel");
  assert.equal(slugify("  Q Bar at Queen Street Fare  "), "q-bar-at-queen-street-fare");
});

test("slugify never leaves a leading or trailing hyphen", () => {
  assert.equal(slugify("!!! Happy Hour !!!"), "happy-hour");
  assert.equal(slugify("---"), "");
});

test("slugify emits only characters that survive being a filename", () => {
  // scripts/prerender-deals.mjs writes "<slug>.html" and skips anything outside this set, which
  // would silently drop the page back to rendering on the Worker.
  for (const input of ["Tōkyō Smoke / Bar", "50% off — drinks!", "Ñoño's Cantina"]) {
    assert.match(slugify(input), /^[a-z0-9-]+$/, `${input} produced ${slugify(input)}`);
  }
});

test("slugify caps at 100 characters", () => {
  assert.equal(slugify("a".repeat(250)).length, 100);
});

test("uniqueSlug returns the plain slug when nothing claims it", () => {
  assert.equal(uniqueSlug("Sidedoor Golden Hour Ottawa", new Set()), "sidedoor-golden-hour-ottawa");
});

test("uniqueSlug suffixes past anything already taken", () => {
  const taken = new Set(["whalesbone-on-elgin-oysters-pints-ottawa"]);
  assert.equal(
    uniqueSlug("Whalesbone on Elgin Oysters & Pints Ottawa", taken),
    "whalesbone-on-elgin-oysters-pints-ottawa-2",
  );
});

test("uniqueSlug treats a taken deal id exactly like a taken slug", () => {
  // The whole reason `taken` holds both columns: the page lookup matches either, so a slug equal
  // to some other deal's id makes one of those two URLs unreachable.
  const taken = new Set(["datsun-tiki-tuesday-ottawa"]);
  assert.equal(uniqueSlug("Datsun Tiki Tuesday Ottawa", taken), "datsun-tiki-tuesday-ottawa-2");
});

test("uniqueSlug keeps counting while each candidate is taken", () => {
  const taken = new Set(["alora-happy-hour", "alora-happy-hour-2", "alora-happy-hour-3"]);
  assert.equal(uniqueSlug("Alora Happy Hour", taken), "alora-happy-hour-4");
});

test("a suffix shortens the base instead of pushing the slug past the cap", () => {
  // Truncating to 100 AFTER appending would hand back the same 100 characters it was trying to
  // differ from, and the collision it just detected would go through anyway.
  const base = slugify("b".repeat(250));
  const result = uniqueSlug("b".repeat(250), new Set([base]));
  assert.equal(result.length, 100);
  assert.notEqual(result, base);
  assert.ok(result.endsWith("-2"));
});

test("uniqueSlug falls back to deal for input with no usable characters", () => {
  assert.equal(uniqueSlug("!!!", new Set()), "deal");
  assert.equal(uniqueSlug("!!!", new Set(["deal"])), "deal-2");
});

test("uniqueSlug gives up rather than returning a colliding slug", () => {
  const taken = new Set(["x"]);
  for (let n = 2; n < 100; n += 1) taken.add(`x-${n}`);
  assert.equal(uniqueSlug("x", taken), "");
});
