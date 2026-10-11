import { env } from "cloudflare:workers";
import { apiError, hasJobSecret } from "../../../api-utils";
import { buildWinbackEmail, canDeliverTo, emailConfiguration, sendEmail, signUnsubscribe } from "../../../email";
import { GRACE_DAYS } from "../../../entitlement";
import { resolvePlan } from "../../../apple-entitlement";
import { cancelSubscription, fetchSubscription, previewNextCharge, resumeSubscription, stripeConfigured } from "../../../stripe";
import { buildAnnualReminderEmail, buildPauseEndingEmail, subscriptionTerms } from "../../../billing-emails";

// The five things Pro needs doing to it on a clock rather than on a webhook.
//
//   1. Cancel anything still past_due past the grace window.
//   2. Resume a pause Stripe should have ended and did not.
//   3. Take Pro back from an admin grant whose end date has passed.
//   4. Tell somebody their pause ends soon, before billing restarts.
//   5. Remind a monthly subscriber once a year that Pro renews, and how to cancel.
//   6. Send one win-back email to somebody who lapsed a month ago.
//
// Run hourly from the worker's cron alongside the digest and translation jobs, and gated on the
// same kind of shared secret. Each step is independent: one failing must not stop the others, since
// they have nothing to do with each other beyond all being about billing.

/** Lapsed this long ago before a win-back is worth sending. */
const WINBACK_AFTER_DAYS = 30;
/** And not after this: past a couple of months, a win-back reads as a company that forgot you left. */
const WINBACK_BEFORE_DAYS = 90;
/** Nobody gets a marketing email at 3am. Sent between these hours in the recipient's own timezone. */
const WINBACK_HOURS = [10, 18];

/**
 * Cancel subscriptions whose grace period has run out.
 *
 * Stripe's own retry schedule is a dashboard setting, and its default runs four attempts across
 * about three weeks. Honoring that would hand out three weeks of unpaid Pro every time a card
 * expired, so this enforces the real limit from Radar's side: past GRACE_DAYS, the subscription is
 * canceled outright regardless of what the dashboard says. A dashboard misconfigured back to the
 * default cannot quietly reopen the three weeks.
 *
 * `cancelSubscription` rather than cancel-at-period-end: the period in question is one they have
 * not paid for, which is the whole reason we are here.
 */
async function cancelExpiredGrace() {
  const overdue = await env.DB.prepare(
    `SELECT id,email,stripe_subscription_id FROM users
      WHERE plan_status='past_due' AND past_due_since IS NOT NULL
        AND past_due_since <= datetime('now','-${GRACE_DAYS} days')
      LIMIT 100`,
  ).all<{ id: string; email: string; stripe_subscription_id: string | null }>();
  let canceled = 0, failed = 0;
  for (const user of overdue.results || []) {
    // The local row is updated whether or not Stripe answers. A subscription we could not reach is
    // still one the customer has not paid for, and leaving them entitled because an API call failed
    // is the failure mode this job exists to prevent. Stripe's own eventual cancellation webhook
    // will agree with us later.
    if (user.stripe_subscription_id && stripeConfigured()) {
      try { await cancelSubscription(user.stripe_subscription_id); } catch { failed += 1; }
    }
    await env.DB.prepare(
      "UPDATE users SET plan='free',plan_status='canceled',past_due_since=NULL,winback_sent_at=NULL WHERE id=?",
    ).bind(user.id).run();
    // The web subscription is over; an App Store one or an admin grant may still be paying for Pro.
    await resolvePlan(user.id);
    await env.DB.prepare(
      "INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'subscription_canceled',?)",
    ).bind(crypto.randomUUID(), user.id, JSON.stringify({ cause: "grace_expired", graceDays: GRACE_DAYS })).run();
    canceled += 1;
  }
  return { canceled, failed };
}

/**
 * Resume pauses that should already have ended.
 *
 * Stripe clears `pause_collection` itself when `resumes_at` arrives, and the resulting webhook is
 * what normally un-pauses the account. This is the backstop for the webhook that never came: a
 * dropped event would otherwise leave somebody paused, and therefore without Pro, indefinitely -
 * a silent failure that looks to them like the product taking their money and giving nothing back.
 */
