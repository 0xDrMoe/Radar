import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";
import { apiError, cleanIsoDate, cleanText, cleanWeekdays, clientKey, normalizedPostal, rateLimit, readJson, requireSameOrigin, validHttpUrl, validPostal } from "../../api-utils";
import { publicDealPredicate } from "../../deal-lifecycle";
import { paidForPredicate } from "../../plan-resolution";

// The creator workspace's entire server surface.
//
// Deliberately its own route rather than a corner of /api/admin: a creator holds no admin
// permission at all, so every check here is about one account's own rows, and there is no code
// path from this file into anything else. The admin API's authorization table needs no entry for
// any of it, because none of it is reachable from there.
//
// Submissions are `suggestions` rows, not a parallel table. That was already the reviewed-deal
// pipeline — pending/approved/rejected, a rejection reason, and `convert_suggestion` in admin
// that mints the deal — so a creator submission is the same object arriving through a different
// door, and staff review it in the queue they already work. The conversion names the deal
// deterministically (`suggestion-<id>`), which is how a submission here reports what became of it
// without needing a link table.

/**
 * How many deals a creator can put their name on at once.
 *
 * A cap rather than an unlimited list, because a picks section that holds everything recommends
 * nothing — the whole value of the feature is that somebody had to leave things out. Twelve fits
 * a rail on a phone without the reader ever reaching a "load more" on an editorial list.
 */
export const MAX_PICKS = 12;

/**
 * How long the creator's own line about a deal can be.
 *
 * A caption, not a review. It renders under a restaurant name on a page that belongs to the deal,
 * and a paragraph there is somebody else's page being used as a blog.
 */
export const PICK_NOTE_MAX = 140;

interface CreatorActionBody {
  action?: unknown;
  id?: unknown;
  dealId?: unknown;
  note?: unknown;
  dealIds?: unknown;
  restaurant?: unknown;
  deal?: unknown;
  postal?: unknown;
  schedule?: unknown;
  source?: unknown;
  restaurantWebsite?: unknown;
  address?: unknown;
  description?: unknown;
  price?: unknown;
  eligibleDays?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startsAt?: unknown;
  expiresAt?: unknown;
  restrictions?: unknown;
}

type CreatorProfile = { user_id: string; handle: string; display_name: string | null; status: string; commission_rate_bps: number };

// Both halves have to hold: the role says this workspace is theirs, the profile row says which
// handle they are. A creator whose profile is paused keeps the role and loses the workspace,
// which is the reversible half of turning someone off.
async function creatorContext() {
  const user = await getAppUser();
  if (!user) return { error: apiError(401, "AUTH_REQUIRED", "Sign in required.") } as const;
  if (user.role !== "creator") return { error: apiError(403, "NOT_A_CREATOR", "This workspace is for creator accounts.") } as const;
  const profile = await env.DB.prepare("SELECT user_id,handle,display_name,status,commission_rate_bps FROM creator_profiles WHERE user_id=?")
    .bind(user.userId).first<CreatorProfile>();
  if (!profile || profile.status !== "active")
    return { error: apiError(403, "CREATOR_INACTIVE", "This creator account is not active. Contact Radar staff.") } as const;
  return { user, profile } as const;
}

