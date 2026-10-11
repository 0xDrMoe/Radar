"use client";
import { CalendarPlus } from "lucide-react";
import { useTranslations } from "next-intl";

function icsDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}
function escapeIcs(value: string): string {
  return value.replace(/\\/g,"\\\\").replace(/,/g,"\\,").replace(/;/g,"\\;").replace(/\n/g,"\\n");
}

// Scoped deliberately narrow: `deals.schedule` is free text ("Mon–Fri 3–6pm"), not a machine-
// readable recurrence rule, so this doesn't attempt to reconstruct a recurring happy-hour
// calendar entry. What it CAN do honestly is remind someone before a time-limited offer's
// expires_at passes — which is also the one piece of schedule data every deal already has
// structured, so no new parsing/DB work is needed to ship it.
export default function AddToCalendar({ title, restaurant, expiresAt, schedule, url }: { title: string; restaurant: string; expiresAt: string; schedule: string; url: string }) {
  const t = useTranslations("addToCalendar");

  function download() {
    const end = new Date(expiresAt);
    const start = new Date(end.getTime() - 60 * 60 * 1000);
    const stamp = icsDate(new Date());
    const uid = `${crypto.randomUUID()}@radar.cheap`;
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Radar//Deal Reminder//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${escapeIcs(t("summary",{title,restaurant}))}`,
      `DESCRIPTION:${escapeIcs(`${schedule}\\n${url}`)}`,
      `URL:${url}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];
    const blob = new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "radar-deal-reminder.ics";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <button type="button" className="calendar-button" onClick={download}>
      <CalendarPlus /> {t("button")}
    </button>
  );
}