async function resumeFinishedPauses() {
  const due = await env.DB.prepare(
    `SELECT id,stripe_subscription_id FROM users
      WHERE paused_until IS NOT NULL AND paused_until <= datetime('now') LIMIT 100`,
  ).all<{ id: string; stripe_subscription_id: string | null }>();
  let resumed = 0, failed = 0;
  for (const user of due.results || []) {
    if (user.stripe_subscription_id && stripeConfigured()) {
      try { await resumeSubscription(user.stripe_subscription_id); } catch { failed += 1; continue; }
    }
    await env.DB.prepare("UPDATE users SET paused_until=NULL WHERE id=?").bind(user.id).run();
    await env.DB.prepare(
      "INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'subscription_resumed',?)",
    ).bind(crypto.randomUUID(), user.id, JSON.stringify({ cause: "pause_elapsed" })).run();
    resumed += 1;
  }
  return { resumed, failed };
}

/**
 * Take Pro back from admin grants whose end date has passed.
 *
 * Nothing happens on a grant's end date by itself. The grant stops counting the moment resolvePlan
 * next asks, but nothing asks until something else about the account changes, so without this a
 * comped month would run forever. The day named is still covered: a grant until 2026-10-15 lapses
 * at the first run on the 16th, UTC.
 *
 * The query only narrows the candidates to accounts a lapsed grant could still be holding on Pro:
 * no live grant left, no App Store subscription, and no web subscription that keeps Pro on its own.
 * resolvePlan makes the decision, the same one as everywhere else. Resolving takes an account out
 * of the query, so an hour with nothing lapsing writes nothing. It starts from plan_grants, which
 * stays tiny, rather than from every user.
 */
async function endLapsedGrants() {
  const lapsed = await env.DB.prepare(
    `SELECT u.id FROM users u
      WHERE u.id IN (SELECT user_id FROM plan_grants WHERE revoked_at IS NULL AND expires_at < date('now'))
        AND u.plan='pro'
        AND NOT EXISTS (SELECT 1 FROM plan_grants g WHERE g.user_id=u.id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at >= date('now')))
        AND NOT EXISTS (SELECT 1 FROM apple_subscriptions a WHERE a.user_id=u.id AND a.status IN ('active','grace_period'))
        AND NOT (u.stripe_subscription_id IS NOT NULL AND u.plan_status IN ('active','trialing','past_due'))
      LIMIT 100`,
  ).all<{ id: string }>();
  let resolved = 0;
  for (const user of lapsed.results || []) {
    await resolvePlan(user.id);
    resolved += 1;
  }
  return { resolved };
}

/** How far ahead of a pause ending its reminder goes out. Pauses run whole months (PAUSE_MONTHS). */
const PAUSE_REMINDER_DAYS = 7;

/**
 * Tell somebody their pause is about to end and billing will restart.
 *
 * Stripe has no event for this, so it is found on the clock: a pause ending within a week that has
 * not been told about yet. The record of having told them is the product_events row itself, keyed
 * on the pause's own end date, so a second pause later gets its own reminder and a retried hour
 * does not send this one twice.
 *
 * Transactional, like the trial-ending notice it mirrors: it is about a charge they agreed to, and
 * nobody should find out a pause has ended from their card statement.
 */