export async function GET() {
  const context = await creatorContext();
  if ("error" in context) return context.error;
  const { handle } = context.profile;

  const [submissions, visits, signups, paths, clicks, linkClicks, earnings, ledger, campaignRows, proSignups, visitTrend, audienceDeals, picks] = await Promise.all([
    // LEFT JOIN rather than two round trips: what a creator wants to know about a submission is
    // what became of it, and that lives on the deal the conversion created.
    env.DB.prepare(
      `SELECT s.id,s.restaurant,s.deal,s.postal,s.schedule,s.price,s.description,s.address,s.restaurant_website,s.source,
              s.eligible_days,s.start_time,s.end_time,s.starts_at,s.expires_at,s.restrictions,
              s.status,s.rejection_reason,s.reference,s.created_at,s.updated_at,
              d.id deal_id,d.status deal_status,d.active deal_active,d.city deal_city
         FROM suggestions s
         LEFT JOIN deals d ON d.id='suggestion-' || s.id AND d.deleted_at IS NULL
        WHERE s.user_id=?
        ORDER BY s.created_at DESC LIMIT 200`,
    ).bind(context.user.userId).all(),
    env.DB.prepare(
      `SELECT COUNT(*) total,
              COALESCE(SUM(created_at>=datetime('now','-30 days')),0) last30
         FROM product_events WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?`,
    ).bind(handle).first<{ total: number; last30: number }>(),
    env.DB.prepare("SELECT COUNT(*) total FROM users WHERE referred_by=?").bind(handle).first<{ total: number }>(),
    // Where their link actually lands people. This is the honest version of "top deals": read
    // straight from the recorded visit path, not from a click metric the site does not keep.
    env.DB.prepare(
      `SELECT json_extract(properties,'$.path') path,COUNT(*) hits
         FROM product_events WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?
        GROUP BY path ORDER BY hits DESC LIMIT 10`,
    ).bind(handle).all<{ path: string; hits: number }>(),
    // Activity on the deals this creator's own submissions produced, whoever brought the reader —
    // a submission that gets picked up and shared widely is still their work. Keyed on the
    // deterministic id `convert_suggestion` mints, so no link table is needed.
    env.DB.prepare(
      `SELECT entity_id deal_id,
              COALESCE(SUM(json_extract(properties,'$.kind')='view'),0) views,
              COALESCE(SUM(json_extract(properties,'$.kind')='offer'),0) offers
         FROM product_events
        WHERE type='deal_click' AND entity_id IN (SELECT 'suggestion-' || id FROM suggestions WHERE user_id=?)
        GROUP BY entity_id`,
    ).bind(context.user.userId).all<{ deal_id: string; views: number; offers: number }>(),
    // And activity from their link, on any deal — the other half of the same question.
    env.DB.prepare(
      `SELECT COALESCE(SUM(json_extract(properties,'$.kind')='view'),0) views,
              COALESCE(SUM(json_extract(properties,'$.kind')='offer'),0) offers
         FROM product_events WHERE type='deal_click' AND json_extract(properties,'$.creator')=?`,
    ).bind(handle).first<{ views: number; offers: number }>(),
    // Earnings, grouped by currency because Radar Pro is quoted in several and a single total
    // across them would be a made-up number. Voided rows are excluded from every total but the
    // count, so a creator can see that something was reversed rather than watch it vanish.
    env.DB.prepare(
      `SELECT currency,status,COUNT(*) subscriptions,COALESCE(SUM(commission_amount),0) amount
         FROM creator_commissions WHERE handle=? GROUP BY currency,status`,
    ).bind(handle).all<{ currency: string; status: string; subscriptions: number; amount: number }>(),
    // The ledger itself. No subscriber identity: a creator is owed money, not told who by.
    env.DB.prepare(
      `SELECT created_at,currency,gross_amount,rate_bps,commission_amount,status,paid_at
         FROM creator_commissions WHERE handle=? ORDER BY created_at DESC LIMIT 50`,
    ).bind(handle).all<Record<string, unknown>>(),
    // Per-campaign, so a creator can see which post actually worked. Unioned rather than joined
    // because the two halves live in different tables and either can exist without the other: a
    // label can bring visits and no subscribers, or (once the cookie has expired for everyone
    // who clicked) subscribers whose visits are long past.
    env.DB.prepare(
      `SELECT campaign,SUM(visits) visits,SUM(subscriptions) subscriptions,SUM(earned) earned,MAX(currency) currency FROM (
         SELECT json_extract(properties,'$.creatorCampaign') campaign,COUNT(*) visits,0 subscriptions,0 earned,NULL currency
           FROM product_events
          WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?
            AND json_extract(properties,'$.creatorCampaign') IS NOT NULL
          GROUP BY campaign
         UNION ALL
         SELECT campaign,0 visits,COUNT(*) subscriptions,
                COALESCE(SUM(CASE WHEN status<>'void' THEN commission_amount ELSE 0 END),0) earned,currency
           FROM creator_commissions WHERE handle=? AND campaign IS NOT NULL GROUP BY campaign,currency
       ) GROUP BY campaign ORDER BY visits DESC LIMIT 50`,
    ).bind(handle, handle).all<{ campaign: string; visits: number; subscriptions: number; earned: number; currency: string | null }>(),
    // How many of those signups went on to pay. Signups are the number a creator can see moving
    // day to day; this is the one their share is actually a share of, and showing only the first
    // would let a link that brings a lot of curious nobody look like a link that is working. Pro
    // alone is not paying: a comped account has it too, so this asks who pays (paidForPredicate).
    env.DB.prepare(
      `SELECT COUNT(*) total FROM users WHERE referred_by=? AND plan='pro' AND plan_status IN ('active','trialing') AND ${paidForPredicate}`,
    ).bind(handle).first<{ total: number }>(),
    // Thirty days of arrivals, by day. A total tells a creator the link works; a shape tells them
    // which post did it and how long a video keeps sending people, which is the thing they can
    // act on when deciding what to make next.
    env.DB.prepare(
      `SELECT date(created_at) day,COUNT(*) count
         FROM product_events
        WHERE type='campaign_visit' AND json_extract(properties,'$.creator')=?
          AND created_at>=datetime('now','-30 days')
        GROUP BY day ORDER BY day`,
    ).bind(handle).all<{ day: string; count: number }>(),
    // What their audience actually opened once it arrived - any deal, not only the ones they
    // submitted. This is the editorial signal: it says which food their followers came for, which
    // is what a "Picks by" section should be built out of rather than guessed at.
    env.DB.prepare(
      `SELECT pe.entity_id deal_id,d.title,d.restaurant,d.city,
              COALESCE(SUM(json_extract(pe.properties,'$.kind')='view'),0) views,
              COALESCE(SUM(json_extract(pe.properties,'$.kind')='offer'),0) offers
         FROM product_events pe JOIN deals d ON d.id=pe.entity_id AND d.deleted_at IS NULL
        WHERE pe.type='deal_click' AND json_extract(pe.properties,'$.creator')=?
        GROUP BY pe.entity_id,d.title,d.restaurant,d.city
        ORDER BY views DESC LIMIT 10`,
    ).bind(handle).all<{ deal_id: string; title: string; restaurant: string; city: string; views: number; offers: number }>(),
    // Their own picks, joined to the deal so the workspace can show what each one has become.
    // An INNER JOIN would make a pick disappear the moment staff pulled the deal, which is the
    // one time a creator most needs to see it — so this is LEFT, and the workspace says
    // "no longer listed" rather than silently shortening the list under them.
    env.DB.prepare(
      `SELECT p.deal_id,p.note,p.position,p.created_at,
              d.title,d.restaurant,d.city,d.emoji,d.slug,d.status,d.active,d.deleted_at
         FROM creator_picks p
         LEFT JOIN deals d ON d.id=p.deal_id
        WHERE p.handle=?
        ORDER BY p.position,p.created_at`,
    ).bind(handle).all<Record<string, unknown>>(),
  ]);

  const activity = new Map((clicks.results || []).map((row) => [row.deal_id, row]));

  return Response.json({
    profile: { handle, displayName: context.profile.display_name, name: context.user.displayName },
    submissions: (submissions.results as Array<Record<string, unknown>>).map((row) => {
      const counts = activity.get(String(row.deal_id || ""));
      return { ...row, views: counts?.views || 0, offers: counts?.offers || 0 };
    }),
    stats: {
      visits: visits?.total || 0,
      visits30: visits?.last30 || 0,
      signups: signups?.total || 0,
      paths: paths.results || [],
      linkViews: linkClicks?.views || 0,
      linkOffers: linkClicks?.offers || 0,
      proSignups: proSignups?.total || 0,
      visitTrend: visitTrend.results || [],
      audienceDeals: audienceDeals.results || [],
    },
    picks: {
      max: MAX_PICKS,
      noteMax: PICK_NOTE_MAX,
      items: (picks.results || []).map((row) => ({
        ...row,
        // Computed here rather than in the browser so the workspace and the public reader agree
        // on one definition of "this pick is showing", which is the same condition the public
        // route filters on.
        live: row.deleted_at === null && row.status === "live" && Number(row.active) === 1,
      })),
    },
    earnings: {
      rateBps: context.profile.commission_rate_bps,
      // One entry per currency: what is still owed, what has been paid, and how many paid
      // invoices sit behind each. Kept as separate buckets rather than a single "earned" so the
      // workspace never has to imply that pending money has already arrived.
      byCurrency: Object.values(
        (earnings.results || []).reduce<Record<string, { currency: string; pending: number; paid: number; voided: number; subscriptions: number }>>(
          (accumulator, row) => {
            const bucket = (accumulator[row.currency] ||= { currency: row.currency, pending: 0, paid: 0, voided: 0, subscriptions: 0 });
            if (row.status === "paid") bucket.paid += row.amount;
            else if (row.status === "void") bucket.voided += row.amount;
            else bucket.pending += row.amount;
            bucket.subscriptions += row.subscriptions;
            return accumulator;
          },
          {},
        ),
      ),
      recent: ledger.results || [],
    },
    campaigns: campaignRows.results || [],
  });
}

