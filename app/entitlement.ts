/**
 * One answer to "is this account on Pro", for everything that needs to ask.
 *
 * The expression `plan === "pro" && (status === "active" || status === "trialing")` was written out
 * by hand in eight places - the session, the home page, the dashboard, the Apple reconciler, and
 * three screens in the phone app. Eight copies of an entitlement rule is eight chances for them to
 * disagree, and a disagreement here is either a paying customer locked out of what they bought or a
 * lapsed one still getting it. The rule lives here now; `mobile/lib/entitlement.ts` is the phone's
 * copy, kept identical and checked against this file by tests/entitlement.test.mjs.
 *
 * Deliberately free of any `cloudflare:workers` import: client components and the test runner both
 * need it, and neither can reach into a Worker-bound module.
 */

/** Statuses where Stripe says the subscription is current. */
export const ENTITLED_STATUSES = ["active", "trialing"] as const;

/**
 * A failed renewal is not instantly the end of a subscription, but it is close to it.
 *
 * When a card declines, Stripe moves the subscription to `past_due` and retries. Radar used to drop
 * `plan` to `free` the moment that status arrived, which took Pro away from somebody who was still
 * a paying customer and whose card would very likely clear on the next attempt - with no warning,
 * because nothing else in the product mentioned billing state.
 *
 * The other extreme is worse for a business: Stripe's default retry schedule runs four attempts over
 * about three weeks, and honoring all of it would hand out three weeks of unpaid access every time
 * a card expired. So the window is deliberately short - one attempt a day for three days, then the
 * subscription is canceled.
 *
 * Both halves have to agree for that to hold. Stripe's own retry schedule is a dashboard setting
 * (Billing > Subscriptions and emails > Manage failed payments), and `app/api/jobs/billing` cancels
 * anything still `past_due` past the window regardless of what that setting says - so a dashboard
 * left on the default cannot quietly reopen the three weeks.
 */
export const GRACE_STATUSES = ["past_due"] as const;

/** How long a declined renewal keeps Pro before the subscription is canceled. */
export const GRACE_DAYS = 3;

/**
 * How long a subscription may be paused for, in months.
 *
 * Pausing is the single most effective alternative to canceling: people who pause come back, and
 * people who cancel mostly do not. Capped rather than open-ended because an indefinite pause is a
 * cancellation that never gets counted as one, and because Stripe needs a date to resume on.
 */
export const PAUSE_MONTHS = [1, 2, 3] as const;

/**
 * How long a new subscriber's free trial runs, when trials are switched on at all.
 *
 * Nobody is charged during it and `trialing` is an entitled status, so a trial is real Pro. Short
 * on purpose: long enough to see whether the catalog covers where somebody eats, not long enough
 * to be a chunk of the product for nothing.
 *
 * One per account, enforced by `users.trial_used` - Stripe will happily grant a fresh trial on
 * every new subscription for the same customer, so canceling and resubscribing would otherwise
 * farm an unlimited run of free days.
 *
 * Whether trials run at all is an operator switch rather than a constant: see `trials_enabled` in
 * app/settings.ts. This is only how long one lasts once it is on.
 */
export const TRIAL_DAYS = 3;

export type PlanShape = {
  plan?: string | null;
  planStatus?: string | null;
  pastDueSince?: string | null;
  pausedUntil?: string | null;
};

/** SQLite writes "YYYY-MM-DD HH:MM:SS" with no zone; it is UTC, and Date needs telling so. */
function parseStamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(parsed) ? null : parsed;
}

function withinGrace(pastDueSince: string | null | undefined, now: Date) {
  const started = parseStamp(pastDueSince);
  // No stamp, or an unreadable one, means the grace period never properly started - only reachable
  // for a row written before the column existed. Guessing in the customer's favor costs one short
  // window; guessing the other way locks a paying customer out.
  if (started === null) return true;
  return now.getTime() - started < GRACE_DAYS * 86_400_000;
}

/**
 * Whether a paused subscription is still inside its pause.
 *
 * Exported because both the entitlement check and the screens that offer to resume need it, and
 * because "paused" has to mean the same thing in both places.
 */
export function isPaused(pausedUntil: string | null | undefined, now: Date = new Date()) {
  const until = parseStamp(pausedUntil);
  if (until === null) return false;
  return now.getTime() < until;
}

/**
 * Whether the account may use Pro features right now.
 *
 * `now` is injectable so the grace and pause boundaries can be tested without waiting for them.
 */
export function isProPlan(
  plan: string | null | undefined,
  status: string | null | undefined,
  pastDueSince?: string | null,
  now: Date = new Date(),
  pausedUntil?: string | null,
) {
  if (plan !== "pro") return false;
  // Checked before the status, and it wins. Stripe keeps a paused subscription `active` - pausing
  // stops the invoices, not the subscription - so reading the status alone would hand out Pro to
  // somebody who has explicitly stopped paying for it.
  if (isPaused(pausedUntil, now)) return false;
  if ((ENTITLED_STATUSES as readonly string[]).includes(status || "")) return true;
  if ((GRACE_STATUSES as readonly string[]).includes(status || "")) return withinGrace(pastDueSince, now);
  return false;
}

