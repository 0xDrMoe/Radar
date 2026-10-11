// What an open accuracy report does to a deal while staff look into it.
//
// A reader who says a deal has ended, or that its price, hours, place or terms are wrong, is the
// freshest signal Radar gets about that deal. Before this the report sat in the admin Reports tab
// and the deal went on showing as it was, ranked as it was, until somebody got to it. Now, from the
// moment the report is filed until staff resolve or reject it, the deal is "under review":
//
//   - it reads as "Re-checking" wherever its verification is shown (effective_verification_status
//     'stale', the word every client already has), and the deal page says why;
//   - the recommended order puts it after the deals nobody has questioned that match as well, and it
//     does not take a sponsored slot.
//
// It stays listed. One report is a reason to doubt a deal, not proof it is gone, and hiding it would
// let anyone with an account remove a competitor's offer. Staff closing the report (resolved or
// rejected) ends the state; no other write is needed, because every reader below asks the reports
// table directly.
//
// The owner-confirmation work reads the same definition, so there is one answer to "is this deal
// under review".
//
// Imports nothing, so tests can load it on its own.

/** Report categories that question the deal itself. A duplicate listing does not. */
export const RECHECK_REPORT_CATEGORIES = [
  "deal_ended",
  "incorrect_price",
  "incorrect_schedule",
  "restaurant_closed",
  "wrong_location",
  "misleading_terms",
] as const;

/** Report statuses still waiting on staff. 'resolved' and 'rejected' are closed. */
export const OPEN_REPORT_STATUSES = ["open", "reviewing"] as const;

/**
 * How many open reports one account may hold at once. A report demotes a deal until staff look at
 * it, so without a ceiling one account could push a whole neighbourhood down the list at the rate
 * limit's eight a minute. Real readers report one or two deals; staff closing a report frees its
 * place.
 */
export const MAX_OPEN_REPORTS_PER_USER = 10;

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(",");

/** SQL: the open-report statuses, as an IN list. */
export const openReportStatusesSql = quoted(OPEN_REPORT_STATUSES);

/**
 * SQL: 1 when the deal `alias`.id has an open report questioning it, else 0. Uses
 * idx_reports_deal_status (drizzle/0068), so it reads the deal's own open reports and nothing else.
 */
export function underReviewSql(alias = "d"): string {
  return `EXISTS(SELECT 1 FROM reports rp WHERE rp.deal_id=${alias}.id AND rp.status IN (${openReportStatusesSql}) AND rp.category IN (${quoted(RECHECK_REPORT_CATEGORIES)}))`;
}

/** Whether a report of this category puts its deal under review while it is open. */
export function questionsDeal(category: string | null | undefined): boolean {
  return (RECHECK_REPORT_CATEGORIES as readonly string[]).includes(String(category));
}

/** Whether a report in this status is still waiting on staff. */
export function isOpenReport(status: string | null | undefined): boolean {
  return (OPEN_REPORT_STATUSES as readonly string[]).includes(String(status));
}
