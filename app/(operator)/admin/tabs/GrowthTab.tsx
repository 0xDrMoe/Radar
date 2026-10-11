"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarX,
  ExternalLink,
  Eye,
  Globe2,
  HeartHandshake,
  Mail,
  MapPin,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
} from "lucide-react";
import TrendChart from "../../TrendChart";
import { ListToolbar, Pager, selectRows } from "../../ListScope";
import { percent } from "../format";
import { EMPTY_GEO, GeoFilter, geoIsSet, geoQuery, matchesGeo, PanelHeader, StatePanel, type GeoFilterValue } from "../ui";
import { usePagedRows, useTabState, useWorkspace } from "../workspace";

// HOW PEOPLE USE RADAR, for view_analytics.
//
// The all-time headcounts (subscriptions, saved locations, digest subscribers, leaderboards) come
// with the workspace payload. Everything that takes a date range is read from GET
// /api/admin/growth when this tab opens, for 7, 30 or 90 days, in two parts: the overview, and
// search demand (which has its own filters). See that route for what each figure is and what it
// costs.
//
// The money panels that used to sit at the bottom of this tab - revenue, subscription movement,
// the affiliate program, cancellation reasons, the subscription switches, retention and comps -
// answer to manage_finance and live in ../FinancePanels.tsx for the Admin tab. Sponsorships have
// their own tab (SponsorshipsTab.tsx), for manage_sponsorships.

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

type Trend = { day: string; count: number }[];

interface GrowthOverview {
  range: Range;
  totals: {
    saves: number; saves_prev: number; views: number; views_prev: number; offers: number; offers_prev: number;
    searches: number; searches_prev: number; deals_touched: number;
  };
  trends: { saves: Trend; views: Trend; offers: Trend; searches: Trend };
  mostSaved: {
    deal_id: string; title: string; restaurant: string; city: string | null; status: string; location_scope: string | null;
    region: string | null; country: string | null; saves: number; saves_range: number; saves_prev: number;
  }[];
  deals: { deal_id: string; title: string; restaurant: string; city: string | null; status: string; location_scope: string | null; views: number; offers: number }[];
  quiet: {
    id: string; title: string; restaurant: string; city: string | null; location_scope: string | null; verification_status: string | null;
    created_at: string; region: string | null; country: string | null; last_opened: string | null;
  }[];
  visits: {
    daily: { day: string; kind: string; views: number }[];
    sources: { kind: string; label: string; views: number }[];
    countries: { kind: string; label: string; views: number }[];
  };
  leads: {
    sources: { source: string; total: number; confirmed: number; in_range: number; converted: number }[];
    daily: { day: string; source: string; count: number }[];
    areas: { area: string; count: number }[];
    pilotWaitlist: number;
  };
}

interface SearchTerm {
  term: string;
  searches: number;
  misses: number;
  last_seen: string;
  peak_day: number;
  signals: { code: string; label: string }[];
  verdict: { verdict: "confirmed_abuse" | "not_abuse"; note: string | null; updated_at: string; decided_by: string } | null;
}

interface GrowthSearch {
  range: Range;
  totals: { total: number; misses: number; distinct_terms: number };
  terms: SearchTerm[];
  markets: { market: string; searches: number }[];
}

/**
 * One lazily-read part of the growth route. Loading is derived (the answer on hand is for another
 * request) rather than set, so the effect only ever sets state after its fetch settles.
 */
function useGrowthPart<T>(url: string) {
  const [attempt, setAttempt] = useState(0);
  const key = `${url}#${attempt}`;
  const [result, setResult] = useState<{ key: string; data?: T; error?: string } | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const response = await fetch(url);
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message || "The figures could not be loaded.");
        if (live) setResult({ key, data: body as T });
      } catch (cause) {
        if (live) setResult({ key, error: cause instanceof Error ? cause.message : "The figures could not be loaded." });
      }
    })();
    return () => {
      live = false;
    };
  }, [url, key]);
  const current = result?.key === key ? result : null;
  return { data: current?.data, error: current?.error, loading: !current, retry: () => setAttempt((n) => n + 1) };
}

// A brand-wide or national offer has no single place, and a blank city is not a place: neither is
// ever presented as a city.
function placeLabel(row: { city?: string | null; location_scope?: string | null }) {
  if (row.location_scope === "brand") return "Every branch (brand-wide)";
  if (row.location_scope === "national") return "Nationwide";
  return row.city?.trim() || "No city recorded";
}

// What a non-live tag on a deal row means. Archived especially: it reads like "stored", when it
// means the deal was taken down for good - its saves and views are history from when it was live.
const STATUS_MEANING: Record<string, string> = {
  archived: "Archived: taken down for good and kept for the record. Not public.",
  expired: "Expired: its end date passed. Not public.",
  paused: "Paused: taken down for now and expected back. Not public.",
  draft: "Draft: never published.",
  scheduled: "Scheduled: published on a future date.",
};

function StatusTag({ status }: { status: string }) {
  if (status === "live") return null;
  return <span className="tag sw-growth-tag" title={STATUS_MEANING[status] || status}> {status}</span>;
}

