// The draft review screen: every draft beside the words its source used, decided one at a time.
//
// Why this exists
// ---------------
// Drafts arrive faster than the one-at-a-time editor clears them, from the internal research
// process. Each one's evidence is a quote in internal_notes ("Restaurant's own page says: ..."),
// and the review is reading that quote against the fields and the source page. In the
// editor that took five steps per deal and a schedule re-typed by hand, so the drafts sat.
//
// One draft per decision
// ----------------------
// The screen used to tick drafts in batches of up to fifty, which made it easy to publish something
// nobody had read. It is now a list beside one draft's full detail: the reviewer selects a draft,
// reads it against its source, and publishes or archives that one; the next draft in the same
// filtered list is selected for them (nextDraftAfter). The server holds to one draft per request
// (ONE_DRAFT_AT_A_TIME in app/api/admin/route.ts) whatever a client sends, and archiving needs a
// reason. The request still carries an `items` array, so the batch reader and the writes below are
// the same code a single decision runs.
//
// What a decision does
// --------------------
// "Verify and publish" is the single verify (app/api/admin/route.ts) and the lifecycle publish, in
// one transaction: a verification event, the primary branch confirmed, the deal live. A draft whose
// schedule is only prose gets the windows app/schedule-text.ts reads from it, which the screen
// showed the reviewer beside the quote. The client sends the schedule text it showed, and a draft
// whose text has changed since is skipped, so what is saved is what was read. "Archive" retires a
// draft that did not hold up.
//
// Both write the audit rows the single buttons would (verify, lifecycle), marked as coming from
// draft review, so the audit log reads the same whichever way it was done.
//
// It never decides anything. A draft the parser cannot read, or with no source or branch, is
// refused here and goes to the editor.

import { parseScheduleText, type ScheduleWindow } from "./schedule-text";
import { sourceKind, type SourceKind } from "./review-queue";
import { DEAL_PLACES_SQL, drinkIssuesForRow, type DrinkRuleIssue } from "./drink-rules";

/** The most ids the request reader accepts. The route then refuses anything but exactly one. */
export const MAX_DRAFT_BATCH = 50;
/** How many drafts the screen loads. Far above the backlog; past it, the oldest wait their turn. */
export const DRAFT_REVIEW_LIMIT = 300;

/**
 * Every draft, with what the reviewer reads and what publishing needs. Drafts in a market Radar
 * covers first (a published deal there has readers), then the oldest.
 */
export const DRAFT_REVIEW_SQL = `SELECT d.id,d.restaurant,d.title,d.emoji,d.category,d.city,d.address,d.price,d.schedule,d.terms,d.restrictions,
    d.expires_at,d.internal_notes,d.source_url,d.location_id,d.verification_status,d.created_at,
    d.description,d.cuisine,d.location_scope,r.country national_country,r.footprint,${DEAL_PLACES_SQL} places,
    r.website,l.region region,COALESCE(l.country,r.country) country,COALESCE(l.full_postal,l.postal_prefix) postal,
    (SELECT COUNT(*) FROM deal_schedules s WHERE s.deal_id=d.id) schedules,
    (SELECT COUNT(*) FROM deal_locations dl WHERE dl.deal_id=d.id AND dl.location_id=d.location_id) offer_location,
    (SELECT COUNT(*) FROM deal_locations dl WHERE dl.deal_id=d.id) locations,
    (SELECT json_extract(s.details,'$.note') FROM staff_reminders s WHERE s.deal_id=d.id AND s.kind='new_draft' AND s.status='open' ORDER BY s.created_at DESC LIMIT 1) research_note,
    EXISTS(SELECT 1 FROM market_coverage m WHERE m.market=d.city OR (m.market='Ottawa–Gatineau' AND d.city IN ('Ottawa','Gatineau'))) covered
  FROM deals d LEFT JOIN restaurants r ON r.id=d.restaurant_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
  WHERE d.status='draft' AND d.deleted_at IS NULL
  ORDER BY covered DESC,d.created_at,d.id
  LIMIT ${DRAFT_REVIEW_LIMIT}`;

export interface DraftReviewRow {
  id: string;
  /** The offer's branch's province or state, country and postal code, for the geography filters. */
  region?: string | null;
  country?: string | null;
  postal?: string | null;
  restaurant: string;
  title: string;
  emoji: string;
  category: string | null;
  city: string;
  address: string | null;
  price: string | null;
  schedule: string | null;
  terms: string | null;
  restrictions: string | null;
  expires_at: string | null;
  internal_notes: string | null;
  source_url: string | null;
  location_id: string | null;
  verification_status: string;
  created_at: string | null;
  website: string | null;
  schedules: number | null;
  offer_location: number | null;
  locations: number | null;
  research_note: string | null;
  covered: number | boolean | null;
  description?: string | null;
  cuisine?: string | null;
  location_scope?: string | null;
  national_country?: string | null;
  footprint?: string | null;
  /** Where its branches are, for the drink rules (DEAL_PLACES_SQL). */
  places?: string | null;
}

