import { env } from "cloudflare:workers";

// Stripe Connect: how an affiliate gets an account Radar can send money to, and how Radar sends
// it.
//
// Separate from app/stripe.ts because it is a different relationship with Stripe. That file is
// Radar taking money from a customer; this one is Radar paying a third party out of its own
// balance. They share an API key and nothing else — different objects, different failure modes,
// and a different thing to get wrong.
//
// EXPRESS ACCOUNTS, not Custom. Express means Stripe hosts the onboarding form, collects the
// identity and bank details, runs the KYC, and owns the ongoing "we need another document"
// conversation. Radar never sees a bank account number, never stores one, and never has to build
// a verification UI — which is the only responsible way to do this without a compliance team. The
// cost is that the affiliate sees a Stripe-branded form in the middle of the flow, which is the
// right trade.
//
// TRANSFERS, not payouts. Radar creates a `transfer` from its platform balance to the connected
// account; Stripe then pays that account out to its bank on the account's own schedule. So the
// object Radar owns is the transfer, and `payout.*` webhooks are Stripe telling us what happened
// on the far side afterwards. Calling `POST /payouts` would be Radar paying its *own* bank, which
// is not what an affiliate payout is.
//
// Every function here throws on failure rather than returning a sentinel. A payout path that
// cannot tell "Stripe said no" from "nothing to do" is a payout path that will eventually record
// a payment that did not happen.

function runtime() { return env as unknown as Record<string, string>; }

/**
 * Whether Connect can be used at all.
 *
 * Separate from `stripeConfigured()` in app/stripe.ts: an instance can be perfectly able to take
 * subscriptions and still have no Connect platform set up, which is exactly the state Radar is in
 * until the Connect settings are completed in the Stripe dashboard. Every affiliate-payout
 * surface checks this and degrades to "payouts are not available yet" rather than throwing a 500
 * at an affiliate who did nothing wrong.
 *
 * STRIPE_CONNECT_ENABLED is the deliberate second switch. Having a live key is not consent to
 * start moving money out of the platform balance, so Connect stays off until it is turned on
 * explicitly — which means this code can ship, be reviewed and be tested before it can pay
 * anyone.
 */
export function connectConfigured() {
  return Boolean(runtime().STRIPE_SECRET_KEY) && runtime().STRIPE_CONNECT_ENABLED === "true";
}