async function remindPausesEnding(emailEnabled: boolean) {
  if (!emailEnabled) return { sent: 0, failed: 0 };
  const ending = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.timezone,u.paused_until,u.stripe_subscription_id FROM users u
      WHERE u.paused_until IS NOT NULL AND u.stripe_subscription_id IS NOT NULL
        AND u.paused_until > datetime('now') AND u.paused_until <= datetime('now','+${PAUSE_REMINDER_DAYS} days')
        AND NOT EXISTS(SELECT 1 FROM product_events e WHERE e.user_id=u.id AND e.type='pause_ending_reminder_sent' AND e.entity_id=u.paused_until)
      LIMIT 50`,
  ).all<{ id: string; email: string; name: string | null; timezone: string | null; paused_until: string; stripe_subscription_id: string }>();
  const runtime = env as unknown as Record<string, string>;
  const origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
  let sent = 0, failed = 0;
  for (const person of ending.results || []) {
    // The subscription carries the reader's language and its price. When Stripe cannot be read the
    // notice still goes, in English and pointing at the account page for the price: late or vague
    // is better than a charge nobody was told about.
    const subscription = stripeConfigured() ? await fetchSubscription(person.stripe_subscription_id) : null;
    const terms = subscription ? subscriptionTerms(subscription) : null;
    // Cancelled while paused: nothing restarts, so there is nothing to warn about.
    if (terms?.endsAtPeriodEnd) continue;
    const locale = terms?.locale || "en";
    const price = (subscription ? await previewNextCharge(person.stripe_subscription_id) : null) || terms?.price || null;
    const resumesAt = Math.floor(Date.parse(`${person.paused_until.replace(" ", "T")}Z`) / 1000);
    const mail = buildPauseEndingEmail({
      locale, recipientName: person.name, timezone: person.timezone, accountUrl: `${origin}/${locale}/dashboard/billing`,
      interval: terms?.interval || "month", price, resumesAt,
    });
    try {
      await sendEmail({ to: person.email, subject: mail.subject, html: mail.html, text: mail.text, tag: "billing-pause_ending", audience: "transactional" });
      // Stamped only on a send that did not throw, so a provider outage is retried next hour.
      await env.DB.prepare("INSERT INTO product_events(id,user_id,type,entity_id,properties) VALUES(?,?,'pause_ending_reminder_sent',?,?)")
        .bind(crypto.randomUUID(), person.id, person.paused_until, JSON.stringify({ locale, priceKnown: Boolean(price) })).run();
      sent += 1;
    } catch { failed += 1; }
  }
  return { sent, failed };
}

/** A year, give or take a month: the yearly reminder goes out after this long since the last one. */
const ANNUAL_REMINDER_AFTER_DAYS = 335;

/**
 * The yearly reminder to a monthly subscriber.
 *
 * California (AB 2863), Connecticut (from July 1, 2026) and Minnesota require one every year for
 * every auto-renewing plan, not only yearly ones. Yearly plans are covered by the renewal reminder
 * on invoice.upcoming, so both count as "reminded" here and a yearly subscriber is never sent this
 * one as well.
 *
 * The clock starts at the subscription's start (its `subscription_started` event, or the account's
 * creation for subscriptions older than that event) or at the last reminder, whichever is later.
 * Stripe is read for the plan's period, its language and whether it is still renewing. A yearly
 * plan found here is recorded as covered rather than mailed, so it is not looked up again every
 * hour until its own renewal reminder arrives.
 */
async function remindAnnually(emailEnabled: boolean) {
  if (!emailEnabled || !stripeConfigured()) return { sent: 0, failed: 0, yearly: 0 };
  const due = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.timezone,u.stripe_subscription_id FROM users u
      WHERE u.stripe_subscription_id IS NOT NULL AND u.plan_status IN ('active','past_due') AND u.paused_until IS NULL
        AND COALESCE(
              (SELECT MAX(e.created_at) FROM product_events e WHERE e.user_id=u.id
                 AND (e.type='subscription_started'
                      OR (e.type IN ('billing_notice_sent','annual_reminder_covered')
                          AND json_extract(e.properties,'$.kind') IN ('annual_reminder','renewal_reminder')))),
              u.created_at) <= datetime('now','-${ANNUAL_REMINDER_AFTER_DAYS} days')
      LIMIT 50`,
  ).all<{ id: string; email: string; name: string | null; timezone: string | null; stripe_subscription_id: string }>();
  const runtime = env as unknown as Record<string, string>;
  const origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
  let sent = 0, failed = 0, yearly = 0;
  for (const person of due.results || []) {
    // Unreadable today is retried next hour; a reminder a day late is fine, one with the wrong
    // plan in it is not.
    const subscription = await fetchSubscription(person.stripe_subscription_id);
    if (!subscription) { failed += 1; continue; }
    const terms = subscriptionTerms(subscription);
    if (terms.interval === "year" || terms.endsAtPeriodEnd) {
      await env.DB.prepare("INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'annual_reminder_covered',?)")
        .bind(crypto.randomUUID(), person.id, JSON.stringify({ kind: "annual_reminder", reason: terms.interval === "year" ? "yearly_plan" : "not_renewing" })).run();
      yearly += 1;
      continue;
    }
    const locale = terms.locale;
    const price = (await previewNextCharge(person.stripe_subscription_id)) || terms.price;
    const mail = buildAnnualReminderEmail({
      locale, recipientName: person.name, timezone: person.timezone,
      accountUrl: `${origin}/${locale}/dashboard/billing`, termsUrl: `${origin}/${locale}/terms`,
      price, nextChargeAt: terms.periodEnd,
    });
    try {
      await sendEmail({ to: person.email, subject: mail.subject, html: mail.html, text: mail.text, tag: "billing-annual_reminder", audience: "transactional" });
      await env.DB.prepare("INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'billing_notice_sent',?)")
        .bind(crypto.randomUUID(), person.id, JSON.stringify({ kind: "annual_reminder", locale, priceKnown: Boolean(price) })).run();
      sent += 1;
    } catch { failed += 1; }
  }
  return { sent, failed, yearly };
}

