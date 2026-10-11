import { env } from "cloudflare:workers";
import { fallbackPlaces, geocodeCityName, geocodeMapbox, geocodeZippopotam, type ResolvedLocation } from "./geocode";

// Postal/city resolution, shared by the public search path and the background jobs.
//
// This used to live inside app/api/deals/route.ts, private to it, with the per-IP geocode rate
// limit hardcoded into the function body. That made it unusable from anywhere without a request:
// clientKey() reads headers(), and the cron self-fetches with a synthetic Request, so every job
// lookup would have hashed to the same "unknown" bucket and shared one 30/hour budget — enough to
// throttle a backfill into failing quietly.
//
// So the guard is now the caller's to supply. Each entry point bounds external calls the way that
// makes sense for it: a request bounds per client IP, a job bounds by its own batch size.

export interface PostalCacheRow {
  normalized_postal: string;
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  city: string;
  region: string;
  country: string;
  timezone: string;
  provider: string;
  status: string;
  updated_at: string;
  fresh: number;
}

// Returns false to refuse an external lookup, which resolves to null. How a refusal is surfaced
// to the user is the caller's business: the deals route turns it into a 429, a job just skips.
export type GeocodeGuard = () => Promise<boolean>;

// A guard that never refuses. For background jobs, where the batch size is the real bound and
// there is no per-IP notion to limit against.
export const unlimitedGeocodes: GeocodeGuard = async () => true;

// Freshness is computed in SQL rather than by parsing timestamps in JS, matching the idiom used
// for the other staleness checks in this codebase and avoiding any dependence on how a given JS
// engine reads SQLite's zoneless CURRENT_TIMESTAMP format.
const CACHE_SELECT = "SELECT *,(julianday('now')-julianday(updated_at)<1) fresh FROM postal_cache WHERE normalized_postal=?";
const CACHE_UPSERT = "INSERT OR REPLACE INTO postal_cache(normalized_postal,latitude,longitude,neighborhood,city,region,country,timezone,provider,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'geocoder','resolved',CURRENT_TIMESTAMP)";
// Sentinel 0/'' values are safe: the status==='unsupported' branch never lets them reach a caller.
const CACHE_MISS = "INSERT OR REPLACE INTO postal_cache(normalized_postal,latitude,longitude,neighborhood,city,region,country,timezone,provider,status,updated_at) VALUES(?,0,0,NULL,'','','','','geocoder','unsupported',CURRENT_TIMESTAMP)";

async function cached(key: string) {
  return env.DB.prepare(CACHE_SELECT).bind(key).first<PostalCacheRow>();
}

export async function resolvePostal(postal: string, guard: GeocodeGuard): Promise<ResolvedLocation | null> {
  const hit = await cached(postal);
  if (hit?.status === "unsupported") {
    // Negative cache: a prior lookup for this exact postal code found nothing. Skip both
    // geocoders while it's fresh so a repeat search (or a bot retrying a bad code) can't keep
    // re-triggering external calls for the same known miss.
    if (hit.fresh) return null;
  } else if (hit) {
    return { postal, neighborhood: hit.neighborhood, city: hit.city, region: hit.region, country: hit.country, latitude: hit.latitude, longitude: hit.longitude, timezone: hit.timezone, accuracy: "postal" };
  }

  // Only genuinely new (or expired-negative) lookups reach here — ordinary browsing and cache
  // hits never do.
  if (!(await guard())) return null;

  const isCanadian = /^[A-Z]\d[A-Z]/.test(postal);
  const resolved = (await geocodeMapbox(postal)) || (await geocodeZippopotam(postal, isCanadian));
  if (resolved) {
    await env.DB.prepare(CACHE_UPSERT)
      .bind(postal, resolved.latitude, resolved.longitude, resolved.neighborhood, resolved.city, resolved.region, resolved.country, resolved.timezone).run();
    return resolved;
  }

  // Last-resort offline fallback if both geocoders are unreachable (e.g. a network outage) —
  // covers the site's core markets so search degrades gracefully instead of failing outright.
  const fallback = fallbackPlaces.find((place) => place.pattern.test(postal));
  if (!fallback) {
    await env.DB.prepare(CACHE_MISS).bind(postal).run();
    return null;
  }
  const { city, region, country, latitude, longitude, timezone } = fallback;
  return { postal, city, region, country, latitude, longitude, timezone, neighborhood: null, accuracy: "city" };
}

