"use client";
import { useState } from "react";

// The overview's 30-day charts. The shared sparkline in app/(operator)/TrendChart.tsx is a line with
// no axis, no dates and one total, which is fine as a decoration in the creator and affiliate
// portals but left staff guessing what a bump meant or when it happened. This one draws a bar per
// day against a labelled scale, names the dates at both ends, compares the last week with the one
// before, and says the value of whichever day is pointed at. Single series, so one colour and no
// legend: the heading names it.

const DAY_MS = 86_400_000;

/**
 * The last `days` calendar days, oldest first, with the count for each. The server groups by
 * SQLite's date(created_at), which is a UTC day, and only returns days that had activity, so the
 * calendar is built in UTC too and the quiet days are filled with zero rather than squeezed out.
 */
export function dailySeries(rows: readonly { day: string; count: number }[], days: number, now: number) {
  const byDay = new Map(rows.map((row) => [row.day, Number(row.count) || 0]));
  const series: { day: string; count: number }[] = [];
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(now - back * DAY_MS).toISOString().slice(0, 10);
    series.push({ day, count: byDay.get(day) || 0 });
  }
  return series;
}

const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function DailyActivityChart({
  title,
  description,
  rows,
  now,
  days = 30,
  unit,
}: {
  title: string;
  /** What is being counted, in one line, so nobody has to guess what an "event" is. */
  description: string;
  rows: readonly { day: string; count: number }[];
  now: number;
  days?: number;
  /** Singular and plural nouns for the count, e.g. ["signup", "signups"]. */
  unit: [string, string];
}) {
  const [pointed, setPointed] = useState<number | null>(null);
  const series = dailySeries(rows, days, now);
  const total = series.reduce((sum, point) => sum + point.count, 0);
  const peak = Math.max(0, ...series.map((point) => point.count));
  const lastWeek = series.slice(-7).reduce((sum, point) => sum + point.count, 0);
  const weekBefore = series.slice(-14, -7).reduce((sum, point) => sum + point.count, 0);
  const noun = (count: number) => (count === 1 ? unit[0] : unit[1]);
  const change = lastWeek - weekBefore;
  const width = 300, height = 72, slot = width / series.length, gap = 2;
  const focus = pointed === null ? null : series[pointed];
  return (
    <figure className="sw-ov-chart">
      <figcaption>
        <h3>{title}</h3>
        <p>{description}</p>
      </figcaption>
      <div className="sw-ov-chart-figures">
        <b>{total.toLocaleString()}</b>
        <span>{noun(total)} in {days} days</span>
        <span className="sw-ov-chart-week">
          {lastWeek.toLocaleString()} in the last 7 days
          {" "}({change === 0 ? "same as" : change > 0 ? `${change.toLocaleString()} more than` : `${Math.abs(change).toLocaleString()} fewer than`} the week before)
        </span>
      </div>
      {total === 0 ? (
        // A genuine zero for someone allowed to read it: say so in words instead of drawing a flat line.
        <p className="sw-ov-chart-none">No {unit[1]} in the last {days} days.</p>
      ) : (
        <>
          <div className="sw-ov-chart-plot">
            <span className="sw-ov-chart-scale" aria-hidden="true">
              <span>{peak}</span>
              <span>0</span>
            </span>
            <svg
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              onMouseLeave={() => setPointed(null)}
            >
              <line x1="0" x2={width} y1={height - 0.5} y2={height - 0.5} className="sw-ov-chart-base" />
              {series.map((point, index) => {
                const barHeight = peak ? Math.max(point.count ? 2 : 0, (point.count / peak) * (height - 4)) : 0;
                return (
                  <g key={point.day} onMouseEnter={() => setPointed(index)}>
                    {/* The hit area is the whole column, not just the bar, so a one-count day is easy to point at. */}
                    <rect x={index * slot} y="0" width={slot} height={height} className="sw-ov-chart-hit" />
                    <rect
                      x={index * slot + gap / 2}
                      y={height - barHeight}
                      width={Math.max(1, slot - gap)}
                      height={barHeight}
                      className={pointed === index ? "sw-ov-chart-bar active" : "sw-ov-chart-bar"}
                    />
                  </g>
                );
              })}
            </svg>
          </div>
          <div className="sw-ov-chart-axis" aria-hidden="true">
            <span>{dayLabel(series[0].day)}</span>
            <span className="sw-ov-chart-readout">
              {focus ? `${dayLabel(focus.day)}: ${focus.count.toLocaleString()} ${noun(focus.count)}` : "Point at a day to see its count"}
            </span>
            <span>{dayLabel(series[series.length - 1].day)}</span>
          </div>
          {/* The same figures as a list for screen readers: only the days that had any. */}
          <ul className="sr-only">
            {series.filter((point) => point.count).map((point) => (
              <li key={point.day}>{dayLabel(point.day)}: {point.count} {noun(point.count)}</li>
            ))}
          </ul>
        </>
      )}
    </figure>
  );
}
