import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getAppUser } from "../../auth";
import { apiError, readJson, requireSameOrigin } from "../../api-utils";
import {
  conversionRate,
  minimumPayout,
  payoutBlocker,
  DEFAULT_HOLD_DAYS,
  DEFAULT_RATE_BPS,
  DEFAULT_YEARLY_RATE_BPS,
  rateForInterval,
  MIN_PAYOUT_BY_CURRENCY,
} from "../../affiliate-program";
import {
  balancesForHandle,
  connectStateFor,
  requestPayout,
  syncConnectAccount,
} from "../../affiliate-payouts";
import { paidForPredicate } from "../../plan-resolution";
import { connectConfigured, createAccountLink, createConnectAccount, createExpressLoginLink } from "../../stripe-connect";

// The affiliate portal's own API. Everything an affiliate can see or do about their own account,
// and nothing about anyone else's.
//
// ISOLATION IS STRUCTURAL, NOT CHECKED. Every query below is parameterised by `handle`, and that
// handle is resolved from the signed-in user's id — it is never read from the URL, the body, or a
// header. There is no code path here that takes an affiliate identifier from the client, so there
// is no identifier to tamper with: the IDOR this endpoint would otherwise need guarding against
// cannot be expressed as a request. A manager looking at someone else's figures uses the
// management API, which checks a permission.
//
// The dashboard is a GET and every state change is a POST behind requireSameOrigin, matching the
// rest of Radar's API. Money movement additionally re-reads Stripe inside
// app/affiliate-payouts.ts — nothing here trusts an amount, a currency or a balance that arrived
// in a request body, because no endpoint accepts one.

export const dynamic = "force-dynamic";

// The terms, sent with every answer so the portal never hard-codes a number that lives in
// app/affiliate-program.ts.
//
// `site` is the prefix for links that leave the portal — the personal dashboard, the application
// form, the Radar wordmark. It is empty for a request that arrived on a host serving the whole
// site, which makes those links relative: the right answer on radar.cheap, in preview, and in
// development, where an absolute production URL would send a developer to the live site. Only a
// request on affiliate.radar.cheap, where the rest of Radar is not reachable, gets an absolute
// one — a relative /dashboard there would be rewritten into the portal and 404.
async function programmeFacts() {
  const runtime = env as unknown as Record<string, string>;
  const host = (await headers()).get("host") || "";
  return {
    site: host.startsWith("affiliate.") ? (runtime.PUBLIC_APP_URL || "https://radar.cheap").replace(/\/+$/, "") : "",
    program: {
      holdDays: DEFAULT_HOLD_DAYS,
      minimums: MIN_PAYOUT_BY_CURRENCY,
      defaultRateBps: DEFAULT_RATE_BPS,
      defaultYearlyRateBps: DEFAULT_YEARLY_RATE_BPS,
    },
  };
}

/** The signed-in user's affiliate identity, or null when they do not have one. */
async function affiliateFor(userId: string) {
  return env.DB.prepare(
    `SELECT handle,display_name,status,commission_rate_bps,stripe_account_id,payouts_enabled,requirements_due,created_at
       FROM creator_profiles WHERE user_id=?`,
  ).bind(userId).first<{
    handle: string; display_name: string | null; status: string; commission_rate_bps: number;
    stripe_account_id: string | null; payouts_enabled: number; requirements_due: number; created_at: string;
  }>();
}

/** The affiliate's pending application, when they have applied but not been approved. */
async function applicationFor(userId: string) {
  return env.DB.prepare(
    "SELECT id,status,requested_handle,rejection_reason,created_at,reviewed_at FROM creator_applications WHERE user_id=? ORDER BY id DESC LIMIT 1",
  ).bind(userId).first<{ id: number; status: string; requested_handle: string; rejection_reason: string | null; created_at: string; reviewed_at: string | null }>();
}

