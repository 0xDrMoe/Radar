// Whether you order at a counter or sit at a table.
//
// This is the rule behind the public Fast food / Sit-down filter, and it lives in its own
// import-free module for the same reason app/price-tiers.ts and app/radius.ts do: two callers have
// to agree on it. `scripts/classify-service-style.mjs` runs it over the whole catalog, and
// `app/api/admin/route.ts` runs it on the one restaurant it is creating, so a restaurant added
// through the admin is classified the same way as one the script reaches later. A second copy of
// this in the script is exactly how an audit in this repo once reported a clean catalog over a
// rule it had reimplemented slightly differently.
//
// Nothing in the schema derives this. `cuisine` describes the kitchen, not the room — one row of
// 291 is tagged "Fast Food" and 79 carry no cuisine at all — and `amenities` is `[]` on every row.
// So it is decided explicitly, in six passes, strongest evidence first, and every answer carries
// the reason that produced it so the result can be argued with rather than trusted.

export type ServiceStyle = "quick" | "sit_down";

// Ordering at a counter or in an app, with no table service. Matched on the name, case- and
// punctuation-insensitively, as a whole phrase.
const QUICK_BRANDS = [
  "a&w", "burger king", "mcdonald's", "wendy's", "kfc", "popeyes", "taco bell", "subway",
  "harvey's", "tim hortons", "little caesars", "pizza pizza", "pizza 73", "kooko's pizza",
  "triple o's", "dairy queen", "chipotle", "five guys", "mr sub", "quiznos", "booster juice",
  "second cup", "starbucks", "country style", "coffee time",
];

// Words that name the format rather than the food.
const QUICK_FORMAT = [
  "shawarma", "taqueria", "canteen", "creamery", "donut", "doughnut", "bakery", "pastry",
  "gelateria", "pasticceria", "deli", "takeout", "take-out", "street food", "counter", "juice",
  "smoothie", "ice cream", "food truck", "fish and chip shop",
];
const SIT_FORMAT = [
  "tavern", "taverna", "brasserie", "steakhouse", "steak house", "oyster house", "oyster bar",
  "bistro", "trattoria", "osteria", "ristorante", "pizzeria", "chophouse", "supper club", "dining room",
  "gastrobar", "gastro pub", "public house", "ale house", "alehouse", "roadhouse", "boathouse",
  "wine bar", "cocktail bar", "lounge", "grill", "grille", "pub", "tap", "taproom", "brewing",
  "brewery", "brewpub", "beerworks", "kitchen", "eatery", "restaurant", "resto", "cantina",
  "izakaya", "smokehouse", "barbecue", "sports bar",
  // A bare "Bar" is a room with seats in this catalog — Char Bar, Tamari Bar, Lulu Bar, Bar
  // Raval, Bar Hop. Word-bounded, so "AloBar" is one word and does not match.
  "bar", "social", "socialhouse", "club", "brasserie", "trattoria", "diner", "chalet", "inn", "tap house",
];

// The cuisines that settle it on their own, either way.
const QUICK_CUISINE = new Set(["Fast Food", "Bakery", "Cafe & Coffee", "Dessert"]);
const SIT_CUISINE = new Set(["Bar & Pub", "Wine Bar", "Brewpub", "Steakhouse", "Contemporary", "French", "Seafood"]);

// Last resort, and the weakest evidence here — every restaurant reaching this pass has already
// failed to match a brand, a format word in its name, a decisive cuisine, or anything in its own
// deals. It is applied anyway because a cuisine does have a dominant service model in *this*
// catalog, and because the passes above have already lifted out the exceptions: a sit-down
// format word beats this table, so "Pizzeria da Romolo" and "The Grand Pizzeria" are rooms while
// "Campus Pizza" and "KirkWooD Pizza" are counters.
//
// Answers from this pass say "cuisine default" in their reason, and the script counts them
// separately, so how much of the catalog rests on it stays visible. Several keys here are not in
// app/cuisines.ts — Contemporary, Southeast Asian, Tex-Mex, Rotisserie and the rest are values
// stored before that canonical list existed, and dropping them would drop real classifications.
const CUISINE_DEFAULT: Record<string, ServiceStyle> = {
  // Formats that are a counter far more often than not, once the rooms have been lifted out.
  Pizza: "quick", "Middle Eastern": "quick", Vietnamese: "quick", Chinese: "quick",
  Burgers: "quick", "Southeast Asian": "quick", Deli: "quick",
  // Formats served at a table.
  American: "sit_down", Canadian: "sit_down", Italian: "sit_down", Mexican: "sit_down",
  Japanese: "sit_down", Indian: "sit_down", Greek: "sit_down", Mediterranean: "sit_down",
  Spanish: "sit_down", "Spanish & Latin": "sit_down", "Latin American": "sit_down",
  Caribbean: "sit_down", Thai: "sit_down", Korean: "sit_down", Ramen: "sit_down",
  Sushi: "sit_down", Diner: "sit_down", BBQ: "sit_down", "Asian Fusion": "sit_down",
  Global: "sit_down", "Tex-Mex": "sit_down", Southern: "sit_down", Rotisserie: "sit_down",
  "Breakfast & Brunch": "sit_down", "Vegan & Vegetarian": "sit_down",
};

