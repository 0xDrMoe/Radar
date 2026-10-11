import { env } from "cloudflare:workers";

// Shared postal-code geocoding: used by both the public search path (app/api/deals/route.ts,
// which layers its own cache + rate limit on top) and the admin deal editor (app/api/admin/
// route.ts, which has no rate limit of its own since it's already gated behind an authenticated
// admin session). Keeping the geocoders themselves here means both callers resolve a postal code
// to the same coordinates instead of the admin side inventing its own approximation.

export type ResolvedLocation = {
  postal?: string;
  neighborhood?: string | null;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  accuracy: "postal" | "city" | "device";
};

interface MapboxGeocodeResponse {
  features?: Array<{
    geometry?: { coordinates?: number[] };
    properties?: {
      name?: string;
      context?: {
        region?: { region_code?: string; name?: string };
        neighborhood?: { name?: string };
        place?: { name?: string };
        country?: { country_code?: string };
      };
      coordinates?: { routable_points?: Array<{ timezone?: string }> };
    };
  }>;
}

interface ZippopotamResponse {
  places?: Array<{
    latitude?: string;
    longitude?: string;
    "state abbreviation"?: string;
    state?: string;
    "place name"?: string;
  }>;
}

// IANA timezone per US state / Canadian province, used to fill in the resolved location's
// timezone regardless of which geocoding path (or fallback) resolved it.
export const regionTimezones: Record<string, string> = {
  AL: "America/Chicago", AK: "America/Anchorage", AZ: "America/Phoenix", AR: "America/Chicago", CA: "America/Los_Angeles",
  CO: "America/Denver", CT: "America/New_York", DE: "America/New_York", FL: "America/New_York", GA: "America/New_York",
  HI: "Pacific/Honolulu", ID: "America/Boise", IL: "America/Chicago", IN: "America/Indiana/Indianapolis", IA: "America/Chicago",
  KS: "America/Chicago", KY: "America/New_York", LA: "America/Chicago", ME: "America/New_York", MD: "America/New_York",
  MA: "America/New_York", MI: "America/Detroit", MN: "America/Chicago", MS: "America/Chicago", MO: "America/Chicago",
  MT: "America/Denver", NE: "America/Chicago", NV: "America/Los_Angeles", NH: "America/New_York", NJ: "America/New_York",
  NM: "America/Denver", NY: "America/New_York", NC: "America/New_York", ND: "America/Chicago", OH: "America/New_York",
  OK: "America/Chicago", OR: "America/Los_Angeles", PA: "America/New_York", RI: "America/New_York", SC: "America/New_York",
  SD: "America/Chicago", TN: "America/Chicago", TX: "America/Chicago", UT: "America/Denver", VT: "America/New_York",
  VA: "America/New_York", WA: "America/Los_Angeles", WV: "America/New_York", WI: "America/Chicago", WY: "America/Denver", DC: "America/New_York",
  AB: "America/Edmonton", BC: "America/Vancouver", MB: "America/Winnipeg", NB: "America/Moncton", NL: "America/St_Johns",
  NS: "America/Halifax", NT: "America/Yellowknife", NU: "America/Iqaluit", ON: "America/Toronto", PE: "America/Halifax",
  QC: "America/Toronto", SK: "America/Regina", YT: "America/Whitehorse",
};

/**
 * The zone at a point in a state or province, for the ones a time-zone line runs through.
 *
 * regionTimezones has one zone a region, and a region's one zone is wrong for part of it: all of
 * Tennessee read as Central, so Knoxville - Eastern, and where Radar's Tennessee deals are - came
 * back an hour behind, and a branch added from the admin with a Knoxville ZIP would have been
 * stored that way and told readers its happy hour had started an hour early. Each line here is
 * where the boundary runs past the people, not a survey: counties along a boundary can still
 * land on the wrong side of it. Everything else falls through to regionTimezones.
 */
