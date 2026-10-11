"use client";
import { useSyncExternalStore } from "react";
import { useLocale } from "next-intl";
import { dateFormatLocale, parseSqlTimestamp } from "./verification";
import { dateFormatter } from "./formatters";

// Renders a stored timestamp in the reader's own timezone.
//
// Every date on this site used to be formatted with a bare toLocaleDateString(). In a client
// component that quietly does the right thing; in a server component — which is what the deal
// page is — it formats against the Worker's clock, which is UTC. So a 7pm Toronto verification
// showed up as the next day for anyone reading it in the evening, and nobody could tell, because
// a date rendered one day off still looks like a perfectly ordinary date.
//
// A server component cannot know the reader's timezone: it is not in the request. So this renders
// twice. The server pass (and the first client pass, so hydration matches exactly) uses a stated
// zone — the deal's own location, where that is the meaningful one, falling back to the site's
// home market. Then an effect flips it to the reader's actual zone. The visible result is correct
// immediately for most readers and correct for everyone a frame later.
export type TimeStyle = "date" | "longDate" | "dateTime";

const STYLES: Record<TimeStyle, Intl.DateTimeFormatOptions> = {
  date: { month: "short", day: "numeric", year: "numeric" },
  longDate: { month: "long", day: "numeric", year: "numeric" },
  dateTime: { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" },
};

// The site's core market. Only ever used for the pre-hydration frame, never as a claim about
// where the reader is.
const HOME_TIME_ZONE = "America/Toronto";

const subscribeToNothing = () => () => {};

export default function LocalTime({ value, style = "date", sourceTimeZone }: { value: string | null | undefined; style?: TimeStyle; sourceTimeZone?: string | null }) {
  const locale = useLocale();
  // useSyncExternalStore rather than a state-in-effect flag: its server snapshot is what SSR and
  // the hydrating first client render both use, and the client snapshot takes over immediately
  // after, which is exactly the two-pass behavior needed here — with no subscription, since
  // nothing ever changes after that.
  const readerZone = useSyncExternalStore(subscribeToNothing, () => true, () => false);
  if (!value) return null;
  const date = parseSqlTimestamp(value);
  if (Number.isNaN(date.getTime())) return null;
  // Cached, because this renders once per verification event on a deal page and once per card in
  // a list, and building a DateTimeFormat costs far more than using one — enough, in aggregate,
  // to put these pages over the Worker's CPU limit. The key carries everything that varies: the
  // reader-zone pass has no timeZone in its options, so it must not share a key with the
  // stated-zone pass that does.
  const zone = readerZone ? "" : sourceTimeZone || HOME_TIME_ZONE;
  const options = readerZone ? STYLES[style] : { ...STYLES[style], timeZone: zone };
  const formatter = dateFormatter(`local|${locale}|${style}|${zone}`, dateFormatLocale(locale), options, STYLES[style]);
  return <time dateTime={date.toISOString()}>{formatter.format(date)}</time>;
}
