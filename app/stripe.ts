import { env } from "cloudflare:workers";
import { BILLING_PLANS, type BillingPlan } from "./billing-plans";
import { currencyForCountry, type PlanPrice } from "./pricing";
import { TRIAL_DAYS } from "./entitlement";
import type { EmailLocale, StripeSubscriptionLike } from "./billing-emails";
import type { CouponFacts, SubscriptionBilling } from "./save-offers";

function runtime() { return env as unknown as Record<string,string>; }
export function stripeConfigured() {
  const value = runtime();
  return Boolean(value.STRIPE_SECRET_KEY && value.STRIPE_PRICE_ID);
}

// The keys themselves live in app/billing-plans.ts, which imports nothing from the Worker runtime
// so that the client component and the tests can both reach them. This half — turning a key into
// the price it charges — is the half that must stay server-side.
const PLAN_PRICE_VARS: Record<BillingPlan,string> = {
  monthly: "STRIPE_PRICE_ID",
  yearly: "STRIPE_PRICE_ID_YEARLY",
};

/** The configured price for a plan, or "" when that plan has no price set. */
export function priceIdForPlan(plan: BillingPlan) {
  return runtime()[PLAN_PRICE_VARS[plan]] || "";
}

/**
 * The plans that actually have a price configured.
 *
 * Read by the Pro page so the picker never offers a period that checkout would refuse: with only
 * STRIPE_PRICE_ID set — which is every deployment before the yearly price existed — this returns
 * just ["monthly"] and no picker is drawn at all.
 */
export function availablePlans(): BillingPlan[] {
  return BILLING_PLANS.filter((plan) => Boolean(priceIdForPlan(plan)));
}

// --- displayed pricing -------------------------------------------------------------------------
//
// The site showed no price at all until now: the Pro FAQ said the amount appears "before you
// confirm at checkout", which was true but asks a visitor to reach a payment page to learn what
// something costs. The reason it was never written into the page is that a hardcoded figure drifts
// the moment anyone edits the price in Stripe, and nothing catches it. So the numbers are read
// back from the Price objects that Checkout itself charges against — they cannot drift, because
// they are the same objects.

type PriceRecord = {
  currency: string;
  amount: number;
  interval: string;
  /** currency code -> minor-unit amount, from Stripe's currency_options. Excludes the base. */
  options: Record<string,number>;
};

// Cached per isolate rather than in KV or the Cache API: the payload is two small objects, the
// data changes about once a year, and an isolate serves many requests. A cold isolate pays one
// Stripe round-trip; everything after that is free. Nothing here varies by visitor — the country
// decision happens downstream in currencyForCountry — so there is no key to get wrong and no way
// for one reader's price to be handed to another.
const PRICE_TTL_MS = 10 * 60_000;
let priceCache: { at: number; prices: Partial<Record<BillingPlan,PriceRecord>> } | null = null;

async function fetchPrice(priceId: string): Promise<PriceRecord | null> {
  // currency_options is not returned by default; without the expand the multi-currency amounts are
  // simply absent and every visitor would be quoted the base currency.
  const url = `https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}?expand[]=currency_options`;
  const response = await fetch(url,{headers:{authorization:`Bearer ${runtime().STRIPE_SECRET_KEY}`}});
  if (!response.ok) return null;
  const price = await response.json() as {
    currency?: string;
    unit_amount?: number | null;
    recurring?: { interval?: string } | null;
    currency_options?: Record<string,{ unit_amount?: number | null }> | null;
  };
  if (!price.currency || typeof price.unit_amount !== "number") return null;
  const options: Record<string,number> = {};
  for (const [currency,option] of Object.entries(price.currency_options || {})) {
    if (typeof option?.unit_amount === "number") options[currency.toLowerCase()] = option.unit_amount;
  }
  return {
    currency: price.currency.toLowerCase(),
    amount: price.unit_amount,
    interval: price.recurring?.interval || "month",
    options,
  };
}

async function loadPrices(): Promise<Partial<Record<BillingPlan,PriceRecord>>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.prices;
  const prices: Partial<Record<BillingPlan,PriceRecord>> = {};
  await Promise.all(availablePlans().map(async (plan) => {
    const record = await fetchPrice(priceIdForPlan(plan));
    if (record) prices[plan] = record;
  }));
  // Only cached once something came back. Caching an empty result would hide a transient Stripe
  // failure behind ten minutes of priceless pages.
  if (Object.keys(prices).length) priceCache = { at: Date.now(), prices };
  return prices;
}

