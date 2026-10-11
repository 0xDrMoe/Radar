import { env } from "cloudflare:workers";
import {
  balancesFrom,
  DEFAULT_HOLD_DAYS,
  holdCutoffModifier,
  MATURE_COMMISSIONS_SQL,
  minimumPayout,
  payoutBlocker,
  type ConnectState,
  type CurrencyBalance,
  type PayoutBlocker,
} from "./affiliate-program";
import { connectConfigured, createTransfer, isInsufficientBalance, retrieveConnectAccount } from "./stripe-connect";

// Turning approved commissions into money that has actually left Radar.
//
// This is the file where a mistake costs real money, so the ordering below is deliberate and
// worth reading before changing:
//
//   1. A payout row is created FIRST, in `pending`, before anything is claimed and before Stripe
//      is called. Its id is the transfer's idempotency key, so the key exists before the money
//      does. A key minted at the point of the call — a UUID, a timestamp, the amount — would be
//      new on every retry, which is how one payout becomes two transfers.
//
//   2. Commissions are claimed by a conditional UPDATE, not selected and then updated. `WHERE
//      status='approved' AND payout_id IS NULL` is the lock: whichever request gets there first
//      takes the rows, the second claims nothing, and neither had to hold a transaction open
//      across a network call to Stripe. D1 has no interactive transactions, so a claim that is
//      not a single statement is not a claim.
//
//   3. The amount is read back from the rows that were actually claimed. Summing first and
//      claiming second would let a clawback land in between and transfer money against a
//      commission that had just been voided.
//
//   4. Only then is Stripe called. On failure the claim is released and the payout is marked
//      failed, so the balance comes back rather than disappearing into a row nobody looks at.
//
// A claimed commission stays `approved` with a `payout_id` until the payout is confirmed paid. It
// is not `paid` the moment a transfer is created: Stripe can still fail or reverse it, and a
// ledger that says "paid" about money that bounced is worse than one that says nothing.

export type PayoutAttempt =
  | { ok: true; payoutId: number; transferId: string; amount: number; currency: string; commissions: number }
  | { ok: false; blocker: PayoutBlocker | "stripe_error" | "connect_unavailable"; message: string; payoutId?: number };

/** The ledger rows the balance maths needs, for one affiliate. */
async function ledgerFor(handle: string) {
  const rows = await env.DB.prepare(
    "SELECT currency,status,commission_amount,payout_id FROM creator_commissions WHERE handle=?",
  ).bind(handle).all<{ currency: string; status: string; commission_amount: number; payout_id: number | null }>();
  return balancesFrom(rows.results || []);
}

export async function balancesForHandle(handle: string): Promise<CurrencyBalance[]> {
  return ledgerFor(handle);
}

/**
 * The connected-account state the portal shows, read from Radar's mirror of it.
 *
 * Cheap on purpose — this runs on every dashboard load. The mirror is refreshed by the
 * `account.updated` webhook and by `syncConnectAccount` below; the payout path never trusts it
 * and re-reads Stripe before sending anything.
 */
export async function connectStateFor(handle: string): Promise<ConnectState> {
  const row = await env.DB.prepare(
    "SELECT stripe_account_id,payouts_enabled,requirements_due FROM creator_profiles WHERE handle=?",
  ).bind(handle).first<{ stripe_account_id: string | null; payouts_enabled: number; requirements_due: number }>();
  return {
    accountId: row?.stripe_account_id || null,
    payoutsEnabled: !!row?.payouts_enabled,
    requirementsDue: Number(row?.requirements_due) || 0,
  };
}

/**
 * Re-read an account from Stripe and write the answer into Radar's mirror.
 *
 * Called when an affiliate returns from onboarding, and by the `account.updated` webhook. Both
 * paths matter: the webhook is how the mirror stays right over the following months, and the
 * return-from-onboarding read is how the portal stops saying "finish setting up" the instant they
 * have.
 */
