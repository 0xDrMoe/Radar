import { env } from "cloudflare:workers";
import { getAppUser } from "../../../auth";
import { apiError, readJson, requireSameOrigin } from "../../../api-utils";
import { createCheckoutSession, findOrCreateCustomer, priceIdForPlan, stripeConfigured } from "../../../stripe";
import { isBillingPlan } from "../../../billing-plans";
import { TRIAL_DAYS } from "../../../entitlement";
import { readSetting } from "../../../settings";
import { emailLocale } from "../../../billing-emails";

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401,"AUTH_REQUIRED","Sign in required.");
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!stripeConfigured()) return apiError(503,"BILLING_UNAVAILABLE","Billing is not available right now.");
  // An absent or unparseable body means the monthly plan, so a client that predates the picker
  // and sends nothing keeps working rather than erroring.
  const body = await readJson<{ plan?: unknown; source?: unknown; locale?: unknown }>(request).catch(() => ({} as { plan?: unknown; source?: unknown; locale?: unknown }));
  // Anything the browser sends that is not one of the two known keys falls back to monthly. The
  // key is never used to build the Stripe request directly — priceIdForPlan owns that mapping, so
  // a caller cannot name a price of its own choosing. See app/stripe.ts.
  const plan = isBillingPlan(body.plan) ? body.plan : "monthly";
  const priceId = priceIdForPlan(plan);
  // Where the reader came from, for counting what the iOS app's US link-out brings in. One known
  // value or nothing: a free-text field from the browser does not belong in Stripe's metadata.
  const source = body.source === "ios_app" ? "ios_app" : null;
  if (!priceId) return apiError(400,"PLAN_UNAVAILABLE","That billing period is not available.");
  // The page's language, else the language cookie, else English. Only ever one of Radar's three
  // locales: emailLocale maps anything else to "en", so the browser cannot put free text into Stripe.
  const locale = emailLocale(body.locale ?? /(?:^|;\s*)NEXT_LOCALE=([a-z]{2})/.exec(request.headers.get("cookie") || "")?.[1]);
  const runtime = env as unknown as Record<string,string>,origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
  const existing = await env.DB.prepare("SELECT stripe_customer_id,trial_used FROM users WHERE id=?").bind(user.userId).first<{stripe_customer_id:string|null;trial_used:number}>();
  let customerId = existing?.stripe_customer_id || null;
  if (!customerId) {
    try { customerId = await findOrCreateCustomer(user.userId,user.email); }
    catch { return apiError(502,"STRIPE_ERROR","Billing is temporarily unavailable."); }
    await env.DB.prepare("UPDATE users SET stripe_customer_id=? WHERE id=?").bind(customerId,user.userId).run();
  }
  // Three gates, and all three have to agree.
  //
  //   the switch      trials are off unless an operator has turned them on for something
  //   TRIAL_DAYS      a zero-day trial is not a trial
  //   trial_used      one per account, ever
  //
  // None of them is the request body. Stripe grants a fresh trial on every new subscription for the
  // same customer, so a trial the browser could ask for is an unlimited run of free days for anyone
  // who cancels and resubscribes.
  //
  // Marked used when the session is created rather than when the trial starts. Somebody who opens
  // checkout, is offered the trial, and abandons has still seen the offer; the alternative is a
  // webhook round trip that can be avoided by never opening checkout at all. Erring toward
  // not-offered costs one trial and cannot be farmed.
  const withTrial = TRIAL_DAYS > 0 && !existing?.trial_used && await readSetting("trials_enabled");
  try {
    const url = await createCheckoutSession(customerId,user.userId,priceId,`${origin}/dashboard/billing?upgraded=1`,`${origin}/dashboard/billing`,withTrial,source,locale);
    if (withTrial) await env.DB.prepare("UPDATE users SET trial_used=1 WHERE id=?").bind(user.userId).run();
    return Response.json({ url, trialDays: withTrial ? TRIAL_DAYS : 0 });
  } catch { return apiError(502,"STRIPE_ERROR","Checkout could not be started."); }
}