/**
 * The prices to display to a visitor in `country`, keyed by plan.
 *
 * Never throws and never blocks a render: any failure reaching Stripe yields {} and the caller
 * draws the page without prices, which is exactly what it did before this existed. Same
 * graceful-degradation shape as app/geocode.ts.
 */
export async function displayPrices(country: string | null): Promise<Partial<Record<BillingPlan,PlanPrice>>> {
  let prices: Partial<Record<BillingPlan,PriceRecord>>;
  try { prices = await loadPrices(); } catch { return {}; }
  const display: Partial<Record<BillingPlan,PlanPrice>> = {};
  for (const plan of BILLING_PLANS) {
    const record = prices[plan];
    if (!record) continue;
    const currency = currencyForCountry(country,record.currency,[record.currency,...Object.keys(record.options)]);
    const amount = currency === record.currency ? record.amount : record.options[currency];
    // A currency_options entry with no unit_amount cannot be quoted; fall back rather than guess.
    if (typeof amount !== "number") { display[plan] = { currency: record.currency, amount: record.amount, interval: record.interval }; continue; }
    display[plan] = { currency, amount, interval: record.interval };
  }
  return display;
}

async function stripeRequest(path:string,params:Record<string,string>) {
  const key = runtime().STRIPE_SECRET_KEY;
  const body = new URLSearchParams(params);
  const response = await fetch(`https://api.stripe.com/v1/${path}`,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",authorization:`Bearer ${key}`},body});
  const result = await response.json() as Record<string,unknown> & { error?: { message?:string; code?:string } };
  if (!response.ok) throw new Error(`STRIPE_${result.error?.code || response.status}`);
  return result;
}

// A Stripe customer is adopted only when it was created for this same Radar account. Matching on
// the email alone let two accounts share one customer: an address can be changed in the billing
// portal or recycled, and the webhook applies subscription changes to every row holding the
// customer id, so one account could ride on, see, or cancel another's subscription.
export async function findOrCreateCustomer(userId:string,email:string) {
  const search = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=20`,{headers:{authorization:`Bearer ${runtime().STRIPE_SECRET_KEY}`}});
  if (!search.ok) throw new Error(`STRIPE_${search.status}`);
  const found = await search.json() as { data?: Array<{id:string;metadata?:Record<string,string>|null}> };
  const own = found.data?.find((customer) => customer.metadata?.userId === userId);
  if (own) return own.id;
  const created = await stripeRequest("customers",{email,"metadata[userId]":userId});
  return created.id as string;
}

/**
 * `priceId` is resolved by the caller from a BillingPlan — never taken from a request body.
 *
 * `withTrial` is decided by the caller from `users.trial_used`, not from anything the browser sent.
 * Stripe will grant a fresh trial on every new subscription for the same customer, so a trial
 * offered on the client's say-so is an unlimited run of free weeks for anyone who cancels and
 * resubscribes.
 */
export async function createCheckoutSession(customerId:string,userId:string,priceId:string,successUrl:string,cancelUrl:string,withTrial=false,source:"ios_app"|null=null,locale:EmailLocale="en") {
  const session = await stripeRequest("checkout/sessions",{
    customer:customerId,
    mode:"subscription",
    // Checkout in the reader's language, and the language recorded on the subscription, where the
    // webhook reads it back to write the purchase, trial-ending and renewal notices in it too
    // (app/billing-emails.ts). On the subscription rather than only the session because a renewal
    // notice a year from now has only the subscription to go on.
    locale:CHECKOUT_LOCALE[locale],
    "metadata[locale]":locale,
    "subscription_data[metadata][locale]":locale,
    "line_items[0][price]":priceId,
    "line_items[0][quantity]":"1",
    // A card is still collected up front. A trial that ends by silently doing nothing converts far
    // worse than one that ends by charging the card already on file, and it leaves the subscription
    // in `incomplete` - a status that grants nothing and explains nothing to the customer.
    ...(withTrial ? {
      "subscription_data[trial_period_days]": String(TRIAL_DAYS),
      "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
    } : {}),
    // On the session and on the subscription it creates, so a renewal a year later still says how
    // the customer first arrived.
    ...(source ? { "metadata[source]": source, "subscription_data[metadata][source]": source } : {}),
    success_url:successUrl,
    cancel_url:cancelUrl,
    client_reference_id:userId,
    // Puts the "Add promotion code" field on Checkout. Without it a promotion code created in the
    // dashboard is unreachable - there is no field to type it into, and nothing reports that,
    // so the code simply appears not to work.
    //
    // Everything about which codes exist, what they discount and how long the discount lasts on a
    // subscription lives in the Stripe dashboard, not here. This flag only decides whether the
    // field is shown at all, to everyone.
    allow_promotion_codes:"true",
    // The renewal terms again, beside Checkout's own button, which is where the customer agrees to
    // them (the Pro page states them in the reader's language beside its button too). Stripe shows
    // the price, the period and any trial's end date above it.
    "custom_text[submit][message]":RENEWAL_TERMS,
  });
  return session.url as string;
}

/** Stripe Checkout's own names for Radar's languages: Canadian French, Latin American Spanish. */
const CHECKOUT_LOCALE: Record<EmailLocale,string> = { en: "en", fr: "fr-CA", es: "es-419" };

/** What Checkout says beside its subscribe button. Stripe's limit is 1,200 characters. */
export const RENEWAL_TERMS = "Radar Pro renews automatically at the price and billing period shown, until you cancel. Any free trial converts to a paid subscription when it ends unless you cancel first. Cancel anytime online from Account in your Radar dashboard; you keep Pro until the end of the period you paid for.";

/** A subscription as Stripe has it now, or null when it cannot be read. Never throws. */
export async function fetchSubscription(subscriptionId:string): Promise<StripeSubscriptionLike | null> {
  try {
    const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,{headers:{authorization:`Bearer ${runtime().STRIPE_SECRET_KEY}`}});
    if (!response.ok) return null;
    return await response.json() as StripeSubscriptionLike;
  } catch { return null; }
}

/**
 * What the subscription's next invoice will actually charge: Stripe's own preview, so a discount,
 * a multi-currency price and the quantity are all counted the way the charge will count them.
 * Null when Stripe will not say, and the caller falls back to the list price. Never throws: a
 * notice with the list price in it is better than no notice.
 */
export async function previewNextCharge(subscriptionId:string): Promise<{ amount:number; currency:string } | null> {
  try {
    const preview = await stripeRequest("invoices/create_preview",{ subscription:subscriptionId }) as { amount_due?: number; currency?: string };
    return typeof preview.amount_due === "number" && preview.currency ? { amount: preview.amount_due, currency: preview.currency.toLowerCase() } : null;
  } catch { return null; }
}

/**
 * Ends a subscription immediately rather than at the period end.
 *
 * Used by account deletion, where "cancel at period end" would leave Stripe billing a customer
 * whose account no longer exists and who has no way left to stop it.
 */
export async function cancelSubscription(subscriptionId:string) {
  const key = runtime().STRIPE_SECRET_KEY;
  const response = await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`,{method:"DELETE",headers:{authorization:`Bearer ${key}`}});
  const result = await response.json() as { error?: { code?:string } };
  // Already gone is the outcome we wanted.
  if (!response.ok && result.error?.code !== "resource_missing") throw new Error(`STRIPE_${result.error?.code || response.status}`);
  return result;
}

