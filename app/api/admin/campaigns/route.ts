import { env } from "cloudflare:workers";
import { hasPermission, type AppUser } from "../../../auth";
import { apiError, cleanText, readJson } from "../../../api-utils";
import { requireStaff, writeAudit } from "../../../admin-guard";

// Tracked campaigns: the record behind a tagged link, and the traffic that link brought in.
//
// Traffic was always recorded as `campaign_visit` product events (app/api/track/route.ts) and is
// still recorded exactly that way. A `campaigns` row (drizzle/0071_staff_workspace_access.sql) adds
// what an event cannot say: who owns the link, what it is for, whether it is running and when. The
// row is matched to its events by the link itself, never by a copied count, so a campaign created
// after its link was shared still shows every visit the link ever had (within the window below).
//
//   creator_handle set   an affiliate's labeled link (?c=<handle>&camp=<campaign>): matched on the
//                        event's `creator` and `creatorCampaign`
//   creator_handle NULL  a utm link: matched on `source` and `campaign`, ignoring creator visits
//                        (those carry source "creator" and belong to the rule above)
//
// An affiliate's campaign stores the handle and nothing else about them. Their name, rate and
// status stay in creator_profiles, which is the Affiliates tab's to change.
//
// Reading needs manage_campaigns, view_analytics or manage_finance (the same rule as the campaign
// traffic in GET /api/admin). Creating and editing needs manage_campaigns, and every write is
// audited.

/** product_events can be large: every read here is bounded to this many days and aggregated in SQL. */
const WINDOW_DAYS = 180;
const SINCE = `datetime('now','-${WINDOW_DAYS} days')`;
// The groups a list read pulls back. A free-text utm_campaign can spread traffic across many
// groups; past this the list says it is truncated rather than quietly dropping the tail.
const MAX_GROUPS = 1000;
const MAX_CAMPAIGNS = 300;

const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;
type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

// The shapes /api/track accepts. A source is lowercased there and kept to 40 characters; a slug
// rule here keeps a record from naming a link nobody could type.
const SOURCE = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const UTM_CAMPAIGN = /^[a-z0-9][a-z0-9._-]{0,59}$/;
const MEDIUM = /^[a-z0-9][a-z0-9._-]{0,39}$/;
// The creator link's own rules (app/CreatorLink.tsx, app/api/track/route.ts).
const HANDLE = /^[a-z0-9][a-z0-9-]{1,31}$/;
const CREATOR_CAMPAIGN = /^[a-z0-9][a-z0-9-]{1,47}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const canRead = (user: AppUser) =>
  hasPermission(user, "manage_campaigns") || hasPermission(user, "view_analytics") || hasPermission(user, "manage_finance");

interface CampaignRow {
  id: string;
  name: string;
  source: string;
  campaign: string | null;
  medium: string | null;
  landing_city: string | null;
  creator_handle: string | null;
  owner_id: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  owner_name: string | null;
  created_by_name: string | null;
}

const CAMPAIGN_SELECT = `SELECT c.*,o.name owner_name,cb.name created_by_name
  FROM campaigns c LEFT JOIN users o ON o.id=c.owner_id LEFT JOIN users cb ON cb.id=c.created_by`;

/** The key a campaign and its traffic share. */
function linkKey(link: { creator: string | null; label: string | null; source: string | null }) {
  return link.creator ? `c:${link.creator}:${link.label || ""}` : `u:${link.source || ""}:${link.label || ""}`;
}
const keyOfCampaign = (row: Pick<CampaignRow, "creator_handle" | "source" | "campaign">) =>
  linkKey({ creator: row.creator_handle, label: row.campaign, source: row.source });

/** The WHERE clause that finds one campaign's events, with its bindings. */
function eventMatch(row: Pick<CampaignRow, "creator_handle" | "source" | "campaign">): [string, string[]] {
  if (row.creator_handle)
    return [
      "json_extract(properties,'$.creator')=? AND COALESCE(json_extract(properties,'$.creatorCampaign'),'')=?",
      [row.creator_handle, row.campaign || ""],
    ];
  return [
    "json_extract(properties,'$.creator') IS NULL AND json_extract(properties,'$.source')=? AND COALESCE(json_extract(properties,'$.campaign'),'')=?",
    [row.source, row.campaign || ""],
  ];
}

