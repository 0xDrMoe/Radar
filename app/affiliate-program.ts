// The rules of Radar's affiliate program: what a commission is worth, when it becomes payable,
// and when a payout may be attempted.
//
// Its own import-free module, like app/price-tiers.ts and app/radius.ts, for a sharper reason than
// either of those: this is money. The accrual path (the Stripe webhook), the payout path (the
// affiliate API), the management surface and the tests all have to agree on exactly one answer to
// "how much is this affiliate owed right now", and a second copy of that arithmetic living in a
// dashboard query is how a portal ends up showing a figure the payout button refuses to pay.
//
// Everything here is pure. No database, no Stripe, no clock of its own — `now` is always passed
// in, so every rule below can be tested at a date of the test's choosing rather than whenever the
// suite happens to run.
//
// NAMING. Radar's affiliate program is the *creator* program: `creator_profiles`,
// `creator_commissions`, `users.referred_by`, the `/creator` workspace. The affiliate portal is a
// surface over those tables, not a second program beside them, so the storage keeps its existing
// names and this module speaks of affiliates. One ledger, two vocabularies, and the schema is the
// one that wins.

// ---------------------------------------------------------------------------------------------
// Commission lifecycle
// ---------------------------------------------------------------------------------------------

/**
 * Where a commission is in its life.
 *
 * `pending`  accrued from a paid invoice, still inside the hold period. Real, visible to the
 *            affiliate, and deliberately not payable: the money it is a share of can still be
 *            refunded, and paying it out first means asking for it back.
 * `approved` the hold period has elapsed with the payment intact. Payable.
 * `paid`     settled by a payout that Stripe completed.
 * `void`     reversed — refunded, disputed, or the subscription was canceled inside the window.
 *            Voided, never deleted: an affiliate who was shown a figure has to be able to find
 *            out what happened to it, and a voided row explains itself where a missing one
 *            cannot.
 * `rejected` refused by staff, with a reason. Distinct from `void`, which is something Stripe
 *            did; this is something a person decided.
 */
export const COMMISSION_STATUSES = ["pending", "approved", "paid", "void", "rejected"] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];

export function isCommissionStatus(value: unknown): value is CommissionStatus {
  return typeof value === "string" && (COMMISSION_STATUSES as readonly string[]).includes(value);
}

/** The statuses that still represent money Radar expects to pay. */
export const OWED_STATUSES: readonly CommissionStatus[] = ["pending", "approved"];

// ---------------------------------------------------------------------------------------------
// Payout lifecycle
// ---------------------------------------------------------------------------------------------

/**
 * Where a payout is.
 *
 * `pending`    created in Radar, not yet sent to Stripe. The window in which it can be canceled
 *              without anything having happened.
 * `processing` a Stripe transfer exists. Money is in flight and the row is no longer Radar's to
 *              rewrite — only a webhook moves it from here.
 * `paid`       Stripe completed it.
 * `failed`     Stripe rejected or reversed it. The commissions it covered go back to `approved`
 *              so the next run picks them up; leaving them `paid` would mean an affiliate was
 *              told they had been paid money that bounced.
 * `canceled`  abandoned before anything was sent.
 */
export const PAYOUT_STATUSES = ["pending", "processing", "paid", "failed", "canceled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export function isPayoutStatus(value: unknown): value is PayoutStatus {
  return typeof value === "string" && (PAYOUT_STATUSES as readonly string[]).includes(value);
}

/** A payout that has left Radar and cannot be edited here any more. */
export const IN_FLIGHT_PAYOUT_STATUSES: readonly PayoutStatus[] = ["processing", "paid"];

// ---------------------------------------------------------------------------------------------
// Program policy
// ---------------------------------------------------------------------------------------------

/**
 * How long a commission waits before it can be paid.
 *
 * Radar Pro is a monthly subscription bought with a card, so the realistic reversal is a refund
 * or a chargeback rather than a delivery dispute. 30 days covers the refund window comfortably
 * and is short enough that an affiliate is not waiting a quarter to be paid for January.
 *
 * This is the number that makes `clawBackCommission` in the Stripe webhook worth having: without
 * a hold, a refund arriving the day after a payout is a conversation instead of an UPDATE.
 */
export const DEFAULT_HOLD_DAYS = 30;

/**
 * The statement that matures commissions, as text plus its one binding.
 *
 * Here rather than in app/affiliate-payouts.ts because two things run it: that module's
 * `approveMaturedCommissions`, and the hourly cron in worker/index.ts, which cannot import from
 * affiliate-payouts without pulling Stripe into the Worker entry. Two copies of this UPDATE would
 * be two definitions of when money becomes payable, and the one that drifted would be the one
 * nobody was reading.
 *
 * Rows already carrying a payout_id are excluded: they are claimed, and re-approving them would
 * offer the same money to a second payout.
 */
export const MATURE_COMMISSIONS_SQL =
  `UPDATE creator_commissions
      SET status='approved',approved_at=CURRENT_TIMESTAMP
    WHERE status='pending'
      AND payout_id IS NULL
      AND created_at <= datetime('now', ?)`;

