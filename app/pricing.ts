// Turning a Stripe price into the string a visitor reads.
//
// The rule this module exists to keep: the price shown is the price charged. Nothing here invents
// an amount or converts one. Every number rendered on the site comes from a Stripe Price object,
// and the only decision made locally is *which* of the currencies that price already carries to
// show — so a visitor can never be quoted a figure Checkout would not honor.
//
// Deliberately free of any `cloudflare:workers` import so the Pro page, the pricing route and the
// tests can all reach it.

/** One billing period, priced. `amount` is in the currency's minor unit, as Stripe stores it. */
export type PlanPrice = {
  currency: string;
  amount: number;
  /** "month" | "year" as Stripe reports it — used to label the period, never to compute one. */
  interval: string;
};

/**
 * Where a visitor is, mapped to the currency they would expect to be charged in.
 *
 * An entry here is a *preference*, not a promise: currencyForCountry only honors it when the
 * Stripe price actually carries that currency, so an unconfigured currency silently falls back to
 * the price's base one rather than showing an amount that does not exist. That is what makes this
 * table safe to keep broad — adding USD in the Stripe dashboard is all it takes for US visitors to
 * start seeing USD, with no deploy, and removing it again reverts them just as quietly.
 *
 * Country, not locale. /fr is read from Montreal and from Paris, /es from Madrid and from Mexico
 * City; the language someone reads in says nothing about the currency their card is denominated
 * in. Cloudflare gives us the country for free on every request.
 *
 * Exported for the Worker (worker/index.ts), which keeps one colo copy of the Pro page per
 * currencyBucket below: reading the same table is what keeps the page it hands a visitor the page
 * this module would have priced for them.
 */
export const COUNTRY_CURRENCY: Record<string, string> = {
  CA: "cad",
  US: "usd",
  GB: "gbp",
  AU: "aud",
  NZ: "nzd",
  CH: "chf",
  JP: "jpy",
  IN: "inr",
  SG: "sgd",
  HK: "hkd",
  MX: "mxn",
  BR: "brl",
  NO: "nok",
  SE: "sek",
  DK: "dkk",
  PL: "pln",
  CZ: "czk",
  AE: "aed",
  ZA: "zar",
  // The euro, spelled out by country rather than guessed from a region code.
  AT: "eur", BE: "eur", CY: "eur", DE: "eur", EE: "eur", ES: "eur", FI: "eur", FR: "eur",
  GR: "eur", HR: "eur", IE: "eur", IT: "eur", LT: "eur", LU: "eur", LV: "eur", MT: "eur",
  NL: "eur", PT: "eur", SI: "eur", SK: "eur",
};

/**
 * The currency to display for a visitor, given the currencies a price actually has.
 *
 * `available` should be the price's own currency plus every key of its `currency_options`. When
 * the visitor's country maps to one of those, that wins; otherwise the base currency does, which
 * is both the honest answer and what Stripe will charge.
 */
export function currencyForCountry(country: string | null | undefined, base: string, available: Iterable<string>): string {
  const wanted = COUNTRY_CURRENCY[(country || "").toUpperCase()];
  if (!wanted) return base;
  for (const currency of available) if (currency.toLowerCase() === wanted) return wanted;
  return base;
}

/**
 * Which visitors are quoted the same Pro page: everyone whose country prefers the same currency,
 * and everyone whose country has no entry above together, as "base".
 *
 * currencyForCountry reads nothing about the country but its entry in COUNTRY_CURRENCY, so two
 * countries in one bucket are always shown the same currency and the same amount, whatever the
 * price carries. That is the whole guarantee the Worker's colo copy of /pro rests on: it is kept
 * once per bucket (cacheKeyFor in worker/index.ts), and a bucket that grouped two countries this
 * module would price differently would hand one of them the other's figure. A currency the price
 * does not carry falls back to the base one inside its own bucket, which only stores the base page
 * twice.
 */
export function currencyBucket(country: string | null | undefined): string {
  return COUNTRY_CURRENCY[(country || "").toUpperCase()] ?? "base";
}

/**
 * What the Pro page's server render writes when it has prices to show, and the Worker looks for
 * before it keeps a copy of the page: `data-radar-priced=""` on the page's header.
 *
 * displayPrices answers {} whenever Stripe cannot be reached, and the page then draws no price at
 * all - right for that one visitor, wrong to hand everyone in the colo for the next fifteen
 * minutes. The marker is only rendered beside actual prices, so its absence is the Worker's sign
 * that a render must not be stored.
 */