export async function GET() {
  const runtime = env as unknown as Record<string, string>;
  const user = await getAppUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to view your affiliate dashboard.");

  const profile = await affiliateFor(user.userId);
  if (!profile) {
    // Not an affiliate. This is a legitimate, common state — a Radar user who has applied, been
    // rejected, or never applied — so it answers rather than 403s, and the portal renders the
    // right invitation instead of an error.
    const application = await applicationFor(user.userId);
    return Response.json({
      affiliate: null,
      application: application || null,
      ...(await programmeFacts()),
    });
  }

  const { handle } = profile;
  const [balances, connect, clicks, signups, conversions, payouts, ledger, campaigns, daily] = await Promise.all([
    balancesForHandle(handle),
    connectStateFor(handle),
    env.DB.prepare(
      "SELECT COUNT(*) total FROM product_events WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?",
    ).bind(handle).first<{ total: number }>(),
    env.DB.prepare("SELECT COUNT(*) total FROM users WHERE referred_by=?").bind(handle).first<{ total: number }>(),
    // Referred accounts that somebody pays for. A comped account has Pro and is nobody's
    // subscription, so it is not a conversion.
    env.DB.prepare(
      `SELECT COUNT(*) total FROM users WHERE referred_by=? AND plan='pro' AND plan_status IN ('active','trialing') AND ${paidForPredicate}`,
    ).bind(handle).first<{ total: number }>(),
    env.DB.prepare(
      `SELECT id,amount,currency,status,commission_count,failure_reason,created_at,paid_at,stripe_transfer_id
         FROM creator_payouts WHERE handle=? ORDER BY created_at DESC LIMIT 50`,
    ).bind(handle).all<Record<string, unknown>>(),
    // No subscriber identity in the ledger: an affiliate is owed money, not told who by. That is
    // a privacy boundary rather than an oversight — see the same rule in app/api/creator.
    env.DB.prepare(
      `SELECT id,created_at,currency,gross_amount,rate_bps,commission_amount,status,campaign,approved_at,paid_at,payout_id
         FROM creator_commissions WHERE handle=? ORDER BY created_at DESC LIMIT 100`,
    ).bind(handle).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT campaign,SUM(visits) visits,SUM(subscriptions) subscriptions,SUM(earned) earned,MAX(currency) currency FROM (
         SELECT json_extract(properties,'$.creatorCampaign') campaign,COUNT(*) visits,0 subscriptions,0 earned,NULL currency
           FROM product_events
          WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?
            AND json_extract(properties,'$.creatorCampaign') IS NOT NULL
          GROUP BY campaign
         UNION ALL
         SELECT campaign,0 visits,COUNT(*) subscriptions,
                COALESCE(SUM(CASE WHEN status NOT IN ('void','rejected') THEN commission_amount ELSE 0 END),0) earned,currency
           FROM creator_commissions WHERE handle=? AND campaign IS NOT NULL GROUP BY campaign,currency
       ) GROUP BY campaign ORDER BY visits DESC LIMIT 50`,
    ).bind(handle, handle).all<Record<string, unknown>>(),
    env.DB.prepare(
      `SELECT date(created_at) day,COUNT(*) count
         FROM product_events
        WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?
          AND created_at>=datetime('now','-30 days')
        GROUP BY day ORDER BY day`,
    ).bind(handle).all<{ day: string; count: number }>(),
  ]);

  const totalClicks = Number(clicks?.total) || 0;
  const paying = Number(conversions?.total) || 0;
  // One in-flight payout per currency, so the portal can disable the button with a reason rather
  // than letting the request be refused after the fact.
  const inFlight = new Set(
    (payouts.results || [])
      .filter((row) => row.status === "pending" || row.status === "processing")
      .map((row) => String(row.currency)),
  );

  return Response.json({
    affiliate: {
      handle,
      displayName: profile.display_name,
      status: profile.status,
      // The profile holds the monthly rate; the yearly one is derived from it, so the portal
      // never has to know the ratio and cannot disagree with what the webhook stamps.
      rateBps: profile.commission_rate_bps,
      yearlyRateBps: rateForInterval("year", profile.commission_rate_bps),
      joinedAt: profile.created_at,
      referralUrl: `${runtime.PUBLIC_APP_URL || "https://radar.cheap"}/?c=${handle}`,
    },
    connect: {
      ...connect,
      // Whether the platform can pay anyone at all. An affiliate whose own setup is perfect still
      // cannot be paid while this is false, and saying so beats a button that fails silently.
      available: connectConfigured(),
    },
    stats: {
      clicks: totalClicks,
      signups: Number(signups?.total) || 0,
      conversions: paying,
      conversionRate: conversionRate(totalClicks, paying),
    },
    balances: balances.map((balance) => ({
      ...balance,
      minimum: minimumPayout(balance.currency),
      blocker: payoutBlocker(balance.available, balance.currency, connect, inFlight.has(balance.currency)),
    })),
    payouts: payouts.results || [],
    ledger: ledger.results || [],
    campaigns: campaigns.results || [],
    daily: daily.results || [],
    ...(await programmeFacts()),
  });
}

export async function POST(request: Request) {
  // requireSameOrigin answers a question, true or false; it is not a response to hand back. This
  // used to return its result whenever it was truthy, so every legitimate same-origin request
  // "returned" the boolean true, which the framework cannot send and turned into an empty 500,
  // while a cross-origin one got false and fell through to the handler. The guard is the same
  // negation every other route writes.
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  const user = await getAppUser();
  if (!user) return apiError(401, "UNAUTHENTICATED", "Sign in to manage your affiliate account.");
  const profile = await affiliateFor(user.userId);
  if (!profile) return apiError(403, "NOT_AN_AFFILIATE", "This account is not in the affiliate program.");
  if (profile.status !== "active") return apiError(403, "AFFILIATE_INACTIVE", "This affiliate account is not active.");

  let body: Record<string, unknown>;
  try { body = await readJson<Record<string, unknown>>(request); } catch { return apiError(400, "INVALID_REQUEST", "The request body is invalid."); }
  if (!body || typeof body !== "object") return apiError(400, "INVALID_REQUEST", "The request body is invalid.");
  const action = String(body.action || "");
  const portalOrigin = new URL(request.url).origin;

  if (!connectConfigured() && action !== "noop") {
    return apiError(503, "CONNECT_UNAVAILABLE", "Affiliate payouts are not switched on yet.");
  }

  if (action === "connect_start") {
    // The country is the affiliate's answer and cannot be changed once the account exists, so it
    // is taken from them rather than guessed from the request IP — a Canadian creator on holiday
    // should not end up with a US account they can never be paid into. Restricted to an
    // allow-list because Stripe rejects an unsupported country with an error the portal would
    // have to translate anyway.
    const country = String(body.country || "").toUpperCase();
    if (!/^(CA|US|GB|AU|NZ|IE|FR|DE|ES|IT|NL|BE|AT|PT|SE|DK|NO|FI|CH|PL|MX)$/.test(country)) {
      return apiError(422, "INVALID_COUNTRY", "Choose the country your bank account is in.");
    }
    let accountId = profile.stripe_account_id;
    if (!accountId) {
      try {
        const account = await createConnectAccount({ handle: profile.handle, userId: user.userId, email: user.email, country });
        accountId = account.id;
      } catch {
        return apiError(502, "CONNECT_CREATE_FAILED", "Stripe could not create your payout account.");
      }
      // Written before the link is minted: an account that exists at Stripe and not in Radar is
      // an orphan nobody can find, and the unique index makes a second attempt safe.
      await env.DB.prepare(
        "UPDATE creator_profiles SET stripe_account_id=?,updated_at=CURRENT_TIMESTAMP WHERE handle=? AND stripe_account_id IS NULL",
      ).bind(accountId, profile.handle).run();
    }
    try {
      const url = await createAccountLink(
        accountId,
        `${portalOrigin}/affiliate/settings?connect=refresh`,
        `${portalOrigin}/affiliate/settings?connect=done`,
        profile.requirements_due > 0 || profile.payouts_enabled ? "account_update" : "account_onboarding",
      );
      return Response.json({ ok: true, url });
    } catch {
      return apiError(502, "CONNECT_LINK_FAILED", "Stripe could not start onboarding. Try again shortly.");
    }
  }

  if (action === "connect_sync") {
    if (!profile.stripe_account_id) return apiError(400, "NO_CONNECT_ACCOUNT", "There is no payout account to check yet.");
    try {
      const account = await syncConnectAccount(profile.handle, profile.stripe_account_id);
      return Response.json({ ok: true, payoutsEnabled: account.payoutsEnabled, requirementsDue: account.requirementsDue.length });
    } catch {
      return apiError(502, "CONNECT_SYNC_FAILED", "Stripe could not be reached.");
    }
  }

  if (action === "connect_dashboard") {
    if (!profile.stripe_account_id) return apiError(400, "NO_CONNECT_ACCOUNT", "Connect a payout account first.");
    try {
      return Response.json({ ok: true, url: await createExpressLoginLink(profile.stripe_account_id) });
    } catch {
      return apiError(502, "CONNECT_LINK_FAILED", "Stripe could not open your payout dashboard.");
    }
  }

  if (action === "request_payout") {
    // The currency is the only thing the client chooses, and it selects among balances the server
    // computed — it is never an amount. Every figure in the transfer comes from the ledger.
    const currency = String(body.currency || "").toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) return apiError(422, "INVALID_CURRENCY", "Choose a currency to be paid in.");
    const result = await requestPayout({ handle: profile.handle, currency, initiatedBy: user.userId });
    if (!result.ok) return apiError(409, result.blocker.toUpperCase(), result.message);
    await env.DB.prepare(
      "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,details) VALUES(?,?,'affiliate_payout_requested','creator_payout',?,?)",
    ).bind(user.userId, user.role, String(result.payoutId), JSON.stringify({ handle: profile.handle, amount: result.amount, currency: result.currency, transferId: result.transferId })).run();
    return Response.json({ ok: true, payoutId: result.payoutId, amount: result.amount, currency: result.currency });
  }

  return apiError(422, "UNKNOWN_ACTION", "Unknown action.");
}
