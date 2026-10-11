import { env } from "cloudflare:workers";
import { apiError, readTextCapped } from "../../../api-utils";
import { verifyWebhookSignature } from "../../../stripe";
import { GRACE_DAYS, planForStatus } from "../../../entitlement";
import { buildPaymentFailedEmail, sendEmail } from "../../../email";
import { commissionFor, rateForInterval, type BillingInterval } from "../../../affiliate-program";
import { fetchSubscription, invoiceForPayment, previewNextCharge, priceIdForPlan } from "../../../stripe";
import {
  buildPurchaseEmail, buildRenewalReminderEmail, buildTrialEndingEmail, emailLocale, subscriptionTerms,
  type EmailLocale, type StripeSubscriptionLike,
} from "../../../billing-emails";
import { markPayoutFailed, markPayoutPaid, payoutForTransfer } from "../../../affiliate-payouts";
import { resolvePlan } from "../../../apple-entitlement";

interface StripeEvent {
  id?: string;
  type?: string;
  /** Present on events Stripe sends *about* a connected account rather than the platform. */
  account?: string;
  data?: {
    object?: {
      id?: string;
      /** Connect: capability state on an account.updated. */
      payouts_enabled?: boolean;
      requirements?: { currently_due?: string[]; past_due?: string[] };
      /** Connect: the transfer a payout.* event settles, and the reason it failed. */
      failure_message?: string;
      failure_code?: string;
      amount_reversed?: number;
      destination?: string;
      metadata?: Record<string, string>;
      customer?: string;
      subscription?: string;
      client_reference_id?: string;
      status?: string;
      amount_paid?: number;
      /** Invoice line items, read only to tell a monthly invoice from a yearly one. */
      lines?: {
        data?: Array<{
          price?: { id?: string; recurring?: { interval?: string } | null } | null;
          plan?: { id?: string; interval?: string } | null;
          period?: { start?: number; end?: number };
        }>;
      };
      amount_due?: number;
      attempt_count?: number;
      currency?: string;
      amount_refunded?: number;
      invoice?: string;
      /** A dispute's charge and payment intent; a charge's own payment intent. */
      charge?: string;
      payment_intent?: string;
      pause_collection?: { resumes_at?: number | null } | null;
      /** A subscription's trial end, read by trial_will_end. */
      trial_end?: number | null;
      cancel_at_period_end?: boolean;
      cancel_at?: number | null;
      /** An upcoming invoice: when Stripe will try to collect it. */
      next_payment_attempt?: number | null;
      /** Where an invoice's subscription metadata lives, before and after Stripe's 2025-03-31 API. */
      subscription_details?: { metadata?: Record<string, string> | null } | null;
      parent?: { subscription_details?: { subscription?: string; metadata?: Record<string, string> | null } | null } | null;
    };
  };
}

// Which Stripe statuses grant Pro, and for how long a declined card keeps it, both live in
// app/entitlement.ts - the same module the session, the dashboard and the phone app read, so
// an entitlement decision cannot mean one thing here and another there.

/**
 * Whether a subscription event is about the subscription the account has now: the one it stores,
 * or any at all when the stored one is missing or finished. Bound to the event's subscription id.
 */
const CURRENT_SUBSCRIPTION = "(stripe_subscription_id IS NULL OR stripe_subscription_id=? OR plan_status IN ('canceled','incomplete_expired'))";

/**
 * Credit a creator for a paid invoice, if the person who paid arrived through one.
 *
 * Accrual hangs off `invoice.paid` rather than `checkout.session.completed` because the deal is
 * a share of every payment, not a one-off bounty: the first invoice and the twelfth both come
 * through here, so renewals are earned without a second code path. checkout.session.completed
 * still does the entitlement, and deliberately does not accrue — the first payment's invoice
 * arrives here too, and paying it twice is the one mistake a payables table must not make.
 *
 * `users.referred_by` is stamped once at sign-up and never rewritten, so attribution cannot be
 * moved to a different creator later by re-visiting someone else's link. A referral to a handle
 * that has since been paused or deleted earns nothing, which is what pausing a creator is for.
 *
 * Amounts stay in the invoice's own currency as integer minor units. Radar Pro is quoted in
 * several currencies, and converting here would bake today's rate into a row someone gets paid
 * from next month.
 */