export function regionTimezone(region: string, latitude: number, longitude: number): string | undefined {
  switch (region) {
    // East Tennessee is Eastern; the line runs down the Cumberland Plateau, west of Chattanooga.
    case "TN": return longitude > -84.75 || (latitude < 35.4 && longitude > -85.45) ? "America/New_York" : "America/Chicago";
    case "KY": return longitude < -86.0 ? "America/Chicago" : "America/New_York";
    // Gary's corner and Evansville's are Central; the rest of Indiana is Eastern.
    case "IN": return longitude < -86.9 && (latitude > 41.0 || latitude < 38.4) ? "America/Chicago" : "America/Indiana/Indianapolis";
    // The panhandle west of the Apalachicola.
    case "FL": return longitude < -85.0 && latitude > 29.5 ? "America/Chicago" : "America/New_York";
    // The four Upper Peninsula counties on the Wisconsin line.
    case "MI": return longitude < -87.5 && latitude > 45.5 ? "America/Menominee" : "America/Detroit";
    case "TX": return longitude < -104.9 ? "America/Denver" : "America/Chicago";
    case "ND": return longitude < -101.0 && latitude < 47.5 ? "America/Denver" : "America/Chicago";
    case "SD": return longitude < -100.6 ? "America/Denver" : "America/Chicago";
    case "NE": return longitude < -101.3 ? "America/Denver" : "America/Chicago";
    case "KS": return longitude < -101.45 ? "America/Denver" : "America/Chicago";
    // The panhandle north of the Salmon River keeps Pacific time.
    case "ID": return latitude > 45.6 ? "America/Los_Angeles" : "America/Boise";
    case "OR": return longitude > -117.5 && latitude < 44.5 ? "America/Boise" : "America/Los_Angeles";
    // Kenora and Dryden keep Manitoba's time; Thunder Bay keeps Toronto's.
    case "ON": return longitude < -90.0 ? "America/Winnipeg" : "America/Toronto";
    // The Kootenays and Golden keep Alberta's time, the Peace River country standard time all year.
    case "BC": return latitude > 55.5 && longitude > -123 ? "America/Dawson_Creek" : longitude > -118.0 ? "America/Edmonton" : "America/Vancouver";
    case "NL": return longitude < -57.1 && latitude > 51.4 ? "America/Goose_Bay" : "America/St_Johns";
    // The Magdalen Islands keep Atlantic time.
    case "QC": return longitude > -63.0 ? "America/Halifax" : "America/Toronto";
    default: return regionTimezones[region];
  }
}

// The same provinces and states spelled out, against the code regionTimezones is keyed on. Two
// callers need this: canonicalCity, so "Austin, Texas" is recognized as the same mistake as
// "Austin, TX"; and regionCode, because all three geocoders below can answer with either spelling.
const regionNames: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID",
  illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY", "district of columbia": "DC",
  alberta: "AB", "british columbia": "BC", manitoba: "MB", "new brunswick": "NB",
  "newfoundland and labrador": "NL", "northwest territories": "NT", "nova scotia": "NS",
  nunavut: "NU", ontario: "ON", "prince edward island": "PE", quebec: "QC", "québec": "QC",
  saskatchewan: "SK", yukon: "YT",
};

// The two-letter code for a province or state however it was written — "TX", "tx", "Texas",
// "D.C." all reduce to the code regionTimezones and every stored `region` column are keyed on.
//
// All three geocoders below can answer with either spelling. Mapbox prefers `region_code` but
// falls back to `context.region.name`, Zippopotam's `state abbreviation` falls back to `state`,
// and Nominatim's ISO3166-2 code falls back to `address.state` — each fallback being the full
// name. A full name stored in `region` is not a harmless variation: `regionTimezones[region]`
// misses it, so the location silently takes the Toronto default, and a `province=TX` filter never
// matches the row that says "Texas".
//
// A value it does not recognize is passed through rather than blanked. Blank is the state that
// lets country and timezone fall to their Canadian defaults — the failure 0033 had to repair — so
// an unrecognised region is better kept visible than turned into that.
export function regionCode(region: string | null | undefined): string {
  const cleaned = String(region ?? "").replace(/\./g, "").replace(/\s+/g, " ").trim();
  if (cleaned.length === 2 && Object.hasOwn(regionTimezones, cleaned.toUpperCase())) return cleaned.toUpperCase();
  const name = cleaned.toLowerCase();
  return Object.hasOwn(regionNames, name) ? regionNames[name] : cleaned;
}

