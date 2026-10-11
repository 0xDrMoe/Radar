// The admin's review queue: which deals someone should check next, in the order worth checking them.
//
// Why this exists
// ---------------
// "Verified within 30 days" is the claim Radar makes that a deal directory does not, and most of
// the catalog has never earned it: 145 of 162 Canadian cards were listed from their source and
// never checked (app/verification.ts), and every import or research run adds drafts nobody has read.
// The queue that was meant to work this down was the first eight of whatever the admin's 500-row
// deal list happened to load, unordered, with archived and expired deals mixed in. It did not know
// the catalog past row 500, could not say why a deal was in it, and offered no way to act but
// opening the full editor.
//
// What it orders by
// -----------------
// A wrong deal people are looking at costs more trust than a wrong deal nobody opens, so live deals
// come first and, among them, the ones people use: saves (each one somebody planning to go) count
// three times a click on the deal or its offer in the last 30 days. A live deal nobody has ever
// checked goes ahead of one whose check has only aged, at equal attention, because "Listed" is a
// weaker claim than "Re-checking". Ties go to the oldest claim.
//
// Drafts come after every live deal: nothing is wrong on the site while they wait. Among them,
// those in a market Radar covers come first (a published deal there has readers), then those whose
// source is the restaurant's own page (the fastest yes: the reviewer reads one page, and
// scripts/draft-review.mjs makes the same call), then the oldest.
//
// It never decides anything. It ranks; a person opens the source and verifies, edits or retires.

export type ReviewReason = "live_unchecked" | "live_stale" | "draft";
export type SourceKind = "own" | "directory" | "none";

/** A verified deal goes stale this long after its last check; the deals API and admin totals agree. */
export const STALE_AFTER_DAYS = 30;
/** Saves outweigh clicks: a save is someone planning to go, a click is someone looking. */
export const SAVE_WEIGHT = 3;
/**
 * How many ranked rows the server returns for each reason. Per reason rather than overall, so the
 * admin's filter for drafts still has drafts to show while live deals fill the top of the queue.
 * The counts cover the whole queue regardless.
 */
export const REVIEW_QUEUE_LIMIT = 40;

/**
 * Every deal that belongs in the queue, with what ranking needs, read across the whole catalog.
 * Archived, expired, paused, scheduled and deleted deals are not in it: nothing is wrong on the
 * site because of them, and retiring is their resolution, not a check.
 */
export const REVIEW_QUEUE_SQL = `SELECT d.id,d.restaurant,d.title,d.emoji,d.city,d.status,d.verification_status,d.verified_at,d.created_at,d.source_url,
    r.website,
    (SELECT COUNT(*) FROM favorites f WHERE f.deal_id=d.id) saves,
    (SELECT COUNT(*) FROM product_events e WHERE e.entity_id=d.id AND e.type='deal_click' AND e.created_at>=datetime('now','-30 days')) clicks,
    (SELECT MAX(v.verified_at) FROM verification_events v WHERE v.deal_id=d.id AND v.status='verified') last_checked_at,
    EXISTS(SELECT 1 FROM market_coverage m WHERE m.market=d.city OR (m.market='Ottawa–Gatineau' AND d.city IN ('Ottawa','Gatineau'))) covered
  FROM deals d LEFT JOIN restaurants r ON r.id=d.restaurant_id
  WHERE d.deleted_at IS NULL AND (
    d.status='draft'
    OR (d.status='live' AND (d.verification_status<>'verified' OR julianday('now')-julianday(d.verified_at)>${STALE_AFTER_DAYS}))
  )`;

export interface ReviewQueueRow {
  id: string;
  restaurant: string;
  title: string;
  emoji: string;
  city: string;
  status: string;
  verification_status: string;
  verified_at: string | null;
  created_at: string | null;
  source_url: string | null;
  website: string | null;
  saves: number | null;
  clicks: number | null;
  last_checked_at: string | null;
  covered: number | boolean | null;
}

export interface ReviewQueueItem {
  id: string;
  restaurant: string;
  title: string;
  emoji: string;
  city: string;
  reason: ReviewReason;
  saves: number;
  clicks: number;
  /** When it was last checked against its source, or null if it never was. */
  lastCheckedAt: string | null;
  /** When it entered the catalog. */
  createdAt: string | null;
  sourceUrl: string | null;
  source: SourceKind;
  covered: boolean;
}