/**
 * Whether this invoice is for the monthly plan or the yearly one.
 *
 * Read off the invoice's own line items rather than by fetching the subscription, because the
 * answer is already in the event and a second API call is a second thing that can fail while
 * money is being recorded.
 *
 * Two ways of asking, because Stripe's payload has carried both over the years: the modern
 * `price` object and the older `plan`. The configured yearly price id is checked first, since
 * that is Radar's own definition of "the yearly plan"; the interval field is the fallback, which
 * catches a price that was swapped in Stripe without the env var following it.
 *
 * Defaults to monthly when neither can be read. That is the common case and the long-standing
 * behavior, and the resulting rate is stamped visibly on the commission row — so a
 * misclassification shows up as a wrong rate in the portal and the console rather than as a
 * silent one.
 */
function billingIntervalFor(object: NonNullable<NonNullable<StripeEvent["data"]>["object"]>): BillingInterval {
  const yearlyPriceId = priceIdForPlan("yearly");
  for (const line of object.lines?.data || []) {
    const priceId = line.price?.id || line.plan?.id;
    if (yearlyPriceId && priceId === yearlyPriceId) return "year";
    if ((line.price?.recurring?.interval || line.plan?.interval) === "year") return "year";
  }
  return "month";
}

async function accrueCommission(object: NonNullable<NonNullable<StripeEvent["data"]>["object"]>) {
  const invoiceId = object.id, customerId = object.customer, amountPaid = object.amount_paid;
  // A zero-amount invoice is a trial or a fully-discounted period. There is nothing to share.
  if (!invoiceId || !customerId || typeof amountPaid !== "number" || amountPaid <= 0) return null;
  const subscriber = await env.DB.prepare("SELECT id,referred_by,referred_campaign FROM users WHERE stripe_customer_id=?")
    .bind(customerId).first<{ id: string; referred_by: string | null; referred_campaign: string | null }>();
  if (!subscriber?.referred_by) return null;
  const creator = await env.DB.prepare("SELECT user_id,handle,commission_rate_bps FROM creator_profiles WHERE handle=? AND status='active'")
    .bind(subscriber.referred_by).first<{ user_id: string; handle: string; commission_rate_bps: number }>();
  if (!creator) return null;
  // A creator does not earn on their own subscription.
  if (creator.user_id === subscriber.id) return null;
  // The profile's rate is the monthly one; a yearly invoice earns the program's yearly rate.
  // Both plans have always accrued — invoice.paid fires for each, and nothing here filters by
  // price — but until now both accrued at the same share, which paid more on the cheaper plan.
  const interval = billingIntervalFor(object);
  const rateBps = rateForInterval(interval, Number(creator.commission_rate_bps) || 0);
  if (rateBps <= 0) return null;
  // The share itself is app/affiliate-program.ts's to decide, so the portal's arithmetic and the
  // accrual's cannot drift. It rounds down: never accrue more than the share comes to.
  const commission = commissionFor(amountPaid, rateBps);
  if (commission <= 0) return null;
  // OR IGNORE against the unique index on invoice_id — the event-level claim above only catches a
  // repeat of the same event id, and two event ids can describe one invoice.
  const written = await env.DB.prepare(
    `INSERT OR IGNORE INTO creator_commissions(handle,user_id,invoice_id,subscription_id,campaign,gross_amount,currency,rate_bps,commission_amount)
     VALUES(?,?,?,?,?,?,?,?,?)`,
  ).bind(creator.handle,subscriber.id,invoiceId,object.subscription || null,subscriber.referred_campaign,amountPaid,(object.currency || "cad").toLowerCase(),rateBps,commission).run();
  return written.meta.changes ? { handle: creator.handle, userId: subscriber.id, commission, rateBps } : null;
}

/**
 * Take back a commission on an invoice whose money has been given back.
 *
 * Without this a refund left the creator's row `pending` and payable, which means paying out a
 * share of money Radar no longer has. The manual remedy - a member of staff voiding the row in the
 * admin workspace - only works if somebody remembers, every time, forever.
 *
 * Voided, never deleted. A creator who was shown a figure has to be able to find out what happened
 * to it, and a voided row explains itself where a missing one cannot. The creator workspace already
 * shows voided amounts separately for exactly this reason.
 *
 * A row already marked `paid` is left alone. The money has left Radar's account; reversing the
 * ledger entry would not bring it back and would quietly disagree with what was actually paid.
 * Those are a conversation, not a database update, so they are reported rather than changed.
 */