// What an offer says about how it is served.
const SIT_DEAL = /(dine[\s-]?in|reservation|your server|table|lounge|patio|prix fixe|three[\s-]course|sit[\s-]down|dining room|no minors)/i;
// `combo` was in this list and had to come out: a combo is a menu construction, not a service
// model, and it filed AllStar Wings & Ribs — a sit-down wings restaurant — under counter service.
// What is left names the counter itself.
const QUICK_DEAL = /(drive[\s-]?thru|drive[\s-]?through|pick[\s-]?up only|takeout only|take[\s-]?out only|in the app|through the app|mobile app|order at the counter)/i;

const norm = (text: unknown) =>
  String(text || "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();

// Word-bounded, and that is not a detail. The first version fell back to a bare `includes`, which
// read "Angkor Southeast Asian Delight" as a deli and filed a sit-down restaurant under counter
// service. A format word has to be a word.
function hasPhrase(haystack: string, phrase: string) {
  const words = norm(phrase);
  if (!words) return false;
  return new RegExp(`(?<![a-z0-9])${words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")}(?![a-z0-9])`, "i").test(haystack);
}

export type ServiceStyleEvidence = {
  /** The restaurant's name. */
  name?: string | null;
  /** Its stored cuisine, as written — matched against the tables above verbatim. */
  cuisine?: string | null;
  /** Its deals' own words: title, price, description, terms and restrictions, joined. */
  dealCopy?: string | null;
  /**
   * Whether it publishes a happy hour. A restaurant that does has a room people sit in for it,
   * and that is the last piece of real evidence before the cuisine table. It decides 19 of the
   * catalog's 291 — the rooms whose cuisine is blank and whose name carries no format word, so
   * nothing above this pass reaches them: Union 613, North & Navy, Sidedoor, Datsun, Back to
   * Brooklyn, The Clarendon.
   */
  publishesHappyHour?: boolean;
};

/**
 * Decide a restaurant's service style from whatever evidence there is.
 *
 * Returns `{ style: null }` when nothing answers. NULL matches neither filter, which is the honest
 * outcome for a row nobody can classify — better than a default that quietly files every unknown
 * under whichever value is commoner. `why` names the pass that decided, for the script's output
 * and for the admin's audit trail.
 */
export function classifyServiceStyle(evidence: ServiceStyleEvidence): { style: ServiceStyle | null; why: string | null } {
  const name = norm(evidence.name);
  const cuisine = String(evidence.cuisine || "").trim();
  const copy = String(evidence.dealCopy || "");

  // 1. BRANDS — a named list of national quick-service chains. Unambiguous, and where most of the
  //    "quick" answers come from.
  const brand = QUICK_BRANDS.find((candidate) => hasPhrase(name, norm(candidate)));
  if (brand) return { style: "quick", why: `brand: ${brand}` };

  // 2. FORMAT — a word in the name that names the format rather than the food. A sit-down marker
  //    wins a tie: "Stacked Smoked Meat & Grill" is a grill that happens to say deli-ish things,
  //    and "Elmdale Oyster House & Tavern" is a room, not a counter.
  const sitFormat = SIT_FORMAT.find((candidate) => hasPhrase(name, norm(candidate)));
  if (sitFormat) return { style: "sit_down", why: `format: ${sitFormat.trim()}` };
  const quickFormat = QUICK_FORMAT.find((candidate) => hasPhrase(name, norm(candidate)));
  if (quickFormat) return { style: "quick", why: `format: ${quickFormat}` };

  // 3. CUISINE — the few that settle it either way.
  if (QUICK_CUISINE.has(cuisine)) return { style: "quick", why: `cuisine: ${cuisine}` };
  if (SIT_CUISINE.has(cuisine)) return { style: "sit_down", why: `cuisine: ${cuisine}` };

  // 4. THE DEALS — what the offers themselves say. The pass that reads the catalog rather than
  //    the name. Copy naming both a counter and a table says nothing, so it decides nothing.
  if (copy) {
    if (SIT_DEAL.test(copy) && !QUICK_DEAL.test(copy)) return { style: "sit_down", why: "its own deals say dine-in" };
    if (QUICK_DEAL.test(copy) && !SIT_DEAL.test(copy)) return { style: "quick", why: "its own deals say counter" };
  }

  // 5. A HAPPY HOUR — see publishesHappyHour above.
  if (evidence.publishesHappyHour) return { style: "sit_down", why: "publishes a happy hour" };

  // 6. THE CUISINE TABLE — the weakest pass, labeled as such.
  const fallback = CUISINE_DEFAULT[cuisine];
  if (fallback) return { style: fallback, why: `cuisine default: ${cuisine}` };

  // Nothing answered. That is a real outcome, not a failure, and a guess would put a restaurant
  // under a filter it might not belong in rather than leave it out of both. It is what a blank
  // cuisine, no format word in the name and deals that say nothing about the room come to. Blowers
  // & Grafton was the one restaurant with live deals in that state until drizzle/0058 filled its
  // cuisine and service_style from its own site; on the catalogue of 2026-10-01 this pass answers
  // for all 242 restaurants with live deals.
  return { style: null, why: null };
}

/**
 * The evidence a single deal contributes, joined the way `classifyServiceStyle` expects.
 *
 * Shared so the script's aggregate across a restaurant's whole catalog and the admin route's
 * one deal-in-hand are built from the same fields — a caller that forgot `terms` would be reading
 * less than the other one and quietly reaching a different answer.
 */
export function dealCopyForServiceStyle(deal: {
  title?: unknown;
  price?: unknown;
  description?: unknown;
  terms?: unknown;
  restrictions?: unknown;
}) {
  return [deal.title, deal.price, deal.description, deal.terms, deal.restrictions]
    .filter(Boolean)
    .join(" ");
}