export async function syncConnectAccount(handle: string, accountId: string) {
  const account = await retrieveConnectAccount(accountId);
  await env.DB.prepare(
    `UPDATE creator_profiles
        SET payouts_enabled=?,requirements_due=?,connect_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE handle=?`,
  ).bind(account.payoutsEnabled ? 1 : 0, account.requirementsDue.length, handle).run();
  return account;
}

/** Is a payout already in flight for this affiliate and currency? */
async function inFlightPayout(handle: string, currency: string) {
  const row = await env.DB.prepare(
    "SELECT id FROM creator_payouts WHERE handle=? AND currency=? AND status IN ('pending','processing') LIMIT 1",
  ).bind(handle, currency).first<{ id: number }>();
  return !!row;
}

/**
 * Move matured commissions from `pending` to `approved`.
 *
 * A job rather than a read-time calculation, so `approved_at` is a fact with a date on it. If
 * availability were derived on every read from `created_at` plus today's hold period, then
 * changing the hold period would retroactively un-approve money an affiliate had already been
 * shown — and a balance that goes down because a constant changed is indistinguishable, from the
 * outside, from Radar taking something back.
 *
 * Rows already carrying a payout_id are left alone: they are claimed, and re-approving them would
 * hand the same money to a second payout.
 */
export async function approveMaturedCommissions(holdDays = DEFAULT_HOLD_DAYS) {
  const result = await env.DB.prepare(MATURE_COMMISSIONS_SQL).bind(holdCutoffModifier(holdDays)).run();
  return result.meta.changes || 0;
}

/**
 * Release a payout's claim on its commissions and put the balance back.
 *
 * Used when a payout cannot be funded, when Stripe refuses it, and when a transfer that had been
 * accepted is later reversed.
 *
 * `settled` is the difference between those cases. A payout that never got off the ground is
 * holding `approved` rows and simply lets go of them. A payout that completed and was then
 * reversed is holding `paid` ones, and the money has come back to Radar's balance — so the
 * affiliate is owed it again, and the rows have to be reopened rather than left saying they were
 * paid out of money that returned. Everything is scoped to this payout's own id, so reopening
 * one payout's rows can never touch another's.
 */
async function releaseClaim(payoutId: number, settled = false) {
  const result = await env.DB.prepare(
    settled
      ? `UPDATE creator_commissions
            SET payout_id=NULL,status='approved',paid_at=NULL
          WHERE payout_id=? AND status IN ('approved','paid')`
      : "UPDATE creator_commissions SET payout_id=NULL WHERE payout_id=? AND status='approved'",
  ).bind(payoutId).run();
  return result.meta.changes || 0;
}

/**
 * Attempt a payout for one affiliate in one currency.
 *
 * `initiatedBy` is the user id of whoever asked — the affiliate for a self-service payout, a
 * manager for one settled from the management console. It lands on the row and in the audit log,
 * because "who authorized this transfer" is the first question asked about any payment.
 */