export const PRICED_PAGE_MARKER = 'data-radar-priced=""';

// Stripe stores amounts in the currency's minor unit, except for the currencies that have no minor
// unit at all — ¥500 is stored as 500, not 50000. Dividing those by 100 would quote a price a
// hundred times too low. This is Stripe's own zero-decimal list.
const ZERO_DECIMAL = new Set([
  "bif","clp","djf","gnf","jpy","kmf","krw","mga","pyg","rwf","ugx","vnd","vuv","xaf","xof","xpf",
]);

/** A Stripe minor-unit amount as a real number in that currency. */
export function majorUnits(amount: number, currency: string): number {
  return ZERO_DECIMAL.has(currency.toLowerCase()) ? amount : amount / 100;
}

/**
 * The price as a visitor reads it.
 *
 * Formatted with the plain language tag rather than a region-qualified one ("en", not "en-CA"), on
 * purpose: `en-CA` renders CAD as a bare "$", which is exactly the ambiguity worth avoiding when
 * the reader might be American. Plain "en" gives "CA$4.99", "fr" gives "4,99 $CA" — unmistakable
 * in either language, and identical for every reader of that locale, which is what lets the
 * server-rendered copy of this page stay cacheable.
 */
export function formatPrice(locale: string, currency: string, amount: number): string {
  const value = majorUnits(amount, currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
      // Whole amounts read better without the trailing zeros, but a price like 4.99 must keep
      // both digits. Asking for 0-2 gives "CA$25" and "CA$4.99" from the same call.
      minimumFractionDigits: 0,
      maximumFractionDigits: ZERO_DECIMAL.has(currency.toLowerCase()) ? 0 : 2,
    }).format(value);
  } catch {
    // An unrecognized currency code would otherwise throw inside a render. Falling back to the
    // code itself still tells the reader what they are being charged in.
    return `${value} ${currency.toUpperCase()}`;
  }
}

/**
 * What the yearly plan saves against twelve months of the monthly one, as a whole percent.
 *
 * Returns null unless both prices are in the same currency and the yearly one is genuinely
 * cheaper — a "save 0%" badge, or one comparing CAD to USD, is worse than no badge.
 */
export function yearlySavingPercent(monthly: PlanPrice | null, yearly: PlanPrice | null): number | null {
  if (!monthly || !yearly) return null;
  if (monthly.currency !== yearly.currency) return null;
  const twelveMonths = monthly.amount * 12;
  if (twelveMonths <= 0 || yearly.amount >= twelveMonths) return null;
  return Math.round(((twelveMonths - yearly.amount) / twelveMonths) * 100);
}

/**
 * What Radar Pro costs inside the iOS app, by currency, in minor units.
 *
 * This is the one price on the site that is not read back from Stripe, because it does not live in
 * Stripe: it is an App Store Connect price for product `radar.pro.monthly`, and the web has no way
 * to ask StoreKit. So it is written down here, and every guard below exists because a written-down
 * price is exactly the thing that goes stale.
 *
 * Only CAD is listed. Apple sets each storefront's price by its own FX, so the US storefront is
 * US$4.99, not a conversion of C$6.99 — filling in other currencies by arithmetic would invent
 * prices Apple does not charge. A currency that is not listed simply shows no comparison.
 *
 * Keep in step with App Store Connect. If the App Store price changes and this does not, the site
 * overstates the saving; tests/pricing.test.mjs cannot catch that, only a person can.
 */
const APP_STORE_PRICES: Record<string,number> = {
  cad: 699,
};

/**
 * The struck-through "was" price to show beside the web price, or null when there is nothing
 * honest to show.
 *
 * Fails closed on every axis, because each one is a way of advertising a discount that is not
 * real:
 *   - Apple sells no yearly product, so only a monthly web price has a counterpart. Twelve times
 *     the monthly App Store price would be a number Apple never quotes.
 *   - A currency with no App Store price listed gets no comparison rather than a converted one.
 *   - If the App Store is ever the same price or cheaper, there is no saving to advertise.
 *
 * Keyed off the interval Stripe reports rather than the plan the reader picked, so a misconfigured
 * STRIPE_PRICE_ID pointing at a yearly price suppresses the comparison instead of mislabeling it.
 */
export function appStoreComparison(web: PlanPrice | null | undefined): PlanPrice | null {
  if (!web || web.interval !== "month") return null;
  const amount = APP_STORE_PRICES[web.currency.toLowerCase()];
  if (typeof amount !== "number" || amount <= web.amount) return null;
  return { currency: web.currency, amount, interval: web.interval };
}