/** The one binding MATURE_COMMISSIONS_SQL takes: SQLite's modifier for "holdDays ago". */
export function holdCutoffModifier(holdDays = DEFAULT_HOLD_DAYS) {
  return `-${Math.max(0, Math.trunc(holdDays))} days`;
}

/**
 * The least Radar will send in one payout, in minor units of the payout currency.
 *
 * Not a fee-recovery figure — a Stripe transfer to a connected account costs the platform
 * nothing per transfer. It exists so an affiliate's first payout is worth the email it generates,
 * and so the payouts table does not fill with 40-cent rows that each carry a Stripe object.
 *
 * Per currency, because "2000" is twenty dollars and two thousand yen. Anything not listed falls
 * back to DEFAULT_MIN_PAYOUT rather than being treated as zero — an unlisted currency should be
 * harder to pay out, never easier.
 */
export const MIN_PAYOUT_BY_CURRENCY: Record<string, number> = {
  cad: 2500,
  usd: 2500,
  eur: 2500,
  gbp: 2000,
};
export const DEFAULT_MIN_PAYOUT = 2500;

export function minimumPayout(currency: string) {
  return MIN_PAYOUT_BY_CURRENCY[String(currency || "").toLowerCase()] ?? DEFAULT_MIN_PAYOUT;
}

/** The default share of an invoice an affiliate earns, in basis points. 2000 bps = 20%. */
export const DEFAULT_RATE_BPS = 2000;

/**
 * What a yearly subscription pays, in basis points. 1000 bps = 10%.
 *
 * Half the monthly rate, and deliberately so. Radar Pro yearly is sold at a discount to twelve
 * months of monthly, so a flat 20% would hand an affiliate a larger share of a smaller price and
 * make the plan Radar wants people on the one it can least afford to promote. In the numbers the
 * program is described with: a dollar out of every five on monthly, five out of every fifty on
 * yearly.
 *
 * The yearly commission is still far larger in cash — one yearly sale is worth about five months
 * of monthly commission, paid on the day it happens rather than over a year — which is the part
 * worth telling affiliates.
 */
export const DEFAULT_YEARLY_RATE_BPS = 1000;

/** The billing periods a commission can be earned on. */
export type BillingInterval = "month" | "year";

/**
 * The rate to stamp on a commission, given the plan that was billed.
 *
 * `monthlyRateBps` is the affiliate's own rate from their profile, which is the monthly one — it
 * is what `creator_profiles.commission_rate_bps` has always held and what staff set. The yearly
 * rate is derived from it at the program's own ratio rather than being a second column, so a
 * negotiated rate carries to both plans instead of silently leaving one at the default. An
 * affiliate on 25% monthly earns 12.5% yearly, which is the same bargain.
 */
export function rateForInterval(interval: BillingInterval | string | null | undefined, monthlyRateBps = DEFAULT_RATE_BPS) {
  const monthly = Number.isFinite(monthlyRateBps) ? Math.max(0, Math.trunc(monthlyRateBps as number)) : 0;
  if (interval !== "year") return monthly;
  return Math.round((monthly * DEFAULT_YEARLY_RATE_BPS) / DEFAULT_RATE_BPS);
}

/**
 * The widest rate staff may set on a profile.
 *
 * A guard rather than a policy: 100% of an invoice is a typo, not a deal, and the admin field
 * that writes this takes a number typed by a human. Radar keeps the rest of the invoice, so a
 * rate at or above 10000 bps would have Radar paying out more than it took in.
 */
export const MAX_RATE_BPS = 5000;

export function isValidRateBps(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_RATE_BPS;
}

/**
 * An affiliate's share of one payment, in the payment's own minor units.
 *
 * Rounded down, always: never pay out more than the share actually comes to. Currency is not a
 * parameter because it is not a decision — the commission is in whatever the invoice was in, and
 * converting here would bake today's exchange rate into a row someone gets paid from next month.
 */
export function commissionFor(grossMinorUnits: number, rateBps: number) {
  if (!Number.isFinite(grossMinorUnits) || grossMinorUnits <= 0) return 0;
  if (!Number.isFinite(rateBps) || rateBps <= 0) return 0;
  return Math.floor((grossMinorUnits * Math.min(rateBps, MAX_RATE_BPS)) / 10_000);
}

// ---------------------------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------------------------

