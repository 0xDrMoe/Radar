import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";
import { apiError, cleanText, readJson, requireSameOrigin } from "../../api-utils";
import { changedDealFields, dealContentOf, type DealContent } from "../../deal-change-requests";
import { OWNER_CONFIRMATION_COOLDOWN_MINUTES, ownerConfirmationBlocked, portalReportsSql } from "../../owner-confirmation";

interface PortalChangeRow {
  deal_id: string;
  title: string;
  price: string;
  schedule: string;
  description: string | null;
  terms: string | null;
  status: string;
  review_note: string | null;
  created_at: string;
  reviewed_at: string | null;
}

interface PortalDealRow {
  id: string;
  restaurant_id: string;
  status: string;
  active: number;
  city: string | null;
  title: string;
  price: string;
  schedule: string;
  description: string | null;
  terms: string | null;
}

interface PortalReportRow {
  id: number;
  deal_id: string;
  category: string;
  notes: string | null;
  status: string;
  created_at: string;
}

interface PortalActionBody {
  action?: unknown;
  restaurantId?: unknown;
  photoUrl?: unknown;
  dealId?: unknown;
  title?: unknown;
  price?: unknown;
  schedule?: unknown;
  description?: unknown;
  terms?: unknown;
  active?: unknown;
}

async function managedRestaurantIds(userId: string) {
  const rows = await env.DB.prepare("SELECT restaurant_id FROM restaurant_managers WHERE user_id=? AND status='active'").bind(userId).all<{ restaurant_id: string }>();
  return rows.results.map((row) => row.restaurant_id);
}

export async function GET() {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  const restaurantIds = await managedRestaurantIds(user.userId);
  if (!restaurantIds.length) return apiError(403, "NOT_A_MANAGER", "No restaurant has been assigned to this account yet. Radar staff assign restaurants — once one is, it appears here.");
  const placeholders = restaurantIds.map(() => "?").join(",");
  const [restaurants, deals, activity, requests, reports] = await Promise.all([
    env.DB.prepare(`SELECT id,name,website,cuisine,photo_url FROM restaurants WHERE id IN (${placeholders})`).bind(...restaurantIds).all(),
    env.DB.prepare(`SELECT id,restaurant_id,title,price,schedule,description,terms,status,active,city,address,verification_status,verified_at,owner_confirmed_at FROM deals WHERE restaurant_id IN (${placeholders}) AND deleted_at IS NULL ORDER BY title`).bind(...restaurantIds).all(),
    // How each deal is actually doing: how many people opened it, and how many of those went on
    // to this restaurant's own offer page. Scoped by the same restaurant grant as everything else
    // here, so a manager never sees numbers for a restaurant they do not manage.
    env.DB.prepare(
      `SELECT entity_id deal_id,
              COALESCE(SUM(json_extract(properties,'$.kind')='view'),0) views,
              COALESCE(SUM(json_extract(properties,'$.kind')='offer'),0) offers
         FROM product_events
        WHERE type='deal_click'
          AND entity_id IN (SELECT id FROM deals WHERE restaurant_id IN (${placeholders}) AND deleted_at IS NULL)
        GROUP BY entity_id`,
    ).bind(...restaurantIds).all<{ deal_id: string; views: number; offers: number }>(),
    // Each deal's latest edit that is waiting for, or has had, a staff decision: the manager sees
    // what is pending and, once it is decided, whether it went live and why not. Superseded and
    // withdrawn rows are the manager's own history and say nothing new.
    env.DB.prepare(
      `SELECT c.deal_id,c.title,c.price,c.schedule,c.description,c.terms,c.status,c.review_note,c.created_at,c.reviewed_at
         FROM deal_change_requests c
        WHERE c.restaurant_id IN (${placeholders})
          AND c.status IN ('pending','approved','rejected')
          AND c.created_at=(SELECT MAX(created_at) FROM deal_change_requests x WHERE x.deal_id=c.deal_id AND x.status IN ('pending','approved','rejected'))`,
    ).bind(...restaurantIds).all<PortalChangeRow>(),
    // What readers have told Radar is wrong with these deals and staff have not closed yet, so the
    // business can fix it at the source or send a correction. Content only, never who sent it.
    env.DB.prepare(portalReportsSql(restaurantIds.length)).bind(...restaurantIds).all<PortalReportRow>(),
  ]);
  const counts = new Map((activity.results || []).map((row) => [row.deal_id, row]));
  const latest = new Map((requests.results || []).map((row) => [row.deal_id, row]));
  return Response.json({
    restaurants: restaurants.results,
    reports: reports.results || [],
    deals: (deals.results as Array<Record<string, unknown>>).map((deal) => {
      const row = counts.get(String(deal.id));
      const change = latest.get(String(deal.id));
      return {
        ...deal,
        views: row?.views || 0,
        offers: row?.offers || 0,
        pending_change: change?.status === "pending"
          ? { ...dealContentOf(change), created_at: change.created_at }
          : null,
        last_review: change && change.status !== "pending"
          ? { status: change.status, note: change.review_note, reviewed_at: change.reviewed_at }
          : null,
      };
    }),
  });
}

