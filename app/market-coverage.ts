import { kmBetween, type Coordinates } from "./search";

// Which market_coverage row a search is about.
//
// It used to be the row whose name was, letter for letter, the city the search resolved to. Only a
// typed city ever matched. A device point resolves to "Current location" and a postal code to its
// FSA's label - "Ottawa (The Glebe / Ottawa South / Ottawa East)" - so neither found a row, and a
// search with no row is told the area is thin whenever anything at all is there. The website sends
// a point for every search, a picked city included, so every located search on the site said
// "Coverage is still growing in this area", in Ottawa, over 70 places.
//
// Now a place is matched by name first - the city typed, or the postal code's own city without its
// neighbourhoods - and failing that by where it is: the nearest market whose centre is within reach
// of the point. A town with no market near it still gets no row, and is still called thin or empty
// by what is there, which is the honest answer for a place Radar has not set out to cover.

/** The columns this reads from a market_coverage row. */
export type MarketRow = { market: string; region: string | null; country: string | null };

/** Where one listing is, as the deals snapshot holds it. */
export type ListingPlace = { city: string; region: string | null; country: string | null; latitude: number | null; longitude: number | null };

export type MarketCenter<R extends MarketRow> = { row: R } & Coordinates;

/** A place name as two spellings of it compare: case, accents and spacing folded away. */
export function foldPlaceName(value: string | null | undefined) {
  return String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

// Each row's name folded once, not once per row per request: the rows are the snapshot's, and live
// as long as it does.
const FOLDED_MARKETS = new WeakMap<MarketRow, string>();
function foldedMarket(row: MarketRow) {
  let folded = FOLDED_MARKETS.get(row);
  if (folded === undefined) FOLDED_MARKETS.set(row, folded = foldPlaceName(row.market));
  return folded;
}

// Two codes that disagree rule a match out; a code nobody recorded rules nothing out.
const sameCode = (a: string | null | undefined, b: string | null | undefined) => !a || !b || a.toUpperCase() === b.toUpperCase();

function median(values: number[]) {
  const sorted = values.sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Each market's centre: the median pin of the listings filed under its name, in its province or
 * state. The table holds no coordinates, and the listings are where a market's readers actually
 * are. A median rather than a mean, so one misplaced pin cannot drag the centre across town. A
 * market with no listing of its own has no centre, and can only be matched by name.
 */
export function marketCenters<R extends MarketRow>(rows: readonly R[], places: Iterable<ListingPlace>): MarketCenter<R>[] {
  const wanted = new Map<string, R[]>();
  for (const row of rows) {
    const key = foldPlaceName(row.market), list = wanted.get(key);
    if (list) list.push(row); else wanted.set(key, [row]);
  }
  const pins = new Map<R, { latitudes: number[]; longitudes: number[] }>();
  // Folded once per distinct city name, not once per listing: a few dozen names across the catalogue.
  const folded = new Map<string, string>();
  for (const place of places) {
    if (place.latitude == null || place.longitude == null || !place.city) continue;
    const latitude = Number(place.latitude), longitude = Number(place.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    let key = folded.get(place.city);
    if (key === undefined) folded.set(place.city, key = foldPlaceName(place.city));
    const candidates = wanted.get(key);
    if (!candidates) continue;
    for (const row of candidates) {
      if (!sameCode(row.region, place.region) || !sameCode(row.country, place.country)) continue;
      let pin = pins.get(row);
      if (!pin) pins.set(row, pin = { latitudes: [], longitudes: [] });
      pin.latitudes.push(latitude);
      pin.longitudes.push(longitude);
    }
  }
  return [...pins].map(([row, pin]) => ({ row, latitude: median(pin.latitudes), longitude: median(pin.longitudes) }));
}

/**
 * The market a search is about, or undefined when it is about none.
 *
 * `names` are the place's own names, strongest first: what the reader typed, then what the postal
 * code or city resolved to. A name counts when it is a market's, in the same province or state and
 * country where both are known - "Morristown, NJ" is not the Morristown in Tennessee. Failing a name,
 * the nearest market centre within `reachKm` of the point, in the same country: a point in Detroit
 * is not Windsor's reader, however close the river puts them.
 */
export function marketFor<R extends MarketRow>(
  rows: readonly R[],
  centers: readonly MarketCenter<R>[],
  place: { names: ReadonlyArray<string | null | undefined>; region: string | null; country: string | null; point: Coordinates | null; reachKm: number },
): R | undefined {
  for (const name of place.names) {
    const wanted = foldPlaceName(name);
    if (!wanted) continue;
    const named = rows.find((row) => foldedMarket(row) === wanted && sameCode(row.region, place.region) && sameCode(row.country, place.country));
    if (named) return named;
  }
  if (!place.point) return undefined;
  let nearest: R | undefined, nearestKm = Infinity;
  for (const center of centers) {
    if (!sameCode(center.row.country, place.country)) continue;
    const km = kmBetween(place.point, center);
    if (km <= place.reachKm && km < nearestKm) { nearest = center.row; nearestKm = km; }
  }
  return nearest;
}