// City-name counterpart, same shape (cache → geocode → offline fallback → negative-cache) so a
// typed city goes through the same radius-based filtering as a postal code or "use my location"
// instead of a strict city==city string match. Reuses postal_cache with a "city:" prefixed key
// rather than a new table — the column is just a free-text lookup key, nothing else assumes it is
// a real postal code.
const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * A bare place name that is one of Radar's markets, asked about as that market.
 *
 * "Morristown" is a town in Tennessee with deals on Radar, and a bigger one in New Jersey without
 * any, and the geocoder's first answer is New Jersey's: the search came back "no coverage" in the
 * one Morristown that has some. London, Victoria, Windsor and Hamilton each have a namesake south of
 * the border the same way. So a name that matches exactly one covered market, and does not already
 * say which state or province it means, is looked up with the market's region attached.
 */
export function asCoveredMarket(cityText: string, markets: ReadonlyArray<{ market: string; region?: string | null }>): string {
  if (cityText.includes(",")) return cityText;
  const wanted = fold(cityText);
  const matches = markets.filter((row) => row.region && fold(row.market) === wanted);
  return matches.length === 1 ? `${matches[0].market}, ${matches[0].region}` : cityText;
}

export async function resolveCityText(
  typed: string,
  guard: GeocodeGuard,
  markets: ReadonlyArray<{ market: string; region?: string | null }> = [],
): Promise<ResolvedLocation | null> {
  const cityText = asCoveredMarket(typed, markets);
  const key = `city:${cityText.trim().toLowerCase()}`;
  const hit = await cached(key);
  if (hit?.status === "unsupported") {
    if (hit.fresh) return null;
  } else if (hit) {
    return { neighborhood: hit.neighborhood, city: hit.city, region: hit.region, country: hit.country, latitude: hit.latitude, longitude: hit.longitude, timezone: hit.timezone, accuracy: "city" };
  }

  if (!(await guard())) return null;

  const resolved = await geocodeCityName(cityText);
  if (resolved) {
    await env.DB.prepare(CACHE_UPSERT)
      .bind(key, resolved.latitude, resolved.longitude, resolved.neighborhood, resolved.city, resolved.region, resolved.country, resolved.timezone).run();
    return resolved;
  }

  const [name, named] = cityText.split(",").map((part) => part.trim().toLowerCase());
  const fallback = fallbackPlaces.find((place) => place.city.toLowerCase() === name && (!named || place.region.toLowerCase() === named));
  if (!fallback) {
    await env.DB.prepare(CACHE_MISS).bind(key).run();
    return null;
  }
  const { city, region, country, latitude, longitude, timezone } = fallback;
  return { city, region, country, latitude, longitude, timezone, neighborhood: null, accuracy: "city" };
}

// The geocoders answer a Canadian postal code with the whole FSA's name — K2C0J4 comes back as
// "Ottawa (Queensway / Copeland / Carlington / Carleton Heights)". That is a fine matching key and
// a terrible label, and saved_locations.city is read as a label in two places now: the dashboard's
// tracked-area row and the digest email's header. So trim the parenthetical for storage there.
// The raw answer stays untouched in postal_cache, which is what search resolution reads.
export function displayCity(city: string | null | undefined) {
  if (!city) return null;
  const trimmed = city.replace(/\s*\(.*$/, "").trim();
  return trimmed || city.trim() || null;
}