/** Why a draft cannot be published from the review screen, in the words the screen shows. */
export type DraftBlocker = "no_source" | "no_location" | "unreadable_schedule" | "drink_rules";

export const DRAFT_BLOCKER_TEXT: Record<DraftBlocker, string> = {
  no_source: "No source URL",
  no_location: "No confirmed-able branch",
  unreadable_schedule: "Hours could not be read from the schedule",
  drink_rules: "Breaks a drink-advertising rule",
};

export interface DraftReadiness {
  /** What would be saved as its schedule: nothing when it already has windows set in the editor. */
  windows: ScheduleWindow[];
  /** True when the deal already has schedule windows and none are written. */
  hasSchedule: boolean;
  blockers: DraftBlocker[];
  source: SourceKind;
  /** The drink-advertising rules it breaks or should be checked against (app/drink-rules.ts). */
  drinkIssues: DrinkRuleIssue[];
}

type ReadinessInput = Pick<DraftReviewRow, "schedule" | "source_url" | "location_id" | "schedules" | "offer_location" | "website">
  & Partial<Pick<DraftReviewRow, "restaurant" | "title" | "price" | "category" | "terms" | "restrictions" | "description" | "cuisine" | "location_scope" | "national_country" | "footprint" | "places">>;

/** What publishing this draft from the review screen would write, and what stops it. */
export function draftReadiness(row: ReadinessInput): DraftReadiness {
  const hasSchedule = Number(row.schedules) > 0;
  const windows = hasSchedule ? [] : parseScheduleText(row.schedule);
  const blockers: DraftBlocker[] = [];
  if (!row.source_url?.trim()) blockers.push("no_source");
  if (!row.location_id || !Number(row.offer_location)) blockers.push("no_location");
  if (!hasSchedule && !windows.length) blockers.push("unreadable_schedule");
  const drinkIssues = drinkIssuesForRow({
    ...row, id: "", footprint: row.footprint ?? null, places: row.places ?? null, windows: JSON.stringify(windows),
  });
  // First, since it is the one that no edit to the hours or source fixes.
  if (drinkIssues.some((issue) => issue.severity === "block")) blockers.unshift("drink_rules");
  return { windows, hasSchedule, blockers, source: sourceKind(row.source_url, row.website), drinkIssues };
}

/**
 * Which draft to select after a decision on `actedId`, so the reviewer keeps their place: the
 * first draft after it in the list they were reading that is still listed now, else the nearest
 * one before it, else whatever is first. `before` is the filtered list as it stood when they acted,
 * `after` the same filter over the reloaded drafts. Null when nothing is left.
 */
export function nextDraftAfter(before: readonly string[], actedId: string, after: readonly string[]): string | null {
  const remaining = new Set(after);
  const at = before.indexOf(actedId);
  if (at !== -1) {
    for (let index = at + 1; index < before.length; index += 1) if (remaining.has(before[index]) && before[index] !== actedId) return before[index];
    for (let index = at - 1; index >= 0; index -= 1) if (remaining.has(before[index])) return before[index];
  }
  return after.find((id) => id !== actedId) ?? null;
}

/** The draft the reviewer decided on, with the schedule text they were shown. */
export interface DraftBatchItem {
  id: string;
  schedule: string;
}

/** Reads the request body's items: strings only, no repeats, at most MAX_DRAFT_BATCH. */
export function parseDraftBatchItems(value: unknown): DraftBatchItem[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_DRAFT_BATCH) return null;
  const seen = new Set<string>();
  const items: DraftBatchItem[] = [];
  for (const entry of value) {
    const item = entry as { id?: unknown; schedule?: unknown } | null;
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 200) return null;
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    items.push({ id: item.id, schedule: typeof item.schedule === "string" ? item.schedule : "" });
  }
  return items;
}

/** What the decision reads back about the requested deal, just before writing. */
export const DRAFT_BATCH_READ_SQL = `SELECT d.id,d.status,d.schedule,d.source_url,d.location_id,r.website,l.timezone,
    d.restaurant,d.title,d.price,d.category,d.terms,d.restrictions,d.description,d.cuisine,d.location_scope,r.country national_country,r.footprint,${DEAL_PLACES_SQL} places,
    (SELECT COUNT(*) FROM deal_schedules s WHERE s.deal_id=d.id) schedules,
    (SELECT COUNT(*) FROM deal_locations dl WHERE dl.deal_id=d.id AND dl.location_id=d.location_id) offer_location
  FROM deals d LEFT JOIN restaurants r ON r.id=d.restaurant_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
  WHERE d.id IN (SELECT value FROM json_each(?)) AND d.deleted_at IS NULL`;

export interface DraftBatchRow extends ReadinessInput {
  id: string;
  status: string;
  timezone: string | null;
}

export type DraftSkipReason = "not_draft" | "changed" | DraftBlocker;

export const DRAFT_SKIP_TEXT: Record<DraftSkipReason, string> = {
  not_draft: "No longer a draft",
  changed: "Its schedule changed since the page loaded",
  ...DRAFT_BLOCKER_TEXT,
};