async function clawBackCommission(invoiceId: string | undefined, reason: string) {
  if (!invoiceId) return null;
  const row = await env.DB.prepare("SELECT id,handle,status,payout_id,commission_amount,currency FROM creator_commissions WHERE invoice_id=?")
    .bind(invoiceId).first<{ id: number; handle: string; status: string; payout_id: number | null; commission_amount: number; currency: string }>();
  if (!row || row.status === "void") return null;
  // Already settled, or claimed by a payout that is in flight. Either way the money is gone or
  // going, and voiding the row would make the ledger disagree with what Stripe actually sent.
  // Reported rather than changed — this is a conversation, not an UPDATE.
  if (row.status === "paid" || row.payout_id !== null) {
    return { handle: row.handle, amount: row.commission_amount, currency: row.currency, alreadyPaid: true };
  }
  // `pending` and `approved` are both reversible: neither has been paid and neither is claimed.
  // Approved matters most — it is the state a commission sits in while it waits to be paid, so a
  // refund arriving during that wait is exactly the case the hold period exists to catch.
  await env.DB.prepare(
    "UPDATE creator_commissions SET status='void' WHERE id=? AND status IN ('pending','approved') AND payout_id IS NULL",
  ).bind(row.id).run();
  return { handle: row.handle, amount: row.commission_amount, currency: row.currency, alreadyPaid: false, reason };
}

// ── Billing notices ─────────────────────────────────────────────────────────────────────────────
//
// The purchase acknowledgment, the trial-ending notice and the yearly renewal reminder. The copy
// and the reasons for each live in app/billing-emails.ts; this half finds who to send to and what
// the subscription will charge.

interface BillingRecipient { id: string; email: string; name: string | null; timezone: string | null }

async function billingRecipient(customerId: string | undefined, userId?: string | null) {
  if (userId) {
    const byId = await env.DB.prepare("SELECT id,email,name,timezone FROM users WHERE id=?").bind(userId).first<BillingRecipient>();
    if (byId) return byId;
  }
  if (!customerId) return null;
  return env.DB.prepare("SELECT id,email,name,timezone FROM users WHERE stripe_customer_id=?").bind(customerId).first<BillingRecipient>();
}

function siteUrl(request: Request, locale: EmailLocale, path: string) {
  const origin = (env as unknown as Record<string, string>).PUBLIC_APP_URL || new URL(request.url).origin;
  return `${origin}/${locale}${path}`;
}
const accountUrl = (request: Request, locale: EmailLocale) => siteUrl(request, locale, "/dashboard/billing");

/**
 * Send one billing notice and record the outcome either way.
 *
 * A failed send never fails the webhook: Stripe would retry the whole event and redo the
 * entitlement work beside it. It is recorded instead, as `billing_notice_failed`, so a notice that
 * stopped going out shows up in product_events rather than nowhere. Transactional, with no
 * unsubscribe header: these are about money the reader has agreed to pay.
 */