export async function GET(request: Request) {
  const guard = await requireStaff(request, { allow: canRead });
  if (guard.response) return guard.response;
  const id = new URL(request.url).searchParams.get("id");
  return id ? readOne(cleanText(id, 80)) : readList(guard.user);
}

async function readList(user: AppUser) {
  // One pass over the window's campaign visits, grouped by the four properties that identify a
  // link. Matching the groups to records happens below in a single loop over at most MAX_GROUPS
  // rows; doing it as a join would re-scan the events once per campaign.
  const [campaigns, groups, signups] = await Promise.all([
    env.DB.prepare(`${CAMPAIGN_SELECT} ORDER BY (c.status='active') DESC,c.updated_at DESC LIMIT ${MAX_CAMPAIGNS}`).all<CampaignRow>(),
    env.DB.prepare(
      `SELECT json_extract(properties,'$.creator') creator,json_extract(properties,'$.creatorCampaign') creator_campaign,
              json_extract(properties,'$.source') source,json_extract(properties,'$.campaign') campaign,
              COUNT(*) visits,COALESCE(SUM(created_at>=datetime('now','-30 days')),0) visits30,
              MIN(created_at) first_seen,MAX(created_at) last_seen,COUNT(DISTINCT market) markets
         FROM product_events
        WHERE type='campaign_visit' AND created_at>=${SINCE}
        GROUP BY creator,creator_campaign,source,campaign ORDER BY visits DESC LIMIT ${MAX_GROUPS + 1}`,
    ).all<{ creator: string | null; creator_campaign: string | null; source: string | null; campaign: string | null; visits: number; visits30: number; first_seen: string; last_seen: string; markets: number }>(),
    // Sign-ups are only attributable to an affiliate's link: account creation stamps the handle
    // and label (users.referred_by / referred_campaign). A utm visit leaves nothing on the account.
    env.DB.prepare(
      `SELECT referred_by handle,COALESCE(referred_campaign,'') label,COUNT(*) signups FROM users
        WHERE referred_by IS NOT NULL AND created_at>=${SINCE} GROUP BY referred_by,label LIMIT ${MAX_GROUPS}`,
    ).all<{ handle: string; label: string; signups: number }>(),
  ]);
  const groupRows = (groups.results || []).slice(0, MAX_GROUPS);
  const traffic = new Map<string, { visits: number; visits30: number; first_seen: string; last_seen: string }>();
  const untracked = new Map<string, { creator: string | null; source: string | null; campaign: string | null; visits: number; visits30: number; first_seen: string; last_seen: string }>();
  const campaignRows = campaigns.results || [];
  const tracked = new Set(campaignRows.map(keyOfCampaign));
  for (const group of groupRows) {
    const key = linkKey({ creator: group.creator, label: group.creator ? group.creator_campaign : group.campaign, source: group.source });
    const total = traffic.get(key) || { visits: 0, visits30: 0, first_seen: group.first_seen, last_seen: group.last_seen };
    total.visits += group.visits;
    total.visits30 += group.visits30;
    if (group.first_seen < total.first_seen) total.first_seen = group.first_seen;
    if (group.last_seen > total.last_seen) total.last_seen = group.last_seen;
    traffic.set(key, total);
    // Traffic no record claims is listed rather than dropped, so a link somebody shared without
    // tracking it still shows up, with a way to track it.
    if (!tracked.has(key)) {
      const label = group.creator ? group.creator_campaign : group.campaign;
      const row = untracked.get(key) || { creator: group.creator, source: group.creator ? "creator" : group.source, campaign: label, visits: 0, visits30: 0, first_seen: group.first_seen, last_seen: group.last_seen };
      row.visits += group.visits;
      row.visits30 += group.visits30;
      if (group.first_seen < row.first_seen) row.first_seen = group.first_seen;
      if (group.last_seen > row.last_seen) row.last_seen = group.last_seen;
      untracked.set(key, row);
    }
  }
  const signupsBy = new Map((signups.results || []).map((row) => [`c:${row.handle}:${row.label}`, row.signups]));
  return Response.json({
    windowDays: WINDOW_DAYS,
    truncated: (groups.results || []).length > MAX_GROUPS,
    canEdit: hasPermission(user, "manage_campaigns"),
    campaigns: campaignRows.map((row) => {
      const key = keyOfCampaign(row);
      const seen = traffic.get(key);
      return {
        ...row,
        visits: seen?.visits || 0,
        visits30: seen?.visits30 || 0,
        first_seen: seen?.first_seen || null,
        last_seen: seen?.last_seen || null,
        signups: row.creator_handle ? signupsBy.get(key) || 0 : null,
      };
    }),
    untracked: [...untracked.values()].sort((a, b) => b.visits - a.visits).slice(0, 100),
  });
}