// Whether a string names a province or state at all, as opposed to being part of a place name.
function isRegionDesignator(value: string) {
  const code = regionCode(value);
  return code.length === 2 && Object.hasOwn(regionTimezones, code);
}

// A city column is meant to hold a bare city name, with the province or state in the `region`
// column beside it. Everything that groups by city treats the whole string as the key — the
// /api/deals facets, the app's place picker built from them, the homepage's "N cities" count — so
// a row entered as "Austin, TX" does not read as a variant of "Austin". It reads as a second city,
// and the picker offers both as separate places to search.
//
// Strips a trailing region designator in either spelling and collapses stray whitespace. A value
// with no such suffix is returned unchanged apart from that whitespace, so this is safe to apply
// to every city the app reads or writes rather than only to ones suspected of being wrong.
//
// It deliberately does not try to tell two same-named cities in different states apart: the
// catalog has always keyed on the bare name and kept the state in `region`, and folding
// "Austin, TX" into "Austin" enforces that convention rather than changing it. Distinguishing a
// Kansas City, MO from a Kansas City, KS would mean keying the facets on city *and* region, which
// is a different change and one nothing in the data needs yet.
export function canonicalCity(city: string | null | undefined): string {
  const collapsed = String(city ?? "").replace(/\s+/g, " ").trim();
  const comma = collapsed.lastIndexOf(",");
  if (comma < 1) return collapsed;
  // "Washington, D.C." is recognized the same as "Washington, DC" — regionCode takes the dots off.
  if (!isRegionDesignator(collapsed.slice(comma + 1))) return collapsed;
  // A value that is nothing *but* a region ("TX" alone, say) is left as it is — wrong, but not
  // something this can improve by blanking the only city name the row has.
  return collapsed.slice(0, comma).trim() || collapsed;
}

