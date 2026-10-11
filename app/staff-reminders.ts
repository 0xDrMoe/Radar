// Reminders in the staff workspace to renew or confirm a deal (drizzle/0066).
//
// Why this exists
// ---------------
// The review queue ranks everything that could use a look; it never says "this one changes this
// week". A live deal whose end date passes simply drops out of search two days later
// (expireDealsStatement), and a verified deal's "Verified" label quietly turns into "Re-checking"
// at 30 days. Both are moments somebody could have acted on, and a reminder is how they hear about
// them in time: renew the deal or confirm it really ends, re-check it before the label lapses, and
// read the drafts the daily web research found.
//
// When it runs
// ------------
// The Worker's cron fires hourly (wrangler.jsonc). Reminders are opened on the noon tick in New
// York, so staff get one batch a day at a predictable time, whatever the season: the hour is read
// in America/New_York rather than fixed in UTC, which would drift by an hour at each DST change.
// Clearing runs every hour, so a reminder disappears soon after the deal it is about is renewed,
// re-verified, published or retired, without anyone closing it by hand.
//
// It never changes a deal. It only says which ones a person should look at.

import { STALE_AFTER_DAYS } from "./review-queue";

export type StaffReminderKind = "expiring" | "recheck" | "new_draft";
export type StaffReminderStatus = "open" | "done" | "cleared";

export const REMINDER_TIME_ZONE = "America/New_York";
export const REMINDER_HOUR = 12;
/** A live deal ending within this many days gets a reminder to renew or confirm it. */
export const EXPIRING_WITHIN_DAYS = 7;
/** How long before a verified deal's check goes stale it gets a reminder to re-check it. */
export const RECHECK_LEAD_DAYS = 3;
/** The basis of every reminder the research migrations write; one per draft. */
export const RESEARCH_BASIS = "research";

const NEW_ID = "'rem-'||lower(hex(randomblob(8)))";

/** Whether `at` is the noon hour in New York, the one tick a day that opens reminders. */
export function isReminderHour(at: Date): boolean {
  const hour = new Intl.DateTimeFormat("en-US", { timeZone: REMINDER_TIME_ZONE, hour: "numeric", hourCycle: "h23" }).format(at);
  return Number(hour) === REMINDER_HOUR;
}

/**
 * A live deal with an end date in the next week, or already past it and still inside the two-day
 * grace before the expiry job retires it. The basis is the end date itself, so changing it (a
 * renewal) clears this reminder, and a reminder marked done is not opened again for the same date.
 */
export const OPEN_EXPIRING_REMINDERS_SQL = `INSERT INTO staff_reminders(id,kind,deal_id,basis,details)
  SELECT ${NEW_ID},'expiring',d.id,d.expires_at,json_object('expires_at',d.expires_at)
    FROM deals d
   WHERE d.status='live' AND d.deleted_at IS NULL AND d.expires_at IS NOT NULL AND d.expires_at<>''
     AND datetime(d.expires_at)<=datetime('now','+${EXPIRING_WITHIN_DAYS} days')
  ON CONFLICT(kind,deal_id,basis) DO NOTHING`;

/**
 * A live deal verified between (30 - lead) and 30 days ago: about to lose its "Verified" label.
 * Only deals inside that window, not every deal already past it: those are the review queue's
 * "check overdue" backlog, ranked there by how many people use them, and opening a reminder for each
 * at once would bury the ones that are still on time. The basis is verified_at, so the next check
 * clears it.
 */
export const OPEN_RECHECK_REMINDERS_SQL = `INSERT INTO staff_reminders(id,kind,deal_id,basis,details)
  SELECT ${NEW_ID},'recheck',d.id,d.verified_at,json_object('verified_at',d.verified_at)
    FROM deals d
   WHERE d.status='live' AND d.deleted_at IS NULL AND d.verification_status='verified' AND d.verified_at IS NOT NULL
     AND julianday('now')-julianday(d.verified_at)>=${STALE_AFTER_DAYS - RECHECK_LEAD_DAYS}
     AND julianday('now')-julianday(d.verified_at)<=${STALE_AFTER_DAYS}
  ON CONFLICT(kind,deal_id,basis) DO NOTHING`;