async function readOne(id: string) {
  const row = await env.DB.prepare(`${CAMPAIGN_SELECT} WHERE c.id=?`).bind(id).first<CampaignRow>();
  if (!row) return apiError(404, "CAMPAIGN_NOT_FOUND", "That campaign could not be found.");
  const [where, binds] = eventMatch(row);
  const [days, markets, signupDays] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at) day,COUNT(*) visits FROM product_events
        WHERE type='campaign_visit' AND created_at>=${SINCE} AND ${where}
        GROUP BY day ORDER BY day LIMIT ${WINDOW_DAYS + 1}`,
    ).bind(...binds).all<{ day: string; visits: number }>(),
    env.DB.prepare(
      `SELECT market,COUNT(*) visits,MAX(created_at) last_seen FROM product_events
        WHERE type='campaign_visit' AND created_at>=${SINCE} AND ${where}
        GROUP BY market ORDER BY visits DESC LIMIT 50`,
    ).bind(...binds).all<{ market: string | null; visits: number; last_seen: string }>(),
    row.creator_handle
      ? env.DB.prepare(
          `SELECT date(created_at) day,COUNT(*) signups FROM users
            WHERE referred_by=? AND COALESCE(referred_campaign,'')=? AND created_at>=${SINCE}
            GROUP BY day ORDER BY day LIMIT ${WINDOW_DAYS + 1}`,
        ).bind(row.creator_handle, row.campaign || "").all<{ day: string; signups: number }>()
      : Promise.resolve({ results: [] as { day: string; signups: number }[] }),
  ]);
  const byDay = new Map<string, { day: string; visits: number; signups: number }>();
  for (const day of days.results || []) byDay.set(day.day, { day: day.day, visits: day.visits, signups: 0 });
  for (const day of signupDays.results || []) {
    const entry = byDay.get(day.day) || { day: day.day, visits: 0, signups: 0 };
    entry.signups = day.signups;
    byDay.set(day.day, entry);
  }
  const trend = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  return Response.json({
    windowDays: WINDOW_DAYS,
    campaign: row,
    trend,
    markets: markets.results || [],
    totals: {
      visits: trend.reduce((sum, day) => sum + day.visits, 0),
      signups: row.creator_handle ? trend.reduce((sum, day) => sum + day.signups, 0) : null,
    },
  });
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

interface CampaignBody {
  op?: unknown;
  id?: unknown;
  name?: unknown;
  source?: unknown;
  campaign?: unknown;
  medium?: unknown;
  landingCity?: unknown;
  creatorHandle?: unknown;
  ownerId?: unknown;
  status?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  notes?: unknown;
}

type CampaignFields = {
  name: string;
  source: string;
  campaign: string | null;
  medium: string | null;
  landing_city: string | null;
  creator_handle: string | null;
  owner_id: string | null;
  status: CampaignStatus;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
};

const validDate = (value: string) => {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * Every rule a campaign record has to meet, as field errors the form can show beside each input.
 */
function validateCampaign(body: CampaignBody): { fields: CampaignFields; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const rawName = String(body.name ?? "").trim();
  const name = cleanText(body.name, 200);
  if (!name) errors.name = "Give the campaign a name.";
  else if (rawName.length > 80) errors.name = "Keep the name to 80 characters.";
  const creatorHandle = cleanText(body.creatorHandle, 40).toLowerCase() || null;
  if (creatorHandle && !HANDLE.test(creatorHandle)) errors.creatorHandle = "That is not an affiliate handle.";
  // An affiliate's link always records source "creator" (app/CreatorLink.tsx), so that is the
  // source its record carries, whatever the form sent.
  const source = creatorHandle ? "creator" : cleanText(body.source, 60).toLowerCase();
  if (!source) errors.source = "A source is required, e.g. instagram or newsletter.";
  else if (!SOURCE.test(source)) errors.source = "Lowercase letters, numbers, dots, dashes and underscores only, up to 40 characters.";
  const campaign = cleanText(body.campaign, 80).toLowerCase() || null;
  if (campaign && creatorHandle && !CREATOR_CAMPAIGN.test(campaign))
    errors.campaign = "An affiliate's label is 2–48 lowercase letters, numbers and dashes.";
  else if (campaign && !creatorHandle && !UTM_CAMPAIGN.test(campaign))
    errors.campaign = "Lowercase letters, numbers, dots, dashes and underscores only, up to 60 characters.";
  const medium = creatorHandle ? "link" : cleanText(body.medium, 60).toLowerCase() || null;
  if (medium && !MEDIUM.test(medium)) errors.medium = "Lowercase letters, numbers, dots, dashes and underscores only.";
  const landingCity = cleanText(body.landingCity, 120) || null;
  if (landingCity && landingCity.length > 100) errors.landingCity = "Keep the city to 100 characters.";
  const status = String(body.status || "active") as CampaignStatus;
  if (!CAMPAIGN_STATUSES.includes(status)) errors.status = "Choose draft, active, paused or ended.";
  const startsAt = cleanText(body.startsAt, 20) || null;
  const endsAt = cleanText(body.endsAt, 20) || null;
  if (startsAt && !validDate(startsAt)) errors.startsAt = "Use a real date.";
  if (endsAt && !validDate(endsAt)) errors.endsAt = "Use a real date.";
  if (startsAt && endsAt && !errors.startsAt && !errors.endsAt && endsAt < startsAt) errors.endsAt = "The end date cannot be before the start date.";
  const notes = cleanText(body.notes, 1200) || null;
  if (notes && notes.length > 1000) errors.notes = "Keep notes to 1,000 characters.";
  const ownerId = cleanText(body.ownerId, 80) || null;
  return {
    fields: { name, source, campaign, medium, landing_city: landingCity, creator_handle: creatorHandle, owner_id: ownerId, status, starts_at: startsAt, ends_at: endsAt, notes },
    errors,
  };
}

export async function POST(request: Request) {
  const guard = await requireStaff(request, { permission: "manage_campaigns", write: true });
  if (guard.response) return guard.response;
  const user = guard.user;
  let body: CampaignBody;
  try {
    body = await readJson<CampaignBody>(request, 8_000);
  } catch {
    return apiError(400, "INVALID_REQUEST", "The campaign could not be read.");
  }
  const op = String(body.op || "");
  if (op === "status") return setStatus(user, body);
  if (op !== "create" && op !== "update") return apiError(422, "INVALID_OPERATION", "Unknown campaign operation.");

  const { fields, errors } = validateCampaign(body);
  if (Object.keys(errors).length) return apiError(422, "INVALID_CAMPAIGN", "Some fields need fixing.", errors);

  const existing = op === "update" ? await env.DB.prepare("SELECT * FROM campaigns WHERE id=?").bind(cleanText(body.id, 80)).first<CampaignRow>() : null;
  if (op === "update" && !existing) return apiError(404, "CAMPAIGN_NOT_FOUND", "That campaign could not be found.");
  // New records belong to whoever made them unless somebody else is named.
  if (!fields.owner_id) fields.owner_id = existing?.owner_id || user.userId;

  // The owner is someone who can open this workspace. A creator or a reader owning a campaign
  // would be a name on a record nobody on staff answers for. An owner the record already had is
  // left alone, so a campaign whose owner has since left can still be edited.
  const owner = fields.owner_id === existing?.owner_id
    ? true
    : await env.DB.prepare("SELECT id FROM users WHERE id=? AND status='active' AND role NOT IN ('user','creator','restaurant')").bind(fields.owner_id).first();
  if (!owner) return apiError(422, "INVALID_CAMPAIGN", "Some fields need fixing.", { ownerId: "Choose a member of staff." });
  if (fields.creator_handle) {
    const creator = await env.DB.prepare("SELECT handle FROM creator_profiles WHERE handle=?").bind(fields.creator_handle).first();
    if (!creator) return apiError(422, "INVALID_CAMPAIGN", "Some fields need fixing.", { creatorHandle: "No affiliate uses that handle." });
  }
  // One record per link (idx_campaigns_link). Checked first so the form gets a field error; the
  // index is still what holds when two people save at once.
  const clash = await env.DB.prepare(
    "SELECT id,name FROM campaigns WHERE COALESCE(creator_handle,'')=? AND source=? AND COALESCE(campaign,'')=? AND id<>? LIMIT 1",
  ).bind(fields.creator_handle || "", fields.source, fields.campaign || "", existing?.id || "").first<{ id: string; name: string }>();
  if (clash) return linkTaken(clash.name);

  const id = existing?.id || `campaign-${crypto.randomUUID()}`;
  try {
    if (existing) {
      await env.DB.prepare(
        `UPDATE campaigns SET name=?,source=?,campaign=?,medium=?,landing_city=?,creator_handle=?,owner_id=?,status=?,starts_at=?,ends_at=?,notes=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,
      ).bind(fields.name, fields.source, fields.campaign, fields.medium, fields.landing_city, fields.creator_handle, fields.owner_id, fields.status, fields.starts_at, fields.ends_at, fields.notes, id).run();
    } else {
      await env.DB.prepare(
        `INSERT INTO campaigns(id,name,source,campaign,medium,landing_city,creator_handle,owner_id,status,starts_at,ends_at,notes,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(id, fields.name, fields.source, fields.campaign, fields.medium, fields.landing_city, fields.creator_handle, fields.owner_id, fields.status, fields.starts_at, fields.ends_at, fields.notes, user.userId).run();
    }
  } catch (cause) {
    if (/UNIQUE/i.test(String(cause))) return linkTaken("another campaign");
    throw cause;
  }
  // What changed, field by field, so the audit row answers "who moved the end date" by itself.
  const changes: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    const before = existing ? (existing as unknown as Record<string, unknown>)[key] ?? null : null;
    if (!existing || before !== value) changes[key] = existing ? { from: before, to: value } : value;
  }
  await writeAudit(user, { action: existing ? "campaign_update" : "campaign_create", targetType: "campaign", targetId: id, details: changes });
  return Response.json({ ok: true, id }, { status: existing ? 200 : 201 });
}

function linkTaken(name: string) {
  return apiError(409, "CAMPAIGN_LINK_TAKEN", `That link is already tracked by ${name}. Open that campaign instead.`, {
    campaign: "This link already has a campaign record.",
  });
}

/** Pausing, ending or restarting a campaign from its detail view, without resending the form. */
async function setStatus(user: AppUser, body: CampaignBody) {
  const id = cleanText(body.id, 80);
  const status = String(body.status || "") as CampaignStatus;
  if (!CAMPAIGN_STATUSES.includes(status)) return apiError(422, "INVALID_CAMPAIGN", "Some fields need fixing.", { status: "Choose draft, active, paused or ended." });
  const existing = await env.DB.prepare("SELECT id,status FROM campaigns WHERE id=?").bind(id).first<{ id: string; status: string }>();
  if (!existing) return apiError(404, "CAMPAIGN_NOT_FOUND", "That campaign could not be found.");
  if (existing.status === status) return Response.json({ ok: true, id });
  await env.DB.prepare("UPDATE campaigns SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(status, id).run();
  await writeAudit(user, { action: "campaign_update", targetType: "campaign", targetId: id, details: { status: { from: existing.status, to: status } } });
  return Response.json({ ok: true, id });
}
