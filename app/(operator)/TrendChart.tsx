// Shared by the admin and creator workspaces - presentational, no workspace coupling.
// Hand-rolled inline-SVG sparkline — no charting library pulled in for three small cards. Fills
// in zero-count days between the sparse day rows the API returns (see app/api/admin/route.ts's
// `GROUP BY day` queries, which only emit rows for days that actually had activity) so a quiet
// stretch reads as a flat line at zero instead of silently compressing the timeline.
function filledSeries(rows: { day: string; count: number }[], days: number): number[] {
  const byDay = new Map(rows.map((row) => [row.day, row.count]));
  const series: number[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    series.push(byDay.get(date.toISOString().slice(0, 10)) || 0);
  }
  return series;
}

export default function TrendChart({ label, rows, days = 30 }: { label: string; rows: { day: string; count: number }[]; days?: number }) {
  const series = filledSeries(rows, days);
  const total = series.reduce((sum, value) => sum + value, 0);
  const peak = Math.max(...series);
  const max = Math.max(peak, 1);
  const lastWeek = series.slice(-7).reduce((sum, value) => sum + value, 0);
  const width = 100, height = 32;
  const points = series.map((value, index) => {
    const x = (index / (series.length - 1)) * width;
    const y = height - (value / max) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const areaPoints = [`0,${height}`, ...points, `${width},${height}`].join(" ");
  return (
    <div className="trend-card">
      <div className="trend-card-head">
        <b>{total}</b>
        <span>{label}</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        <polygon points={areaPoints} />
        <polyline points={points.join(" ")} />
      </svg>
      {/* The line's shape, in words, for anyone who cannot see it. */}
      <span className="sr-only">Busiest day: {peak}. Last 7 days: {lastWeek}.</span>
      <small>Last {days} days</small>
    </div>
  );
}