export async function createPortalSession(customerId:string,returnUrl:string) {
  const session = await stripeRequest("billing_portal/sessions",{customer:customerId,return_url:returnUrl});
  return session.url as string;
}

/**
 * The portal opened on its cancellation confirmation for one subscription, rather than on its home
 * screen where "Cancel plan" is one more thing to find. Cancelling online has to be no harder than
 * signing up was (California's auto-renewal law as amended by AB 2863, Quebec's Bill 10, and the
 * FTC's reading of ROSCA). Falls back to the ordinary portal when this flow is refused - a portal
 * configuration with cancellation switched off, or a subscription Stripe no longer has.
 */
export async function createCancelPortalSession(customerId:string,subscriptionId:string|null,returnUrl:string) {
  if (subscriptionId) {
    try {
      const session = await stripeRequest("billing_portal/sessions",{
        customer:customerId,
        return_url:returnUrl,
        "flow_data[type]":"subscription_cancel",
        "flow_data[subscription_cancel][subscription]":subscriptionId,
        "flow_data[after_completion][type]":"redirect",
        "flow_data[after_completion][redirect][return_url]":returnUrl,
      });
      return session.url as string;
    } catch (error) {
      console.warn("[billing] cancel flow refused, opening the portal instead", error instanceof Error ? error.message : error);
    }
  }
  return createPortalSession(customerId,returnUrl);
}

