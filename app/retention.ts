// Personal data Radar keeps only for as long as it has a use, swept once a day by the Worker cron.
//
// Quebec's Law 25 (s.23) and PIPEDA (Principle 4.5) both say the same thing: once the purpose a
// piece of personal information was collected for is achieved, it is destroyed or anonymised. The
// tables below are the ones where that moment is a date rather than an event someone triggers, so
// without a sweep they would simply grow, holding email addresses nobody has a reason to keep.
//
// Each rule is a single DELETE with no external call, like the rate-limit sweep beside it in
// worker/index.ts, so it cannot half-fail. Import-free, so the Worker entry pulls in nothing else.
// The periods are Radar's published retention schedule (the Privacy Policy states them); change
// them together.

/** A waitlist address that was sent its confirmation link and never confirmed, after this many days. */
export const UNCONFIRMED_LEAD_DAYS = 30;
/**
 * Raw delivery events from the email provider (opens, bounces, complaints), after this many days.
 * The payload carries the recipient address. Suppressions are kept separately in email_suppressions
 * and are not touched, so a bounce or complaint still stops future sends after its event is gone.
 */
export const EMAIL_EVENT_DAYS = 400;
/** A push token the platform reported as dead, after this many days. Active tokens are untouched. */
export const REVOKED_DEVICE_TOKEN_DAYS = 30;

/** The UTC hour of the one hourly cron tick a day that runs the sweep (about 3 a.m. in Toronto). */
export const RETENTION_HOUR_UTC = 7;

export const RETENTION_RULES = [
  {
    key: "unconfirmed_email_leads",
    // Only leads that were actually sent a link: while the pilot gate is closed a lead has had no
    // chance to confirm yet, and deleting it would drop someone who did ask to hear from Radar.
    sql: `DELETE FROM email_leads WHERE confirmed_at IS NULL AND confirmation_sent_at IS NOT NULL AND datetime(confirmation_sent_at) < datetime('now','-${UNCONFIRMED_LEAD_DAYS} days')`,
  },
  {
    key: "email_events",
    sql: `DELETE FROM email_events WHERE datetime(created_at) < datetime('now','-${EMAIL_EVENT_DAYS} days')`,
  },
  {
    key: "revoked_device_tokens",
    sql: `DELETE FROM device_tokens WHERE status<>'active' AND datetime(last_seen_at) < datetime('now','-${REVOKED_DEVICE_TOKEN_DAYS} days')`,
  },
] as const;

export function isRetentionHour(at: Date): boolean {
  return at.getUTCHours() === RETENTION_HOUR_UTC;
}

type RetentionDatabase = {
  prepare(sql: string): { run(): Promise<{ meta?: { changes?: number } }> };
};

/** Runs every rule; returns how many rows each removed, keyed by rule. */
export async function sweepRetention(db: RetentionDatabase): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  for (const rule of RETENTION_RULES) {
    removed[rule.key] = (await db.prepare(rule.sql).run()).meta?.changes || 0;
  }
  return removed;
}