function NotLiveNote({ rows, noun }: { rows: { status: string }[]; noun: string }) {
  const statuses = [...new Set(rows.map((row) => row.status).filter((status) => status !== "live"))];
  if (!statuses.length) return null;
  return (
    <p className="sw-growth-note">
      Tagged rows are not public right now ({statuses.map((status) => STATUS_MEANING[status]?.split(":")[0].toLowerCase() || status).join(", ")}).
      {statuses.includes("archived") && " Archived means taken down for good and kept for the record, not stored for later."}
      {" "}Their {noun} are history from when they were live: a signal of what people wanted, worth sourcing again, not a current listing.
    </p>
  );
}

function Change({ current, previous, range }: { current: number; previous: number; range: Range }) {
  if (!previous && !current) return <small className="sw-growth-change">None in either period</small>;
  if (!previous) return <small className="sw-growth-change up">New this period (none the {range} days before)</small>;
  const delta = Math.round(((current - previous) / previous) * 100);
  if (!delta) return <small className="sw-growth-change">Same as the {range} days before</small>;
  const Arrow = delta > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <small className={`sw-growth-change ${delta > 0 ? "up" : "down"}`}>
      <Arrow aria-hidden="true" /> {delta > 0 ? "+" : ""}{delta}% on the {range} days before ({previous})
    </small>
  );
}

function DealLink({ id, label }: { id: string; label: string }) {
  const { openTab } = useWorkspace();
  return (
    <button type="button" className="iconbtn" title="Open in Deal inventory" aria-label={`Open ${label} in Deal inventory`} onClick={() => openTab("deals", `?deal=${encodeURIComponent(id)}`)}>
      <ExternalLink />
    </button>
  );
}

export default function GrowthTab() {
  const { data, canViewAnalytics } = useWorkspace();
  const [range, setRange] = useTabState<Range>("growth.range", 30);
  const overview = useGrowthPart<GrowthOverview>(`/api/admin/growth?part=overview&range=${range}`);
  if (!canViewAnalytics)
    return (
      <StatePanel kind="empty" title="Growth needs the view_analytics permission">
        These figures are for staff who read analytics. Ask an owner if your job needs them.
      </StatePanel>
    );
  const growth = data.growth;
  return (
    <>
      <div className="sw-growth-range" role="group" aria-label="Date range for the figures below">
        <span>Showing the last</span>
        {RANGES.map((option) => (
          <button key={option} type="button" aria-pressed={range === option} className={range === option ? "active" : undefined} onClick={() => setRange(option)}>
            {option} days
          </button>
        ))}
      </div>

      {growth && <SubscriptionsPanel users={growth.users} />}

      <RangedSection title="Engagement" part={overview} what="engagement figures">
        {(o) => <EngagementPanel overview={o} allTime={growth ? { saves: growth.favorites.total, ...growth.engagement } : null} />}
      </RangedSection>
      <RangedSection title="Most-saved deals" part={overview} what="most-saved deals">
        {(o) => <MostSavedPanel overview={o} />}
      </RangedSection>
      <RangedSection title="Deal performance" part={overview} what="deal performance">
        {(o) => <DealPerformancePanel overview={o} />}
      </RangedSection>
      <RangedSection title="Quiet inventory" part={overview} what="quiet inventory">
        {(o) => <QuietPanel overview={o} />}
      </RangedSection>
      <RangedSection title="Visits" part={overview} what="visits">
        {(o) => <VisitsPanel overview={o} />}
      </RangedSection>
      <SearchDemand range={range} />
      <RangedSection title="Launch signals" part={overview} what="launch signals">
        {(o) => <LaunchSignalsPanel overview={o} />}
      </RangedSection>
      {growth && <LeaderboardPanel cities={growth.topCities} restaurants={growth.topRestaurants} />}
    </>
  );
}

/** The loading and error states every ranged panel shares, so all of them read the same way. */
function RangedSection({ title, part, what, children }: {
  title: string;
  part: ReturnType<typeof useGrowthPart<GrowthOverview>>;
  what: string;
  children: (overview: GrowthOverview) => React.ReactNode;
}) {
  if (part.data) return <>{children(part.data)}</>;
  return (
    <section className="portal-card">
      <PanelHeader title={title} />
      {part.error ? (
        <StatePanel kind="error" title={`The ${what} could not be loaded`} action={<button type="button" onClick={part.retry}>Try again</button>}>
          {part.error}
        </StatePanel>
      ) : (
        <StatePanel kind="loading" title={`Loading ${what}…`} />
      )}
    </section>
  );
}