// Stripe's webhook signature: header is "t=<unix seconds>,v1=<hex hmac>[,v1=<hex hmac>...]".
// The signed payload is "{timestamp}.{raw body}", matching Stripe's documented scheme — same
// HMAC-SHA256-then-constant-time-compare shape as the Resend/Svix webhook verifier, just with a
// hex digest and a comma-separated header instead of base64 and a space-separated one.
//
// Every v1 entry is tried: while a signing secret is being rolled Stripe sends one per secret, and
// keeping only the last would refuse genuine events for the length of the roll. A timestamp that
// is not a whole number of seconds is refused before any HMAC is computed.
export async function verifyWebhookSignature(secret:string,payload:string,signatureHeader:string) {
  const entries = signatureHeader.split(",").map((entry) => { const at = entry.indexOf("="); return [entry.slice(0,at).trim(),entry.slice(at + 1).trim()] as const; });
  const timestamp = entries.find(([name]) => name === "t")?.[1];
  const signatures = entries.filter(([name,value]) => name === "v1" && value).map(([,value]) => value);
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return null;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return null;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const mac = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${timestamp}.${payload}`));
  const expected = Array.from(new Uint8Array(mac)).map((byte) => byte.toString(16).padStart(2,"0")).join("");
  let matched = false;
  for (const signature of signatures) {
    if (signature.length !== expected.length) continue;
    let mismatch = 0; for (let index=0;index<expected.length;index++) mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
    if (mismatch === 0) matched = true;
  }
  return matched ? timestamp : null;
}

/**
 * PATCH-style helper. `stripeRequest` posts form-encoded bodies, which is also how Stripe takes
 * updates - the API has no PATCH, a POST to the object's own URL is the update.
 */
async function stripeUpdate(path: string, params: Record<string, string>) {
  return stripeRequest(path, params);
}

/**
 * Stop billing a subscription until a date, without ending it.
 *
 * `behavior: void` is the one that matches what "pause" means to a customer: no invoices are
 * created at all for the paused period, so nothing is owed when they come back. The alternatives
 * (`keep_as_draft`, `mark_uncollectible`) still generate invoices, which means a customer who
 * paused for two months returns to a bill for two months they did not use.
 *
 * The subscription stays `active` in Stripe throughout - pausing stops the invoices, not the
 * subscription - which is exactly why `users.paused_until` has to exist. Entitlement cannot be read
 * from the status alone while a pause is on.
 *
 * `resumes_at` is a Unix timestamp; Stripe clears `pause_collection` itself when it arrives and
 * sends `customer.subscription.updated`, so the resume needs no job of ours. The billing job
 * sweeps for stragglers anyway, because a webhook that never arrives would otherwise leave somebody
 * paused forever.
 */
export async function pauseSubscription(subscriptionId: string, resumesAt: Date) {
  return stripeUpdate(`subscriptions/${encodeURIComponent(subscriptionId)}`, {
    "pause_collection[behavior]": "void",
    "pause_collection[resumes_at]": String(Math.floor(resumesAt.getTime() / 1000)),
  });
}

/**
 * Start billing a paused subscription again, now.
 *
 * Stripe clears `pause_collection` when it is sent empty. `proration_behavior: none` because the
 * paused period was genuinely free - billing for it retroactively on resume would make a pause a
 * deferral, which is not what anyone was offered.
 */
export async function resumeSubscription(subscriptionId: string) {
  return stripeUpdate(`subscriptions/${encodeURIComponent(subscriptionId)}`, {
    "pause_collection": "",
    "proration_behavior": "none",
  });
}

/**
 * Put a coupon on a subscription.
 *
 * The coupon itself lives in the Stripe dashboard and is named by `STRIPE_SAVE_COUPON_ID`. Nothing
 * here decides how big the discount is or how long it lasts - that is a pricing decision, and a
 * coupon created in code is one nobody can see or change without a deploy.
 *
 * Returns false rather than throwing when no coupon is configured, so the cancellation flow can ask
 * "is there an offer to make" without a try/catch.
 */
export async function applySaveCoupon(subscriptionId: string) {
  const couponId = runtime().STRIPE_SAVE_COUPON_ID;
  if (!couponId) return false;
  await stripeUpdate(`subscriptions/${encodeURIComponent(subscriptionId)}`, { coupon: couponId });
  return true;
}

/** Whether a discount is available to offer at all. */
export function saveCouponConfigured() {
  return Boolean(runtime().STRIPE_SAVE_COUPON_ID);
}

async function stripeGet<T>(path: string) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${runtime().STRIPE_SECRET_KEY}` } });
  if (!response.ok) throw new Error(`STRIPE_${response.status}`);
  return await response.json() as T;
}