/**
 * The staff roles that get every Pro feature without a subscription: every role that works in the
 * staff workspace (docs/ROLES.md), and `custom`, which is always a staff member's own set. Not
 * creator, restaurant or user. Kept here as a plain list rather than imported from
 * app/permissions.ts so this module stays import-free; tests/entitlement.test.mjs checks it
 * against ALL_ROLES and against the phone's copy.
 *
 * This is access, not a plan. Nothing is written to users.plan, no plan_grants row is made, and
 * Stripe never hears of it, so the Growth tab's subscriber counts, affiliate conversions and the
 * billing screens all go on reading the real plan. Somebody who leaves staff simply stops having it.
 */
export const STAFF_PRO_ROLES = ["owner", "admin", "supervisor", "finance_manager", "developer", "deal_editor", "moderator", "marketing", "analyst", "custom"] as const;

export function isStaffProRole(role: string | null | undefined) {
  return (STAFF_PRO_ROLES as readonly string[]).includes(role || "");
}

/**
 * Whether the account may use Pro features: a Pro plan (isProPlan), or a staff role. What every
 * feature gate asks. The billing screens and the paywall ask isProPlan instead, because they are
 * about what somebody pays for, and a member of staff may still need to test buying it.
 */
export function hasProAccess(
  plan: string | null | undefined,
  status: string | null | undefined,
  pastDueSince?: string | null,
  now: Date = new Date(),
  pausedUntil?: string | null,
  role?: string | null,
) {
  return isStaffProRole(role) || isProPlan(plan, status, pastDueSince, now, pausedUntil);
}

/** The same question asked of a session/profile object rather than loose columns. */
export function isPro(subject: PlanShape | null | undefined, now: Date = new Date()) {
  return isProPlan(subject?.plan, subject?.planStatus, subject?.pastDueSince, now, subject?.pausedUntil);
}

/**
 * Whether the account is on Pro but behind on payment.
 *
 * Distinct from `isPro` on purpose: both are true at once, and that is the whole point. The product
 * keeps working while the banner asks them to fix the card. Callers that want to nag use this;
 * callers that gate a feature use `isProPlan`.
 */
export function isPaymentFailing(status: string | null | undefined) {
  return (GRACE_STATUSES as readonly string[]).includes(status || "");
}

/** Days left before a declined renewal cancels the subscription. Never negative. */
export function graceDaysLeft(pastDueSince: string | null | undefined, now: Date = new Date()) {
  const started = parseStamp(pastDueSince);
  if (started === null) return GRACE_DAYS;
  const elapsed = (now.getTime() - started) / 86_400_000;
  return Math.max(0, Math.ceil(GRACE_DAYS - elapsed));
}

/**
 * What `users.plan` should become for a given Stripe subscription status.
 *
 * Every status Stripe can send, decided once:
 *
 *   active, trialing        the subscription is current
 *   past_due                a renewal failed and Stripe is retrying - keep Pro for GRACE_DAYS
 *   unpaid                  Stripe has given up retrying
 *   canceled                over, whether by the customer or by exhausted retries
 *   incomplete              the first payment never completed; they never had it
 *   incomplete_expired      the same, and Stripe has stopped waiting
 *   paused                  a paused subscription bills nothing, so it grants nothing
 *
 * An unrecognised status falls through to `free`. A status Stripe invents later should cost access
 * rather than grant it, and the admin workspace shows `plan_status` verbatim so it will be visible.
 *
 * Note this says nothing about `pause_collection`, which leaves the status `active`. A pause is
 * carried by `users.paused_until` and applied in `isProPlan`, not here - the plan column stays
 * `pro` through a pause, because the subscription really is still theirs.
 */
export function planForStatus(status: string | null | undefined): "pro" | "free" {
  if ((ENTITLED_STATUSES as readonly string[]).includes(status || "")) return "pro";
  if ((GRACE_STATUSES as readonly string[]).includes(status || "")) return "pro";
  return "free";
}

/**
 * The offer worth making to somebody who gave this reason for canceling.
 *
 * Reason-matched rather than one blanket discount, because the answers mean different things and a
 * discount aimed at the wrong one is money given away for nothing. Somebody who is not using Radar
 * this month does not want it cheaper, they want to stop paying for a while; somebody who finds it
 * expensive is not helped by being told they can pause.
 *
 *   price      a discount, when one is configured. The only reason where money is the objection.
 *   temporary  a pause, which is exactly what they asked for in different words.
 *   unused     a pause. Cheaper for them than canceling and easier to come back from.
 *   deals      a pause, plus the fact that area alerts keep working on the free plan - the
 *              complaint is coverage, and coverage improves without them paying to wait.
 *   missing    nothing to offer. What was missing is the survey's free-text answer, already
 *              recorded with the reason; they go straight on to cancel. (This was a "feedback"
 *              screen whose button sent the note and closed the flow without ever reaching the
 *              portal, so somebody told "this will not stop your cancellation" was left subscribed.)
 *   other      nothing to guess at.
 *
 * `pauseAvailable` is false when a pause cannot be offered honestly - a yearly subscription, whose
 * paid months a pause would switch off (see `pauseTerms` in app/save-offers.ts). Those reasons then
 * get nothing, and "price" without a discount gets nothing either.
 *
 * Returns the offer key, or null to send them straight to the billing portal. Never invents an
 * offer for a reason it does not recognize.
 */
export function offerForReason(reason: string, discountAvailable: boolean, pauseAvailable = true): "discount" | "pause" | null {
  const pause = pauseAvailable ? "pause" : null;
  if (reason === "price") return discountAvailable ? "discount" : pause;
  if (reason === "temporary" || reason === "unused" || reason === "deals") return pause;
  return null;
}