// Offline last resort covering the site's core markets, used when both geocoders are
// unreachable (e.g. a network outage) so location resolution degrades gracefully instead of
// failing outright.
export const fallbackPlaces: Array<{ pattern: RegExp; city: string; region: string; country: string; latitude: number; longitude: number; timezone: string }> = [
  { pattern: /^K[12]/, city: "Ottawa", region: "ON", country: "CA", latitude: 45.4215, longitude: -75.6972, timezone: "America/Toronto" },
  { pattern: /^J8/, city: "Gatineau", region: "QC", country: "CA", latitude: 45.4765, longitude: -75.7013, timezone: "America/Toronto" },
  { pattern: /^M/, city: "Toronto", region: "ON", country: "CA", latitude: 43.6532, longitude: -79.3832, timezone: "America/Toronto" },
  { pattern: /^H/, city: "Montreal", region: "QC", country: "CA", latitude: 45.5019, longitude: -73.5674, timezone: "America/Toronto" },
  { pattern: /^V/, city: "Vancouver", region: "BC", country: "CA", latitude: 49.2827, longitude: -123.1207, timezone: "America/Vancouver" },
  { pattern: /^T2/, city: "Calgary", region: "AB", country: "CA", latitude: 51.0447, longitude: -114.0719, timezone: "America/Edmonton" },
  { pattern: /^T5/, city: "Edmonton", region: "AB", country: "CA", latitude: 53.5461, longitude: -113.4938, timezone: "America/Edmonton" },
  { pattern: /^L8/, city: "Hamilton", region: "ON", country: "CA", latitude: 43.2557, longitude: -79.8711, timezone: "America/Toronto" },
  { pattern: /^N6/, city: "London", region: "ON", country: "CA", latitude: 42.9849, longitude: -81.2453, timezone: "America/Toronto" },
  { pattern: /^N2/, city: "Waterloo", region: "ON", country: "CA", latitude: 43.4643, longitude: -80.5204, timezone: "America/Toronto" },
  { pattern: /^L4/, city: "Barrie", region: "ON", country: "CA", latitude: 44.3894, longitude: -79.6903, timezone: "America/Toronto" },
  { pattern: /^R/, city: "Winnipeg", region: "MB", country: "CA", latitude: 49.8951, longitude: -97.1384, timezone: "America/Winnipeg" },
  { pattern: /^100/, city: "New York", region: "NY", country: "US", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York" },
  { pattern: /^606/, city: "Chicago", region: "IL", country: "US", latitude: 41.8781, longitude: -87.6298, timezone: "America/Chicago" },
  { pattern: /^981/, city: "Seattle", region: "WA", country: "US", latitude: 47.6062, longitude: -122.3321, timezone: "America/Los_Angeles" },
  { pattern: /^787/, city: "Austin", region: "TX", country: "US", latitude: 30.2672, longitude: -97.7431, timezone: "America/Chicago" },
  { pattern: /^802/, city: "Denver", region: "CO", country: "US", latitude: 39.7392, longitude: -104.9903, timezone: "America/Denver" },
  { pattern: /^331/, city: "Miami", region: "FL", country: "US", latitude: 25.7617, longitude: -80.1918, timezone: "America/New_York" },
  { pattern: /^379/, city: "Knoxville", region: "TN", country: "US", latitude: 35.9606, longitude: -83.9207, timezone: "America/New_York" },
  { pattern: /^378/, city: "Morristown", region: "TN", country: "US", latitude: 36.2135, longitude: -83.2949, timezone: "America/New_York" },
  { pattern: /^G[123]/, city: "Quebec City", region: "QC", country: "CA", latitude: 46.8139, longitude: -71.208, timezone: "America/Toronto" },
  { pattern: /^N[89]/, city: "Windsor", region: "ON", country: "CA", latitude: 42.3149, longitude: -83.0364, timezone: "America/Toronto" },
];

export async function geocodeMapbox(postal: string): Promise<ResolvedLocation | null> {
  const runtime = env as unknown as Record<string, string>;
  if (!runtime.MAPBOX_ACCESS_TOKEN || runtime.MAPBOX_PERMANENT_GEOCODING !== "true") return null;
  try {
    const endpoint = new URL("https://api.mapbox.com/search/geocode/v6/forward");
    endpoint.searchParams.set("q", postal);
    endpoint.searchParams.set("country", "ca,us");
    endpoint.searchParams.set("types", "postcode");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("autocomplete", "false");
    endpoint.searchParams.set("permanent", "true");
    endpoint.searchParams.set("access_token", runtime.MAPBOX_ACCESS_TOKEN);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = (await response.json()) as MapboxGeocodeResponse;
    const feature = body.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (coordinates?.length !== 2) return null;
    const context = feature?.properties?.context || {};
    const region = regionCode(context.region?.region_code || context.region?.name);
    return {
      postal,
      neighborhood: context.neighborhood?.name || null,
      city: context.place?.name || feature?.properties?.name || "Unknown",
      region,
      country: String(context.country?.country_code || "CA").toUpperCase(),
      latitude: coordinates[1],
      longitude: coordinates[0],
      timezone: feature?.properties?.coordinates?.routable_points?.[0]?.timezone || regionTimezone(region, coordinates[1], coordinates[0]) || "America/Toronto",
      accuracy: "postal",
    };
  } catch {
    return null;
  }
}

// Free, keyless postal-code geocoder covering every valid US ZIP and Canadian FSA. This is the
// primary resolver: unlike Mapbox it needs no API token to be configured, so location resolution
// keeps working even if that secret is never set up.
export async function geocodeZippopotam(postal: string, isCanadian: boolean): Promise<ResolvedLocation | null> {
  const country = isCanadian ? "ca" : "us";
  const query = isCanadian ? postal.slice(0, 3) : postal.slice(0, 5);
  try {
    const response = await fetch(`https://api.zippopotam.us/${country}/${query}`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return null;
    const body = (await response.json()) as ZippopotamResponse;
    const place = body.places?.[0];
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    if (!place || Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    const region = regionCode(place["state abbreviation"] || place.state);
    return {
      postal,
      neighborhood: null,
      city: place["place name"] || "Unknown",
      region,
      country: isCanadian ? "CA" : "US",
      latitude,
      longitude,
      timezone: regionTimezone(region, latitude, longitude) || (isCanadian ? "America/Toronto" : "America/New_York"),
      accuracy: "postal",
    };
  } catch {
    return null;
  }
}

// Tries Mapbox (if configured) then the free Zippopotam fallback — the same order the public
// search path uses — without any caching or rate limiting of its own; callers that need those
// (like the public search endpoint) layer them on top.
export async function geocodePostal(postal: string, isCanadian: boolean): Promise<ResolvedLocation | null> {
  return (await geocodeMapbox(postal)) || (await geocodeZippopotam(postal, isCanadian));
}

// Offline last resort keyed by postal-code prefix, for when both geocoders are unreachable.
export function fallbackForPostal(postal: string) {
  return fallbackPlaces.find((place) => place.pattern.test(postal)) || null;
}

interface NominatimResult {
  lat: string;
  lon: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    state?: string;
    country_code?: string;
    "ISO3166-2-lvl4"?: string;
  };
}

// Free, keyless place-name geocoder (OpenStreetMap Nominatim) — the city-search counterpart to
// geocodeZippopotam above. Mapbox's geocoder is postcode-only (see the `types=postcode` param on
// geocodeMapbox) and isn't configured in this deployment anyway, so this is the primary resolver
// for a typed city name rather than a postal/ZIP code. Their usage policy requires a descriptive
// User-Agent and asks for at most ~1 request/sec, which the caller's rate limit + cache satisfy.
export async function geocodeCityName(query: string): Promise<ResolvedLocation | null> {
  try {
    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("addressdetails", "1");
    endpoint.searchParams.set("countrycodes", "ca,us");
    const response = await fetch(endpoint, {
      headers: { "User-Agent": "RadarDeals/1.0 (+https://radar.cheap)" },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as NominatimResult[];
    const place = body[0];
    const latitude = Number(place?.lat);
    const longitude = Number(place?.lon);
    if (!place || Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
    // "ISO3166-2-lvl4" comes back as e.g. "US-TN" / "CA-ON" — the 2-letter code regionTimezones
    // is keyed on. Nominatim's plain `address.state` is the full name ("Tennessee"), which is why
    // the fallback goes through regionCode rather than being stored as it arrives.
    const region = regionCode(place.address?.["ISO3166-2-lvl4"]?.split("-")[1] || place.address?.state);
    const country = String(place.address?.country_code || "").toUpperCase();
    return {
      neighborhood: null,
      city: place.address?.city || place.address?.town || place.address?.village || query,
      region,
      country,
      latitude,
      longitude,
      timezone: regionTimezone(region, latitude, longitude) || (country === "US" ? "America/New_York" : "America/Toronto"),
      accuracy: "city",
    };
  } catch {
    return null;
  }
}

// ── Street addresses ────────────────────────────────────────────────────────
//
// Everything above resolves a *postal code* to a point, which is what a search needs: someone
// typing K1N wants deals near K1N. A restaurant location is a different question — it has a real
// street address, and putting it on a map means resolving that address to a door rather than to
// the middle of its city.
//
// This is the piece that was missing, and the reason 172 of 237 locations sit on a postal-prefix
// centroid: nothing ever asked a geocoder where "34 Clarence St, Ottawa" is.
//
// Precision is returned rather than assumed. A geocoder always answers; the useful question is
// what it actually found. A road-level match is worth storing (the right street beats the middle
// of the city) but must not be mistaken for a door, and a city-level match is exactly the
// placeholder we already have, so it is rejected instead of being written back as an improvement.

/** Nominatim allows one request per second. Exceeded, it blocks the caller rather than throttling. */
export const NOMINATIM_MIN_INTERVAL_MS = 1100;

export type GeoPrecision = "exact" | "street" | "city";

export type AddressGeocode = {
  latitude: number;
  longitude: number;
  precision: GeoPrecision;
  provider: "mapbox" | "nominatim";
};

export type PostalAddress = {
  address: string;
  city: string;
  region?: string | null;
  country?: string | null;
  postal?: string | null;
};

// A suite, unit or floor is the part of an address a geocoder has no map for: the building is in
// OpenStreetMap, "Suite RR001" inside it is not, and including it turns a match into a miss. 13 of
// the 175 locations needing repair carry one.
//
// Only ever used as a second attempt, never the first — when the unit *is* mapped (a numbered shop
// in a mall), the full address is the better answer.
export function simplifyAddress(address: string) {
  const simplified = address
    .replace(/,?\s*(suite|ste\.?|unit|apt\.?|bldg\.?|building|kiosk|level)\s+[\w-]+\.?\s*$/i, "")
    .replace(/,?\s*#\s*[\w-]+\s*$/i, "")
    .replace(/,?\s*(ground|lower|upper|\d+(st|nd|rd|th))\s+floor\s*$/i, "")
    // Numbered only: "Floor 2" is a unit, "Floor Lane" is a street name.
    .replace(/,?\s*floor\s+\d+[\w-]*\s*$/i, "")
    .replace(/[\s,]+$/, "");
  return simplified === address ? null : simplified;
}

function addressQuery(place: PostalAddress) {
  return [place.address, place.city, place.region, place.postal, place.country]
    .map((part) => (part || "").trim())
    .filter(Boolean)
    .join(", ");
}

// Nominatim's place_rank is its own answer to "how precise is this?", on a scale where 30 is a
// building and 26-27 is a street. It is the signal to trust: the category/type/addresstype trio is
// inconsistent in a way that silently loses good matches. 8870 SW 136th St in Miami comes back as
// category "place", type "house", addresstype "place" — a real building, which a type allowlist
// reads as a vague "place" and throws away.
const HOUSE_RANK = 30;
const STREET_RANK = 26;

// Kept as a secondary signal for the older/sparser records that come back without a usable rank.
const EXACT_TYPES = new Set([
  "house", "building", "residential", "commercial", "retail", "industrial", "apartments",
  "restaurant", "cafe", "bar", "pub", "fast_food", "shop", "amenity", "yes",
]);
const STREET_TYPES = new Set([
  "road", "street", "primary", "secondary", "tertiary", "unclassified", "living_street", "service",
]);

export function precisionFromOsm(
  category: string,
  type: string,
  addresstype: string,
  placeRank?: number,
): GeoPrecision | null {
  if (typeof placeRank === "number" && placeRank > 0) {
    if (placeRank >= HOUSE_RANK) return "exact";
    if (placeRank >= STREET_RANK) return "street";
    // Anything coarser is a suburb, city or county — the placeholder we are trying to replace.
    return null;
  }
  if (addresstype === "house" || addresstype === "building" || category === "building") return "exact";
  if (EXACT_TYPES.has(addresstype) || EXACT_TYPES.has(type) || category === "shop") return "exact";
  if (STREET_TYPES.has(addresstype) || category === "highway") return "street";
  return null;
}

async function geocodeAddressNominatim(place: PostalAddress): Promise<AddressGeocode | null> {
  try {
    const endpoint = new URL("https://nominatim.openstreetmap.org/search");
    endpoint.searchParams.set("q", addressQuery(place));
    endpoint.searchParams.set("format", "jsonv2");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("addressdetails", "0");
    const response = await fetch(endpoint, {
      // Nominatim's usage policy requires a request to identify the application and a contact
      // point. An anonymous caller gets blocked, correctly.
      headers: { "user-agent": "RadarDeals/1.0 (+https://radar.cheap)", accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Array<{
      lat?: string; lon?: string; category?: string; type?: string; addresstype?: string; place_rank?: number;
    }>;
    const match = body?.[0];
    const latitude = Number(match?.lat);
    const longitude = Number(match?.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    const precision = precisionFromOsm(
      match?.category || "", match?.type || "", match?.addresstype || "", match?.place_rank,
    );
    // A city-level answer is what we already have. Writing it back would mark a placeholder as
    // freshly geocoded and stop the job from ever retrying it.
    if (!precision) return null;
    return { latitude, longitude, precision, provider: "nominatim" };
  } catch {
    return null;
  }
}

async function geocodeAddressMapbox(place: PostalAddress): Promise<AddressGeocode | null> {
  const runtime = env as unknown as Record<string, string>;
  // Same gate as geocodeMapbox: Mapbox forbids storing results from the standard endpoint, and
  // these are written to the database. Without the permanent entitlement we must not use it.
  if (!runtime.MAPBOX_ACCESS_TOKEN || runtime.MAPBOX_PERMANENT_GEOCODING !== "true") return null;
  try {
    const endpoint = new URL("https://api.mapbox.com/search/geocode/v6/forward");
    endpoint.searchParams.set("q", addressQuery(place));
    endpoint.searchParams.set("types", "address,street");
    endpoint.searchParams.set("limit", "1");
    endpoint.searchParams.set("autocomplete", "false");
    endpoint.searchParams.set("permanent", "true");
    endpoint.searchParams.set("access_token", runtime.MAPBOX_ACCESS_TOKEN);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      features?: Array<{ geometry?: { coordinates?: number[] }; properties?: { feature_type?: string } }>;
    };
    const feature = body.features?.[0];
    const coordinates = feature?.geometry?.coordinates;
    if (coordinates?.length !== 2) return null;
    const featureType = feature?.properties?.feature_type;
    if (featureType !== "address" && featureType !== "street") return null;
    return {
      latitude: coordinates[1],
      longitude: coordinates[0],
      precision: featureType === "address" ? "exact" : "street",
      provider: "mapbox",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve a street address to a coordinate, or null when no geocoder could place it precisely
 * enough to be an improvement on a city centroid.
 *
 * Mapbox first when it is configured — it is the better geocoder and the one already trusted for
 * postal lookups — falling back to OpenStreetMap's Nominatim, which needs no key. Nominatim's
 * usage policy caps callers at one request a second, so every caller must pace itself; see
 * NOMINATIM_MIN_INTERVAL_MS. Its data is ODbL, which permits this use with attribution.
 *
 * Never throws, matching every other geocoder here: a location that cannot be placed keeps the
 * coordinate it has and is retried on a later run.
 */
export async function geocodeAddress(place: PostalAddress): Promise<AddressGeocode | null> {
  if (!place.address?.trim() || !place.city?.trim()) return null;
  const found = (await geocodeAddressMapbox(place)) || (await geocodeAddressNominatim(place));
  if (found) return found;

  // Second and last attempt, only when there is actually something to drop. A caller pacing itself
  // for Nominatim must budget two requests for an address with a unit in it.
  const simplified = simplifyAddress(place.address);
  if (!simplified) return null;
  // Paced here rather than by the caller, which has no way to know a second request happened.
  // Two Nominatim calls 200ms apart is exactly the burst its policy forbids, and a throttled
  // retry looks identical to an address that genuinely is not on the map.
  await new Promise((resume) => setTimeout(resume, NOMINATIM_MIN_INTERVAL_MS));
  const retry = { ...place, address: simplified };
  return (await geocodeAddressMapbox(retry)) || (await geocodeAddressNominatim(retry));
}

