import { env } from "cloudflare:workers";
import { createClerkClient } from "@clerk/backend";
import { cancelSubscription } from "./stripe";
import type { AppUser } from "./auth";

// Deleting an account, everywhere it exists.
//
// App Review guideline 5.1.1(v): "If your app supports account creation, you must also offer
// account deletion within the app." Radar creates accounts, so this is not optional, and a link
// to a website does not satisfy it — the deletion has to start and finish inside the app.
//
// Three systems hold a piece of the account and all three have to let go:
//
//   1. Stripe, because an account can be deleted while a subscription is still billing. Canceling
//      is first, and a failure here stops the whole thing: silently deleting the row that records
//      the subscription id would leave a charge recurring against a customer with no account, no
//      email and no way to stop it.
//   2. Clerk, which owns the credential. Without this the person can sign back in and Radar
//      politely creates them a fresh empty account, which looks like the deletion did not work.
//   3. D1, which holds everything else.
//
// The order matters and is the reverse of convenience: the things that can fail and that cost
// money go first, while the account still exists to retry against.

/**
 * Every table with a row belonging to a person, and the column that says so.
 *
 * Listed explicitly rather than discovered, because "delete the user's data" is a promise and a
 * loop over whatever tables happen to exist is not a promise, it is a guess. A new table holding
 * personal data has to be added here — tests/account-deletion.test.mjs fails when one is not.
 */
export const PERSONAL_TABLES = [
  "apple_subscriptions",
  "auth_identities",
  "creator_applications",
  "creator_profiles",
  "device_tokens",
  "plan_grants",
  "email_consents",
  "email_deliveries",
  "excluded_restaurants",
  "favorites",
  "feedback",
  "notification_preferences",
  "product_events",
  "reports",
  "restaurant_managers",
  "saved_locations",
  "saved_restaurants",
  "user_permissions",
] as const;

/**
 * Tables where the person's row is someone else's record, so deletion clears the link instead of
 * removing the row.
 *
 * `creator_commissions` is money. A row says a creator earned a share of an invoice; its `user_id`
 * is the subscriber who paid it. Deleting the subscriber's account must not delete what a third
 * party is owed, and must not quietly reduce a payout that has already been reported to them — so
 * the row stays and the column that points at a person goes. What is left is an amount, a currency
 * and a date, which is what an accounting record needs and is no longer personal data.
 *
 * `cancellation_reasons` and `save_offers` are the other kind: aggregates the product is steered by.
 * Someone who leaves because a city had nothing for them has said something about the catalog, and
 * whether they took the pause they were offered says something about the offer. Both stay true after
 * the account is gone. Deleting the rows would quietly revise the history the Growth tab reads -
 * making a reason look less common than it was, and a save rate look better or worse than it was.
 * Detached from the person, a reason code, an offer key, an accepted flag and a date are not
 * personal data.
 *
 * `suggestions` is the catalog's provenance: a submitted offer may already be a live deal, and the
 * review trail behind it has to outlast the person who sent it. It also holds the contact address
 * the form asked for, so deletion clears that alongside the link (the column is NOT NULL, so it is
 * emptied rather than nulled).
 */
export const ANONYMISED_TABLES = [
  "cancellation_reasons",
  "creator_commissions",
  "save_offers",
  "suggestions",
] as const;

export type DeletionFailure = { code: string; message: string };

/**
 * Removes the account and everything attached to it.
 *
 * Returns a failure rather than throwing, because every caller has to tell the person something
 * specific: "your subscription could not be canceled, so nothing was deleted" is actionable and
 * "something went wrong" is not.
 */
export async function deleteAccount(user: AppUser): Promise<DeletionFailure | null> {
  const runtime = env as unknown as Record<string, string>;

  // 1. Money first, while there is still an account to come back to.
  const billing = await env.DB.prepare("SELECT stripe_subscription_id FROM users WHERE id=?")
    .bind(user.userId)
    .first<{ stripe_subscription_id: string | null }>();
  if (billing?.stripe_subscription_id) {
    try {
      await cancelSubscription(billing.stripe_subscription_id);
    } catch {
      return {
        code: "SUBSCRIPTION_CANCEL_FAILED",
        message: "Your subscription could not be canceled, so nothing was deleted. Try again in a moment.",
      };
    }
  }

  // 2. The credential. Done before the rows so that a failure leaves an account that still works,
  // rather than a sign-in that succeeds into nothing.
  if (runtime.CLERK_SECRET_KEY && user.clerkUserId) {
    try {
      await createClerkClient({ secretKey: runtime.CLERK_SECRET_KEY }).users.deleteUser(user.clerkUserId);
    } catch (cause) {
      // A user Clerk has already lost is not a reason to strand their data here.
      const status = (cause as { status?: number })?.status;
      if (status !== 404) {
        return {
          code: "IDENTITY_DELETE_FAILED",
          message: "Your sign-in could not be removed, so nothing was deleted. Try again in a moment.",
        };
      }
    }
  }

  // 3. The rows. One batch, so a half-deleted account is not a state this can end in.
  await env.DB.batch([
    // Rows keyed by something other than user_id, so the table lists above cannot reach them. Both
    // go first, while the deliveries and addresses that find them still exist.
    // The provider's raw events for this person's deliveries; their payload carries the address.
    env.DB.prepare("DELETE FROM email_events WHERE delivery_id IN (SELECT id FROM email_deliveries WHERE user_id=?)").bind(user.userId),
    // A homepage "keep me posted" signup at an address this account used. It is the same person's
    // address and consent, and leaving it would keep mailing someone who asked to be forgotten.
    // email_suppressions is deliberately not here: it is what keeps an unsubscribed address unsent.
    env.DB.prepare(
      "DELETE FROM email_leads WHERE lower(email) IN (SELECT lower(email) FROM users WHERE id=? UNION SELECT lower(email) FROM email_consents WHERE user_id=?)",
    ).bind(user.userId, user.userId),
    ...PERSONAL_TABLES.map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE user_id=?`).bind(user.userId)),
    // Before the link is cleared below, while the rows can still be found by it.
    env.DB.prepare("UPDATE suggestions SET email='' WHERE user_id=?").bind(user.userId),
    ...ANONYMISED_TABLES.map((table) => env.DB.prepare(`UPDATE ${table} SET user_id=NULL WHERE user_id=?`).bind(user.userId)),
    env.DB.prepare("DELETE FROM users WHERE id=?").bind(user.userId),
  ]);

  return null;
}