/**
 * One win-back email to somebody who lapsed a month ago.
 *
 * Marketing rather than transactional: they are not a customer any more and nothing here is about
 * money they owe, so it goes through the consent gate like any campaign. Most lapsed accounts will
 * therefore never receive one, which is correct.
 *
 * Only sent when there is something true to say. The mail's whole argument is "the catalog has
 * grown since you left", so an account whose city gained nothing gets no mail rather than a mail
 * claiming otherwise.
 */
async function sendWinbacks(emailEnabled: boolean) {
  if (!emailEnabled) return { sent: 0, skipped: 0 };
  const hour = new Date().getUTCHours();
  // Consent and suppression are matched on the address without regard to case, as the digest
  // does. An unsubscribe stores the address lowercased, and an exact match against a users row
  // with a capital in it would find no suppression and mail somebody who asked not to be. They are
  // EXISTS tests rather than joins so that two confirmed consent rows for one address cannot put
  // the same person in the list twice and send them two win-backs in one run.
  const candidates = await env.DB.prepare(
    `SELECT u.id,u.email,u.name,u.timezone,
            (SELECT l.city FROM saved_locations l WHERE l.user_id=u.id AND l.active=1 ORDER BY l.is_default DESC,l.id LIMIT 1) city,
            (SELECT MAX(e.created_at) FROM product_events e WHERE e.user_id=u.id AND e.type='subscription_canceled') lapsed_at
       FROM users u
      WHERE u.plan='free' AND u.plan_status='canceled' AND u.winback_sent_at IS NULL
        AND u.status='active' AND u.hidden=0
        AND EXISTS(SELECT 1 FROM email_consents c WHERE lower(c.email)=lower(u.email) AND c.status='confirmed')
        AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(u.email))
      LIMIT 50`,
  ).all<{ id: string; email: string; name: string | null; timezone: string | null; city: string | null; lapsed_at: string | null }>();

  const runtime = env as unknown as Record<string, string>;
  const origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
  let sent = 0, skipped = 0;
  for (const person of candidates.results || []) {
    if (!person.lapsed_at) { skipped += 1; continue; }
    const lapsedDays = (Date.now() - Date.parse(`${person.lapsed_at.replace(" ", "T")}Z`)) / 86_400_000;
    if (lapsedDays < WINBACK_AFTER_DAYS || lapsedDays > WINBACK_BEFORE_DAYS) { skipped += 1; continue; }
    // A crude local hour, from the timezone offset the digest job already relies on. Good enough to
    // keep a marketing email out of the middle of somebody's night, which is all it needs to do.
    const localHour = localHourFor(person.timezone, hour);
    if (!WINBACK_HOURS.includes(localHour)) { skipped += 1; continue; }
    if (!(await canDeliverTo(person.email))) { skipped += 1; continue; }

    const grown = await env.DB.prepare(
      `SELECT COUNT(*) total FROM deals
        WHERE deleted_at IS NULL AND status='live' AND active=1 AND created_at > ?
          AND (? IS NULL OR city = ?)`,
    ).bind(person.lapsed_at, person.city, person.city).first<{ total: number }>();
    // Nothing new to point at means no honest reason to write.
    if (!grown?.total) { skipped += 1; continue; }

    const token = await signUnsubscribe(person.id, person.email);
    // The address goes in the link as well as the token, as in the digest, launch and sample
    // senders. The token is signed over the address, so /api/email/unsubscribe cannot check it
    // without one, and the unsubscribe page keeps its button disabled until it has both.
    const unsubscribeUrl = `${origin}/unsubscribe?email=${encodeURIComponent(person.email)}&token=${encodeURIComponent(token)}`;
    const mail = buildWinbackEmail({
      recipientName: person.name,
      newDeals: grown.total,
      city: person.city,
      proUrl: `${origin}/pro?from=winback`,
      unsubscribeUrl,
    });
    try {
      await sendEmail({ to: person.email, subject: mail.subject, html: mail.html, text: mail.text, tag: "winback", audience: "pilot", unsubscribeUrl });
      // Stamped only on a send that did not throw, so a provider outage does not silently burn
      // everybody's one chance at a win-back.
      await env.DB.prepare("UPDATE users SET winback_sent_at=CURRENT_TIMESTAMP WHERE id=?").bind(person.id).run();
      await env.DB.prepare(
        "INSERT INTO product_events(id,user_id,type,properties) VALUES(?,?,'winback_sent',?)",
      ).bind(crypto.randomUUID(), person.id, JSON.stringify({ newDeals: grown.total, city: person.city })).run();
      sent += 1;
    } catch { skipped += 1; }
  }
  return { sent, skipped };
}