// Whether a paused deal is the manager's to resume: the newest entry in its audit trail is a portal
// save that left it paused, and its market has not been paused as a whole since. Anything staff did
// to the deal after that (a lifecycle change, an edit, a verification) makes putting it back staff's
// call, through the readiness checks in /api/admin. Newest first with a LIMIT, so the scan stops at
// the deal's latest entry rather than reading the whole log.
async function pausedFromPortal(dealId: string, city: string | null) {
  const latest = await env.DB.prepare(
    "SELECT id,action,details FROM audit_log WHERE target_type='deal' AND target_id=? ORDER BY id DESC LIMIT 1",
  ).bind(dealId).first<{ id: number; action: string; details: string | null }>();
  if (latest?.action !== "portal_update_deal") return false;
  try {
    if ((JSON.parse(latest.details || "{}") as { status?: string }).status !== "paused") return false;
  } catch {
    return false;
  }
  if (!city) return true;
  const marketPaused = await env.DB.prepare(
    "SELECT 1 FROM audit_log WHERE id>? AND action='bulk_lifecycle' AND target_type='market' AND target_id=? LIMIT 1",
  ).bind(latest.id, city).first();
  return !marketPaused;
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  let b: PortalActionBody;
  try { b = await readJson<PortalActionBody>(request); } catch { return apiError(400, "INVALID_REQUEST", "The request body is invalid."); }
  const restaurantIds = await managedRestaurantIds(user.userId);
  if (!restaurantIds.length) return apiError(403, "NOT_A_MANAGER", "No restaurant has been assigned to this account yet. Radar staff assign restaurants — once one is, it appears here.");

  if (b.action === "update_photo") {
    const restaurantId = String(b.restaurantId || "");
    if (!restaurantIds.includes(restaurantId)) return apiError(403, "NOT_YOUR_RESTAURANT", "You do not manage this restaurant.");
    // A manager can remove the photo or point it at one uploaded for this restaurant
    // (/api/portal/photo-upload), not at an outside address. A photo goes live on public cards
    // without review, and one hosted elsewhere could be swapped for something else after it was
    // set, and would tell its host the IP address of everyone who saw a card. Staff can still set
    // an outside URL from /admin.
    const photoUrl = cleanText(b.photoUrl, 600);
    const ownUpload = `/api/photo/restaurants/${restaurantId}/`;
    if (photoUrl && (!photoUrl.startsWith(ownUpload) || !/^[\w./-]+$/.test(photoUrl) || photoUrl.includes(".."))) {
      return apiError(422, "INVALID_PHOTO_URL", "Upload the photo instead of linking to it.", { photoUrl: "Upload the photo" });
    }
    await env.DB.prepare("UPDATE restaurants SET photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(photoUrl || null, restaurantId).run();
    return Response.json({ ok: true });
  }

  if (b.action === "confirm_deal") {
    const dealId = String(b.dealId || "");
    const deal = await env.DB.prepare(
      `SELECT id,restaurant_id,status,owner_confirmed_at,
              owner_confirmed_at IS NOT NULL AND owner_confirmed_at>datetime('now','-${OWNER_CONFIRMATION_COOLDOWN_MINUTES} minutes') recent,
              EXISTS(SELECT 1 FROM deal_change_requests c WHERE c.deal_id=deals.id AND c.status='pending') pending
         FROM deals WHERE id=? AND deleted_at IS NULL`,
    ).bind(dealId).first<{ id: string; restaurant_id: string; status: string; owner_confirmed_at: string | null; recent: number; pending: number }>();
    if (!deal || !restaurantIds.includes(deal.restaurant_id)) return apiError(403, "NOT_YOUR_DEAL", "You do not manage this deal.");
    const blocked = ownerConfirmationBlocked({ status: deal.status, pending_change: deal.pending });
    if (blocked) return apiError(409, "CANNOT_CONFIRM", blocked);
    // A double click, or a second tab: the deal was confirmed moments ago, and saying so again adds
    // nothing to the record.
    if (deal.recent && deal.owner_confirmed_at) return Response.json({ ok: true, confirmed_at: deal.owner_confirmed_at });
    // Owner-sourced, so only the owner column moves: not verified_at or verification_status, which
    // are staff checks, and not updated_at, which would rebuild the search snapshot (drizzle/0069).
    // Guarded on still being live, in case the deal was paused or retired since it was read.
    const update = await env.DB.prepare(
      "UPDATE deals SET owner_confirmed_at=CURRENT_TIMESTAMP WHERE id=? AND status='live' AND deleted_at IS NULL",
    ).bind(dealId).run();
    if (!update.meta?.changes) return apiError(409, "CANNOT_CONFIRM", "This deal changed while you were looking at it. Reload the portal and try again.");
    await env.DB.prepare(
      "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,details) VALUES(?,?,?,?,?,?,?)",
    ).bind(user.userId, user.role, "portal_confirm_deal", "deal", dealId, crypto.randomUUID(), JSON.stringify({ previous: deal.owner_confirmed_at })).run();
    const row = await env.DB.prepare("SELECT owner_confirmed_at FROM deals WHERE id=?").bind(dealId).first<{ owner_confirmed_at: string }>();
    return Response.json({ ok: true, confirmed_at: row?.owner_confirmed_at || null });
  }

  if (b.action === "update_deal") {
    const dealId = String(b.dealId || "");
    const deal = await env.DB.prepare("SELECT id,restaurant_id,status,active,city,title,price,schedule,description,terms FROM deals WHERE id=? AND deleted_at IS NULL").bind(dealId).first<PortalDealRow>();
    if (!deal || !restaurantIds.includes(deal.restaurant_id)) return apiError(403, "NOT_YOUR_DEAL", "You do not manage this deal.");
    const title = cleanText(b.title, 180), price = cleanText(b.price, 120), schedule = cleanText(b.schedule, 180);
    if (!title || !price || !schedule) return apiError(422, "INVALID_DEAL", "Title, price, and schedule are required.");
    const proposed: DealContent = dealContentOf({ title, price, schedule, description: cleanText(b.description, 2000), terms: cleanText(b.terms, 2000) });
    const current = dealContentOf(deal);

    // A manager can pause a live deal and resume a paused one, and that takes effect at once:
    // pausing only takes a listing down, and resuming puts back content staff already accepted.
    // Publishing is staff work behind the readiness checks in /api/admin (verification, a
    // confirmed location, a schedule, a source), so a draft, expired or archived deal keeps its
    // status whatever is sent.
    // Resuming is only the manager's when the pause was theirs (pausedFromPortal): a deal staff took
    // down stays down until staff put it back.
    const toggleable = deal.status === "live" || deal.status === "paused";
    const active = toggleable ? (b.active ? 1 : 0) : deal.active;
    const status = toggleable ? (active ? "live" : "paused") : deal.status;
    if (deal.status === "paused" && status === "live" && !(await pausedFromPortal(dealId, deal.city))) {
      return apiError(409, "PAUSED_BY_RADAR", "Radar paused this deal, so it can't be resumed from here. Contact support to have it put back.");
    }
    const statements: D1PreparedStatement[] = [];
    if (active !== deal.active || status !== deal.status) {
      statements.push(env.DB.prepare("UPDATE deals SET active=?,status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(active, status, dealId));
    }

    // Content never goes onto the deal from here. A save that differs from what the deal says
    // becomes the one pending request for it, replacing any earlier one; a save that matches the
    // deal again takes a pending request back. Saving the same proposal twice (toggling the live
    // switch with the form still showing it) leaves the request, and its place in the queue, alone.
    const pending = await env.DB.prepare("SELECT id,title,price,schedule,description,terms FROM deal_change_requests WHERE deal_id=? AND status='pending'").bind(dealId).first<{ id: string } & DealContent>();
    const changed = changedDealFields(current, proposed);
    let review: "submitted" | "unchanged" | "withdrawn" | "none" = "none";
    if (changed.length) {
      if (pending && !changedDealFields(dealContentOf(pending), proposed).length) {
        review = "unchanged";
      } else {
        review = "submitted";
        if (pending) statements.push(env.DB.prepare("UPDATE deal_change_requests SET status='superseded' WHERE id=? AND status='pending'").bind(pending.id));
        statements.push(env.DB.prepare(
          "INSERT INTO deal_change_requests(id,deal_id,restaurant_id,requested_by,title,price,schedule,description,terms,previous) VALUES(?,?,?,?,?,?,?,?,?,?)",
        ).bind(crypto.randomUUID(), dealId, deal.restaurant_id, user.userId, proposed.title, proposed.price, proposed.schedule, proposed.description, proposed.terms, JSON.stringify(current)));
      }
    } else if (pending) {
      review = "withdrawn";
      statements.push(env.DB.prepare("UPDATE deal_change_requests SET status='withdrawn' WHERE id=? AND status='pending'").bind(pending.id));
    }
    statements.push(env.DB.prepare(
      "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,details) VALUES(?,?,?,?,?,?,?)",
    ).bind(user.userId, user.role, "portal_update_deal", "deal", dealId, crypto.randomUUID(), JSON.stringify({ active: Boolean(active), status, review, fields: changed })));
    try {
      await env.DB.batch(statements);
    } catch {
      // Two saves of the same deal at once: the partial unique index lets only one pending request
      // in, and the batch it lost is rolled back whole.
      return apiError(409, "EDIT_IN_PROGRESS", "Another change to this deal was just saved. Reload the portal and try again.");
    }
    return Response.json({ ok: true, review });
  }

  return apiError(400, "UNKNOWN_ACTION", "Unknown action.");
}
