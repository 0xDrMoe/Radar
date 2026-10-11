import { env } from "cloudflare:workers";
import { apiError, hasJobSecret } from "../../../api-utils";
import { buildDigestEmail, canDeliverTo, emailConfiguration, localParts, sendEmail, signUnsubscribe } from "../../../email";
import { digestNotification, revokeTokens, sendExpoPush, type PushMessage } from "../../../push";
import { kmBetween } from "../../../search";
import { DEFAULT_RADIUS_KM, maxRadiusKm } from "../../../radius";
import { hasProAccess } from "../../../entitlement";
import { alertSchedule } from "../../../plan-limits";

interface DigestRecipient {
  user_id: string;
  email: string;
  name: string | null;
  language: string;
  preference_id: number;
  days: string;
  delivery_time: string;
  timezone: string | null;
  postal: string | null;
  city: string | null;
  /** 1 when this person may be emailed: consent confirmed and not suppressed. */
  email_allowed: number;
  latitude: number | null;
  longitude: number | null;
  radius: number | null;
  plan: string | null;
  plan_status: string | null;
  role: string | null;
  past_due_since: string | null;
  paused_until: string | null;
}

interface DigestDealRow {
  id: string;
  slug: string | null;
  restaurant: string;
  title: string;
  price: string;
  city: string;
  schedule: string;
  emoji: string | null;
  category: string | null;
  postal_prefix: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface DigestDeal extends DigestDealRow {
  points: { latitude: number; longitude: number }[];
}

// One row per (deal, servable location), mirroring how /api/deals decides which locations of a
// chain actually carry the offer: every restaurant_locations row for the deal's restaurant, kept
// when the deal runs brand-wide (location_scope='brand', see drizzle/0049), or when deal_locations
// says 'confirmed' — or, with no deal_locations row at all, when the address matches the deal's own. A deal whose restaurant has no confirmed location falls back to
// the single location the deal itself points at, which is the one-location case.
const DEAL_SQL = `SELECT d.id,d.slug,d.restaurant,d.title,d.price,d.city,d.schedule,d.emoji,d.category,d.postal_prefix,
  CASE WHEN l.id IS NULL THEN own.latitude ELSE l.latitude END latitude,
  CASE WHEN l.id IS NULL THEN own.longitude ELSE l.longitude END longitude
  FROM deals d
  LEFT JOIN restaurant_locations l ON l.restaurant_id=d.restaurant_id AND l.status='operating'
    AND (d.location_scope='brand'
         OR COALESCE((SELECT eligibility FROM deal_locations WHERE deal_id=d.id AND location_id=l.id),
                     CASE WHEN l.address=d.address THEN 'confirmed' ELSE 'unconfirmed' END)='confirmed')
  -- Only consulted when the restaurant has no confirmed location at all: then the deal's own
  -- location is the offer's location. Never used to paper over a confirmed location that simply
  -- has not been geocoded, which would silently place it at a sibling's address.
  LEFT JOIN restaurant_locations own ON own.id=d.location_id
  WHERE d.status='live' AND d.active=1 AND d.deleted_at IS NULL
    AND (d.expires_at IS NULL OR datetime(d.expires_at)>CURRENT_TIMESTAMP)
    -- A nationwide promotion is not news about anyone's area, and a chain placed by its footprint
    -- may still have thousands of harvested branches that this join would read for nothing.
    AND d.location_scope IS NOT 'national'
  ORDER BY d.sponsored DESC,d.verified_at DESC`;

// Collapse the join back down to one entry per deal, in the order the SQL already ranked them, so
// a later slice(0,8) still takes the top eight.
function groupDeals(rows: DigestDealRow[]): DigestDeal[] {
  const byId = new Map<string, DigestDeal>();
  for (const row of rows) {
    let deal = byId.get(row.id);
    if (!deal) { deal = { ...row, points: [] }; byId.set(row.id, deal); }
    if (row.latitude != null && row.longitude != null) deal.points.push({ latitude: row.latitude, longitude: row.longitude });
  }
  return [...byId.values()];
}

function postalPrefix(postal: string | null) {
  return postal ? postal.replace(/\s/g, "").toUpperCase().slice(0, 3) : null;
}

// Distance when we know where the recipient is, postal prefix when we only know their postal code,
// and everything when we know nothing — the last leg is what keeps a recipient whose area has not
// been geocoded yet from silently receiving no mail at all.
//
// The postal-prefix leg stays as an OR rather than being replaced by distance: 1 of the ~170 live
// deals and 3 of the 237 restaurant_locations rows have no coordinates, and a pure distance filter
// would drop them from every roundup forever instead of matching them the coarse way.
function nearRecipient(deal: DigestDeal, recipient: DigestRecipient, prefix: string | null) {
  const origin = recipient.latitude != null && recipient.longitude != null
    ? { latitude: recipient.latitude, longitude: recipient.longitude } : null;
  if (!origin && !prefix && !recipient.city) return true;
  const radius = Math.max(2, Math.min(100, recipient.radius || DEFAULT_RADIUS_KM));
  if (origin && deal.points.some((point) => kmBetween(origin, point) <= radius)) return true;
  if (prefix && deal.postal_prefix === prefix) return true;
  // City match only backs up a recipient we could not place at all; once they have coordinates,
  // a same-named city on the other side of the country is exactly what this job is fixing.
  return !origin && !prefix && !!recipient.city && deal.city === recipient.city;
}

export async function POST(request:Request) {
  const runtime = env as unknown as Record<string,string>;
  if (!hasJobSecret(request, runtime.EMAIL_JOB_SECRET)) return apiError(401,"INVALID_SCHEDULER","Scheduler authentication failed.");
  const config = emailConfiguration(),started = new Date(),jobId = `digest:${started.toISOString().slice(0,13)}`;
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO email_job_runs(id,status,started_at) VALUES(?,'running',CURRENT_TIMESTAMP)").bind(jobId).run();
  if (!claimed.meta.changes) return Response.json({ok:true,duplicate:true,jobId});
  // Email's pilot gate and kill switch stop email. They used to stop the whole run, which would
  // now also silence push — a different channel, with its own opt-in (an OS permission and a
  // device_tokens row) and nothing to do with the email provider being configured or paused.
  const emailEnabled = config.pilotEnabled && !config.killSwitch && config.providerConfigured;
  // The recipient's area. This used to join on p.saved_location_id, which nothing has ever
  // written — /api/user creates the preference row without it and only ever looks it up with
  // `saved_location_id IS NULL`. So l.postal and l.city came back NULL for every recipient, the
  // deal query's location predicate collapsed to always-true, and every roundup was the same
  // national top 8 regardless of where the person lived. Resolve the area the way the dashboard
  // does instead: the default active tracked area, else any active one, else the home postal
  // that /api/user writes on every alert save.
  // email_consents went from an INNER to a LEFT join so that someone who registered a device but
  // never confirmed email still appears here. The email predicate itself is unchanged, moved
  // verbatim into the email_allowed column — a recipient is emailed on exactly the same condition
  // as before, and a row now reaching this loop without it is a push-only recipient.
  const candidates = await env.DB.prepare(`SELECT u.id user_id,u.email,u.name,u.language,u.role,u.plan,u.plan_status,u.past_due_since,u.paused_until,p.id preference_id,p.days,p.delivery_time,p.timezone,COALESCE(l.postal,u.home_postal) postal,l.city,l.latitude,l.longitude,l.radius,
    CASE WHEN c.status='confirmed' AND s.email IS NULL THEN 1 ELSE 0 END email_allowed
    FROM notification_preferences p JOIN users u ON u.id=p.user_id
    LEFT JOIN saved_locations l ON l.id=COALESCE(p.saved_location_id,(SELECT id FROM saved_locations WHERE user_id=u.id AND active=1 ORDER BY is_default DESC,sort_order,id LIMIT 1))
    LEFT JOIN email_consents c ON c.id=(SELECT id FROM email_consents WHERE user_id=u.id ORDER BY id DESC LIMIT 1)
    LEFT JOIN email_suppressions s ON lower(s.email)=lower(u.email)
    WHERE p.enabled=1 AND u.status='active'
      AND ((c.status='confirmed' AND s.email IS NULL)
           OR EXISTS(SELECT 1 FROM device_tokens dt WHERE dt.user_id=u.id AND dt.status='active'))`).all<DigestRecipient>();
  // Every active device, read once and grouped, rather than a query per recipient inside the loop.
  const devicesByUser = new Map<string, string[]>();
  for (const row of (await env.DB.prepare("SELECT user_id,token FROM device_tokens WHERE status='active'").all<{ user_id: string; token: string }>()).results) {
    const tokens = devicesByUser.get(row.user_id);
    if (tokens) tokens.push(row.token); else devicesByUser.set(row.user_id, [row.token]);
  }
  const pushQueue: PushMessage[] = [];
  // Loaded once, not per recipient: the live catalog is the same for everybody, and only the
  // filtering below depends on who is receiving.
  //
  // And only once somebody is actually due. This job runs every hour and most hours nobody is. It
  // read the whole catalogue regardless - a row per deal per branch, every run - to send nothing
  // most of the time.
  let catalogLoad: Promise<DigestDeal[]> | null = null;
  const loadCatalog = () => (catalogLoad ??= env.DB.prepare(DEAL_SQL).all<DigestDealRow>().then((rows) => groupDeals(rows.results)));
  let attempted = 0,sent = 0,failed = 0;
  // One recipient's bad row must not end everybody else's run. A timezone the runtime does not
  // know makes localParts throw, and before this catch that throw left the loop: nobody after that
  // person was emailed, the push batch below (which only goes out after the loop) was dropped for
  // everyone, and this run's email_job_runs row stayed 'running'. It repeated every hour until
  // the row was fixed. Now the person is skipped, the reason is kept, and the run carries on.
  const recipientErrors: { userId: string; error: string }[] = [];
  for (const recipient of candidates.results) {
    try {
      const tokens = devicesByUser.get(recipient.user_id) || [];
      // canDeliverTo is an email allow-list check, so it decides email only — a push-only recipient
      // must not be dropped by it.
      const mayEmail = emailEnabled && recipient.email_allowed === 1 && await canDeliverTo(recipient.email);
      if (!mayEmail && !tokens.length) continue;
      // Schedule and area are the person's, not the channel's: both notifications go out on the day
      // and hour they chose, about the same deals, so the two never disagree.
      //
      // The plan is read here, at send time, rather than trusted from what was saved: the dashboard
      // clamps a Free account's schedule when it is saved, but somebody who saved a daily 18:00
      // roundup and a 100 km area while on Pro, then left, kept both for as long as they never
      // re-saved. A lapsed plan is a Free plan (app/plan-limits.ts).
      const pro = hasProAccess(recipient.plan, recipient.plan_status, recipient.past_due_since, started, recipient.paused_until, recipient.role);
      const schedule = alertSchedule(pro, JSON.parse(recipient.days || "[]").map(Number), recipient.delivery_time);
      const local = localParts(started,recipient.timezone || "America/Toronto"),days = schedule.days,scheduled = schedule.time.slice(0,2);
      if (!days.includes(local.day) || local.time.slice(0,2) !== scheduled) continue;
      attempted++;
      const prefix = postalPrefix(recipient.postal);
      const reach = recipient.radius == null ? recipient : { ...recipient, radius: Math.min(recipient.radius || DEFAULT_RADIUS_KM, maxRadiusKm(pro)) };
      const deals = (await loadCatalog()).filter((deal) => nearRecipient(deal, reach, prefix)).slice(0, 8);
      if (!deals.length) continue;

      if (tokens.length) {
        const { title, body } = digestNotification(deals, recipient.city);
        // Deep-links straight to the deal when there is only one; otherwise the app opens Nearby,
        // which is where a list of several belongs.
        const target = deals.length === 1 ? `/deal/${deals[0].slug || deals[0].id}` : "/";
        for (const token of tokens) pushQueue.push({ to: token, title, body, data: { url: target } });
      }
      if (!mayEmail) continue;
      const deliveryId = crypto.randomUUID(),unsubscribeToken = await signUnsubscribe(recipient.user_id,recipient.email),origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
      const unsubscribeUrl = `${origin}/unsubscribe?email=${encodeURIComponent(recipient.email)}&token=${encodeURIComponent(unsubscribeToken)}`;
      const { html, text } = buildDigestEmail({
        recipientName: recipient.name,
        city: recipient.city,
        origin,
        unsubscribeUrl,
        preferencesUrl: `${origin}/dashboard/alerts`,
        deals: deals.map((deal) => ({
          restaurant: deal.restaurant,
          title: deal.title,
          price: deal.price,
          schedule: deal.schedule,
          emoji: deal.emoji,
          category: deal.category,
          url: `${origin}/deals/${encodeURIComponent(deal.slug || deal.id)}`,
        })),
      });
      await env.DB.prepare("INSERT INTO email_deliveries(id,user_id,email,status,created_at) VALUES(?,?,?,'queued',CURRENT_TIMESTAMP)").bind(deliveryId,recipient.user_id,recipient.email).run();
      try {
        const result = await sendEmail({to:recipient.email,subject:"Your Radar deal roundup",html,text,tag:"deal-digest",unsubscribeUrl,metadata:{deliveryId,userId:recipient.user_id}});
        await env.DB.prepare("UPDATE email_deliveries SET provider_message_id=?,status='sent',sent_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.id,deliveryId).run(); sent++;
      } catch (cause) { failed++; await env.DB.prepare("UPDATE email_deliveries SET status='failed',error_code=? WHERE id=?").bind(cause instanceof Error ? cause.message.slice(0,100) : "UNKNOWN",deliveryId).run(); }
    } catch (cause) {
      const error = cause instanceof Error ? cause.message.slice(0,200) : "UNKNOWN";
      recipientErrors.push({ userId: recipient.user_id, error });
      console.error("digest recipient skipped", recipient.user_id, error);
    }
  }
  // Sent after the loop, in one batched call, rather than per recipient: Expo takes 100 messages
  // per request, and a round trip inside the loop would multiply the job's runtime by the number
  // of people with a phone.
  const push = await sendExpoPush(pushQueue);
  await revokeTokens(push.revoked);
  // Skipped recipients go to audit_log, as the geocode and translation jobs' failures do, so a
  // row that fails every hour shows in admin with the account it belongs to rather than only as a
  // count on the run.
  if (recipientErrors.length) {
    await env.DB.prepare(
      "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,details) VALUES('system:cron','system','digest_recipient_failed','job','digests',?)",
    ).bind(JSON.stringify({ jobId, skipped: recipientErrors.length, recipients: recipientErrors.slice(0, 20) }).slice(0, 1500)).run();
  }
  const details = { attempted, sent, failed, skipped: recipientErrors.length, emailEnabled, push: { queued: pushQueue.length, sent: push.sent, failed: push.failed, revoked: push.revoked.length } };
  await env.DB.prepare("UPDATE email_job_runs SET status=?,recipients=?,details=?,finished_at=CURRENT_TIMESTAMP WHERE id=?").bind(failed || push.failed || recipientErrors.length ? "completed_with_errors" : "completed",sent,JSON.stringify(details),jobId).run();
  return Response.json({ok:true,jobId,attempted,sent,failed,skipped:recipientErrors.length,push:details.push});
}
