// What a deal page says about itself to search engines, link previews and structured data, and the
// few judgements the page body shares with them.
//
// Pure functions with no imports, so the rules can be tested against real catalog strings in
// plain Node (tests/deal-meta.test.mjs) rather than only through a full page render.

/**
 * How long a verification stays good. The same thirty days app/api/deals/route.ts applies in SQL
 * when it computes effective_verification_status, and the admin console's "Stale" filter.
 */
export const VERIFICATION_FRESH_DAYS = 30;

/**
 * The verification status a reader may be told about: 'stale' for a 'verified' deal nobody has
 * looked at in more than VERIFICATION_FRESH_DAYS, otherwise the stored status.
 *
 * Only 'verified' licenses the words "Last verified" or "Confirmed". A deal imported from a
 * directory is stored with verified_at set to the moment of import and verification_status
 * 'needs_review', so the date alone says nothing about whether anyone checked it.
 */
export function effectiveVerificationStatus(status: string | null | undefined, verifiedAt: Date, now: Date = new Date()): string {
  const stored = status || "needs_review";
  if (stored !== "verified") return stored;
  const age = now.getTime() - verifiedAt.getTime();
  return Number.isNaN(age) || age > VERIFICATION_FRESH_DAYS * 86_400_000 ? "stale" : "verified";
}

// ---------------------------------------------------------------------------------------------
// Offer.price
// ---------------------------------------------------------------------------------------------

// Words that make a dollar figure something other than what the offer costs: an amount taken off,
// a spend the reader has to reach first, a floor or a ceiling, an estimate, a donation.
//
// The floor, ceiling and estimate words count only against the figure itself ("from $12", "$10 or
// less"). Anywhere else they describe the item: "$10 large pizza with up to 3 toppings" is still a
// $10 pizza, and "$6.99 each when you choose 2 or more" is still $6.99 each.
const NOT_THE_PRICE = [
  /\boff\b/i, // "$5 off burgers", "25% off pasta"
  /%/, // a percentage beside a figure is a second, different offer
  /\$\s?\d+(?:\.\d+)?\+/, // "$5+ order", "$19.99+": a spend threshold
  /\b(?:over|under|from|up to|at least|less than|more than|about|approx(?:imately|\.)?|around|starting at)\s*\$/i,
  /\$\s?\d+(?:\.\d+)?\s*(?:or (?:less|more|under)|and (?:up|under)|max(?:imum)?)\b/i, // "$10 or less", "each $3 or less"
  /\bdonation\b/i,
  /\bcoupon\b/i, // "$5 coupon" is money off the next order, not a price
  /^\s*free\b/i, // "Free small chili with a $5+ purchase": the item costs nothing; the figure is a condition
];

// Words that mark a separated segment as an offer of its own ("Half-price nachos - $4 tequila
// shots"), as opposed to a description of the one offer ("$5 - McDouble, Junior Chicken or ...").
const OWN_OFFER = /\b(?:half|price|priced|discount(?:ed)?|free|off|special|deal|bogo|2-for-1|two-for-one)\b|%|\$|¢|\d+\s*cents\b/i;

// " · ", " - ", " — ", " – " join two offers as often as they introduce the details of one.
const SEGMENT = /\s+[·\-—–]\s+/;

const AMOUNT = /\$\s?(\d+(?:\.\d{1,2})?)(?![\d.]|\s*[-–]\s*\$?\d)|(?<![\d.])(\d{1,2})\s*(?:¢|cents\b)/gi;
const RANGE = /\$\s?\d+(?:\.\d+)?\s*(?:[-–]|to)\s*\$?\s?\d/i;

/**
 * The single price a deal states for the thing it offers, or null.
 *
 * Offer.price is a number with a currency, and a crawler shows it to a searcher as what the offer
 * costs. So a figure is used only when the text names exactly one amount and nothing around it
 * says the amount is something else: "$5 off", "$5+ purchase", "from $5", "about $9", a $1
 * donation, or one of two offers joined together ("$8 beer · 50% oysters"). Everything else is left
 * without a price rather than given a wrong one; the free text is still on the page.
 *
 * Unit prices count ("$1 per wing", "85¢ per wing", "$10 per pound"): that is the price of the
 * item, stated plainly. So do bundles ("2 tacos for $8"), whose one figure is what the reader pays.
 */
export function offerPrice(priceText: string | null | undefined): number | null {
  const text = String(priceText || "").trim();
  if (!text) return null;
  if (RANGE.test(text)) return null;
  const amounts = [...text.matchAll(AMOUNT)].map((match) => (match[1] != null ? Number(match[1]) : Number(match[2]) / 100));
  // Counted against every $ and ¢ in the text, not only the ones AMOUNT accepted, so a range the
  // pattern declined ("$7-9") cannot leave a lone figure behind that looks like a single price.
  const markers = (text.match(/\$|¢|\bcents\b/gi) || []).length;
  if (amounts.length !== 1 || markers !== 1) return null;
  const amount = amounts[0];
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (NOT_THE_PRICE.some((pattern) => pattern.test(text))) return null;
  const segments = text.split(SEGMENT);
  if (segments.length > 1) {
    // The figure has to be in the first segment, and no later segment may be an offer of its own.
    if (!/\$|¢|\bcents\b/i.test(segments[0])) return null;
    if (segments.slice(1).some((segment) => OWN_OFFER.test(segment))) return null;
  }
  return amount;
}

// ---------------------------------------------------------------------------------------------
// Titles
// ---------------------------------------------------------------------------------------------

export const TITLE_SUFFIX = " — Radar";
// Roughly what a results page shows before it cuts a title off.
export const TITLE_SHOWN = 60;

/**
 * A deal page's <title>: the locale's "{title} at {restaurant}", with the site's name after it
 * only when the whole still fits in TITLE_SHOWN characters. On a long title the site's name is the
 * part a reader needs least and the part a results page would cut, and 193 deal titles ran past
 * sixty with it.
 *
 * The deal's own words are never shortened. Cutting them was tried and read worse than a long
 * title does: "All-you-can-eat wings… at The Senate Tavern" drops the one word that says which
 * night it is.
 */
export function dealPageTitle(core: string): string {
  return core.length + TITLE_SUFFIX.length <= TITLE_SHOWN ? `${core}${TITLE_SUFFIX}` : core;
}

/** Joins sentence fragments ("$7 wings", "Wed", "Last checked Sep 22, 2026") into one description. */
export function sentences(parts: ReadonlyArray<string | null | undefined>): string {
  return parts
    .map((part) => String(part || "").trim().replace(/[\s.;,·]+$/, ""))
    .filter(Boolean)
    .map((part) => `${part}.`)
    .join(" ");
}

// ---------------------------------------------------------------------------------------------
// National footprints
// ---------------------------------------------------------------------------------------------

const US_STATES = new Set(("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS "
  + "MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY").split(" "));

/**
 * A US chain's footprint split into the fifty states and everything else: Washington, DC and the
 * territories (PR, GU, VI, MP, AS). Counting them all as states had Subway "in 55 states".
 */
export function splitUsFootprint(regions: ReadonlyArray<string>): { states: number; others: string[] } {
  const codes = [...new Set(regions.map((region) => region.toUpperCase()))];
  const others = codes.filter((code) => !US_STATES.has(code));
  // DC first, then the territories alphabetically, so the sentence reads the same on every page.
  others.sort((a, b) => (a === "DC" ? -1 : b === "DC" ? 1 : a.localeCompare(b)));
  return { states: codes.length - others.length, others };
}