// One validator for both create and update, so a submission cannot be edited into a state it
// could never have been created in.
function readSubmission(b: CreatorActionBody) {
  const restaurant = cleanText(b.restaurant, 120);
  const deal = cleanText(b.deal, 180);
  const postal = normalizedPostal(b.postal);
  const schedule = cleanText(b.schedule, 160);
  const source = cleanText(b.source, 500);
  const fields: Record<string, string> = {};
  if (!restaurant) fields.restaurant = "Required";
  if (!deal) fields.deal = "Required";
  if (!validPostal(postal)) fields.postal = "Enter a complete postal or ZIP code";
  if (!schedule) fields.schedule = "Required";
  // Kept required for creators for the same reason it is required of the public: a reviewer has
  // to be able to check the offer against the restaurant's own page before it is published.
  if (!validHttpUrl(source, true)) fields.source = "Link the restaurant's own page showing this offer";
  if (b.startsAt && !cleanIsoDate(b.startsAt)) fields.startsAt = "Enter a valid date";
  const expiresAt = cleanIsoDate(b.expiresAt);
  if (b.expiresAt && !expiresAt) fields.expiresAt = "Enter a valid date";
  else if (expiresAt && new Date(expiresAt).getTime() < Date.now()) fields.expiresAt = "Expiry must be in the future";
  return { fields, restaurant, deal, postal, schedule, source };
}

