"use client";
import { useMemo, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Inbox, Loader2 } from "lucide-react";
import { parseSqlTimestamp } from "../../verification";

// The pieces every section of the staff workspace shares, so a list that is loading, empty or
// broken reads the same wherever it is, and every section filters by place the same way.
//
// Styles live in the "Shell" block of app/staff-workspace.css.

/** One state for a panel: loading, empty, failed, or a finished step worth saying out loud. */
export function StatePanel({
  kind,
  title,
  children,
  action,
}: {
  kind: "loading" | "empty" | "error" | "success";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const Icon = kind === "loading" ? Loader2 : kind === "error" ? AlertTriangle : kind === "success" ? CheckCircle2 : Inbox;
  return (
    <div className={`sw-state sw-state-${kind}`} role={kind === "error" ? "alert" : "status"} aria-live="polite">
      <Icon size={18} aria-hidden="true" className={kind === "loading" ? "sw-spin" : undefined} />
      <div>
        <b>{title}</b>
        {children && <p>{children}</p>}
      </div>
      {action}
    </div>
  );
}

// ── Times ────────────────────────────────────────────────────────────────────────────────────

// Built once, on first use, and in the browser: a list renders one of these per row, building an
// Intl.DateTimeFormat costs far more than using one, and the server's zone is not the reader's.
const STAFF_TIME_OPTIONS = {
  dateTime: { dateStyle: "medium", timeStyle: "short" },
  long: { dateStyle: "full", timeStyle: "short" },
  time: { hour: "numeric", minute: "2-digit" },
  date: { dateStyle: "medium" },
  // What the hover shows: the same moment to the second, with its time zone.
  exact: { dateStyle: "full", timeStyle: "long" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;
const staffTimeFormats = new Map<string, Intl.DateTimeFormat>();
function staffTimeFormat(key: keyof typeof STAFF_TIME_OPTIONS) {
  let format = staffTimeFormats.get(key);
  if (!format) staffTimeFormats.set(key, (format = new Intl.DateTimeFormat(undefined, STAFF_TIME_OPTIONS[key])));
  return format;
}

export type StaffTimeStyle = Exclude<keyof typeof STAFF_TIME_OPTIONS, "exact">;

/**
 * A stored time in the reader's own zone, to the minute. Seconds are noise when somebody is reading
 * down a list, and they are still there to the second, with the zone, when the time is hovered.
 * Takes D1's zoneless UTC ("2026-10-09 20:40:11"), an ISO string, or a Date.
 */
export function StaffTime({ value, format = "dateTime", fallback = null }: { value: string | Date | null | undefined; format?: StaffTimeStyle; fallback?: ReactNode }) {
  if (!value) return <>{fallback}</>;
  const at = value instanceof Date ? value : parseSqlTimestamp(value);
  if (Number.isNaN(at.getTime())) return <>{fallback}</>;
  return <time className="sw-time" dateTime={at.toISOString()} title={staffTimeFormat("exact").format(at)}>{staffTimeFormat(format).format(at)}</time>;
}

/** A section's heading inside a tab, with an optional line under it and controls on the right. */
export function PanelHeader({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="sw-panel-head">
      <div>
        <h2>{title}</h2>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="sw-panel-actions">{actions}</div>}
    </header>
  );
}

// ── Geography ────────────────────────────────────────────────────────────────────────────────

/** Where something is: any of these may be missing, and a missing one is never shown as a place. */
export interface Place {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  postal?: string | null;
}

export interface GeoFilterValue {
  country: string;
  region: string;
  city: string;
  postal: string;
}

export const EMPTY_GEO: GeoFilterValue = { country: "", region: "", city: "", postal: "" };

const COUNTRY_NAMES: Record<string, string> = { CA: "Canada", US: "United States" };
export const countryName = (code: string) => COUNTRY_NAMES[code] || code;

const normalPostal = (value: string | null | undefined) => (value || "").replace(/\s+/g, "").toUpperCase();

/** Whether a row sits inside the chosen place. Postal matches by prefix: "K1P" finds "K1P 1J1". */
export function matchesGeo(place: Place, filter: GeoFilterValue) {
  if (filter.country && (place.country || "").toUpperCase() !== filter.country) return false;
  if (filter.region && (place.region || "") !== filter.region) return false;
  if (filter.city && (place.city || "") !== filter.city) return false;
  if (filter.postal && !normalPostal(place.postal).startsWith(normalPostal(filter.postal))) return false;
  return true;
}

export const geoIsSet = (filter: GeoFilterValue) => Boolean(filter.country || filter.region || filter.city || filter.postal);

/** The filter a deep link asks for: /admin/deals?city=Halifax&region=NS. */
export function geoFromSearch(search: string): GeoFilterValue {
  const params = new URLSearchParams(search);
  return {
    country: (params.get("country") || "").toUpperCase().slice(0, 2),
    region: (params.get("region") || "").slice(0, 40),
    city: (params.get("city") || "").slice(0, 80),
    postal: (params.get("postal") || "").slice(0, 10),
  };
}

/** The query string that opens another section filtered to the same place. */
export function geoQuery(filter: Partial<GeoFilterValue>) {
  const params = new URLSearchParams();
  for (const key of ["country", "region", "city", "postal"] as const) if (filter[key]) params.set(key, String(filter[key]));
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * Country, then province or state, then city, then postal code: each list narrows to what the
 * level above allows, and a level with nothing known in it is not offered. The options come from
 * the rows being filtered, so nobody picks a place that would show nothing.
 */
export function GeoFilter({ places, value, onChange, label = "Filter by place" }: { places: Place[]; value: GeoFilterValue; onChange: (next: GeoFilterValue) => void; label?: string }) {
  const options = useMemo(() => {
    const countries = new Set<string>(), regions = new Set<string>(), cities = new Set<string>();
    for (const place of places) {
      const country = (place.country || "").toUpperCase();
      if (country) countries.add(country);
      if (value.country && country !== value.country) continue;
      if (place.region) regions.add(place.region);
      if (value.region && place.region !== value.region) continue;
      if (place.city) cities.add(place.city);
    }
    const sorted = (set: Set<string>) => [...set].sort((a, b) => a.localeCompare(b));
    return { countries: sorted(countries), regions: sorted(regions), cities: sorted(cities) };
  }, [places, value.country, value.region]);
  return (
    <fieldset className="sw-geo">
      <legend className="sr-only">{label}</legend>
      <label>
        <span>Country</span>
        <select value={value.country} onChange={(event) => onChange({ ...EMPTY_GEO, country: event.target.value })}>
          <option value="">All countries</option>
          {options.countries.map((code) => <option key={code} value={code}>{countryName(code)}</option>)}
        </select>
      </label>
      <label>
        <span>Province / state</span>
        <select value={value.region} disabled={!options.regions.length} onChange={(event) => onChange({ ...value, region: event.target.value, city: "" })}>
          <option value="">All provinces and states</option>
          {options.regions.map((region) => <option key={region} value={region}>{region}</option>)}
        </select>
      </label>
      <label>
        <span>City</span>
        <select value={value.city} disabled={!options.cities.length} onChange={(event) => onChange({ ...value, city: event.target.value })}>
          <option value="">All cities</option>
          {options.cities.map((city) => <option key={city} value={city}>{city}</option>)}
        </select>
      </label>
      <label>
        <span>Postal / ZIP</span>
        <input
          value={value.postal}
          maxLength={10}
          placeholder="e.g. K1P or 37902"
          onChange={(event) => onChange({ ...value, postal: event.target.value.replace(/[^a-z0-9 ]/gi, "").slice(0, 10) })}
        />
      </label>
      {geoIsSet(value) && (
        <button type="button" className="sw-link" onClick={() => onChange(EMPTY_GEO)}>
          Clear place
        </button>
      )}
    </fieldset>
  );
}