export async function requestPayout(input: {
  handle: string;
  currency: string;
  initiatedBy: string;
}): Promise<PayoutAttempt> {
  const currency = String(input.currency || "").toLowerCase();
  const { handle } = input;

  if (!connectConfigured()) {
    return { ok: false, blocker: "connect_unavailable", message: "Affiliate payouts are not switched on yet." };
  }

  const profile = await env.DB.prepare(
    "SELECT handle,stripe_account_id,status FROM creator_profiles WHERE handle=?",
  ).bind(handle).first<{ handle: string; stripe_account_id: string | null; status: string }>();
  if (!profile?.stripe_account_id) {
    return { ok: false, blocker: "no_connect_account", message: "Connect a Stripe account before requesting a payout." };
  }
  // A suspended affiliate keeps their ledger — they earned it — but money does not leave while
  // the account is under review. Unsuspending is what releases it.
  if (profile.status !== "active") {
    return { ok: false, blocker: "connect_incomplete", message: "This affiliate account is not active." };
  }

  if (await inFlightPayout(handle, currency)) {
    return { ok: false, blocker: "payout_in_flight", message: "A payout is already on its way." };
  }

  // Stripe's answer, not Radar's cached one. The mirror can be minutes stale and this is the
  // decision that moves money.
  let account;
  try {
    account = await retrieveConnectAccount(profile.stripe_account_id);
  } catch {
    return { ok: false, blocker: "stripe_error", message: "Stripe could not be reached. Try again shortly." };
  }
  await env.DB.prepare(
    "UPDATE creator_profiles SET payouts_enabled=?,requirements_due=?,connect_synced_at=CURRENT_TIMESTAMP WHERE handle=?",
  ).bind(account.payoutsEnabled ? 1 : 0, account.requirementsDue.length, handle).run();

  const balances = await ledgerFor(handle);
  const balance = balances.find((entry) => entry.currency === currency);
  const available = balance?.available || 0;
  const blocker = payoutBlocker(
    available,
    currency,
    { accountId: profile.stripe_account_id, payoutsEnabled: account.payoutsEnabled, requirementsDue: account.requirementsDue.length },
    false,
  );
  if (blocker) {
    return {
      ok: false,
      blocker,
      message: blocker === "below_minimum"
        ? `A payout needs at least ${minimumPayout(currency) / 100} ${currency.toUpperCase()}.`
        : blocker === "nothing_available"
          ? "There is nothing available to pay out yet."
          : "Finish your Stripe setup before requesting a payout.",
    };
  }

  // Step 1 — the row, before anything is claimed. Its id is the idempotency key.
  const created = await env.DB.prepare(
    `INSERT INTO creator_payouts(handle,stripe_account_id,amount,currency,status,initiated_by)
     VALUES(?,?,0,?, 'pending',?)`,
  ).bind(handle, profile.stripe_account_id, currency, input.initiatedBy).run();
  const payoutId = Number(created.meta.last_row_id);
  if (!payoutId) return { ok: false, blocker: "stripe_error", message: "The payout could not be started." };

  // Step 2 — the claim. Conditional, so a second request racing this one takes nothing.
  await env.DB.prepare(
    `UPDATE creator_commissions
        SET payout_id=?
      WHERE handle=? AND currency=? AND status='approved' AND payout_id IS NULL`,
  ).bind(payoutId, handle, currency).run();

  // Step 3 — what was actually claimed, read back rather than assumed.
  const claimed = await env.DB.prepare(
    "SELECT COUNT(*) n,COALESCE(SUM(commission_amount),0) total FROM creator_commissions WHERE payout_id=?",
  ).bind(payoutId).first<{ n: number; total: number }>();
  const amount = Number(claimed?.total) || 0;
  const count = Number(claimed?.n) || 0;

  if (amount <= 0 || amount < minimumPayout(currency)) {
    await releaseClaim(payoutId);
    await env.DB.prepare(
      "UPDATE creator_payouts SET status='canceled',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(amount <= 0 ? "nothing_available" : "below_minimum", payoutId).run();
    return {
      ok: false,
      blocker: amount <= 0 ? "nothing_available" : "below_minimum",
      message: "There is nothing available to pay out yet.",
      payoutId,
    };
  }

  await env.DB.prepare(
    "UPDATE creator_payouts SET amount=?,commission_count=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(amount, count, payoutId).run();

  // Step 4 — the money. Keyed on the payout row, so a retry of this whole request returns the
  // transfer that already exists instead of making a second one.
  try {
    const transfer = await createTransfer({
      accountId: profile.stripe_account_id,
      amount,
      currency,
      idempotencyKey: `radar-payout:${payoutId}`,
      description: `Radar affiliate commissions — ${handle}`,
      metadata: { radar_handle: handle, radar_payout_id: String(payoutId) },
    });
    // The transfer id lands first, on its own. If anything below fails — the isolate is killed,
    // D1 is briefly unavailable — the row is still findable by the transfer Stripe made, which
    // is what lets the transfer.created webhook finish the job instead of the money going
    // missing from Radar's books.
    await env.DB.prepare(
      "UPDATE creator_payouts SET status='processing',stripe_transfer_id=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(transfer.id, payoutId).run();
    // And then it is paid, here, synchronously.
    //
    // A Connect transfer is not a request that gets confirmed later: when Stripe returns a
    // transfer object the money has already moved from Radar's platform balance into the
    // affiliate's Stripe balance. Nothing further will arrive to say so — `transfer.paid` and
    // `transfer.failed` were retired in 2017 when Stripe split payouts out of transfers, and the
    // events that remain (`transfer.created`, `transfer.reversed`) report what has already
    // happened. What IS still asynchronous is Stripe paying that balance into the affiliate's
    // bank, but that is between them and Stripe: it runs on the connected account's own payout
    // schedule, and Radar's obligation was discharged the moment the transfer succeeded.
    //
    // Written through markPayoutPaid rather than inline, so `status='paid'` continues to be
    // written in exactly one place in the codebase.
    await markPayoutPaid(payoutId);
    return { ok: true, payoutId, transferId: transfer.id, amount, currency, commissions: count };
  } catch (error) {
    await releaseClaim(payoutId);
    const reason = isInsufficientBalance(error)
      ? "balance_insufficient"
      : (error as { stripeCode?: string })?.stripeCode || "stripe_error";
    await env.DB.prepare(
      "UPDATE creator_payouts SET status='failed',failure_reason=?,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(String(reason).slice(0, 120), payoutId).run();
    return {
      ok: false,
      blocker: "stripe_error",
      payoutId,
      message: isInsufficientBalance(error)
        ? "Radar's balance is short right now — this payout will be retried."
        : "Stripe refused the transfer.",
    };
  }
}

/**
 * Settle a payout Stripe has confirmed.
 *
 * Idempotent on the payout's own status: a repeated `transfer.paid` for a payout already marked
 * paid changes nothing and, critically, does not mark its commissions a second time.
 */
export async function markPayoutPaid(payoutId: number) {
  const payout = await env.DB.prepare("SELECT id,status FROM creator_payouts WHERE id=?")
    .bind(payoutId).first<{ id: number; status: string }>();
  if (!payout || payout.status === "paid") return false;
  await env.DB.batch([
    env.DB.prepare("UPDATE creator_payouts SET status='paid',paid_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(payoutId),
    // Only now do the commissions become `paid`. Everything before this point left them
    // `approved` and claimed, precisely so this moment could be the one that says money moved.
    env.DB.prepare("UPDATE creator_commissions SET status='paid',paid_at=CURRENT_TIMESTAMP WHERE payout_id=? AND status='approved'").bind(payoutId),
  ]);
  return true;
}

/**
 * Fail a payout and hand its balance back.
 *
 * Commissions that were already settled by a *completed* payout are untouched by releaseClaim, so
 * a late failure on one payout cannot reopen another's rows.
 */
export async function markPayoutFailed(payoutId: number, reason: string) {
  const payout = await env.DB.prepare("SELECT id,status FROM creator_payouts WHERE id=?")
    .bind(payoutId).first<{ id: number; status: string }>();
  if (!payout || payout.status === "failed") return false;
  // A payout that had already settled is being reversed, so its commissions are `paid` and have
  // to be reopened; one that never settled is only holding a claim.
  await releaseClaim(payoutId, payout.status === "paid");
  await env.DB.prepare(
    "UPDATE creator_payouts SET status='failed',failure_reason=?,paid_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(String(reason || "unknown").slice(0, 120), payoutId).run();
  return true;
}

/** Find the Radar payout a Stripe transfer belongs to. */
export async function payoutForTransfer(transferId: string) {
  return env.DB.prepare("SELECT id,handle,status,amount,currency FROM creator_payouts WHERE stripe_transfer_id=?")
    .bind(transferId).first<{ id: number; handle: string; status: string; amount: number; currency: string }>();
}
