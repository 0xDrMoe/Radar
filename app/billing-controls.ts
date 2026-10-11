import type { Billing } from "./plan-resolution";

/**
 * Which billing controls the website's account screen offers.
 *
 * Decided by what bills the account, as the app's Pro screen decides it (mobile/app/pro.tsx), and
 * not by whether the account is on Pro. Every control here goes to Stripe, and Stripe knows only
 * the subscriptions bought on the website. Shown to anybody else, "Manage billing" answered "You
 * do not have a billing account yet", and "Cancel subscription" ran a cancellation survey for a
 * subscription that did not exist. That was every App Store subscriber, and every comp.
 *
 *   - Stripe's controls (manage, and cancel with its survey and save offers) need a web
 *     subscription that is not over. That is asked of the subscription itself rather than of
 *     `billing`, which says who is paying right now. A paused subscription pays nothing and is
 *     still there to resume, and somebody paying twice is billed to Apple first and still needs a
 *     way to cancel the web one.
 *   - An App Store subscription is managed in the App Store, and the screen says so.
 *   - A comp has nothing to manage. The account is on Radar Pro, and that is all there is to say.
 *   - Nobody on Pro is sold Pro, and neither is somebody paused, who already has a subscription:
 *     checkout would start a second one beside it.
 *
 * Free of imports that run, like app/entitlement.ts, so the client component and the tests can
 * both load it.
 */
export function billingControls({ pro, paused, billing, webSubscription }: {
  /** isProPlan, as the page computes it. */
  pro: boolean;
  /** isPaused: a Stripe pause is running. */
  paused: boolean;
  /** Who is paying for Pro right now (billingFor, via /api/user). */
  billing: Billing | undefined;
  /** A Stripe subscription that is not over (stripeOwnsStatus, via /api/user). */
  webSubscription: boolean | undefined;
}) {
  const web = Boolean(webSubscription);
  return {
    manage: pro && web,
    cancel: pro && web && !paused,
    appStore: pro && billing === "apple",
    upgrade: !pro && !paused,
  };
}
