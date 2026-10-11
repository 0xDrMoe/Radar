import { env } from "cloudflare:workers";
import { apiError, hasJobSecret } from "../../../api-utils";
import { appStoreListingUrl } from "../../../app-release";
import {
  buildLaunchEmail,
  emailConfiguration,
  pilotGatesOpen,
  sendEmail,
  signLeadUnsubscribe,
  WAITLIST_SOURCES,
} from "../../../email";

// The launch announcement: one message, once, to the people who asked for it.
//
// Every other job in this folder runs on the hour from worker/index.ts. This one deliberately does
// not, and must not be added there. It is a single irreversible broadcast triggered by a person
// who has decided the app is actually live — there is no schedule on which "tell everyone the app
// shipped" is the right thing to do automatically, and a cron entry would mean a deploy could fire
// it.
//
// Four things stand between an invocation and mail leaving, because the cost of being wrong here
// is not a failed request — it is a wrong or premature message in somebody's inbox that cannot be
// recalled:
//
//   1. It dry-runs unless told otherwise. `?send=true` is the only thing that sends; every other
//      invocation reports exactly who would be mailed and stops. The default is the safe one, so
//      a fumbled command shows you the list instead of mailing it.
//   2. It refuses without a real App Store URL. A launch email whose only button 404s is worse
//      than no launch email, and the most likely time to run this is the moment before the app is
//      actually approved.
//   3. It sends only to `ios-waitlist` leads. Homepage leads asked to hear about nearby deals,
//      which is a different consent; mailing them about an app launch is the thing CASL is about.
//   4. It is resumable, not repeatable. Idempotency is per recipient rather than per run, so a
//      partial failure can be finished by running it again without re-mailing anyone who already
//      received it.

interface LeadRow {
  id: string;
  email: string;
}