export async function POST(request: Request) {
  const context = await creatorContext();
  if ("error" in context) return context.error;
  const { handle } = context.profile;
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  if (!(await rateLimit(await clientKey("creator"), 30, 60))) return apiError(429, "RATE_LIMITED", "Too many changes. Try again shortly.");
  let b: CreatorActionBody;
  try { b = await readJson<CreatorActionBody>(request, 24_000); } catch { return apiError(400, "INVALID_REQUEST", "The request body is invalid."); }

  if (b.action === "save_submission") {
    const { fields, restaurant, deal, postal, schedule, source } = readSubmission(b);
    if (Object.keys(fields).length) return apiError(422, "INVALID_SUBMISSION", "Review the highlighted fields.", fields);
    const shared = [
      cleanText(b.description, 1500) || null,
      cleanText(b.price, 120) || null,
      JSON.stringify(cleanWeekdays(b.eligibleDays)),
      cleanText(b.startTime, 10) || null,
      cleanText(b.endTime, 10) || null,
      cleanIsoDate(b.startsAt),
      cleanIsoDate(b.expiresAt),
      cleanText(b.restrictions, 1000) || null,
      validHttpUrl(b.restaurantWebsite) ? cleanText(b.restaurantWebsite, 500) : null,
      cleanText(b.address, 240) || null,
    ];

    if (b.id) {
      // A submission already in front of a reviewer must not change under them, and someone
      // else's row must be indistinguishable from one that does not exist.
      const owned = await env.DB.prepare("SELECT id,status FROM suggestions WHERE id=? AND user_id=?")
        .bind(b.id, context.user.userId).first<{ id: number; status: string }>();
      if (!owned) return apiError(404, "SUBMISSION_NOT_FOUND", "That submission could not be found.");
      if (owned.status !== "pending")
        return apiError(409, "SUBMISSION_LOCKED", "This submission has already been reviewed and can no longer be edited.");
      await env.DB.prepare(
        `UPDATE suggestions SET restaurant=?,deal=?,title=?,postal=?,schedule=?,source=?,
                description=?,price=?,eligible_days=?,start_time=?,end_time=?,starts_at=?,expires_at=?,restrictions=?,
                restaurant_website=?,address=?,updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND user_id=? AND status='pending'`,
      ).bind(restaurant, deal, deal, postal, schedule, source, ...shared, b.id, context.user.userId).run();
      return Response.json({ ok: true, id: Number(b.id) });
    }

    const reference = `BL-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const created = await env.DB.prepare(
      `INSERT INTO suggestions(restaurant,deal,title,postal,schedule,email,status,user_id,source,relationship,reference,
                               description,price,eligible_days,start_time,end_time,starts_at,expires_at,restrictions,restaurant_website,address)
       VALUES(?,?,?,?,?,?,'pending',?,?,'creator',?,?,?,?,?,?,?,?,?,?,?) RETURNING id`,
    ).bind(restaurant, deal, deal, postal, schedule, context.user.email, context.user.userId, source, reference, ...shared)
      .first<{ id: number }>();
    return Response.json({ ok: true, id: created?.id, reference }, { status: 201 });
  }

  if (b.action === "withdraw_submission") {
    // Only ever their own, only ever while still pending, and recorded rather than deleted so the
    // reference a creator was given still resolves to something.
    const result = await env.DB.prepare(
      "UPDATE suggestions SET status='withdrawn',updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=? AND status='pending'",
    ).bind(b.id, context.user.userId).run();
    if (!result.meta.changes) return apiError(409, "WITHDRAW_BLOCKED", "Only a submission still awaiting review can be withdrawn.");
    return Response.json({ ok: true });
  }

  if (b.action === "save_pick") {
    const dealId = cleanText(b.dealId, 80);
    const note = cleanText(b.note, PICK_NOTE_MAX);
    if (!dealId) return apiError(422, "INVALID_PICK", "Choose a deal to pick.", { dealId: "Required" });
    // Only a deal that is actually on the site. A pick is a public credit, and crediting somebody
    // for a draft nobody can open is a byline pointing at a 404, and one scheduled for later is a
    // draft until its time comes. Checked against the predicate every public read of `deals` uses.
    const deal = await env.DB.prepare(
      `SELECT d.id FROM deals d WHERE d.id=? AND ${publicDealPredicate}`,
    ).bind(dealId).first<{ id: string }>();
    if (!deal) return apiError(404, "DEAL_NOT_FOUND", "That deal is not currently listed on Radar.");

    // The cap counts rows this creator already has, and only refuses a pick that would add one.
    // Editing the note on an existing pick at the cap has to keep working, so the check is
    // "is this deal already picked" rather than a plain count.
    const existing = await env.DB.prepare("SELECT deal_id FROM creator_picks WHERE handle=? AND deal_id=?")
      .bind(handle, dealId).first<{ deal_id: string }>();
    if (!existing) {
      const count = await env.DB.prepare("SELECT COUNT(*) total FROM creator_picks WHERE handle=?")
        .bind(handle).first<{ total: number }>();
      if ((count?.total || 0) >= MAX_PICKS)
        return apiError(409, "PICK_LIMIT", `You can feature ${MAX_PICKS} deals at a time. Remove one to add another.`);
    }

    // New picks land at the end. COALESCE rather than a count, because removing the middle of a
    // list leaves gaps and a count would reuse a position that is already taken.
    await env.DB.prepare(
      `INSERT INTO creator_picks(handle,deal_id,note,position)
       VALUES(?,?,?,COALESCE((SELECT MAX(position)+1 FROM creator_picks WHERE handle=?),0))
       ON CONFLICT(handle,deal_id) DO UPDATE SET note=excluded.note,updated_at=CURRENT_TIMESTAMP`,
    ).bind(handle, dealId, note || null, handle).run();
    return Response.json({ ok: true });
  }

  if (b.action === "remove_pick") {
    const dealId = cleanText(b.dealId, 80);
    await env.DB.prepare("DELETE FROM creator_picks WHERE handle=? AND deal_id=?").bind(handle, dealId).run();
    return Response.json({ ok: true });
  }

  if (b.action === "reorder_picks") {
    // The whole order arrives at once and is written as one batch, so a list can never be left
    // half-reordered by a connection that dropped between two requests. Ids that are not this
    // creator's simply match no row - the handle is in every WHERE clause, never in the body.
    const order = Array.isArray(b.dealIds) ? b.dealIds.slice(0, MAX_PICKS).map((value) => cleanText(value, 80)) : [];
    if (!order.length) return apiError(422, "INVALID_ORDER", "Send the new order.");
    await env.DB.batch(
      order.map((dealId, index) =>
        env.DB.prepare("UPDATE creator_picks SET position=?,updated_at=CURRENT_TIMESTAMP WHERE handle=? AND deal_id=?")
          .bind(index, handle, dealId),
      ),
    );
    return Response.json({ ok: true });
  }

  return apiError(400, "UNKNOWN_ACTION", "Unknown action.");
}