export interface ReviewQueue {
  items: ReviewQueueItem[];
  counts: Record<ReviewReason, number>;
}

/** SQLite's naive "YYYY-MM-DD HH:MM:SS" is UTC; see parseSqlTimestamp in app/verification.ts. */
function sqlTime(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`).getTime();
}

function hostOf(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Whether a deal's source is the restaurant's own site. A subdomain of the restaurant's domain
 * (menu.example.com for example.com) counts as its own; a directory, social page or ordering
 * platform does not, which is the same line restaurants.website draws (drizzle/0058).
 */
export function sourceKind(sourceUrl: string | null | undefined, website: string | null | undefined): SourceKind {
  const source = hostOf(sourceUrl);
  if (!source) return "none";
  const own = hostOf(website);
  if (own && (source === own || source.endsWith(`.${own}`))) return "own";
  return "directory";
}

export function reviewReason(row: Pick<ReviewQueueRow, "status" | "verification_status">): ReviewReason {
  if (row.status === "draft") return "draft";
  return row.verification_status === "verified" || row.verification_status === "stale" ? "live_stale" : "live_unchecked";
}

const REASON_ORDER: Record<ReviewReason, number> = { live_unchecked: 0, live_stale: 1, draft: 2 };
const SOURCE_ORDER: Record<SourceKind, number> = { own: 0, directory: 1, none: 2 };

/** Attention a live deal gets; what decides which wrong-looking deal costs the most trust. */
export function attention(item: Pick<ReviewQueueItem, "saves" | "clicks">): number {
  return item.saves * SAVE_WEIGHT + item.clicks;
}

/** The moment the deal's current claim dates from: its last check, else when it was listed. */
function claimTime(item: ReviewQueueItem): number {
  const time = sqlTime(item.lastCheckedAt ?? item.createdAt);
  return Number.isNaN(time) ? 0 : time;
}

export function compareReviewItems(a: ReviewQueueItem, b: ReviewQueueItem): number {
  const aDraft = a.reason === "draft";
  const bDraft = b.reason === "draft";
  if (aDraft !== bDraft) return aDraft ? 1 : -1;
  if (!aDraft) {
    return attention(b) - attention(a)
      || REASON_ORDER[a.reason] - REASON_ORDER[b.reason]
      || claimTime(a) - claimTime(b)
      || a.id.localeCompare(b.id);
  }
  return Number(b.covered) - Number(a.covered)
    || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
    || claimTime(a) - claimTime(b)
    || a.id.localeCompare(b.id);
}

export function buildReviewQueue(rows: readonly ReviewQueueRow[], limit = REVIEW_QUEUE_LIMIT): ReviewQueue {
  const counts: Record<ReviewReason, number> = { live_unchecked: 0, live_stale: 0, draft: 0 };
  const items = rows.map((row): ReviewQueueItem => {
    const reason = reviewReason(row);
    counts[reason] += 1;
    return {
      id: row.id,
      restaurant: row.restaurant,
      title: row.title,
      emoji: row.emoji,
      city: row.city,
      reason,
      saves: Number(row.saves) || 0,
      clicks: Number(row.clicks) || 0,
      // A 'verified' deal with no verification_events row predates the events table; its
      // verified_at is still the check it stands on. An unchecked deal's verified_at is only when
      // it was imported (app/verification.ts), so it is never read as a check.
      lastCheckedAt: row.last_checked_at ?? (reason === "live_stale" ? row.verified_at : null),
      createdAt: row.created_at,
      sourceUrl: row.source_url,
      source: sourceKind(row.source_url, row.website),
      covered: Boolean(row.covered),
    };
  });
  items.sort(compareReviewItems);
  // The first `limit` of each reason, kept in the overall order, so the top of the unfiltered queue
  // is exactly the top of the whole ranking.
  const taken: Record<ReviewReason, number> = { live_unchecked: 0, live_stale: 0, draft: 0 };
  const kept = items.filter((item) => taken[item.reason]++ < limit);
  return { items: kept, counts };
}
