// What counts as a photo worth fetching, tested against the markup that actually broke it.
//
// The candidate finder used to require a raster extension at the end of the URL. That is not how
// restaurant sites serve images any more, and the cost was silent: a page with twenty photographs
// on it reported "no candidate images on the page" and the card fell back to an emoji. Both real
// shapes below were taken off live sites on 2026-09-19, so a future tightening of the pattern has
// to fail here rather than in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import { photoCandidates, MAX_CANDIDATES } from "../app/photo-candidates.ts";

const PAGE = "https://example.test/locations/somewhere";

/** One <img> per src, in order, as a page would carry them. */
function pageWith(...srcs) {
  return `<html><body>${srcs.map((s) => `<img src="${s}" alt="">`).join("")}</body></html>`;
}

test("an image proxy carrying the real file in a query parameter outranks unknowns", () => {
  // JOEY's location pages, verbatim in shape: the only photograph on the page is behind Next.js's
  // optimizer, and the .jpg sits in the middle of the URL rather than at its end.
  //
  // Asserted as a ranking rather than as mere presence, because presence does not distinguish
  // anything. The URL's *path* is /_next/image, which carries no extension either way, so it is
  // admitted as an unknown even by a pattern anchored to the end of the string. What reading the
  // query parameter buys is knowing it is a photograph, and therefore putting it ahead of the
  // page's anonymous assets instead of behind them, where MAX_CANDIDATES would drop it.
  const src =
    "/_next/image?url=https%3A%2F%2Fjoeyrestaurants.kinsta.cloud%2Fapp%2Fuploads%2F2023%2F05%2FLocation-Burnaby_Hero.jpg&w=1920&q=75";
  const unknowns = Array.from({ length: MAX_CANDIDATES }, (_, i) => `https://cdn.test/asset/${i}`);
  assert.equal(photoCandidates(pageWith(...unknowns, src), PAGE)[0], new URL(src, PAGE).toString());
});

test("a CDN URL with no extension at all is still worth fetching", () => {
  // White Spot serves photographs as base64-encoded paths with no extension anywhere. The URL
  // cannot tell us what it is, so the content-type check at fetch time has to be what decides —
  // which means the URL must survive this far.
  const src =
    "https://craft-assets.whitespot.ca/eyJidWNrZXQiOiJ3aGl0ZXNwb3QtY3JhZnQtYXNzZXRzLXByb2QiLCJrZXkiOiJpbWFnZXMifQ";
  assert.deepEqual(photoCandidates(pageWith(src), PAGE), [src]);
});

test("extensions we could not store are refused without spending a fetch", () => {
  // PHOTO_TYPES holds jpeg, png and webp alone, so these could not be stored even if fetched.
  const refused = pageWith(
    "https://cdn.test/hero.svg",
    "https://cdn.test/hero.gif",
    "https://cdn.test/hero.avif",
    "https://cdn.test/hero.bmp",
  );
  assert.deepEqual(photoCandidates(refused, PAGE), []);
});

test("a named photograph outranks an extensionless guess", () => {
  // The ordering is the point, not a detail. MAX_CANDIDATES is small, so if unknown URLs were taken
  // in document order they would fill every slot and crowd out the one file on the page that says
  // outright that it is a photograph.
  const unknowns = Array.from({ length: MAX_CANDIDATES }, (_, i) => `https://cdn.test/asset/${i}`);
  const [first] = photoCandidates(pageWith(...unknowns, "https://cdn.test/dining-room.jpg"), PAGE);
  assert.equal(first, "https://cdn.test/dining-room.jpg");
});

test("relaxing the extension test did not relax the furniture test", () => {
  // The previous pattern rejected these incidentally, by extension. Now that extensionless URLs
  // are admitted, the name-based test is the only thing standing between a card and a wall of
  // brand marks, so it has to still bite.
  const furniture = pageWith(
    "https://cdn.test/assets/logo",
    "https://cdn.test/assets/favicon",
    "https://cdn.test/assets/map-pin",
    "https://cdn.test/assets/avatar-default",
  );
  assert.deepEqual(photoCandidates(furniture, PAGE), []);
});

test("og:image still comes first, and an empty one is not a candidate", () => {
  const withOg =
    `<meta property="og:image" content="https://cdn.test/the-room.jpg">` +
    pageWith("https://cdn.test/other.jpg");
  assert.equal(photoCandidates(withOg, PAGE)[0], "https://cdn.test/the-room.jpg");

  // JOEY ships `content=""`. Resolving an empty string against the page URL yields the page itself,
  // which would then be fetched as though it were an image.
  const emptyOg = `<meta property="og:image" content="">` + pageWith("https://cdn.test/real.jpg");
  assert.deepEqual(photoCandidates(emptyOg, PAGE), ["https://cdn.test/real.jpg"]);
});

test("never more than MAX_CANDIDATES, whatever the page offers", () => {
  const many = pageWith(...Array.from({ length: 20 }, (_, i) => `https://cdn.test/photo-${i}.jpg`));
  assert.equal(photoCandidates(many, PAGE).length, MAX_CANDIDATES);
});
