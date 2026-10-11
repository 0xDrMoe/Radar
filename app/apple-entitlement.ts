import { env } from "cloudflare:workers";
import { decidePlan, type Billing } from "./plan-resolution";
import { appAccountTokenFor, subscriptionStatus, type AppleSubscription } from "./appstore";

// Turning what Apple says into what Radar grants.
//
// Written once and called from both the purchase endpoint and the notification endpoint, because
// they are the same operation reached two ways: ask Apple, write down the answer, resolve the
// entitlement. A renewal three months from now arrives only as a notification, so if the two
// disagreed the difference would show up as an account that silently stopped being Pro.

/** Apple's numeric status, in words, for the row and for anything reading it later. */
const STATUS_NAMES: Record<number, string> = {
  1: "active",
  2: "expired",
  3: "billing_retry",
  4: "grace_period",
  5: "revoked",
};

/**
 * Records a subscription against a user and sets their plan to match.
 *
 * `userId` is required the first time — a purchase, where the signed-in person is making the
 * claim. Afterwards the row remembers who it belongs to, which is what lets a renewal notification
 * with no session behind it resolve to the right account.
 */
export async function applyAppleSubscription(transactionId: string, userId?: string): Promise<AppleSubscription | null> {
  const subscription = await subscriptionStatus(transactionId);
  if (!subscription) return null;

  const existing = await env.DB.prepare("SELECT user_id FROM apple_subscriptions WHERE original_transaction_id=?")
    .bind(subscription.originalTransactionId)
    .first<{ user_id: string }>();

  // A subscription already belonging to someone else is not transferred. Apple's own id is stable
  // across a family, a restore and a reinstall, so the first account to claim it keeps it —
  // otherwise one purchase could be walked from account to account, each one claiming Pro.
  const owner = existing?.user_id || userId;
  if (!owner) return subscription;
  // Nor is it reported to the second account as Pro: answering with Apple's `entitled` here told
  // the app it had unlocked Pro while this account's plan was never touched.
  if (existing && userId && existing.user_id !== userId) return { ...subscription, entitled: false };
  // A first claim has to come from the account the purchase was made for, when the purchase says.
  // Transaction ids are close to sequential, so without this anyone signed in could report one
  // they had not bought and take the subscription before its buyer's app got round to it. A
  // purchase from a build that set no token (before this existed) can still be claimed as before.
  if (!existing && userId && subscription.appAccountToken && subscription.appAccountToken !== await appAccountTokenFor(userId)) {
    return { ...subscription, entitled: false };
  }

  const statusName = STATUS_NAMES[subscription.status] || "unknown";
  await env.DB.prepare(
    `INSERT INTO apple_subscriptions(original_transaction_id,user_id,product_id,status,environment,expires_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(original_transaction_id) DO UPDATE SET
       status=excluded.status, expires_at=excluded.expires_at, product_id=excluded.product_id,
       environment=excluded.environment, updated_at=CURRENT_TIMESTAMP`,
  ).bind(
    subscription.originalTransactionId,
    owner,
    subscription.productId,
    statusName,
    subscription.environment,
    subscription.expiresAt,
  ).run();

  await resolvePlan(owner);
  return subscription;
}

/** Everything the plan depends on, read in one go: the account's row, Apple's table, the grants. */
async function planInputs(userId: string) {
  const [row, apple, grant] = await Promise.all([
    env.DB.prepare("SELECT plan_status,past_due_since,paused_until,stripe_subscription_id FROM users WHERE id=?")
      .bind(userId)
      .first<{ plan_status: string | null; past_due_since: string | null; paused_until: string | null; stripe_subscription_id: string | null }>(),
    // Sandbox rows count as much as production ones: they are App Review's purchases, and
    // TestFlight testers' (see app/appstore.ts).
    env.DB.prepare(
      "SELECT status FROM apple_subscriptions WHERE user_id=? AND status IN ('active','grace_period') LIMIT 1",
    ).bind(userId).first<{ status: string }>(),
    // Grants store a plain YYYY-MM-DD expiry, or none; the day it names is still covered.
    env.DB.prepare(
      "SELECT 1 granted FROM plan_grants WHERE user_id=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at >= date('now')) LIMIT 1",
    ).bind(userId).first<{ granted: number }>(),
  ]);
  if (!row) return null;
  return {
    stripe: {
      subscriptionId: row.stripe_subscription_id,
      status: row.plan_status,
      pastDueSince: row.past_due_since,
      pausedUntil: row.paused_until,
    },
    apple: apple ?? null,
    granted: Boolean(grant),
  };
}

/**
 * Sets users.plan from whichever source currently entitles them — a web subscription, an App
 * Store subscription, or an admin grant.
 *
 * Radar Pro can be bought twice over, and a cancellation on one side must not revoke an
 * entitlement the other side is still paying for. So the plan is recomputed from all of them
 * rather than assigned by whichever event arrived last. Called after anything that changes one of
 * the sources: an Apple purchase or notification, a Stripe subscription webhook, the grace job, an
 * admin grant or revoke, and the billing job once a grant's end date has passed.
 * The rule itself, and why plan_status has exactly one owner at a time, is app/plan-resolution.ts.
 */
export async function resolvePlan(userId: string) {
  const inputs = await planInputs(userId);
  if (!inputs) return;
  const decision = decidePlan(inputs);
  const sets = ["plan=?"];
  const values: string[] = [decision.plan];
  if (decision.status) { sets.push("plan_status=?"); values.push(decision.status); }
  if (decision.forgetSubscription) sets.push("stripe_subscription_id=NULL");
  await env.DB.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).bind(...values, userId).run();
}

/** Who is paying for this account's Pro right now: Apple, Stripe, or nobody. */
export async function billingFor(userId: string): Promise<Billing> {
  const inputs = await planInputs(userId);
  return inputs ? decidePlan(inputs).billing : null;
}