/**
 * The invoice a charge paid, for taking a commission back when the money is refunded or disputed.
 *
 * Read from Stripe because the events do not reliably carry it: a dispute names only the charge,
 * and from the 2025-03-31 API a Charge no longer has an `invoice` field, the link living on an
 * InvoicePayment instead. Both shapes are tried, so this holds whichever API version the account
 * is pinned to. Null when neither answers; the caller records that rather than guessing.
 */
export async function invoiceForPayment(chargeId?: string, paymentIntentId?: string): Promise<string | null> {
  try {
    let intent = paymentIntentId;
    if (chargeId) {
      const charge = await stripeGet<{ invoice?: string | null; payment_intent?: string | null }>(`charges/${encodeURIComponent(chargeId)}`);
      if (typeof charge.invoice === "string" && charge.invoice) return charge.invoice;
      intent ||= charge.payment_intent || undefined;
    }
    if (intent) {
      const query = new URLSearchParams({ "payment[type]": "payment_intent", "payment[payment_intent]": intent, limit: "1" });
      const payments = await stripeGet<{ data?: Array<{ invoice?: string | null }> }>(`invoice_payments?${query}`);
      const invoice = payments.data?.[0]?.invoice;
      if (typeof invoice === "string" && invoice) return invoice;
    }
  } catch { /* unresolved: answered below */ }
  return null;
}

/**
 * What the save offers' terms are worked out from: the subscription's currency, interval and billing
 * anchor, and the save coupon when one is configured (see app/save-offers.ts).
 *
 * Read fresh from Stripe at the moment the offer is made, because the coupon is edited in the
 * dashboard and a cached copy could quote yesterday's discount. Throws when the subscription cannot
 * be read; a coupon that cannot be read comes back null, which withdraws only the discount.
 */
export async function fetchSaveContext(subscriptionId: string): Promise<{ billing: SubscriptionBilling | null; coupon: CouponFacts | null }> {
  const couponId = runtime().STRIPE_SAVE_COUPON_ID;
  const [subscription, coupon] = await Promise.all([
    stripeGet<{
      currency?: string;
      billing_cycle_anchor?: number;
      items?: { data?: Array<{ price?: { recurring?: { interval?: string; interval_count?: number } | null } | null }> };
    }>(`subscriptions/${encodeURIComponent(subscriptionId)}`),
    couponId
      ? stripeGet<CouponFacts>(`coupons/${encodeURIComponent(couponId)}?expand[]=currency_options`).catch((error) => {
        console.warn("[billing] save coupon could not be read", error instanceof Error ? error.message : error);
        return null;
      })
      : Promise.resolve(null),
  ]);
  const recurring = subscription.items?.data?.[0]?.price?.recurring;
  const billing = subscription.currency && subscription.billing_cycle_anchor && recurring?.interval
    ? { currency: subscription.currency.toLowerCase(), interval: recurring.interval, intervalCount: recurring.interval_count || 1, anchor: new Date(subscription.billing_cycle_anchor * 1000) }
    : null;
  return { billing, coupon };
}

/**
 * Cancel a subscription at the end of the period already paid for.
 *
 * Distinct from `cancelSubscription`, which ends it immediately and is what account deletion needs.
 * Everything a customer initiates should use this one: they have paid for the period and the terms
 * say so.
 */
export async function cancelAtPeriodEnd(subscriptionId: string) {
  return stripeUpdate(`subscriptions/${encodeURIComponent(subscriptionId)}`, { cancel_at_period_end: "true" });
}
