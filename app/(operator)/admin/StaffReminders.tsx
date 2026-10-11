"use client";

import { Bell, Check, Link2, Pencil } from "lucide-react";
import { GatedButton } from "./GatedButton";
import { usePagedRows } from "./workspace";
import { Pager } from "../ListScope";
import { EXPIRY_GRACE_PERIOD_DAYS } from "../../deal-lifecycle";
import { STALE_AFTER_DAYS } from "../../review-queue";
import { ownerConfirmationCurrent } from "../../owner-confirmation";
import { reminderNote, type StaffReminder } from "../../staff-reminders";

const DAY_MS = 86_400_000;

/** SQLite's naive timestamps are UTC; a bare date is that day's start in UTC. */
function timeOf(value: string | null | undefined): number {
  if (!value) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return Date.parse(`${value}T00:00:00Z`);
  return Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
}

function dayLabel(time: number): string {
  return new Date(time).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function inDays(days: number): string {
  if (days <= 0) return "today";
  return days === 1 ? "tomorrow" : `in ${days} days`;
}

/** What the reminder asks for, in a line, from the deal as it stands now. */
export function reminderReason(reminder: StaffReminder, now: number): string {
  if (reminder.kind === "expiring") {
    const ends = timeOf(reminder.expires_at);
    if (Number.isNaN(ends)) return "End date to confirm";
    if (ends > now) return `Ends ${dayLabel(ends)} (${inDays(Math.ceil((ends - now) / DAY_MS))}). Renew it or confirm it ends then.`;
    const leaves = ends + EXPIRY_GRACE_PERIOD_DAYS * DAY_MS;
    return `Ended ${dayLabel(ends)} and leaves search ${inDays(Math.ceil((leaves - now) / DAY_MS))}. Renew it if it is still running.`;
  }
  if (reminder.kind === "recheck") {
    const checked = timeOf(reminder.verified_at);
    if (Number.isNaN(checked)) return "Check it against its source";
    const age = Math.floor((now - checked) / DAY_MS);
    const left = STALE_AFTER_DAYS - age;
    return left > 0
      ? `Checked ${age} days ago. Its Verified label lapses ${inDays(left)}.`
      : `Checked ${age} days ago. Its Verified label has lapsed.`;
  }
  return "Found by the daily research. Check it against the source, then publish or archive it.";
}

/**
 * Deals to renew or confirm, opened once a day at noon Eastern (app/staff-reminders.ts). Each closes
 * on its own once the deal is renewed, re-checked, published or retired; "Done" is for the handling
 * the deal cannot show, such as confirming that an end date really is the end.
 *
 * "Renew or confirm" meant nothing to anyone who had not read that file, so the panel says what
 * each button does and what happens next, one sentence each, and only for the kinds of reminder
 * actually on the list. The clearing sweep runs hourly, which is why a renewal or a check says
 * "within the hour" and the confirm button, a direct write (resolve_staff_reminder), says "now".
 */
export default function StaffReminders({
  reminders,
  now,
  busy,
  canVerify,
  onOpen,
  onVerify,
  onResolve,
}: {
  reminders: StaffReminder[];
  now: number;
  busy: string;
  canVerify: boolean;
  onOpen: (reminder: StaffReminder) => void;
  onVerify: (dealId: string) => void;
  onResolve: (id: string) => void;
}) {
  const [paged, setPage] = usePagedRows("reminders", reminders);
  if (!reminders.length) return null;
  const blocked = canVerify ? null : "Your role does not include verifying deals.";
  const kinds = new Set(reminders.map((reminder) => reminder.kind));
  return (
    <section className="portal-card quality-actions staff-reminders" aria-labelledby="staff-reminders-title">
      <div className="portal-card-head">
        <div>
          <span className="kicker">REMINDERS</span>
          <h2 id="staff-reminders-title">Renew or confirm</h2>
          <p>
            Deals that change soon: an end date coming up, a Verified label about to lapse, or a new draft from the
            daily research. A new batch opens every day at noon Eastern. Check the deal&rsquo;s source, then pick the
            action that matches what you found.
          </p>
        </div>
        <span className="status"><Bell aria-hidden="true" /> {reminders.length} open</span>
      </div>
      <dl className="sw-reminder-help">
        {kinds.has("expiring") && (
          <>
            <dt>Renew (Edit)</dt>
            <dd>The deal is still running past its end date: open it and set the new end date. The reminder closes on its own within the hour.</dd>
            <dt>End date is right</dt>
            <dd>The deal really does end on that date: confirm it. The reminder closes now and the deal leaves search {EXPIRY_GRACE_PERIOD_DAYS} days after it ends.</dd>
          </>
        )}
        {kinds.has("recheck") && (
          <>
            <dt>Still right</dt>
            <dd>The source still shows the deal as listed: record the check. Its Verified label is renewed for {STALE_AFTER_DAYS} days and the reminder closes within the hour.</dd>
          </>
        )}
        {kinds.has("new_draft") && (
          <>
            <dt>Review / Done</dt>
            <dd>Review opens the draft to publish or archive it, which closes the reminder within the hour; Done closes it now and leaves the draft as it is.</dd>
          </>
        )}
      </dl>
      <div className="quality-list review-list">
        {paged.rows.map((reminder) => {
          const note = reminderNote(reminder.details);
          const label = `${reminder.restaurant}, ${reminder.title}`;
          return (
            <article key={reminder.id}>
              <span aria-hidden="true">{reminder.emoji}</span>
              <div>
                <b>{reminder.restaurant}</b>
                <small>{reminder.title} · {reminder.city}{reminder.kind === "new_draft" ? " · draft" : ""}</small>
                <small><span className={`status${reminder.kind === "new_draft" ? " draft" : ""}`}>{reminderReason(reminder, now)}</span></small>
                {note && <small>Research note: {note}</small>}
                {reminder.kind !== "new_draft" && ownerConfirmationCurrent(reminder.owner_confirmed_at, now) && reminder.owner_confirmed_at && (
                  <small>The restaurant confirmed it is still running on {dayLabel(timeOf(reminder.owner_confirmed_at))}. Their word, not a check.</small>
                )}
                <div className="review-actions">
                  {reminder.source_url ? (
                    <a href={reminder.source_url} target="_blank" rel="noopener noreferrer" className="review-source">
                      <Link2 /> Source
                    </a>
                  ) : (
                    <span className="review-source none">No source</span>
                  )}
                  {reminder.kind === "recheck" && (
                    <GatedButton
                      type="button"
                      blocked={blocked ?? (!reminder.source_url ? "Add a source URL before this deal can be verified." : null)}
                      disabled={busy === `verify-${reminder.deal_id}`}
                      title="You read the source and the deal matches it. Records the check and renews its Verified label."
                      onClick={() => onVerify(reminder.deal_id)}
                    >
                      <Check /> Still right<span className="sr-only">: {label}</span>
                    </GatedButton>
                  )}
                  <button type="button" onClick={() => onOpen(reminder)}>
                    <Pencil /> {reminder.kind === "new_draft" ? "Review" : reminder.kind === "expiring" ? "Renew (Edit)" : "Edit"}<span className="sr-only"> {label}</span>
                  </button>
                  {reminder.kind !== "recheck" && (
                    <GatedButton
                      type="button"
                      blocked={blocked}
                      disabled={busy === `resolve_staff_reminder-${reminder.id}`}
                      title={reminder.kind === "expiring" ? "The deal really ends then. Closes this reminder now; the deal itself is not changed." : "Closes this reminder now and leaves the draft as it is."}
                      onClick={() => onResolve(reminder.id)}
                    >
                      <Check /> {reminder.kind === "expiring" ? "End date is right" : "Done"}<span className="sr-only">: {label}</span>
                    </GatedButton>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      <Pager paged={paged} noun="reminder" onPage={setPage} />
    </section>
  );
}
