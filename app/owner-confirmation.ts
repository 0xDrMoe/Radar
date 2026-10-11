// A restaurant manager's "still running" for one of their deals, and the reader reports they see
// about their own deals in the portal (drizzle/0069).
//
// What a confirmation is
// ----------------------
// The business saying its own offer still stands. That is a real signal - the restaurant is the
// authority on whether it still runs wing night - but it is not what "Verified" means on Radar:
// staff reading the source (app/verification.ts). So it has its own column and its own line on the
// deal page, "Confirmed by the restaurant", and it never moves verified_at, verification_status, a
// re-check reminder or the review queue. A reader can tell who vouched for what.
//
// It is only offered for a live deal, and not while the manager has an edit waiting for review:
// "still running as listed" about a listing they have just asked to change would vouch for the very
// wording they say is wrong.

import { parseSqlTimestamp } from "./verification";
import { STALE_AFTER_DAYS } from "./review-queue";
import { openReportStatusesSql } from "./accuracy-reports";

/** How long a confirmation is shown as current: the same window a staff check holds "Verified". */
export const OWNER_CONFIRMATION_DAYS = STALE_AFTER_DAYS;
/** A second press within this many minutes changes nothing and writes no new audit row. */
export const OWNER_CONFIRMATION_COOLDOWN_MINUTES = 10;

const DAY_MS = 86_400_000;

/** Whether an owner confirmation is recent enough to show; false when there is none. */
export function ownerConfirmationCurrent(confirmedAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!confirmedAt) return false;
  const at = parseSqlTimestamp(confirmedAt).getTime();
  if (Number.isNaN(at)) return false;
  return now - at <= OWNER_CONFIRMATION_DAYS * DAY_MS && at - now <= DAY_MS;
}

/** Why a manager cannot confirm this deal right now, or null when they can. */
export function ownerConfirmationBlocked(deal: { status: string; pending_change?: unknown }): string | null {
  if (deal.status !== "live") return "Only a live deal can be confirmed. Resume it first.";
  if (deal.pending_change) return "Your edit is waiting for review. Once it is approved, you can confirm the deal.";
  return null;
}

// Reader reports a manager sees: the ones still waiting on staff, as app/accuracy-reports.ts
// defines them, so the portal and the deal's "under review" state agree on what is open.
/** How many open reports the portal reads across a manager's restaurants. */
export const PORTAL_REPORTS_LIMIT = 50;

/** The categories /api/reports accepts, as a manager reads them. */
export const REPORT_CATEGORY_LABELS: Record<string, string> = {
  deal_ended: "Says the deal has ended",
  incorrect_price: "Says the price is wrong",
  incorrect_schedule: "Says the days or times are wrong",
  restaurant_closed: "Says the restaurant is closed",
  wrong_location: "Says the location is wrong",
  misleading_terms: "Says the terms are misleading",
  duplicate_listing: "Says this deal is listed twice",
};

export function reportCategoryLabel(category: string): string {
  return REPORT_CATEGORY_LABELS[category] || "Says something is wrong";
}

/**
 * Open reports on a manager's deals, newest first. Only what a business needs to act on: never the
 * reader's email, account or supporting link (the privacy policy publishes a report's content, not
 * who sent it). `?` placeholders are the manager's restaurant ids.
 */
export function portalReportsSql(restaurantCount: number): string {
  const placeholders = Array.from({ length: restaurantCount }, () => "?").join(",");
  return `SELECT r.id,r.deal_id,r.category,r.notes,r.status,r.created_at
     FROM reports r JOIN deals d ON d.id=r.deal_id
    WHERE d.restaurant_id IN (${placeholders}) AND d.deleted_at IS NULL AND r.status IN (${openReportStatusesSql})
    ORDER BY r.created_at DESC,r.id DESC
    LIMIT ${PORTAL_REPORTS_LIMIT}`;
}