/** Days elapsed between two SQL timestamps, or null when either cannot be read. */
export function daysBetween(fromSqlTimestamp: string, now: Date): number | null {
  // SQLite's CURRENT_TIMESTAMP is UTC with no marker, and `new Date` reads a marker-less
  // datetime as local time — which would shift the hold period by the server's offset. Same fix
  // as parseSqlTimestamp in app/verification.ts, inlined because this module imports nothing.
  const text = String(fromSqlTimestamp || "");
  if (!text) return null;
  const at = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text.replace(" ", "T")}Z`).getTime();
  if (Number.isNaN(at)) return null;
  return (now.getTime() - at) / 86_400_000;
}

/**
 * Has this commission cleared the hold period?
 *
 * A row with an unreadable timestamp is NOT approvable. The failure modes are not symmetric: a
 * commission held too long is a complaint, and one paid too early is money out the door against
 * a payment that could still reverse.
 */
export function holdElapsed(createdAt: string, now: Date, holdDays = DEFAULT_HOLD_DAYS) {
  const age = daysBetween(createdAt, now);
  return age !== null && age >= holdDays;
}

export type ConnectState = {
  /** The connected account id, or null when the affiliate has never started onboarding. */
  accountId: string | null;
  /** Stripe's own answer to "may this account receive money", mirrored from account.updated. */
  payoutsEnabled: boolean;
  /** Whatever Stripe still wants before it will say yes. */
  requirementsDue: number;
};

export type PayoutBlocker =
  | "no_connect_account"
  | "connect_incomplete"
  | "below_minimum"
  | "nothing_available"
  | "payout_in_flight";

/**
 * Why this affiliate cannot be paid right now, or null when they can.
 *
 * Ordered so the reason returned is the one the affiliate should act on first: there is no point
 * telling someone they are $8 short of the threshold when they have not connected an account to
 * be paid into. Returning a code rather than a sentence keeps the wording in the UI, where it can
 * be translated.
 */
export function payoutBlocker(
  available: number,
  currency: string,
  connect: ConnectState,
  hasInFlightPayout: boolean,
): PayoutBlocker | null {
  if (!connect.accountId) return "no_connect_account";
  if (!connect.payoutsEnabled || connect.requirementsDue > 0) return "connect_incomplete";
  if (hasInFlightPayout) return "payout_in_flight";
  if (available <= 0) return "nothing_available";
  if (available < minimumPayout(currency)) return "below_minimum";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------------------------

/**
 * A ledger row as the balance maths needs it.
 *
 * `payout_id` matters as much as `status` does. An approved commission that a payout has already
 * claimed is not available — the money is spoken for and in flight — but it is not paid either,
 * because the transfer can still fail and hand it back. Reading availability from the status
 * alone would let one balance be spent twice: the portal would keep offering it while a payout
 * was already carrying it.
 */
export type LedgerRow = { currency: string; status: string; commission_amount: number; payout_id?: number | null };

export type CurrencyBalance = {
  currency: string;
  pending: number;
  approved: number;
  /** Approved, but claimed by a payout that has not landed yet. */
  inPayout: number;
  paid: number;
  reversed: number;
  /** What a payout would move today: approved and unclaimed. */
  available: number;
  /** Everything ever earned and not reversed — the number an affiliate thinks of as "earnings". */
  lifetime: number;
};

/**
 * Roll a ledger up into one balance per currency.
 *
 * Per currency and never summed across them. Radar Pro is quoted in several, and a single total
 * would be a made-up number produced by an exchange rate nobody agreed to. Every surface that
 * shows earnings shows them this way, which is why this returns a list rather than a figure.
 *
 * `available` is the approved rows no payout has claimed. That is exactly what the payout path
 * spends, which is the property worth having: the portal cannot show a figure the payout button
 * then refuses, and two payouts cannot be funded from one balance.
 */
export function balancesFrom(rows: readonly LedgerRow[]): CurrencyBalance[] {
  const byCurrency = new Map<string, CurrencyBalance>();
  for (const row of rows) {
    const currency = String(row.currency || "").toLowerCase() || "cad";
    const amount = Number(row.commission_amount) || 0;
    const balance = byCurrency.get(currency) || {
      currency, pending: 0, approved: 0, inPayout: 0, paid: 0, reversed: 0, available: 0, lifetime: 0,
    };
    // An unknown status counts toward nothing rather than toward everything. A row written by
    // something this module has not been taught about should be invisible to a payout, not
    // silently payable.
    if (row.status === "pending") balance.pending += amount;
    else if (row.status === "approved") {
      balance.approved += amount;
      if (row.payout_id != null) balance.inPayout += amount;
    }
    else if (row.status === "paid") balance.paid += amount;
    else if (row.status === "void" || row.status === "rejected") balance.reversed += amount;
    byCurrency.set(currency, balance);
  }
  for (const balance of byCurrency.values()) {
    balance.available = balance.approved - balance.inPayout;
    balance.lifetime = balance.pending + balance.approved + balance.paid;
  }
  return [...byCurrency.values()].sort((a, b) => b.lifetime - a.lifetime || a.currency.localeCompare(b.currency));
}

/**
 * Clicks to paying subscribers, as a percentage.
 *
 * Returns null rather than 0 when there were no clicks. A brand-new affiliate has no conversion
 * rate; showing them "0%" says their link is failing when it has not yet been used.
 */
export function conversionRate(clicks: number, conversions: number): number | null {
  if (!Number.isFinite(clicks) || clicks <= 0) return null;
  return (conversions / clicks) * 100;
}
