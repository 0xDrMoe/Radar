/**
 * The terms of a save offer, worked out before it is shown so the screen can state them exactly.
 *
 * An offer that says "a discount" without saying how much or for how long, or "pause" without saying
 * when the next charge lands, asks somebody to agree to terms they cannot see. That is the kind of
 * thing ROSCA, California's auto-renewal law (AB 2863) and Quebec's consumer protection rules treat
 * as a dark pattern, and it is also simply a worse offer: nobody takes a discount they cannot size.
 *
 * Everything here is computed from what Stripe itself says about the coupon and the subscription, so
 * what the screen promises is what Stripe will do. When the facts needed to state an offer honestly
 * cannot be had, the offer is not made - `saveDiscountTerms` and `pauseTerms` return null and the
 * customer goes straight on to cancel.
 *
 * Deliberately free of any `cloudflare:workers` import, like app/entitlement.ts, so the test runner
 * can exercise it directly.
 */

/** The parts of a Stripe subscription the offer terms depend on. */
export interface SubscriptionBilling {
  /** Lowercase ISO currency of the subscription. */
  currency: string;
  /** The price's recurring interval: "month", "year", or something Radar does not sell. */
  interval: string;
  intervalCount: number;
  /** Stripe's billing_cycle_anchor: every renewal falls a whole number of intervals after it. */
  anchor: Date;
}

/** The parts of a Stripe coupon the offer terms depend on. */
export interface CouponFacts {
  valid?: boolean | null;
  percent_off?: number | null;
  amount_off?: number | null;
  currency?: string | null;
  currency_options?: Record<string, { amount_off?: number | null }> | null;
  duration?: string | null;
  duration_in_months?: number | null;
}

/**
 * What the discount is, in a shape the screen can phrase in any language.
 *
 * Exactly one of `percentOff` and `amountOff` is set. `amountOff` is in the currency's minor unit,
 * the way Stripe counts it. `months` is set only for a `repeating` coupon.
 */
export interface DiscountTerms {
  percentOff: number | null;
  amountOff: number | null;
  currency: string | null;
  duration: "once" | "repeating" | "forever";
  months: number | null;
}

/** One pause length and what it means for this subscription. */
export interface PauseTerms {
  months: number;
  /** When Pro switches back on and the pause ends (YYYY-MM-DD, UTC). */
  resumesOn: string;
  /** The first renewal Stripe will actually charge for (YYYY-MM-DD, UTC). */
  nextChargeOn: string;
}

/**
 * `date` plus whole calendar months, held to the last day of a shorter month.
 *
 * `Date#setMonth` overflows instead: January 31 plus one month is March 3. Stripe clamps (an anchor
 * on the 31st renews on February 28 and March 31), and a pause should end on the date the customer
 * was told, so this clamps the same way. Always counted from the original date, never chained, so a
 * clamp in February does not drag March back to the 28th.
 */
export function addMonths(date: Date, months: number) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** When a pause of `months` that starts at `now` ends. Calendar months, so the 14th returns on the 14th. */
export function pauseResumesAt(months: number, now: Date = new Date()) {
  return addMonths(now, months);
}

/** Interval length in months, or null for an interval Radar does not sell (day, week). */
function intervalMonths(billing: SubscriptionBilling) {
  const count = Math.max(1, Math.floor(billing.intervalCount || 1));
  if (billing.interval === "month") return count;
  if (billing.interval === "year") return count * 12;
  return null;
}

/**
 * The first renewal strictly after `after`.
 *
 * With `pause_collection[behavior]=void`, a renewal that falls inside the pause is still invoiced but
 * the invoice is voided, so the first charge is the first renewal after the pause ends - not the day
 * it ends. Somebody pausing for one month on their renewal day is charged two months later, and
 * the screen should say so rather than let them expect a charge that does not come.
 */
export function nextRenewalAfter(billing: SubscriptionBilling, after: Date) {
  const step = intervalMonths(billing);
  if (!step) return null;
  // Jump close first, then walk, so an anchor years in the past does not loop month by month.
  const elapsed = (after.getUTCFullYear() - billing.anchor.getUTCFullYear()) * 12 + (after.getUTCMonth() - billing.anchor.getUTCMonth());
  let k = Math.max(0, Math.floor(elapsed / step) - 1);
  let renewal = addMonths(billing.anchor, k * step);
  while (renewal.getTime() <= after.getTime()) {
    k += 1;
    renewal = addMonths(billing.anchor, k * step);
  }
  return renewal;
}

const day = (date: Date) => date.toISOString().slice(0, 10);

/**
 * The pause lengths to offer, each with the date Pro comes back and the date billing restarts.
 *
 * Monthly subscriptions only. A yearly subscriber has already paid for the months a pause would
 * switch off, so a pause takes away time they bought; and a yearly renewal that happened to fall
 * inside the pause would be voided, giving a whole year away. Neither is an offer worth making.
 */
export function pauseTerms(billing: SubscriptionBilling | null, lengths: readonly number[], now: Date = new Date()): PauseTerms[] | null {
  if (!billing || billing.interval !== "month") return null;
  const terms: PauseTerms[] = [];
  for (const months of lengths) {
    const resumesAt = pauseResumesAt(months, now);
    const nextCharge = nextRenewalAfter(billing, resumesAt);
    if (!nextCharge) return null;
    terms.push({ months, resumesOn: day(resumesAt), nextChargeOn: day(nextCharge) });
  }
  return terms.length ? terms : null;
}

/**
 * The discount's terms for this subscription, or null when it cannot be stated or would do nothing.
 *
 *   - An invalid coupon (expired, redeemed out) would be refused by Stripe when applied.
 *   - A fixed-amount coupon has to have an amount in the subscription's currency; Stripe refuses one
 *     that does not, and quoting it in another currency would misstate it.
 *   - A `repeating` coupon on a subscription that does not renew inside its window discounts
 *     nothing - three months off a yearly plan renewing in eight. Offering it would be a save offer
 *     that visibly does nothing.
 */
export function saveDiscountTerms(coupon: CouponFacts | null, billing: SubscriptionBilling | null, now: Date = new Date()): DiscountTerms | null {
  if (!coupon || !billing || coupon.valid === false) return null;
  const duration = coupon.duration;
  if (duration !== "once" && duration !== "repeating" && duration !== "forever") return null;

  let percentOff: number | null = null, amountOff: number | null = null, currency: string | null = null;
  if (typeof coupon.percent_off === "number" && coupon.percent_off > 0) {
    if (coupon.percent_off >= 100) return null;
    percentOff = coupon.percent_off;
  } else if (typeof coupon.amount_off === "number" && coupon.amount_off > 0) {
    currency = billing.currency.toLowerCase();
    if (coupon.currency?.toLowerCase() === currency) amountOff = coupon.amount_off;
    else {
      const option = Object.entries(coupon.currency_options || {}).find(([code]) => code.toLowerCase() === currency)?.[1];
      if (typeof option?.amount_off === "number" && option.amount_off > 0) amountOff = option.amount_off;
    }
    if (amountOff === null) return null;
  } else return null;

  let months: number | null = null;
  if (duration === "repeating") {
    months = Math.floor(coupon.duration_in_months || 0);
    if (months < 1) return null;
    const nextRenewal = nextRenewalAfter(billing, now);
    if (!nextRenewal || nextRenewal.getTime() > addMonths(now, months).getTime()) return null;
  }
  return { percentOff, amountOff, currency, duration, months };
}
