// How a reader gets an offer, and which country's dollars it is priced in.
//
// The question a chain deal raises before any other is "do I need their app?" A McValue price is at
// the counter; Taco John's National Taco Day taco is only in the TJ Rewards app; Little Caesars'
// 3OFF18 is a code typed on its website. Radar stores the answer as `deals.redemption`, a
// comma-separated set of the four ways below (drizzle/0049), with the checkout code in
// `deals.promo_code` (drizzle/0050). NULL answers nothing and shows nothing - it is not a claim
// that the offer needs no app.
//
// Pure functions, so the card, the deal page, the national list and the tests read one rule.

export const REDEMPTION_METHODS = ["in_store", "app", "online", "code"] as const;
export type RedemptionMethod = (typeof REDEMPTION_METHODS)[number];

const KNOWN = new Set<string>(REDEMPTION_METHODS);

/** The stored set, in canonical order. Unknown words are dropped rather than shown raw. */
export function parseRedemption(value: unknown): RedemptionMethod[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const found = new Set(list.map((item) => String(item).trim().toLowerCase()).filter((item) => KNOWN.has(item)));
  return REDEMPTION_METHODS.filter((method) => found.has(method));
}

/** Only in the chain's app: not at the counter, not on its website. */
export function appOnly(methods: readonly RedemptionMethod[]): boolean {
  return methods.includes("app") && !methods.includes("in_store") && !methods.includes("online");
}

/** At the counter or on the website - either way without installing anything. */
export function noAppNeeded(methods: readonly RedemptionMethod[]): boolean {
  return methods.includes("in_store") || methods.includes("online");
}

/**
 * The one answer a card has room for, most restrictive first: a reader who needs the app has to be
 * told before anything else, a code is the next thing they must have in hand, and only then does it
 * matter whether the counter or the website is the way in.
 */
export type RedemptionBadge = "appOnly" | "code" | "inStore" | "online";

export function redemptionBadge(methods: readonly RedemptionMethod[]): RedemptionBadge | null {
  if (!methods.length) return null;
  if (appOnly(methods)) return "appOnly";
  if (methods.includes("code")) return "code";
  if (methods.includes("in_store")) return "inStore";
  if (methods.includes("online")) return "online";
  return null;
}

/** A checkout code as it is shown and copied: trimmed, and only if it looks like one. */
export function displayPromoCode(value: unknown): string | null {
  const code = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9-]{2,24}$/.test(code) ? code : null;
}

export type Market = "CA" | "US";

/** The market a deal is priced in, from its country. Anything else is not claimed. */
export function marketOf(country: unknown): Market | null {
  const value = String(country || "").trim().toUpperCase();
  return value === "US" || value === "CA" ? value : null;
}

/** ISO 4217, for structured data and for the "prices in" line. */
export const CURRENCY: Record<Market, "USD" | "CAD"> = { US: "USD", CA: "CAD" };
