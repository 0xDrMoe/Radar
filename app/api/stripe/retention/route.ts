import { env } from "cloudflare:workers";
import { getAppUser } from "../../../auth";
import { apiError, cleanText, readJson, requireSameOrigin } from "../../../api-utils";
import { PAUSE_MONTHS, offerForReason } from "../../../entitlement";
import { stripeOwnsStatus } from "../../../plan-resolution";
import { pauseResumesAt, pauseTerms, saveDiscountTerms } from "../../../save-offers";
import { applySaveCoupon, createCancelPortalSession, createPortalSession, fetchSaveContext, pauseSubscription, resumeSubscription, saveCouponConfigured, stripeConfigured } from "../../../stripe";

/**
 * The cancellation flow, between the survey answer and Stripe's billing portal.
 *
 * Three steps, each its own request, because they are three different decisions:
 *
 *   survey   they said why they are leaving. Records it, and answers with the offer that fits.
 *   accept   they took the offer. Applies it and they stay.
 *   decline  they did not. Hands back the portal URL and gets out of the way.
 *
 * The offer is chosen server-side from the reason - see `offerForReason` - so the browser cannot ask
 * for a discount by claiming a reason it did not give, and so the mapping lives in one place next to
 * the explanation of why each reason gets what it gets.
 *
 * Every offer goes out with its terms: how much the discount is and how long it lasts, or for each
 * pause length the day Pro comes back and the day the next charge lands (app/save-offers.ts). Those
 * are read from Stripe when the offer is made, and an offer whose terms cannot be stated is not made.
 *
 * `decline` always works and always returns a portal link. A retention flow that can trap somebody
 * is worse than no retention flow: it converts a cancellation into a chargeback and a review.
 */

const CANCEL_REASONS = new Set(["price", "deals", "unused", "missing", "temporary", "other"]);

interface RetentionBody {
  step?: unknown;
  reason?: unknown;
  detail?: unknown;
  offer?: unknown;
  months?: unknown;
}

function returnUrl() {
  const runtime = env as unknown as Record<string, string>;
  return `${runtime.PUBLIC_APP_URL || "https://radar.cheap"}/dashboard/billing`;
}

async function portalUrl(customerId: string) {
  return createPortalSession(customerId, returnUrl());
}