function SubscriptionsPanel({ users }: { users: NonNullable<ReturnType<typeof useWorkspace>["data"]["growth"]>["users"] }) {
  return (
    <section className="portal-card">
      <PanelHeader title="Subscriptions">
        Every account, counted on the server rather than from the loaded list. <b>Paying</b> is a live paid subscription. <b>Not paying</b> is Pro with nobody paying for it, such as a comped account. Payment failed and canceled are each account&apos;s last known billing status. All-time, so the date range does not apply.
      </PanelHeader>
      <div className="quality-grid">
        {[
          ["Total users", users.total],
          ["Pro (paying)", users.pro_paying],
          ["Pro (trialing)", users.pro_trialing],
          ["Pro (not paying)", users.pro_not_paying],
          ["Payment failed", users.pro_past_due],
          ["Canceled", users.pro_canceled],
        ].map(([label, value]) => (
          <article key={String(label)}>
            <b>{value}</b>
            <span>{label}</span>
          </article>
        ))}
        <article>
          <b>{percent(users.pro_paying, users.total)}</b>
          <span>Paying for Pro</span>
        </article>
      </div>
    </section>
  );
}

function EngagementPanel({ overview, allTime }: { overview: GrowthOverview; allTime: { saves: number; saved_locations: number; digest_subscribers: number } | null }) {
  const { totals, trends, range } = overview;
  const cards: [string, Trend, number, number][] = [
    ["Deals saved", trends.saves, totals.saves, totals.saves_prev],
    ["Deal pages opened", trends.views, totals.views, totals.views_prev],
    ["Offers opened (left for the restaurant)", trends.offers, totals.offers, totals.offers_prev],
    ["Searches", trends.searches, totals.searches, totals.searches_prev],
  ];
  return (
    <section className="portal-card">
      <PanelHeader title="Engagement">
        What people did on Radar in the last {range} days, each beside the {range} days before it. An <b>offer opened</b> is someone leaving for the restaurant&apos;s own page — the closest thing recorded to intent to claim the deal.
      </PanelHeader>
      <div className="trend-charts">
        {cards.map(([label, rows, current, previous]) => (
          <div key={label} className="sw-growth-trend">
            <TrendChart label={label} rows={rows} days={range} />
            <Change current={current} previous={previous} range={range} />
          </div>
        ))}
      </div>
      {allTime && (
        <div className="quality-grid">
          <article><b>{allTime.saves}</b><span>Saved deals, all-time</span></article>
          <article><b>{allTime.saved_locations}</b><span>Active saved locations (a person can have several)</span></article>
          <article><b>{allTime.digest_subscribers}</b><span>People with a scheduled deal alert on</span></article>
          <article><b>{percent(totals.offers, totals.views)}</b><span>Click-through, last {range} days</span></article>
        </div>
      )}
    </section>
  );
}

function MostSavedPanel({ overview }: { overview: GrowthOverview }) {
  const { mostSaved, range } = overview;
  const [paged, setPage] = usePagedRows("growth.mostSaved", mostSaved, String(range));
  return (
    <section className="portal-card">
      <PanelHeader title="Most-saved deals">
        Ranked by saves in the last {range} days, then all-time. Each row says where the deal is, whether it is still public, and how its saves moved against the {range} days before. Open one to see it in Deal inventory.
      </PanelHeader>
      {!mostSaved.length ? (
        <StatePanel kind="empty" title="No saved deals yet">Deals people save from the site and app are ranked here as soon as the first one is saved.</StatePanel>
      ) : (
        <>
          <div className="audit-list">
            {paged.rows.map((row) => {
              const place = placeLabel(row);
              return (
                <article key={row.deal_id}>
                  <HeartHandshake aria-hidden="true" />
                  <div>
                    <b>{row.title}<StatusTag status={row.status} /></b>
                    <small>{row.restaurant} · {place}{row.region && place !== "No city recorded" && !row.location_scope ? `, ${row.region}` : ""}</small>
                    <small className="sw-growth-saves">
                      {row.saves_range} in the last {range} days · {row.saves_prev} the {range} days before
                      {row.saves_range > row.saves_prev ? " · rising" : row.saves_range < row.saves_prev ? " · falling" : ""}
                    </small>
                  </div>
                  <time>{row.saves} save{row.saves === 1 ? "" : "s"}</time>
                  <DealLink id={row.deal_id} label={row.title} />
                </article>
              );
            })}
          </div>
          <Pager paged={paged} noun="deal" onPage={setPage} />
          <NotLiveNote rows={paged.rows} noun="saves" />
        </>
      )}
    </section>
  );
}