async function connectRequest(
  path: string,
  params: Record<string, string>,
  options: { idempotencyKey?: string; method?: "POST" | "GET" } = {},
) {
  const key = runtime().STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_not_configured");
  const method = options.method || "POST";
  const headers: Record<string, string> = { authorization: `Bearer ${key}` };
  // Stripe deduplicates on this for 24 hours. Every call that creates money-moving state passes
  // one, so a retried request — a Worker retry, a double-clicked button, a queue replay — returns
  // the original object instead of making a second one.
  if (options.idempotencyKey) headers["idempotency-key"] = options.idempotencyKey;
  let url = `https://api.stripe.com/v1/${path}`;
  const body = new URLSearchParams(params);
  if (method === "GET") {
    const query = body.toString();
    if (query) url += `?${query}`;
  } else {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  const response = await fetch(url, { method, headers, ...(method === "POST" ? { body } : {}) });
  const result = await response.json() as Record<string, unknown> & { error?: { message?: string; code?: string; type?: string } };
  if (!response.ok) {
    // The code is carried so callers can tell the one recoverable failure — the platform balance
    // is short — from everything else, which is a bug or a configuration problem.
    const error = new Error(`STRIPE_${result.error?.code || result.error?.type || response.status}`) as Error & { stripeCode?: string; stripeMessage?: string };
    error.stripeCode = result.error?.code || result.error?.type || String(response.status);
    error.stripeMessage = result.error?.message || "";
    throw error;
  }
  return result;
}

export type ConnectAccount = {
  id: string;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
  /** Stripe's deadline for the outstanding requirements, when it has set one. */
  currentDeadline: number | null;
  /** The account's default currency, which decides what Radar may transfer to it. */
  defaultCurrency: string | null;
};

function readAccount(raw: Record<string, unknown>): ConnectAccount {
  const requirements = (raw.requirements || {}) as { currently_due?: string[]; past_due?: string[]; current_deadline?: number | null };
  // currently_due and past_due overlap; a past-due item is also currently due. Union rather than
  // sum, or an account with one late document reports two outstanding requirements.
  const due = new Set([...(requirements.currently_due || []), ...(requirements.past_due || [])]);
  return {
    id: String(raw.id || ""),
    payoutsEnabled: raw.payouts_enabled === true,
    chargesEnabled: raw.charges_enabled === true,
    detailsSubmitted: raw.details_submitted === true,
    requirementsDue: [...due],
    currentDeadline: typeof requirements.current_deadline === "number" ? requirements.current_deadline : null,
    defaultCurrency: typeof raw.default_currency === "string" ? raw.default_currency.toLowerCase() : null,
  };
}

/**
 * Create the connected account an affiliate will be paid into.
 *
 * `transfers` is the only capability requested. Radar sends money to this account and never
 * charges through it, so asking for `card_payments` would put the affiliate through a merchant
 * onboarding — business category, refund policy, statement descriptor — for a capability nothing
 * uses.
 *
 * The country decides which onboarding form Stripe shows and which currencies the account can
 * settle in, and it cannot be changed afterwards. It comes from the affiliate's own answer rather
 * than from the request IP: a Canadian creator on holiday should not end up with a US account
 * they can never be paid into.
 *
 * The handle rides along in metadata so a Stripe dashboard row can be traced back to an affiliate
 * without a lookup, and `user_id` so it can be traced to a person.
 */
export async function createConnectAccount(input: { handle: string; userId: string; email: string; country: string }) {
  const account = await connectRequest("accounts", {
    type: "express",
    country: input.country.toUpperCase(),
    email: input.email,
    "capabilities[transfers][requested]": "true",
    "business_profile[product_description]": "Radar affiliate — referral commissions on Radar Pro subscriptions.",
    "metadata[radar_handle]": input.handle,
    "metadata[radar_user_id]": input.userId,
  }, {
    // Keyed on the handle, so a double-submitted "start onboarding" cannot create two accounts
    // for one affiliate — which would be two balances and a permanent reconciliation problem.
    idempotencyKey: `connect-account:${input.handle}`,
  });
  return readAccount(account);
}

/**
 * A one-time URL into Stripe's hosted onboarding.
 *
 * Short-lived and single-use by design — Stripe expires these in minutes — so it is minted at the
 * moment the affiliate clicks, never stored, and never emailed. `refreshUrl` is where Stripe
 * sends them if the link has already expired by the time they open it; it has to point at
 * something that mints a fresh one rather than at a dead end.
 *
 * `account_onboarding` for the first run and `account_update` afterwards: the second shows only
 * what is still outstanding instead of walking a verified account through the whole form again.
 */
export async function createAccountLink(accountId: string, refreshUrl: string, returnUrl: string, kind: "account_onboarding" | "account_update" = "account_onboarding") {
  const link = await connectRequest("account_links", {
    account: accountId,
    refresh_url: refreshUrl,
    return_url: returnUrl,
    type: kind,
    // Ask for everything Stripe will eventually need, rather than the minimum to enable
    // transfers. Collecting it in one sitting beats a second interruption a month later when a
    // threshold is crossed and payouts stop.
    collection_options: "",
    "collection_options[fields]": "eventually_due",
  });
  return String(link.url || "");
}

/** Stripe's current answer about an account. The payout path re-reads this before sending. */
export async function retrieveConnectAccount(accountId: string): Promise<ConnectAccount> {
  const account = await connectRequest(`accounts/${encodeURIComponent(accountId)}`, {}, { method: "GET" });
  return readAccount(account);
}

/**
 * A link into the Express dashboard, where an affiliate manages their own bank details and sees
 * Stripe's record of what it paid them.
 *
 * Radar deliberately does not rebuild any of that. The affiliate's bank account is Stripe's to
 * hold and theirs to change, and a Radar form in front of it would be a copy that goes stale and
 * a field nobody should be typing an account number into.
 */
export async function createExpressLoginLink(accountId: string) {
  const link = await connectRequest(`accounts/${encodeURIComponent(accountId)}/login_links`, {});
  return String(link.url || "");
}

export type TransferResult = { id: string; amount: number; currency: string; destination: string };

/**
 * Move money from Radar's platform balance to an affiliate's connected account.
 *
 * `idempotencyKey` is required, not optional, and callers pass the Radar payout row's own id.
 * That is what makes this safe to retry: the same payout row can call this as many times as the
 * request is replayed and Stripe will return the one transfer. Generating a key here — from a
 * UUID, or from the amount — would defeat the whole mechanism, so the type does not allow it.
 *
 * Fails, loudly, when the platform balance is short. `balance_insufficient` is the one error a
 * caller should handle rather than treat as a bug: it means the payout is legitimate and simply
 * cannot be funded today.
 */
export async function createTransfer(input: {
  accountId: string;
  amount: number;
  currency: string;
  idempotencyKey: string;
  description?: string;
  metadata?: Record<string, string>;
}): Promise<TransferResult> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new Error("STRIPE_invalid_transfer_amount");
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.metadata || {})) metadata[`metadata[${key}]`] = value;
  const transfer = await connectRequest("transfers", {
    amount: String(input.amount),
    currency: input.currency.toLowerCase(),
    destination: input.accountId,
    ...(input.description ? { description: input.description } : {}),
    ...metadata,
  }, { idempotencyKey: input.idempotencyKey });
  return {
    id: String(transfer.id || ""),
    amount: Number(transfer.amount) || 0,
    currency: String(transfer.currency || input.currency).toLowerCase(),
    destination: String(transfer.destination || input.accountId),
  };
}

/** True when the failure was "the platform balance is short" rather than a bug. */
export function isInsufficientBalance(error: unknown) {
  return (error as { stripeCode?: string })?.stripeCode === "balance_insufficient";
}
