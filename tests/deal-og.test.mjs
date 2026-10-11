// The deal share card (scripts/deal-og.mjs): a PNG of the right size, text it cannot draw dropped
// rather than shown as boxes, and long text cut rather than overflowing.
import assert from "node:assert/strict";
import test from "node:test";

const { clip, printable, renderDealImage, WIDTH, HEIGHT } = await import("../scripts/deal-og.mjs");

test("text the font cannot draw is dropped, and the rest kept", () => {
  assert.equal(printable("50¢ wings — Mondays & Thursdays"), "50¢ wings — Mondays & Thursdays");
  assert.equal(printable("Café “Très bon”"), "Café “Très bon”");
  assert.equal(printable("Wings 🍗 night ☕"), "Wings night");
  assert.equal(printable("  many   spaces\n here "), "many spaces here");
  assert.equal(printable(null), "");
});

test("long text is cut on a word, with an ellipsis, and short text is left alone", () => {
  assert.equal(clip("Half-price wings", 40), "Half-price wings");
  const cut = clip("Half-price wings every Monday and Thursday night all night long", 30);
  assert.ok(cut.length <= 30 && cut.endsWith("…"), cut);
  assert.ok(!/\s…$/.test(cut), "no dangling space before the ellipsis");
});

test("a card is a 1200 x 630 PNG, whatever the deal says", async () => {
  for (const deal of [
    { restaurant: "Finnigan's Cove Seafood Bar & Grill", title: "50¢ wings Mondays and Thursdays", price: "50¢ wings", schedule: "Mon & Thu 3-8 PM", category: "Happy hour", city: "Harrisonburg, VA" },
    { restaurant: "Émile's", title: "x".repeat(300), price: "", schedule: "", category: "Food deal", city: "" },
    { restaurant: "🍕🍕🍕", title: "🍕", category: "Food deal" },
  ]) {
    const png = await renderDealImage(deal);
    assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "PNG signature");
    assert.equal(png.readUInt32BE(16), WIDTH);
    assert.equal(png.readUInt32BE(20), HEIGHT);
    assert.ok(png.length > 5_000 && png.length < 400_000, `${png.length} bytes`);
  }
});