/** UTC hour shifted into a named zone, or left as UTC when the zone is unusable. */
function localHourFor(timezone: string | null, utcHour: number) {
  if (!timezone) return utcHour;
  try {
    return Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "numeric", hour12: false }).format(new Date()));
  } catch {
    return utcHour;
  }
}

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string>;
  if (!hasJobSecret(request, runtime.BILLING_JOB_SECRET))
    return apiError(401, "INVALID_SCHEDULER", "Scheduler authentication failed.");

  const config = emailConfiguration();
  const emailEnabled = config.pilotEnabled && !config.killSwitch && config.providerConfigured;

  // Sequential rather than parallel, and each wrapped: these all write to `users`, and a failure in
  // one must not take the others down. Canceling an expired grace matters more than a win-back, so
  // it goes first and is never skipped because a later step threw.
  const result: Record<string, unknown> = {};
  const failed: Record<string, string> = {};
  for (const [name, step] of [
    ["grace", () => cancelExpiredGrace()],
    ["pauses", () => resumeFinishedPauses()],
    ["grants", () => endLapsedGrants()],
    ["pauseReminders", () => remindPausesEnding(emailEnabled)],
    ["annualReminders", () => remindAnnually(emailEnabled)],
    ["winback", () => sendWinbacks(emailEnabled)],
  ] as const) {
    try { result[name] = await step(); }
    catch (cause) {
      const error = cause instanceof Error ? cause.message : "UNKNOWN";
      result[name] = { error };
      failed[name] = error;
    }
  }

  // A step that throws is recorded here, by the job itself, rather than left to whoever called it.
  // The cron reads only the status code and throws the body away, and this route used to answer
  // 200 whatever happened, so a dunning cutoff or a grant expiry that had started failing every
  // hour left no trace anywhere: unpaid Pro and expired comps would simply have carried on. The
  // row names each failing step and its error, in audit_log like the geocode and translation
  // jobs' failures, so it shows in admin next to them.
  //
  // The answer is a 500 as well, so anything that does look at the status (the cron's own
  // billing_job_failed row, a person running the job by hand) sees a failure too. The body still
  // carries every step's result, because the steps that succeeded did their work.
  const failedSteps = Object.keys(failed);
  if (failedSteps.length) {
    console.error("billing job step failed", failed);
    try {
      await env.DB.prepare(
        "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,details) VALUES('system:cron','system','billing_step_failed','job','billing',?)",
      ).bind(JSON.stringify({ steps: failed }).slice(0, 1500)).run();
    } catch (cause) {
      // The database being the thing that failed is the likeliest reason a step threw at all, so
      // this write can fail too; the 500 below still reports it.
      console.error("billing job could not record its failure", cause);
    }
  }
  return Response.json({ ok: failedSteps.length === 0, ...result }, { status: failedSteps.length ? 500 : 200 });
}
