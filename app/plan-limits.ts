// What the Free plan and Radar Pro each allow on a signed-in account, in one place.
//
// These numbers were literals in four files: the dashboard's copy, /api/user (the tracked-area cap,
// the alert schedule and the history window), the history export and the digest job. The job never
// read them at all, so an account that left Pro kept its daily roundup, its chosen hour and its
// 100 km reach for as long as it never re-saved the form. Every server that hands out one of these
// now asks this file, and the dashboard's plan table is drawn from it, so what the page promises and
// what the server enforces are the same numbers.
//
// Import-free (the radius ceiling is maxRadiusKm in app/radius.ts), so client components, Worker routes and the test runner can all load it.
//
// Pro monetizes extra utility (more areas, more reach, more schedule control, longer history), never
// basic discovery: nothing here limits searching, browsing, saving deals or hiding restaurants.

/** Tracked areas a Free account may hold. Pro has no cap. */
export const FREE_AREA_LIMIT = 1;

/** Alert roundups a Free account may schedule in a week. */
export const FREE_ALERT_DAYS = 1;

/** The hour a Free account's roundup goes out. Pro picks its own. */
export const FREE_ALERT_TIME = "08:00";

/** Alert deliveries kept on the dashboard. Pro also gets them as a CSV. */
export const HISTORY_ROWS = { free: 20, pro: 500 } as const;

export function historyRows(pro: boolean): number {
  return pro ? HISTORY_ROWS.pro : HISTORY_ROWS.free;
}

/**
 * The schedule a roundup is actually sent on. A Free account keeps the first day it chose and the
 * Free hour, whatever it saved while it was on Pro: a lapsed plan is a Free plan.
 */
export function alertSchedule(pro: boolean, days: number[], time: string | null | undefined): { days: number[]; time: string } {
  if (pro) return { days, time: time || FREE_ALERT_TIME };
  return { days: days.slice(0, FREE_ALERT_DAYS), time: FREE_ALERT_TIME };
}