/** Fixed, so every batch and every retry attributes to the same campaign and dedupes against it. */
const CAMPAIGN_ID = "campaign:ios-launch";
const SUBJECT = "Radar is on the App Store";

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string>;
  if (!hasJobSecret(request, runtime.EMAIL_JOB_SECRET)) {
    return apiError(401, "INVALID_SCHEDULER", "Scheduler authentication failed.");
  }

  const url = new URL(request.url);
  const send = url.searchParams.get("send") === "true";
  const limit = Math.max(1, Math.min(500, Number(url.searchParams.get("limit")) || 100));
  const origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
  const appStoreUrl = await appStoreListingUrl();

  // Checked even on a dry run: the point of the dry run is to tell you whether a real send would
  // work, and one that reported "42 ready to go" while the send would refuse would be lying.
  // The check itself lives in app/app-release.ts so the announcement page at /launch and this job
  // cannot disagree about whether the app has shipped.
  if (!appStoreUrl) {
    return apiError(
      503,
      "APP_STORE_URL_MISSING",
      "Set APP_STORE_URL to the app's apps.apple.com link before sending the launch email.",
    );
  }
  if (!pilotGatesOpen()) {
    const config = emailConfiguration();
    return apiError(503, "EMAIL_DISABLED", "Email delivery is off.", {
      pilotEnabled: String(config.pilotEnabled),
      killSwitchClear: String(!config.killSwitch),
      providerConfigured: String(config.providerConfigured),
      signingConfigured: String(config.signingConfigured),
    });
  }

  const placeholders = WAITLIST_SOURCES.map(() => "?").join(",");
  // Suppression and already-sent are both excluded here rather than checked in the loop, so the
  // reported count is the count that would actually be mailed. The already-sent clause is what
  // makes this resumable: a second run sees only whoever the first did not finish.
  const pending = await env.DB.prepare(
    `SELECT l.id,l.email
       FROM email_leads l
      WHERE l.source IN (${placeholders})
        AND l.confirmed_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(l.email))
        AND NOT EXISTS(SELECT 1 FROM email_deliveries d
                        WHERE d.campaign_id=? AND lower(d.email)=lower(l.email) AND d.status='sent')
      ORDER BY l.created_at,l.id
      LIMIT ?`,
  ).bind(...WAITLIST_SOURCES, CAMPAIGN_ID, limit).all<LeadRow>();

  const remaining = await env.DB.prepare(
    `SELECT COUNT(*) total
       FROM email_leads l
      WHERE l.source IN (${placeholders})
        AND l.confirmed_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(l.email))
        AND NOT EXISTS(SELECT 1 FROM email_deliveries d
                        WHERE d.campaign_id=? AND lower(d.email)=lower(l.email) AND d.status='sent')`,
  ).bind(...WAITLIST_SOURCES, CAMPAIGN_ID).first<{ total: number }>();

  if (!send) {
    return Response.json({
      ok: true,
      dryRun: true,
      wouldSend: pending.results.length,
      pendingTotal: remaining?.total ?? 0,
      subject: SUBJECT,
      appStoreUrl,
      recipients: pending.results.map((lead) => lead.email),
      hint: "Re-run with ?send=true to actually send. Nothing was written.",
    });
  }

  // Written only on a real send, so a dry run leaves no trace to reason about later.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO email_campaigns(id,name,type,status,subject,segment,created_by)
     VALUES(?,?,'announcement','sending',?,?,'job:launch-email')`,
  ).bind(CAMPAIGN_ID, "iOS launch announcement", SUBJECT, JSON.stringify({ sources: WAITLIST_SOURCES })).run();

  const jobId = `launch:${new Date().toISOString()}`;
  await env.DB.prepare("INSERT INTO email_job_runs(id,status,started_at) VALUES(?,'running',CURRENT_TIMESTAMP)").bind(jobId).run();

  let sent = 0, failed = 0;
  const errors: string[] = [];
  for (const lead of pending.results) {
    const deliveryId = crypto.randomUUID();
    const token = await signLeadUnsubscribe(lead.id, lead.email);
    const unsubscribeUrl = `${origin}/unsubscribe?email=${encodeURIComponent(lead.email)}&token=${encodeURIComponent(token)}`;
    const { html, text } = buildLaunchEmail({ appStoreUrl, unsubscribeUrl, origin });

    // The delivery row goes in before the send, not after. If the Worker dies mid-request the row
    // is left 'queued' — visible, and not counted as sent, so the next run retries it. Writing it
    // afterwards would lose any send whose response never came back, and re-mail those people.
    await env.DB.prepare(
      "INSERT INTO email_deliveries(id,campaign_id,user_id,email,status,created_at) VALUES(?,?,?,?,'queued',CURRENT_TIMESTAMP)",
    ).bind(deliveryId, CAMPAIGN_ID, `lead:${lead.id}`, lead.email).run();

    try {
      const result = await sendEmail({
        to: lead.email,
        subject: SUBJECT,
        html,
        text,
        tag: "ios-launch",
        unsubscribeUrl,
        metadata: { deliveryId, leadId: lead.id },
        audience: "app-waitlist",
      });
      await env.DB.prepare("UPDATE email_deliveries SET provider_message_id=?,status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(result.id, deliveryId).run();
      sent++;
    } catch (cause) {
      failed++;
      const code = cause instanceof Error ? cause.message.slice(0, 100) : "UNKNOWN";
      if (errors.length < 5) errors.push(code);
      await env.DB.prepare("UPDATE email_deliveries SET status='failed',error_code=? WHERE id=?").bind(code, deliveryId).run();
    }
  }

  const left = Math.max(0, (remaining?.total ?? 0) - sent);
  const details = { sent, failed, errors, limit, remaining: left };
  await env.DB.prepare("UPDATE email_job_runs SET status=?,recipients=?,details=?,finished_at=CURRENT_TIMESTAMP WHERE id=?")
    .bind(failed ? "completed_with_errors" : "completed", sent, JSON.stringify(details), jobId).run();
  // The campaign is only 'sent' once nobody is left, so a half-finished broadcast is visible as
  // one rather than reading as complete.
  if (!left) {
    await env.DB.prepare("UPDATE email_campaigns SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(CAMPAIGN_ID).run();
  }

  return Response.json({ ok: true, jobId, sent, failed, remaining: left, errors });
}