/** Straight to Stripe's cancellation confirmation for this subscription (createCancelPortalSession). */
async function cancelUrl(customerId: string, subscriptionId: string | null) {
  return createCancelPortalSession(customerId, subscriptionId, returnUrl());
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  if (!stripeConfigured()) return apiError(503, "BILLING_UNAVAILABLE", "Billing is not available right now.");

  let body: RetentionBody;
  try { body = await readJson<RetentionBody>(request, 2_000); }
  catch { return apiError(400, "INVALID_REQUEST", "That request could not be read."); }

  const account = await env.DB.prepare(
    "SELECT stripe_customer_id,stripe_subscription_id,plan_status,paused_until FROM users WHERE id=?",
  ).bind(user.userId).first<{ stripe_customer_id: string | null; stripe_subscription_id: string | null; plan_status: string; paused_until: string | null }>();
  if (!account?.stripe_customer_id) return apiError(404, "NO_SUBSCRIPTION", "You do not have a billing account yet.");

  const step = cleanText(body.step, 12);

  // ── Resume, which is the same flow run backwards ────────────────────────────────────────────
  if (step === "resume") {
    if (!account.stripe_subscription_id || !account.paused_until) return apiError(409, "NOT_PAUSED", "That subscription is not paused.");
    try { await resumeSubscription(account.stripe_subscription_id); }
    catch { return apiError(502, "STRIPE_ERROR", "The subscription could not be resumed."); }
    // Cleared here rather than waiting for the webhook, so the page they are looking at is right by
    // the time it reloads. The webhook writes the same value again a moment later.
    await env.DB.prepare("UPDATE users SET paused_until=NULL WHERE id=?").bind(user.userId).run();
    await env.DB.prepare("INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'subscription_resumed',?)")
      .bind(crypto.randomUUID(), user.userId, JSON.stringify({ cause: "customer" })).run();
    return Response.json({ ok: true, resumed: true });
  }

  // ── Step one: they said why ─────────────────────────────────────────────────────────────────
  if (step === "survey") {
    // Only a subscription that exists can be canceled, so only one can have a reason recorded
    // against it. A Stripe customer id alone is not one: a comp or an App Store subscriber can
    // carry one from a web subscription that ended long ago, and their answer would sit among the
    // Growth tab's reasons as a cancellation that never happened.
    if (!stripeOwnsStatus({ subscriptionId: account.stripe_subscription_id, status: account.plan_status, pastDueSince: null, pausedUntil: account.paused_until }))
      return apiError(409, "NO_SUBSCRIPTION", "There is no subscription to cancel.");
    const reason = cleanText(body.reason, 20).toLowerCase();
    if (!CANCEL_REASONS.has(reason)) return apiError(422, "INVALID_REASON", "Pick one of the listed reasons.");
    const detail = cleanText(body.detail, 500) || null;
    // plan_status is stamped so a reason given while a payment was already failing can be told apart
    // from one given by a customer in good standing. They mean different things: the first is often
    // a billing problem wearing a cancellation's clothes.
    await env.DB.prepare("INSERT INTO cancellation_reasons(user_id,reason,detail,plan_status) VALUES(?,?,?,?)")
      .bind(user.userId, reason, detail, account.plan_status).run();

    // A subscription already paused cannot be offered a pause, and one with a discount on it should
    // not be offered another. Both would be an offer that visibly does nothing.
    //
    // The discount is once per account, ever. It used to be offered again on every pass through
    // this form, and reapplying a `once` or `repeating` coupon after it runs out starts it over, so
    // answering "price" each time it lapsed kept the discount going forever. Someone who has taken
    // it is offered the pause instead, which is what "price" gets when no coupon is configured.
    const alreadyPaused = Boolean(account.paused_until);
    const discountTaken = Boolean(await env.DB.prepare(
      "SELECT 1 FROM save_offers WHERE user_id=? AND offer='discount' AND accepted=1 LIMIT 1",
    ).bind(user.userId).first());

    // The terms come from Stripe. If Stripe cannot be reached there are no terms to state, so no
    // offer is made and they go straight on to cancel - never an offer with the numbers left out.
    let discount = null, pauses = null;
    if (!alreadyPaused && offerForReason(reason, true)) {
      try {
        const context = await fetchSaveContext(account.stripe_subscription_id!);
        discount = saveCouponConfigured() && !discountTaken ? saveDiscountTerms(context.coupon, context.billing) : null;
        pauses = pauseTerms(context.billing, PAUSE_MONTHS);
      } catch (error) {
        console.warn("[billing] save offer terms unavailable", error instanceof Error ? error.message : error);
      }
    }
    const offer = alreadyPaused ? null : offerForReason(reason, Boolean(discount), Boolean(pauses));
    if (offer)
      await env.DB.prepare("INSERT INTO save_offers(user_id,reason,offer) VALUES(?,?,?)")
        .bind(user.userId, reason, offer).run();
    return Response.json({
      offer,
      pauseMonths: PAUSE_MONTHS,
      pauses: offer === "pause" ? pauses : null,
      discount: offer === "discount" ? discount : null,
      reason,
    });
  }

  // ── Step two: they took it ──────────────────────────────────────────────────────────────────
  if (step === "accept") {
    const offer = cleanText(body.offer, 16);
    if (!account.stripe_subscription_id) return apiError(409, "NO_SUBSCRIPTION", "There is no subscription to change.");

    // An offer can only be taken if it was made. The survey step decides which offer somebody
    // gets and writes the row; this reads that row back rather than believing the request.
    //
    // Without it the browser picks its own offer: a POST of {step:"accept", offer:"discount"},
    // with no survey answered and nothing on screen, applies the save coupon to any live
    // subscription. The reason the survey chooses server-side is exactly this, and that choice is
    // worth nothing if the next request can overrule it.
    //
    // Newest unaccepted row, matching the offer, which is the same row markAccepted then closes.
    const open = await env.DB.prepare(
      "SELECT id FROM save_offers WHERE user_id=? AND offer=? AND accepted=0 ORDER BY created_at DESC LIMIT 1",
    ).bind(user.userId, offer).first<{ id: number }>();
    if (!open) return apiError(409, "OFFER_NOT_OPEN", "That offer is not available. Start again from the cancellation form.");

    if (offer === "pause") {
      const months = Number(body.months);
      if (!(PAUSE_MONTHS as readonly number[]).includes(months)) return apiError(422, "INVALID_PAUSE", "Pick a pause length.");
      // Calendar months rather than 30-day blocks, so the 14th comes back on the 14th - and the same
      // function the survey used to quote the date, so the pause ends on the day it said it would.
      const resumesAt = pauseResumesAt(months);
      try { await pauseSubscription(account.stripe_subscription_id, resumesAt); }
      catch { return apiError(502, "STRIPE_ERROR", "The subscription could not be paused."); }
      const pausedUntil = resumesAt.toISOString().slice(0, 19).replace("T", " ");
      await env.DB.prepare("UPDATE users SET paused_until=? WHERE id=?").bind(pausedUntil, user.userId).run();
      await markAccepted(user.userId, "pause");
      await env.DB.prepare("INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'subscription_paused',?)")
        .bind(crypto.randomUUID(), user.userId, JSON.stringify({ months, resumesAt: pausedUntil })).run();
      return Response.json({ ok: true, pausedUntil });
    }

    if (offer === "discount") {
      let applied = false;
      try { applied = await applySaveCoupon(account.stripe_subscription_id); }
      catch { return apiError(502, "STRIPE_ERROR", "The discount could not be applied."); }
      if (!applied) return apiError(409, "NO_DISCOUNT", "No discount is available right now.");
      await markAccepted(user.userId, "discount");
      await env.DB.prepare("INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'save_offer_accepted',?)")
        .bind(crypto.randomUUID(), user.userId, JSON.stringify({ offer: "discount" })).run();
      return Response.json({ ok: true, discounted: true });
    }

    // "feedback" is accepted by being told, so there is nothing to apply to the subscription. The
    // note went into cancellation_reasons.detail at the survey step and reaches the team from there.
    // No longer offered (offerForReason): what was missing is recorded with the survey answer. A
    // page loaded before that change can still send it, and must still reach the cancellation it
    // was promised ("This will not stop your cancellation"), so it is answered like a decline. Not
    // marked accepted: a note on the way out is not a save.
    if (offer === "feedback") {
      try { return Response.json({ ok: true, url: await cancelUrl(account.stripe_customer_id, account.stripe_subscription_id) }); }
      catch { return apiError(502, "STRIPE_ERROR", "The billing portal could not be opened."); }
    }
    return apiError(422, "INVALID_OFFER", "Unknown offer.");
  }

  // ── Step three: they did not, or never had one ──────────────────────────────────────────────
  // `decline` is somebody leaving: the portal opens on the cancellation itself. `portal` is the
  // portal's home screen.
  if (step === "decline" || step === "portal") {
    try { return Response.json({ url: step === "decline" ? await cancelUrl(account.stripe_customer_id, account.stripe_subscription_id) : await portalUrl(account.stripe_customer_id) }); }
    catch { return apiError(502, "STRIPE_ERROR", "The billing portal could not be opened."); }
  }

  return apiError(422, "INVALID_STEP", "Unknown step.");
}

/**
 * Mark the most recent offer of this kind as taken.
 *
 * Scoped to the newest unaccepted row so a customer who has been through this before does not have
 * an old declined offer retroactively counted as a save. The save rate is the whole reason the
 * table exists, and it is only worth reading if it cannot be inflated.
 */
async function markAccepted(userId: string, offer: string) {
  await env.DB.prepare(
    `UPDATE save_offers SET accepted=1
      WHERE id=(SELECT id FROM save_offers WHERE user_id=? AND offer=? AND accepted=0 ORDER BY created_at DESC LIMIT 1)`,
  ).bind(userId, offer).run();
}