/**
 * Closes every open reminder whose deal no longer is what the reminder was about: its end date or
 * check changed, it left draft or live, or it was deleted. `resolution` records what happened, so
 * the history says whether a deal was renewed or simply ran out.
 */
export const CLEAR_STAFF_REMINDERS_SQL = `UPDATE staff_reminders
     SET status='cleared',resolved_by='system:cron',resolved_at=CURRENT_TIMESTAMP,
         resolution=COALESCE((SELECT CASE
             WHEN d.deleted_at IS NOT NULL THEN 'deleted'
             WHEN staff_reminders.kind='expiring' AND d.status='live' THEN 'renewed'
             WHEN staff_reminders.kind='recheck' AND d.status='live' THEN 'rechecked'
             WHEN d.status='live' THEN 'published'
             ELSE d.status END
           FROM deals d WHERE d.id=staff_reminders.deal_id),'deleted')
   WHERE status='open' AND NOT EXISTS (
     SELECT 1 FROM deals d WHERE d.id=staff_reminders.deal_id AND d.deleted_at IS NULL AND (
          (staff_reminders.kind='expiring' AND d.status='live' AND d.expires_at IS staff_reminders.basis)
       OR (staff_reminders.kind='recheck' AND d.status='live' AND d.verified_at IS staff_reminders.basis)
       OR (staff_reminders.kind='new_draft' AND d.status='draft')))`;

/** Open reminders for the workspace, most urgent first: endings by date, then checks, then drafts. */
export const OPEN_STAFF_REMINDERS_SQL = `SELECT s.id,s.kind,s.deal_id,s.basis,s.details,s.created_at,
         d.restaurant,d.title,d.emoji,d.city,d.status deal_status,d.expires_at,d.verified_at,d.source_url,d.owner_confirmed_at
    FROM staff_reminders s JOIN deals d ON d.id=s.deal_id AND d.deleted_at IS NULL
   WHERE s.status='open'
   ORDER BY CASE s.kind WHEN 'expiring' THEN 0 WHEN 'recheck' THEN 1 ELSE 2 END,
            CASE s.kind WHEN 'expiring' THEN datetime(d.expires_at) WHEN 'recheck' THEN datetime(d.verified_at) ELSE s.created_at END,
            s.id
   LIMIT 200`;

export interface StaffReminder {
  id: string;
  kind: StaffReminderKind;
  deal_id: string;
  basis: string;
  details: string;
  created_at: string;
  restaurant: string;
  title: string;
  emoji: string;
  city: string;
  deal_status: string;
  expires_at: string | null;
  verified_at: string | null;
  source_url: string | null;
  /** The restaurant's own "still running" from the portal (drizzle/0069): context, not a check. */
  owner_confirmed_at: string | null;
}

/** The research note a new_draft reminder carries, if it is readable. */
export function reminderNote(details: string | null | undefined): string | null {
  try {
    const parsed = JSON.parse(details || "{}") as { note?: unknown };
    return typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : null;
  } catch {
    return null;
  }
}

interface ReminderDatabase {
  prepare(sql: string): { run(): Promise<{ meta?: { changes?: number } }> };
}

/**
 * The cron's step: clear what has moved on, and on the noon tick open today's reminders. Returns
 * how many of each happened, for the audit row. Throws if a statement fails; the caller records it.
 */
export async function sweepStaffReminders(db: ReminderDatabase, at: Date): Promise<{ cleared: number; opened: number }> {
  const cleared = (await db.prepare(CLEAR_STAFF_REMINDERS_SQL).run()).meta?.changes || 0;
  if (!isReminderHour(at)) return { cleared, opened: 0 };
  let opened = 0;
  for (const sql of [OPEN_EXPIRING_REMINDERS_SQL, OPEN_RECHECK_REMINDERS_SQL]) {
    opened += (await db.prepare(sql).run()).meta?.changes || 0;
  }
  return { cleared, opened };
}