export interface DraftPublishPlan {
  publish: { id: string; windows: ScheduleWindow[]; timezone: string }[];
  skipped: { id: string; reason: DraftSkipReason }[];
}

/** Used when a branch has no timezone on record, as convert_suggestion does. */
const FALLBACK_TIMEZONE = "America/Toronto";

/**
 * Which of the requested drafts publish, and with which schedule windows. Pure, so the decision is
 * testable apart from the database: the route reads DRAFT_BATCH_READ_SQL and writes what this says.
 */
export function planDraftPublish(items: readonly DraftBatchItem[], rows: readonly DraftBatchRow[]): DraftPublishPlan {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const plan: DraftPublishPlan = { publish: [], skipped: [] };
  for (const item of items) {
    const row = byId.get(item.id);
    if (!row || row.status !== "draft") {
      plan.skipped.push({ id: item.id, reason: "not_draft" });
      continue;
    }
    if ((row.schedule || "") !== item.schedule) {
      plan.skipped.push({ id: item.id, reason: "changed" });
      continue;
    }
    const readiness = draftReadiness(row);
    if (readiness.blockers.length) {
      plan.skipped.push({ id: item.id, reason: readiness.blockers[0] });
      continue;
    }
    plan.publish.push({ id: item.id, windows: readiness.windows, timezone: row.timezone || FALLBACK_TIMEZONE });
  }
  return plan;
}

// The writes. Each takes the deal ids as one JSON array and touches only rows still 'draft', so a
// deal published or archived by somebody else between the read and this batch is left alone by
// every statement alike. The deals UPDATE runs last of the four, since the others test its status.

/** Binds: JSON array of {deal, display, days, start, end, timezone}. */
export const DRAFT_INSERT_SCHEDULES_SQL = `INSERT INTO deal_schedules(deal_id,display_text,days,start_time,end_time,timezone)
  SELECT json_extract(j.value,'$.deal'),json_extract(j.value,'$.display'),json_extract(j.value,'$.days'),json_extract(j.value,'$.start'),json_extract(j.value,'$.end'),json_extract(j.value,'$.timezone')
    FROM json_each(?) j
   WHERE EXISTS(SELECT 1 FROM deals d WHERE d.id=json_extract(j.value,'$.deal') AND d.status='draft' AND d.deleted_at IS NULL)`;

/** Binds: verified_by, notes, JSON array of ids. Same row the single verify writes. */
export const DRAFT_VERIFY_EVENTS_SQL = `INSERT INTO verification_events(deal_id,status,method,source_url,verified_by,notes)
  SELECT d.id,'verified','source_review',d.source_url,?,? FROM deals d
   WHERE d.id IN (SELECT value FROM json_each(?)) AND d.status='draft' AND d.deleted_at IS NULL`;

/** Binds: JSON array of ids. Confirms the deal's primary branch, as the single verify does by default. */
export const DRAFT_CONFIRM_LOCATIONS_SQL = `UPDATE deal_locations
     SET eligibility='confirmed',source_url=(SELECT d.source_url FROM deals d WHERE d.id=deal_locations.deal_id),
         verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
   WHERE deal_id IN (SELECT value FROM json_each(?))
     AND EXISTS(SELECT 1 FROM deals d WHERE d.id=deal_locations.deal_id AND d.location_id=deal_locations.location_id AND d.status='draft' AND d.deleted_at IS NULL)`;

/**
 * Binds: actor_id, actor_role, action, request_id, reason, batch size, status, confirmedLocations,
 * JSON array of ids. One row per deal still in draft, with the deal's name and city in its details
 * the way the single actions' rows carry what they changed.
 */
export const DRAFT_AUDIT_SQL = `INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,reason,details)
  SELECT ?1,?2,?3,'deal',d.id,?4,?5,json_object('via','draft_review','batchSize',?6,'status',?7,'confirmedLocations',?8,'restaurant',d.restaurant,'title',d.title,'city',d.city)
    FROM deals d
   WHERE d.id IN (SELECT value FROM json_each(?9)) AND d.status='draft' AND d.deleted_at IS NULL`;

/**
 * Binds: JSON array of ids. Verified and live in one step, the result of verify then lifecycle.
 * Returns the ids it changed, which is the count the reviewer is told.
 */
export const DRAFT_PUBLISH_SQL = `UPDATE deals
     SET verification_status='verified',verified_at=CURRENT_TIMESTAMP,status='live',active=1,updated_at=CURRENT_TIMESTAMP
   WHERE id IN (SELECT value FROM json_each(?)) AND status='draft' AND deleted_at IS NULL
  RETURNING id`;

/** Binds: JSON array of ids. Returns the ids it changed. */
export const DRAFT_ARCHIVE_SQL = `UPDATE deals SET status='archived',active=0,updated_at=CURRENT_TIMESTAMP
   WHERE id IN (SELECT value FROM json_each(?)) AND status='draft' AND deleted_at IS NULL
  RETURNING id`;
