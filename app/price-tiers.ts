// How a deal's price becomes a $ / $$ / $$$ tag.
//
// Its own module, with no imports, for two reasons. It is the one piece of pricing logic that
// both the site and the backfill script have to agree on, and a script that cannot import it
// would end up with a second copy that drifts — which is how an audit in this repo once reported
// a clean catalog over a rule it had reimplemented slightly differently. `app/verification.ts`
// re-exports all of this, so nothing that already imports it has to change.

// Three tiers, not five. Five asked the reader to tell "Moderate" from "Upscale" on a site whose
// median deal is $8.50 and whose 90th percentile is $21.95: two of the five buckets held 32 of
// 310 priced deals between them, so three of the five chips on the filter row were noise and the
// distinction they drew was one nobody was making. $ / $$ / $$$ also needs no legend.
export const MAX_PRICE_TIER = 3;

export function priceTierSymbol(tier?: number | null) {
  return tier && tier >= 1 && tier <= MAX_PRICE_TIER ? "$".repeat(tier) : null;
}

// Anything stored under the old five tiers, or arriving from an older client, folded onto the
// three that exist now. A named function rather than an inline clamp so the intent stays legible:
// the old "Upscale" and "Fine dining" become one "$$$", not two rows of the same chip.
export function narrowPriceTier(tier?: number | null): number | null {
  if (tier == null || !Number.isFinite(tier) || tier < 1) return null;
  return Math.min(Math.trunc(tier), MAX_PRICE_TIER);
}

// Boundaries drawn where the catalog's prices actually are, measured across the 310 live deals
// that quote a figure: under $10 / $10–25 / $25+ splits them about 171 / 115 / 24. They also read
// the way a person says them out loud, which $6 / $12 / $20 / $35 did not.
const TIER_TWO_FROM = 10;
const TIER_THREE_FROM = 25;

/**
 * Best-effort tier from a deal's free-text price.
 *
 * `price_tier` on the row stays the source of truth; this fills the gap for anything untagged and
 * is what the backfill script uses to do the tagging.
 *
 * Cents are read as well as dollars, and that is not a nicety. 199 of 509 live deals quoted no
 * dollar sign, and a large share of those were wing nights priced "85¢ per wing" or "69¢ each".
 * A dollars-only pattern saw nothing in them, so the cheapest deals in the catalog were exactly
 * the ones carrying no price tag — the tag was missing precisely where it was most obviously
 * knowable. Anything priced in cents is tier one; nothing priced in cents is anything else.
 */
export function estimatePriceTier(priceText: string): number | null {
  const dollars = Array.from(String(priceText || "").matchAll(/\$\s?(\d+(?:\.\d{1,2})?)/g)).map((match) => Number(match[1]));
  if (dollars.length) {
    const lowest = Math.min(...dollars);
    if (lowest < TIER_TWO_FROM) return 1;
    if (lowest < TIER_THREE_FROM) return 2;
    return 3;
  }
  if (/(?<![\p{L}\p{N}])\d+\s?(?:¢|cents?(?![\p{L}]))/iu.test(String(priceText || ""))) return 1;
  return null;
}
