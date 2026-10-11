import { ENTITLED_STATUSES, isProPlan, planForStatus } from "./entitlement";

// Who is paying for Radar Pro, and so what an account's plan is.
//
// Pro can be paid for in two places — a Stripe subscription bought on the website, and an App
// Store subscription bought in the app — and an admin can grant it with neither. users.plan has to
// say "pro" while any one of those holds, and "free" only once none does. That is one OR, and the
// OR is the easy part. What makes this a module is users.plan_status, one column doing two jobs:
//
//   - It is Stripe's word for the web subscription (active, past_due, canceled...), written by the
//     webhook; the grace period and the billing screens read it as exactly that.
//   - It is also what every reader of "is this account Pro" checks beside the plan — the session,
//     the phone, the admin counts — so an account paid for by Apple, or granted Pro by an admin,
//     has to say "active" there too, or it is Pro on paper and nowhere else. Grants were exactly
//     that until they came through here: plan='pro' beside the "inactive" every free account starts
//     with, recorded in plan_grants and granting nothing.
//
// The bugs this replaces came from the two jobs colliding. The Apple path wrote "active" into the
// column, and the next time the plan was recomputed it read that same "active" back as a live web
// subscription — so an App Store subscription that expired never took Pro away. And the webhook
// went the other way: a web cancellation wrote plan='free' outright, taking Pro from somebody who
// was still paying Apple.
//
// So the column has one owner at a time:
//
//   - While the account has a Stripe subscription that is not finished, the column is Stripe's.
//     Nothing else writes it, and "is Stripe paying" is read from it.
//   - Otherwise it belongs to whichever other source entitles the account: an App Store
//     subscription or an admin grant. A finished Stripe subscription's id is forgotten, so there is
//     never a stale id lying around to make an "active" written for Apple or a grant look like
//     Stripe's, and a webhook about that subscription finds nothing of its own to write over.
//
// One case is left imperfect on purpose: a live but unpaid web subscription (paused, or past its
// grace) beside an active App Store subscription or a grant. The column stays Stripe's, so readers
// see the unpaid status for as long as Stripe has something to say. It resolves itself — the grace
// job or Stripe finishes an unpaid subscription within days, a pause ends on its own date, and the
// next resolution hands the column over — and the alternative, writing over Stripe's word while it
// still means something, is the bug above.

/** Stripe's statuses for a subscription that is over and will not come back. */
const FINISHED = new Set(["canceled", "incomplete_expired"]);

export type StripeState = {
  subscriptionId: string | null;
  status: string | null;
  pastDueSince: string | null;
  pausedUntil: string | null;
};

export type Billing = "apple" | "stripe" | null;

export type PlanDecision = {
  plan: "pro" | "free";
  /** A new plan_status to write, or null to leave the column as it is. */
  status: string | null;
  /** The stored Stripe subscription is finished, and its id should be cleared. */
  forgetSubscription: boolean;
  /** Who is paying for Pro right now — what the app's subscription screen offers to manage. */
  billing: Billing;
};

/** Whether plan_status is Stripe's to write: there is a subscription, and it is not over. */
export function stripeOwnsStatus(stripe: StripeState): boolean {
  return Boolean(stripe.subscriptionId) && !FINISHED.has(stripe.status || "");
}

/**
 * SQL for "somebody pays for this account's Pro", beside the plan and status a count already asks
 * for. For the numbers that mean money rather than access: the Growth tab's paying subscribers,
 * and the conversions an affiliate or a creator is shown.
 *
 * plan='pro' with an entitled status is what every access check reads, and a grant writes that
 * too, so on its own it counts comped accounts as customers. This adds who is paying:
 *
 *   - A Stripe subscription id. decidePlan forgets the id once the subscription is finished, so an
 *     id beside 'active' or 'trialing' is always Stripe's own word, never an "active" written for
 *     Apple or a grant.
 *   - Or a live App Store subscription bought in Production. A sandbox purchase opens Pro, because
 *     App Review and TestFlight testers buy there (planInputs, app/apple-entitlement.ts), but
 *     nobody paid for it.
 *
 * Written against the users table by its own name, as publicDealPredicate is written against `d`.
 */
export const paidForPredicate =
  "(users.stripe_subscription_id IS NOT NULL OR EXISTS (SELECT 1 FROM apple_subscriptions paid WHERE paid.user_id=users.id AND paid.status IN ('active','grace_period') AND paid.environment='Production'))";

export function decidePlan({
  stripe,
  apple,
  granted,
  now = new Date(),
}: {
  stripe: StripeState;
  /** The account's active, or in-grace, Production App Store subscription — if it has one. */
  apple: { status: string } | null;
  /** An admin grant that has been neither revoked nor let expire. */
  granted: boolean;
  now?: Date;
}): PlanDecision {
  const owned = stripeOwnsStatus(stripe);
  const stripeActive = owned && isProPlan("pro", stripe.status, stripe.pastDueSince, now, stripe.pausedUntil);
  // A grant entitles exactly as a subscription does. It just bills nobody.
  const entitled = stripeActive || Boolean(apple) || granted;
  const forgetSubscription = Boolean(stripe.subscriptionId) && !owned;
  // Apple first when both are paying: the app can open Apple's own page for managing that one, and
  // somebody paying twice is best told about the subscription they can cancel from their phone.
  const billing: Billing = apple ? "apple" : stripeActive ? "stripe" : null;

  if (entitled) {
    return { plan: "pro", status: owned ? null : "active", forgetSubscription, billing };
  }

  // Nothing entitles the account. A live web subscription still sets the plan the way the webhook
  // always has, so a web customer sees no difference at all; with none, the plan is free.
  const plan = owned ? planForStatus(stripe.status) : "free";
  // An "active" left behind by an App Store subscription or a grant that has since ended is nobody's
  // word any more, and it is no longer true.
  const leftover = !owned && (ENTITLED_STATUSES as readonly string[]).includes(stripe.status || "");
  return { plan, status: leftover ? "inactive" : null, forgetSubscription, billing: null };
}