function DealPerformancePanel({ overview }: { overview: GrowthOverview }) {
  const { deals, range, totals } = overview;
  const [query, setQuery] = useTabState("growth.dealQuery", "");
  const selection = selectRows(deals, (row) => `${row.title} ${row.restaurant} ${row.city || ""}`, { query, showAll: true });
  const [paged, setPage] = usePagedRows("growth.deals", selection.matched, `${range}|${query.trim()}`);
  return (
    <section className="portal-card">
      <PanelHeader title="Deal performance">
        A <b>view</b> is a deal page opened; an <b>offer</b> is someone leaving Radar for the restaurant&apos;s own page. Counted apart because together they are a click-through rate. Ranked by views in the last {range} days; search to find any deal opened in the period.
      </PanelHeader>
      <div className="quality-grid">
        <article><b>{totals.views}</b><span>Deal views</span></article>
        <article><b>{totals.offers}</b><span>Offers opened</span></article>
        <article><b>{percent(totals.offers, totals.views)}</b><span>Click-through</span></article>
        <article><b>{totals.deals_touched}</b><span>Deals opened at least once</span></article>
      </div>
      {!deals.length ? (
        <StatePanel kind="empty" title={`No deal pages opened in the last ${range} days`}>
          Opening a deal page records a view. Try a longer range, or check Visits for whether anyone reached the site.
        </StatePanel>
      ) : (
        <>
          <ListToolbar query={query} onQuery={setQuery} placeholder="Search by deal, restaurant or city…" label="Search deal performance" />
          <p className="list-count-line">
            {query.trim()
              ? `${selection.matched.length} of ${deals.length} deals opened in the period`
              : `${deals.length} deals opened in the period${deals.length >= 300 ? " (the 300 most viewed)" : ""}`}
          </p>
          {!selection.matched.length ? (
            <StatePanel kind="empty" title={`No deal matches “${query.trim()}”`}>Only deals opened in the last {range} days are listed. Clear the search or try a longer range.</StatePanel>
          ) : (
            <div className="audit-list">
              {paged.rows.map((row, index) => (
                <article key={row.deal_id}>
                  <Eye aria-hidden="true" />
                  <div>
                    <b>{query.trim() ? "" : `${paged.first + index}. `}{row.title}<StatusTag status={row.status} /></b>
                    <small>{row.restaurant} · {placeLabel(row)} · {row.offers} offer{row.offers === 1 ? "" : "s"} · {percent(row.offers, row.views)} through</small>
                  </div>
                  <time>{row.views} view{row.views === 1 ? "" : "s"}</time>
                  <DealLink id={row.deal_id} label={row.title} />
                </article>
              ))}
            </div>
          )}
          <Pager paged={paged} noun="deal" onPage={setPage} />
          <NotLiveNote rows={paged.rows} noun="views" />
        </>
      )}
    </section>
  );
}

const AGE_FILTERS = [
  { value: 0, label: "Any age" },
  { value: 30, label: "Up 30+ days" },
  { value: 90, label: "Up 90+ days" },
  { value: 180, label: "Up 180+ days" },
];

// Every quiet deal is live by definition (the server reads only public deals), so the status that
// tells them apart is the verification one: a quiet deal nobody has re-checked is the first to look at.
const VERIFICATION_LABELS: Record<string, string> = {
  verified: "Verified",
  stale: "Needs re-check",
  unverified: "Unverified",
};