async function sendBillingNotice(
  recipient: BillingRecipient,
  kind: "purchase" | "trial_ending" | "renewal_reminder",
  mail: { subject: string; html: string; text: string },
  properties: Record<string, unknown>,
) {
  let sent = true, error: string | null = null;
  try { await sendEmail({ to: recipient.email, subject: mail.subject, html: mail.html, text: mail.text, tag: `billing-${kind}`, audience: "transactional" }); }
  catch (cause) { sent = false; error = cause instanceof Error ? cause.message : "UNKNOWN"; }
  await env.DB.prepare("INSERT INTO product_events(id,user_id,type,entity_id,properties) VALUES(?,?,?,?,?)")
    .bind(crypto.randomUUID(), recipient.id, sent ? "billing_notice_sent" : "billing_notice_failed", null, JSON.stringify({ kind, ...properties, ...(error ? { error } : {}) })).run();
}

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string,string>;
  const secret = runtime.STRIPE_WEBHOOK_SECRET;
  const signatureHeader = request.headers.get("stripe-signature");
  if (!secret || !signatureHeader) return apiError(401,"INVALID_WEBHOOK","Webhook authentication failed.");
  // Read with a ceiling before the signature is checked: anyone can post here with some header, and
  // an unbounded body is memory the isolate shares with every other request on it. Stripe's events
  // are a few kilobytes; a megabyte is far beyond any real one.
  let rawBody:string; try { rawBody = await readTextCapped(request,1_000_000); } catch { return apiError(413,"PAYLOAD_TOO_LARGE","Webhook body is too large."); }
  if (!(await verifyWebhookSignature(secret,rawBody,signatureHeader))) return apiError(401,"INVALID_WEBHOOK","Webhook authentication failed.");
  let event:StripeEvent; try { event = JSON.parse(rawBody); } catch { return apiError(400,"INVALID_WEBHOOK_BODY","Webhook body is invalid."); }
  const eventKey = `stripe:${event.id || crypto.randomUUID()}`;
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO mutation_keys(key,actor_id,action,response) VALUES(?,'stripe','stripe_webhook','processing')").bind(eventKey).run();
  if (!claimed.meta.changes) return Response.json({ok:true,duplicate:true});
  // The claim above is taken before any work, so a handler that throws partway (a D1 error, a
  // Stripe call failing) used to leave the event marked as seen: the request 500s, the retry finds
  // the row, answers {duplicate:true}, and the event is never applied.
  try {
    const object = event.data?.object || {};
    // Forward instrumentation for the admin Growth tab's future subscription trend/MRR charts —
    // there's no way to backfill history for events that already happened before this existed, so
    // this only makes today's events visible to tomorrow's queries, not past ones.
    async function logSubscriptionEvent(type: string, userId: string | null, properties: Record<string,unknown>) {
      await env.DB.prepare("INSERT INTO product_events(id,user_id,type,entity_id,properties) VALUES(?,?,?,?,?)")
        .bind(crypto.randomUUID(),userId,type,object.subscription || null,JSON.stringify(properties)).run();
    }
    if (event.type === "checkout.session.completed") {
      const customerId = object.customer,subscriptionId = object.subscription,userId = object.client_reference_id;
      if (customerId && subscriptionId) {
        // past_due_since is cleared on every path that makes a subscription current again: a new
        // checkout, a recovered invoice, or a status change back to active. A stale stamp would
        // have the grace period counting down against a subscription that is already paid up.
        if (userId) await env.DB.prepare("UPDATE users SET plan='pro',plan_status='active',past_due_since=NULL,stripe_customer_id=?,stripe_subscription_id=? WHERE id=?").bind(customerId,subscriptionId,userId).run();
        else await env.DB.prepare("UPDATE users SET plan='pro',plan_status='active',past_due_since=NULL,stripe_subscription_id=? WHERE stripe_customer_id=?").bind(subscriptionId,customerId).run();
        const resolvedUserId = userId || (await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id=?").bind(customerId).first<{id:string}>())?.id || null;
        await logSubscriptionEvent("subscription_started",resolvedUserId,{customerId});
        // The acknowledgment: the terms they agreed to, how it renews and how to cancel, in a form
        // they can keep (California's auto-renewal law; the trial variant also covers Bill 10's
        // up-front terms). Read from the subscription, since the session does not say the period or
        // the trial. Without it there is nothing true to put in the email, so none is sent and the
        // skip is recorded.
        const recipient = await billingRecipient(customerId,resolvedUserId);
        if (recipient?.email) {
          const subscription = await fetchSubscription(subscriptionId);
          if (!subscription) {
            await logSubscriptionEvent("billing_notice_failed",recipient.id,{kind:"purchase",error:"SUBSCRIPTION_UNREADABLE"});
          } else {
            const terms = subscriptionTerms(subscription);
            const locale = emailLocale(object.metadata?.locale ?? subscription.metadata?.locale);
            const price = (await previewNextCharge(subscriptionId)) || terms.price;
            const mail = buildPurchaseEmail({
              locale, recipientName: recipient.name, timezone: recipient.timezone, accountUrl: accountUrl(request,locale),
              interval: terms.interval, price, trialEnd: terms.trialEnd, renewsAt: terms.periodEnd,
              termsUrl: siteUrl(request,locale,"/terms"),
              // Stripe sends trial_will_end three days before the end, so a second notice only comes
              // for a trial longer than that; see the trial_will_end branch.
              remindLater: Boolean(terms.trialEnd && terms.trialEnd * 1000 - Date.now() > 4 * 86_400_000),
            });
            await sendBillingNotice(recipient,"purchase",mail,{locale,interval:terms.interval,trial:Boolean(terms.trialEnd)});
          }
        }
      }
    } else if (event.type === "invoice.paid") {
      // Every paid invoice, not only the attributed ones. This is the only record Radar keeps of
      // money actually collected. Stripe knows, but the Growth tab cannot ask Stripe, and
      // `users.plan` says someone is on Pro without saying what they paid or how often - a monthly
      // and a yearly subscriber are indistinguishable from the users table alone, so revenue
      // computed from a headcount would be wrong for every annual plan and quietly wrong in total.
      //
      // Written before the accrual, so an unattributed or refused commission never costs the
      // revenue row beside it.
      const amountPaid = object.amount_paid;
      if (typeof amountPaid === "number" && amountPaid > 0) {
        const payer = object.customer
          ? (await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id=?").bind(object.customer).first<{id:string}>())?.id || null
          : null;
        await logSubscriptionEvent("invoice_paid",payer,{amount:amountPaid,currency:(object.currency || "cad").toLowerCase(),invoiceId:object.id || null});
      }
      // A paid invoice ends any dunning: whatever Stripe says the subscription status is, money
      // arrived. Clearing here rather than waiting for customer.subscription.updated means the
      // banner goes away the moment the retry succeeds.
      if (object.customer)
        await env.DB.prepare("UPDATE users SET past_due_since=NULL WHERE stripe_customer_id=? AND past_due_since IS NOT NULL").bind(object.customer).run();
      const accrued = await accrueCommission(object);
      if (accrued)
        await logSubscriptionEvent("creator_commission_accrued",accrued.userId,{handle:accrued.handle,commission:accrued.commission,rateBps:accrued.rateBps});
    } else if (event.type === "charge.refunded" || event.type === "credit_note.created" || event.type === "charge.dispute.created") {
      // Three events for one situation: a refund issued against the charge, a credit note issued
      // against the invoice, and a chargeback. A credit note names its invoice. A refunded charge
      // names it only on API versions before 2025-03-31, and a dispute names only the charge, so
      // those two are looked up at Stripe when the invoice is not on the event.
      const invoiceId = object.invoice
        || (event.type === "credit_note.created"
          ? undefined
          : await invoiceForPayment(event.type === "charge.dispute.created" ? object.charge : object.id, object.payment_intent)) || undefined;
      if (!invoiceId && event.type !== "credit_note.created")
        await logSubscriptionEvent("commission_clawback_unmatched", null, { event: event.type, objectId: object.id || null });
      const clawed = await clawBackCommission(invoiceId, event.type);
      if (clawed)
        await logSubscriptionEvent(
          clawed.alreadyPaid ? "commission_refund_after_payout" : "commission_clawed_back",
          null,
          { handle: clawed.handle, amount: clawed.amount, currency: clawed.currency, invoiceId },
        );
    } else if (event.type === "invoice.payment_failed") {
      // Telling someone their card failed is the whole of dunning that Radar can do - Stripe
      // handles the retries. Sent once, on the transition into failure, because `attempt_count`
      // rises with every retry and mailing on each one turns a helpful notice into a nag.
      //
      // Entitlement is untouched here: customer.subscription.updated is what moves the account
      // to past_due, and this branch only writes the email.
      const customerId = object.customer;
      if (customerId && (object.attempt_count ?? 1) <= 1) {
        const payer = await env.DB.prepare("SELECT id,email,name FROM users WHERE stripe_customer_id=?").bind(customerId).first<{id:string;email:string;name:string|null}>();
        await logSubscriptionEvent("invoice_payment_failed",payer?.id || null,{attempt:object.attempt_count ?? 1});
        if (payer?.email) {
          const origin = new URL(request.url).origin;
          const amount = typeof object.amount_due === "number" && object.amount_due > 0
            ? `${(object.amount_due / 100).toFixed(2)} ${(object.currency || "cad").toUpperCase()}`
            : null;
          const mail = buildPaymentFailedEmail({ recipientName: payer.name, graceDays: GRACE_DAYS, billingUrl: `${origin}/dashboard/billing`, amount });
          // Never let a mail failure fail the webhook: Stripe would retry the whole event and the
          // entitlement work beside it would run again for nothing.
          try { await sendEmail({ to: payer.email, subject: mail.subject, html: mail.html, text: mail.text, tag: "payment-failed", audience: "transactional" }); }
          catch { /* logged by the event above; the in-app banner still tells them */ }
        }
      }
    } else if (event.type === "customer.subscription.updated") {
      const customerId = object.customer,status = object.status || "unknown";
      if (customerId) {
        // past_due keeps Pro (see app/entitlement.ts) and stamps when the dunning started, but
        // only the first time: a second past_due webhook must not restart the grace clock and
        // hand out another three weeks. COALESCE is what keeps the original stamp.
        // Stripe keeps a paused subscription `active` — pausing stops the invoices, not the
        // subscription — so the pause has to be mirrored separately or a paused account reads as a
        // paying one. Stripe clears `pause_collection` itself when `resumes_at` arrives and sends
        // this event again, which is what un-pauses the account with no job of ours involved.
        const resumesAt = object.pause_collection?.resumes_at;
        const pausedUntil = resumesAt ? new Date(resumesAt * 1000).toISOString().slice(0,19).replace("T"," ") : null;
        // The subscription's own id is written too: it is what says plan_status is Stripe's word (see
        // app/plan-resolution.ts). And the row is only written when this event is about the
        // subscription the account has now, or when it has none that is still running. Stripe does
        // not promise order, and a late event about a subscription somebody replaced months ago
        // would otherwise write that old subscription's status over the live one's.
        await env.DB.prepare(
          `UPDATE users SET plan_status=?,plan=?,paused_until=?,past_due_since=CASE WHEN ?='past_due' THEN COALESCE(past_due_since,CURRENT_TIMESTAMP) ELSE NULL END,stripe_subscription_id=COALESCE(?,stripe_subscription_id)
            WHERE stripe_customer_id=? AND ${CURRENT_SUBSCRIPTION}`,
        ).bind(status,planForStatus(status),pausedUntil,status,object.id || null,customerId,object.id || "").run();
        const resolvedUserId = (await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id=?").bind(customerId).first<{id:string}>())?.id || null;
        // An App Store subscription or an admin grant can still be paying for Pro when this one
        // stops; the plan is recomputed from all of them rather than taken from this event.
        if (resolvedUserId) await resolvePlan(resolvedUserId);
        await logSubscriptionEvent("subscription_updated",resolvedUserId,{status,paused:Boolean(pausedUntil)});
      }
    } else if (event.type === "customer.subscription.deleted") {
      const customerId = object.customer;
      if (customerId) {
        const resolvedUserId = (await env.DB.prepare("SELECT id FROM users WHERE stripe_customer_id=?").bind(customerId).first<{id:string}>())?.id || null;
        // winback_sent_at is cleared alongside the rest: somebody who subscribed, lapsed, came back and
        // lapsed again is eligible for the win-back a second time. Leaving the old stamp would make
        // the first lapse silence every one after it.
        await env.DB.prepare(`UPDATE users SET plan='free',plan_status='canceled',past_due_since=NULL,paused_until=NULL,winback_sent_at=NULL WHERE stripe_customer_id=? AND ${CURRENT_SUBSCRIPTION}`).bind(customerId,object.id || "").run();
        // Somebody who canceled on the web and pays Apple keeps Pro; the plan comes from both.
        if (resolvedUserId) await resolvePlan(resolvedUserId);
        await logSubscriptionEvent("subscription_canceled",resolvedUserId,{});
      }
    } else if (event.type === "customer.subscription.trial_will_end") {
      // Stripe sends this three days before a trial ends, which sits inside the 2 to 10 days Quebec's
      // Bill 10 asks for. The notice has to give the end date and the price that will be charged.
      // A trial already set to cancel converts into nothing, so telling that person they are about
      // to be charged would be untrue; they get no mail.
      //
      // Radar's trial is three days, so Stripe sends this the moment the trial starts, alongside
      // checkout.session.completed. The trial-start acknowledgment already carries the same date
      // and price, so when it went out in the last day this one is skipped rather than sent twice.
      // If that acknowledgment failed, this one still goes.
      const subscription = object as StripeSubscriptionLike;
      const terms = subscriptionTerms(subscription);
      const trialEnd = subscription.trial_end;
      const recipient = await billingRecipient(object.customer);
      const alreadyNoticed = recipient ? await env.DB.prepare(
        `SELECT 1 ok FROM product_events WHERE user_id=? AND type='billing_notice_sent'
            AND json_extract(properties,'$.kind')='purchase' AND json_extract(properties,'$.trial')=1
            AND created_at > datetime('now','-1 day') LIMIT 1`,
      ).bind(recipient.id).first() : null;
      if (recipient?.email && trialEnd && !terms.endsAtPeriodEnd && subscription.status === "trialing" && !alreadyNoticed) {
        const price = (object.id ? await previewNextCharge(object.id) : null) || terms.price;
        const mail = buildTrialEndingEmail({
          locale: terms.locale, recipientName: recipient.name, timezone: recipient.timezone, accountUrl: accountUrl(request,terms.locale),
          interval: terms.interval, price, trialEnd,
        });
        await sendBillingNotice(recipient,"trial_ending",mail,{locale:terms.locale,trialEnd,priceKnown:Boolean(price)});
      }
    } else if (event.type === "invoice.upcoming") {
      // The yearly renewal reminder. Stripe sends invoice.upcoming the number of days ahead set in
      // the dashboard (Billing > Subscriptions and emails > Upcoming renewal events), for every
      // plan; only the yearly one gets a mail, since a monthly reminder every month is noise and no
      // law asks for it. The state windows for annual plans (California 15-45 days, Colorado 25-40,
      // Virginia 30-60, Minnesota 15-30) all include 30 days, which is the setting to use. The
      // days ahead are recorded with each send, so a dashboard set to anything else shows up.
      //
      // The amount is the invoice's own, which already counts discounts and the subscriber's
      // currency. The subscription is read for the reader's language, and to skip anyone who has
      // already cancelled: their plan is not renewing, whatever the invoice preview says.
      const subscriptionId = object.subscription || object.parent?.subscription_details?.subscription;
      if (billingIntervalFor(object) === "year") {
        const recipient = await billingRecipient(object.customer);
        const subscription = subscriptionId ? await fetchSubscription(subscriptionId) : null;
        const terms = subscription ? subscriptionTerms(subscription) : null;
        const renewsAt = object.lines?.data?.[0]?.period?.start || object.next_payment_attempt || terms?.periodEnd || null;
        if (recipient?.email && renewsAt && !terms?.endsAtPeriodEnd) {
          const locale = emailLocale(subscription?.metadata?.locale ?? object.subscription_details?.metadata?.locale ?? object.parent?.subscription_details?.metadata?.locale);
          const price = typeof object.amount_due === "number" && object.currency ? { amount: object.amount_due, currency: object.currency.toLowerCase() } : terms?.price || null;
          const mail = buildRenewalReminderEmail({ locale, recipientName: recipient.name, timezone: recipient.timezone, accountUrl: accountUrl(request,locale), price, renewsAt });
          const daysAhead = Math.round((renewsAt * 1000 - Date.now()) / 86_400_000);
          await sendBillingNotice(recipient,"renewal_reminder",mail,{locale,renewsAt,daysAhead});
        }
      }
    } else if (event.type === "account.updated") {
      // Stripe's own answer to "may this account be paid", mirrored so the portal can explain a
      // blocked payout without calling Stripe on every page load. Keyed on the account id rather
      // than the handle: the id is what Stripe knows, and the unique index on the column makes it
      // exactly one profile.
      const accountId = object.id || event.account;
      if (accountId) {
        const due = new Set([...(object.requirements?.currently_due || []), ...(object.requirements?.past_due || [])]);
        await env.DB.prepare(
          `UPDATE creator_profiles
              SET payouts_enabled=?,requirements_due=?,connect_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
            WHERE stripe_account_id=?`,
        ).bind(object.payouts_enabled === true ? 1 : 0, due.size, accountId).run();
        await logSubscriptionEvent("affiliate_connect_updated", null, { accountId, payoutsEnabled: object.payouts_enabled === true, requirementsDue: due.size });
      }
    } else if (event.type === "transfer.created") {
      // A safety net, not the settlement.
      //
      // A payout is marked paid the moment createTransfer returns, because that is when the money
      // moved — see app/affiliate-payouts.ts. This branch exists for the narrow window where Stripe
      // made the transfer and Radar never recorded it: the isolate was killed, or D1 was briefly
      // unavailable, between the API call returning and the row being written. Stripe then tells us
      // about a transfer we have a row for but never settled, and markPayoutPaid, which does
      // nothing to a payout already paid, finishes the job.
      //
      // Deliberately keyed on the transfer id rather than the metadata, so a transfer created by
      // anything other than this code path is looked up, found to be unknown, and ignored.
      if (object.id) {
        const payout = await payoutForTransfer(object.id);
        if (payout && await markPayoutPaid(payout.id)) {
          await logSubscriptionEvent("affiliate_payout_recovered", null, { handle: payout.handle, payoutId: payout.id, amount: payout.amount, currency: payout.currency });
        }
      }
    } else if (event.type === "transfer.reversed") {
      // The money came back to Radar's balance, so the affiliate is owed it again: the payout is
      // marked failed and every commission it covered is reopened, whether it had settled or not.
      //
      // Only a full reversal does that. Stripe allows a transfer to be reversed in parts, and
      // `amount_reversed` is the running total — reopening the whole payout because a fraction of
      // it came back would credit an affiliate for money Radar still holds on their behalf. A
      // partial reversal is recorded for a person to look at, because nothing in Radar creates one.
      if (object.id) {
        const payout = await payoutForTransfer(object.id);
        if (payout) {
          const reversed = Number(object.amount_reversed) || 0;
          if (reversed >= payout.amount) {
            const reason = object.failure_message || object.failure_code || "transfer.reversed";
            if (await markPayoutFailed(payout.id, reason)) {
              await logSubscriptionEvent("affiliate_payout_reversed", null, { handle: payout.handle, payoutId: payout.id, amount: payout.amount, currency: payout.currency, reason });
            }
          } else {
            await logSubscriptionEvent("affiliate_payout_partly_reversed", null, { handle: payout.handle, payoutId: payout.id, amount: payout.amount, reversed, currency: payout.currency });
          }
        }
      }
    } else if (event.type === "payout.paid") {
      // The connected account's own bank run landing, which is between the affiliate and Stripe.
      // Recorded, never settled against: one bank payout can cover several of Radar's transfers,
      // and Radar's side of this was finished when the transfer succeeded.
      await logSubscriptionEvent("affiliate_bank_payout_paid", null, {
        account: event.account || null,
        stripePayoutId: object.id || null,
      });
    } else if (event.type === "payout.failed") {
      // Stripe could not move money from the affiliate's Stripe balance into their bank — a stale
      // account number, usually. Deliberately NOT resolved to a Radar payout and NOT reversed:
      // `object.id` here is a Stripe payout id, one bank run can cover several of Radar's
      // transfers, and Radar's side of this completed successfully. The money is still theirs, sat
      // at Stripe, and what fixes it is the affiliate correcting their bank details. So this is
      // recorded for staff to act on, and nothing in the ledger moves.
      await logSubscriptionEvent("affiliate_bank_payout_failed", null, {
        account: event.account || null,
        stripePayoutId: object.id || null,
        reason: object.failure_message || object.failure_code || "unknown",
      });
    }
  } catch (error) {
    // Give the claim back so the provider's retry applies the event instead of reading it as a
    // duplicate. The state writes are safe to repeat (plan and payout updates set a value, and
    // commissions are unique per invoice); at worst a retry logs an analytics event twice, which
    // is a far smaller cost than a paid plan that never turns on or a cancellation that never lands.
    await env.DB.prepare("DELETE FROM mutation_keys WHERE key=? AND response='processing'").bind(eventKey).run();
    throw error;
  }
  await env.DB.prepare("UPDATE mutation_keys SET response='processed' WHERE key=?").bind(eventKey).run();
  return Response.json({ok:true});
}