function QuietPanel({ overview }: { overview: GrowthOverview }) {
  const { quiet, range } = overview;
  const { now } = useWorkspace();
  const [geo, setGeo] = useTabState<GeoFilterValue>("growth.quietGeo", EMPTY_GEO);
  const [status, setStatus] = useTabState("growth.quietStatus", "");
  const [age, setAge] = useTabState("growth.quietAge", 0);
  const places = useMemo(
    () => quiet.filter((row) => !row.location_scope).map((row) => ({ country: row.country, region: row.region, city: row.city })),
    [quiet],
  );
  const statuses = [...new Set(quiet.map((row) => row.verification_status || "unverified"))].sort();
  const rows = quiet.filter((row) => {
    if (geoIsSet(geo) && (row.location_scope || !matchesGeo({ country: row.country, region: row.region, city: row.city }, geo))) return false;
    if (status && (row.verification_status || "unverified") !== status) return false;
    if (age && now - new Date(`${row.created_at.replace(" ", "T")}Z`).getTime() < age * 86400000) return false;
    return true;
  });
  const filtered = geoIsSet(geo) || Boolean(status) || Boolean(age);
  const [paged, setPage] = usePagedRows("growth.quiet", rows, `${range}|${geoQuery(geo)}|${status}|${age}`);
  return (
    <section className="portal-card">
      <PanelHeader title="Quiet inventory">
        Live deals nobody opened in the last {range} days, oldest first. Each is catalog space earning nothing: either it is not surfacing in search, or it is not worth surfacing. One that has been up for months says more than one added yesterday.
      </PanelHeader>
      {!quiet.length ? (
        <StatePanel kind="empty" title={`Every live deal was opened in the last ${range} days`}>Nothing published is sitting unseen.</StatePanel>
      ) : (
        <>
          <GeoFilter places={places} value={geo} onChange={setGeo} label="Filter quiet deals by place" />
          <div className="sw-growth-filters">
            <label>
              <span>Status</span>
              <select value={status} onChange={(event) => setStatus(event.target.value)}>
                <option value="">Any verification</option>
                {statuses.map((value) => <option key={value} value={value}>{VERIFICATION_LABELS[value] || value}</option>)}
              </select>
            </label>
            <label>
              <span>Age</span>
              <select value={age} onChange={(event) => setAge(Number(event.target.value))}>
                {AGE_FILTERS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>
          <p className="list-count-line">
            {filtered ? `${rows.length} of ${quiet.length} quiet deals` : `${quiet.length} quiet deal${quiet.length === 1 ? "" : "s"}`}
            {quiet.length >= 300 ? " (the 300 oldest)" : ""}
          </p>
          {!rows.length ? (
            <StatePanel kind="empty" title="No quiet deals match these filters" action={<button type="button" onClick={() => { setGeo(EMPTY_GEO); setStatus(""); setAge(0); }}>Clear filters</button>}>
              Brand-wide and national offers have no single place, so a place filter leaves them out.
            </StatePanel>
          ) : (
            <div className="audit-list">
              {paged.rows.map((row) => (
                <article key={row.id}>
                  <CalendarX aria-hidden="true" />
                  <div>
                    <b>{row.title}</b>
                    <small>
                      {row.restaurant} · {placeLabel(row)}{row.region && !row.location_scope && row.city ? `, ${row.region}` : ""} · {VERIFICATION_LABELS[row.verification_status || "unverified"] || row.verification_status}
                      {row.last_opened ? ` · last opened ${row.last_opened.slice(0, 10)}` : " · never opened"}
                    </small>
                  </div>
                  <time>added {row.created_at.slice(0, 10)}</time>
                  <DealLink id={row.id} label={row.title} />
                </article>
              ))}
            </div>
          )}
          <Pager paged={paged} noun="quiet deal" onPage={setPage} />
        </>
      )}
    </section>
  );
}

const PAGE_KINDS = [
  { kind: "deal", label: "Deal pages" },
  { kind: "guide", label: "City guides" },
  { kind: "home", label: "Home page" },
  { kind: "page", label: "Static pages (about, legal, help)" },
  { kind: "other", label: "Other pages" },
];
// Content pages by default. The home page is where everybody lands, so it swamps every other line,
// and static and other pages say little about what people came for.
const DEFAULT_KINDS = ["deal", "guide"];

function VisitsPanel({ overview }: { overview: GrowthOverview }) {
  const { visits, range } = overview;
  const [kinds, setKinds] = useTabState<string[]>("growth.visitKinds", DEFAULT_KINDS);
  const included = new Set(kinds);
  const sum = (rows: { kind: string; label: string; views: number }[]) => {
    const totals = new Map<string, number>();
    for (const row of rows) if (included.has(row.kind)) totals.set(row.label, (totals.get(row.label) || 0) + row.views);
    return [...totals].map(([label, views]) => ({ label, views })).sort((a, b) => b.views - a.views);
  };
  const daily = new Map<string, number>();
  const byKind = new Map<string, number>();
  for (const row of visits.daily) {
    byKind.set(row.kind, (byKind.get(row.kind) || 0) + row.views);
    if (included.has(row.kind)) daily.set(row.day, (daily.get(row.day) || 0) + row.views);
  }
  const trend = [...daily].map(([day, count]) => ({ day, count }));
  const total = trend.reduce((acc, row) => acc + row.count, 0);
  const sources = sum(visits.sources);
  const countries = sum(visits.countries);
  const fromElsewhere = sources.filter((row) => row.label !== "direct" && row.label !== "internal").reduce((acc, row) => acc + row.views, 0);
  // Two lists side by side, so ten to a page rather than a full list's worth.
  const [sourcePage, setSourcePage] = usePagedRows("growth.sources", sources, `${range}|${kinds.join()}`, 10);
  const [countryPage, setCountryPage] = usePagedRows("growth.countries", countries, `${range}|${kinds.join()}`, 10);
  const toggle = (kind: string) => setKinds((current) => (current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind]));
  return (
    <section className="portal-card">
      <PanelHeader title="Visits">
        Public pages opened in the last {range} days, counted without a cookie and without recording who. Readers who ask not to be tracked and automated browsers are left out, so read these as a floor. The home page and other non-content pages are left out by default; tick them to include them.
      </PanelHeader>
      <fieldset className="sw-growth-kinds">
        <legend>Pages counted</legend>
        {PAGE_KINDS.map(({ kind, label }) => (
          <label key={kind}>
            <input type="checkbox" checked={included.has(kind)} onChange={() => toggle(kind)} />
            {label} <small>({byKind.get(kind) || 0})</small>
          </label>
        ))}
      </fieldset>
      {!kinds.length ? (
        <StatePanel kind="empty" title="No kind of page is ticked">Tick at least one kind of page to count its visits.</StatePanel>
      ) : !visits.daily.length ? (
        <StatePanel kind="empty" title={`No page views counted in the last ${range} days`}>Views appear as soon as somebody opens a public page.</StatePanel>
      ) : (
        <>
          <div className="quality-grid">
            <article><b>{total}</b><span>Views, pages ticked above</span></article>
            <article><b>{trend.length}</b><span>Days with any view</span></article>
            <article><b>{fromElsewhere}</b><span>Arrived from elsewhere on the web</span></article>
          </div>
          <div className="trend-charts">
            <TrendChart label="Page views" rows={trend} days={range} />
          </div>
          <div className="leaderboard-columns">
            <div>
              <h3 className="sw-growth-subhead">Where they came from</h3>
              <div className="audit-list">
                {sourcePage.rows.map((row) => (
                  <article key={`from-${row.label}`}>
                    <Search aria-hidden="true" />
                    <div><b>{row.label}</b></div>
                    <time>{row.views}&times;</time>
                  </article>
                ))}
                {!sources.length && <StatePanel kind="empty" title="No visits to these pages" />}
              </div>
              <Pager paged={sourcePage} noun="source" onPage={setSourcePage} />
            </div>
            <div>
              <h3 className="sw-growth-subhead">Country</h3>
              <div className="audit-list">
                {countryPage.rows.map((row) => (
                  <article key={`country-${row.label || "unknown"}`}>
                    <Globe2 aria-hidden="true" />
                    <div><b>{row.label || "Unknown country"}</b></div>
                    <time>{row.views}&times;</time>
                  </article>
                ))}
                {!countries.length && <StatePanel kind="empty" title="No visits to these pages" />}
              </div>
              <Pager paged={countryPage} noun="country" plural="countries" onPage={setCountryPage} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function SearchDemand({ range }: { range: Range }) {
  const [market, setMarket] = useTabState("growth.searchMarket", "");
  const [zeroOnly, setZeroOnly] = useTabState("growth.searchZeroOnly", false);
  const [hideConfirmed, setHideConfirmed] = useTabState("growth.searchHideConfirmed", true);
  const params = new URLSearchParams({ part: "search", range: String(range) });
  if (market) params.set("market", market);
  if (zeroOnly) params.set("zero", "1");
  const part = useGrowthPart<GrowthSearch>(`/api/admin/growth?${params}`);
  const search = part.data;
  const terms = (search?.terms || []).filter((row) => !(hideConfirmed && row.verdict?.verdict === "confirmed_abuse"));
  const hidden = (search?.terms.length || 0) - terms.length;
  const flagged = (search?.terms || []).filter((row) => row.signals.length && !row.verdict).length;
  const [paged, setPage] = usePagedRows("growth.searchTerms", terms, `${range}|${market}|${zeroOnly}|${hideConfirmed}`);
  return (
    <section className="portal-card">
      <PanelHeader title="Search demand">
        What people typed into the search box in the last {range} days, and whether Radar could answer. <b>Unanswered searches are the sourcing list</b>: each is somebody asking for food the catalog does not carry yet. Terms that look like probing or spam are marked <i>Possible abuse — not confirmed</i> until someone reviews them.
      </PanelHeader>
      <div className="sw-growth-filters">
        <label>
          <span>Market</span>
          <select value={market} onChange={(event) => setMarket(event.target.value)}>
            <option value="">All markets</option>
            {market && !(search?.markets || []).some((row) => row.market === market) && <option value={market}>{market}</option>}
            {(search?.markets || []).map((row) => <option key={row.market} value={row.market}>{row.market} ({row.searches})</option>)}
          </select>
        </label>
        <label className="sw-growth-check">
          <input type="checkbox" checked={zeroOnly} onChange={(event) => setZeroOnly(event.target.checked)} />
          Zero-result terms only
        </label>
        <label className="sw-growth-check">
          <input type="checkbox" checked={hideConfirmed} onChange={(event) => setHideConfirmed(event.target.checked)} />
          Hide confirmed abuse
        </label>
      </div>
      {part.error ? (
        <StatePanel kind="error" title="Search demand could not be loaded" action={<button type="button" onClick={part.retry}>Try again</button>}>{part.error}</StatePanel>
      ) : !search ? (
        <StatePanel kind="loading" title="Loading search demand…" />
      ) : (
        <>
          <div className="quality-grid">
            <article><b>{search.totals.total}</b><span>Searches</span></article>
            <article><b>{search.totals.distinct_terms}</b><span>Distinct terms</span></article>
            <article><b>{search.totals.misses}</b><span>Came back empty</span></article>
            <article><b>{percent(search.totals.misses, search.totals.total)}</b><span>Miss rate</span></article>
            <article><b>{flagged}</b><span>Possible abuse, not yet reviewed</span></article>
          </div>
          {!terms.length ? (
            <StatePanel kind="empty" title={zeroOnly ? "No unanswered searches" : "No searches recorded"}>
              {hidden
                ? `${hidden} term${hidden === 1 ? " is" : "s are"} hidden as confirmed abuse.`
                : zeroOnly
                  ? `Every search${market ? ` in ${market}` : ""} in the last ${range} days matched at least one deal.`
                  : `Nobody searched${market ? ` in ${market}` : ""} in the last ${range} days. Try a longer range or all markets.`}
            </StatePanel>
          ) : (
            <>
              <p className="list-count-line">
                {terms.length} term{terms.length === 1 ? "" : "s"}, {zeroOnly ? "most-missed" : "most-searched"} first{search.terms.length >= 100 ? " (the top 100)" : ""}
                {hidden ? ` · ${hidden} confirmed abuse hidden` : ""}
              </p>
              <div className="audit-list">
                {paged.rows.map((row) => <SearchTermRow key={row.term} row={row} onSaved={part.retry} />)}
              </div>
              <Pager paged={paged} noun="term" onPage={setPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function SearchTermRow({ row, onSaved }: { row: SearchTerm; onSaved: () => void }) {
  const { setNotice } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [verdict, setVerdict] = useState<"" | "confirmed_abuse" | "not_abuse">(row.verdict?.verdict || "");
  const [note, setNote] = useState(row.verdict?.note || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const suspected = row.signals.length > 0;
  async function save() {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/admin/growth", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "search_verdict", term: row.term, verdict, note }),
      });
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message || "The verdict could not be saved.");
      setOpen(false);
      setNotice(`Verdict recorded for “${row.term}”.`);
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The verdict could not be saved.");
    } finally {
      setSaving(false);
    }
  }
  // Only a recorded verdict may say "Confirmed abuse". A pattern match is a suspicion and is
  // labeled as one; a "not abuse" verdict clears the label without hiding the term.
  const badge = row.verdict?.verdict === "confirmed_abuse"
    ? <span className="sw-growth-badge confirmed"><ShieldAlert aria-hidden="true" /> Confirmed abuse</span>
    : row.verdict?.verdict === "not_abuse"
      ? <span className="sw-growth-badge cleared"><ShieldCheck aria-hidden="true" /> Reviewed: not abuse</span>
      : suspected
        ? <span className="sw-growth-badge suspected"><ShieldAlert aria-hidden="true" /> Possible abuse — not confirmed</span>
        : null;
  return (
    <article className="sw-growth-term">
      <Search aria-hidden="true" />
      <div>
        <b className="sw-growth-term-text">{row.term}</b>
        <small>
          {row.misses ? `${row.misses} of ${row.searches} found nothing (${percent(row.misses, row.searches)})` : "always matched"} · last asked {row.last_seen.slice(0, 10)}
        </small>
        {badge}
        {suspected && !row.verdict && <small className="sw-growth-signals">{row.signals.map((signal) => signal.label).join(" · ")}</small>}
        {row.verdict && <small className="sw-growth-signals">{row.verdict.decided_by}, {row.verdict.updated_at.slice(0, 10)}{row.verdict.note ? `: ${row.verdict.note}` : ""}</small>}
        {open && (
          <div className="sw-growth-verdict">
            <fieldset>
              <legend>Your verdict on “{row.term}”</legend>
              <label><input type="radio" name={`verdict-${row.term}`} checked={verdict === "confirmed_abuse"} onChange={() => setVerdict("confirmed_abuse")} /> Confirmed abuse</label>
              <label><input type="radio" name={`verdict-${row.term}`} checked={verdict === "not_abuse"} onChange={() => setVerdict("not_abuse")} /> Not abuse</label>
            </fieldset>
            <label>Note (optional, kept in the audit log)
              <input value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="What you checked" />
            </label>
            {error && <StatePanel kind="error" title="Not saved">{error}</StatePanel>}
            <div className="editor-actions">
              <button type="button" className="primary" disabled={!verdict || saving} onClick={save}>{saving ? "Saving…" : "Record verdict"}</button>
              <button type="button" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      <time>{row.searches}&times;</time>
      {(suspected || row.verdict) && !open && (
        <button type="button" className="tool-button" onClick={() => setOpen(true)}>{row.verdict ? "Change verdict" : "Review"}</button>
      )}
    </article>
  );
}

// LEAD CAPTURE, AND WHY IT IS NOW "LAUNCH SIGNALS".
// email_leads is not a second mailing list beside the Mailing list tab; it is the only list that
// needs no account. It is written by one endpoint, app/api/email/capture, from two forms on the home
// page, and each form is a different promise (see that file and app/api/jobs/launch-email):
//   homepage     "keep me posted": a visitor with no account asks to hear about deals near the
//                postal code they were looking at.
//   ios-waitlist "tell me when the app is out": mailed once, on launch day, by the launch job.
// Both are double opt-in (confirmed_at, drizzle/0064). The Mailing list tab is the other side:
// signed-in accounts' alert consents and the deal-alert *pilot* waitlist (email_consents), which
// staff act on one person at a time. The old "Lead capture" panel showed one combined total with
// a conversion rate, which mixed the two promises and looked like a duplicate of that tab. Here
// they are counted apart, with where homepage leads are asking from and how many accounts wait for
// the pilot, as signals of launch demand. No addresses: the people are the Mailing list tab's.
const LEAD_SOURCE_LABELS: Record<string, { label: string; meaning: string }> = {
  "ios-waitlist": { label: "App waitlist", meaning: "Asked to be told when the iPhone app ships. Mailed once, on launch day." },
  homepage: { label: "Deal news (no account)", meaning: "Asked to hear about deals near a postal code without signing up." },
};

function LaunchSignalsPanel({ overview }: { overview: GrowthOverview }) {
  const { openTab, canManageEmail } = useWorkspace();
  const { leads, range } = overview;
  const trend = Object.values(
    leads.daily.reduce<Record<string, { day: string; count: number }>>((byDay, row) => {
      (byDay[row.day] ||= { day: row.day, count: 0 }).count += row.count;
      return byDay;
    }, {}),
  );
  const empty = !leads.sources.length && !leads.pilotWaitlist;
  const [areaPage, setAreaPage] = usePagedRows("growth.leadAreas", leads.areas, String(range));
  return (
    <section className="portal-card">
      <PanelHeader
        title="Launch signals"
        actions={canManageEmail ? <button type="button" className="tool-button" onClick={() => openTab("mail")}><Mail aria-hidden="true" /> Mailing list</button> : undefined}
      >
        Who is asking to hear from Radar before they have an account, counted by what they asked for. These are the home page&apos;s email forms; the people themselves, and the deal-alert pilot waitlist, are managed on the Mailing list tab. <b>Confirmed</b> means they followed the link in the confirmation email; nothing is sent to anyone before that.
      </PanelHeader>
      {empty ? (
        <StatePanel kind="empty" title="Nobody has signed up through the home page forms yet">
          The app waitlist and the &ldquo;keep me posted&rdquo; form on the home page both land here once someone uses them.
        </StatePanel>
      ) : (
        <>
          <div className="quality-grid">
            {leads.sources.map((row) => {
              const meta = LEAD_SOURCE_LABELS[row.source] || { label: row.source, meaning: "A form source this page does not know." };
              return (
                <article key={row.source} title={meta.meaning}>
                  <b>{row.total}</b>
                  <span>{meta.label}: {row.confirmed} confirmed · {row.in_range} in the last {range} days · {row.converted} now have an account</span>
                </article>
              );
            })}
            <article title="Signed-in accounts waiting for a place in the deal-alert pilot. Accepted one at a time from the Mailing list tab.">
              <b>{leads.pilotWaitlist}</b>
              <span>Accounts waiting for the deal-alert pilot</span>
            </article>
          </div>
          <div className="trend-charts">
            <TrendChart label="Sign-ups through the forms" rows={trend} days={range} />
          </div>
          {leads.sources.map((row) => LEAD_SOURCE_LABELS[row.source] && (
            <p key={`meaning-${row.source}`} className="sw-growth-note"><b>{LEAD_SOURCE_LABELS[row.source].label}:</b> {LEAD_SOURCE_LABELS[row.source].meaning}</p>
          ))}
          <h3 className="sw-growth-subhead">Where &ldquo;deal news&rdquo; sign-ups are asking from</h3>
          {!leads.areas.length ? (
            <StatePanel kind="empty" title="No postal codes left yet">The home page sends the area it is showing; a sign-up without one is not placed.</StatePanel>
          ) : (
            <>
              <div className="audit-list">
                {areaPage.rows.map((row) => (
                  <article key={row.area}>
                    <MapPin aria-hidden="true" />
                    <div>
                      <b>{row.area}</b>
                      <small>First three characters of the postal or ZIP code</small>
                    </div>
                    <time>{row.count}</time>
                  </article>
                ))}
              </div>
              <Pager paged={areaPage} noun="area" onPage={setAreaPage} />
            </>
          )}
        </>
      )}
    </section>
  );
}

function LeaderboardPanel({ cities, restaurants }: {
  cities: { city: string; region: string | null; country: string | null; count: number }[];
  restaurants: { restaurant: string; count: number }[];
}) {
  const { openTab, setInventoryQuery } = useWorkspace();
  // Two lists side by side, so ten to a page rather than a full list's worth.
  const [cityPage, setCityPage] = usePagedRows("growth.topCities", cities, "", 10);
  const [restaurantPage, setRestaurantPage] = usePagedRows("growth.topRestaurants", restaurants, "", 10);
  return (
    <section className="portal-card">
      <PanelHeader title="Top cities & restaurants">
        By live deal count, all-time. Open a city or a restaurant to see its deals in Deal inventory. Brand-wide and national offers, and deals with no city recorded, are counted together and never as a city.
      </PanelHeader>
      <div className="leaderboard-columns">
        <div>
          <div className="audit-list">
            {cityPage.rows.map((row) => {
              const placed = Boolean(row.city);
              return (
                <article key={`${row.city}|${row.region}|${row.country}`}>
                  <MapPin aria-hidden="true" />
                  <div>
                    {placed ? (
                      <button type="button" className="sw-link" onClick={() => openTab("deals", geoQuery({ city: row.city, region: row.region || "", country: row.country || "" }))}>
                        {row.city}{row.region ? `, ${row.region}` : ""}
                      </button>
                    ) : (
                      <b>No city recorded</b>
                    )}
                    {!placed && <small>Brand-wide or national offers, or deals missing a city</small>}
                  </div>
                  <time>{row.count} live</time>
                </article>
              );
            })}
            {!cities.length && <StatePanel kind="empty" title="No live deals yet">Cities appear here once a deal is published.</StatePanel>}
          </div>
          <Pager paged={cityPage} noun="city" plural="cities" onPage={setCityPage} />
        </div>
        <div>
          <div className="audit-list">
            {restaurantPage.rows.map((row) => (
              <article key={row.restaurant}>
                <Store aria-hidden="true" />
                <div>
                  <button type="button" className="sw-link" onClick={() => { setInventoryQuery(row.restaurant); openTab("deals"); }}>{row.restaurant}</button>
                </div>
                <time>{row.count} live</time>
              </article>
            ))}
            {!restaurants.length && <StatePanel kind="empty" title="No live deals yet">Restaurants appear here once a deal is published.</StatePanel>}
          </div>
          <Pager paged={restaurantPage} noun="restaurant" onPage={setRestaurantPage} />
        </div>
      </div>
    </section>
  );
}
