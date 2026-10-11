// The lean shape of a deal, for clients that render a card rather than a whole page.
//
// /api/deals answers 70 fields per deal. A phone showing a list of cards reads 28 of them, and the
// three heaviest fields it never touches — chain_locations, brand_offers, and the full
// participating_locations rows — were 34 KB of a 261 KB response for a single 41-deal search.
// Over cellular that is most of the wait before anything appears.
//
// This is a projection, not a second source of truth: every field here exists on the full row
// under the same name and means the same thing, so a client can move between the two views
// without a translation layer. Adding a field the app starts needing is a one-line change here;
// the failure mode is a missing value, never a wrong one.

/** Everything a deal card, a map pin and a sort need. Nothing else. */
export const COMPACT_DEAL_FIELDS = [
  "id",
  "slug",
  "restaurant",
  "canonical_restaurant",
  "title",
  "category_label",
  "cuisine_label",
  "schedule",
  "price",
  "price_tier",
  // Whether the offer is running right now, and the phrase for it ("Available now · 2-5 PM").
  // Computed per request against the deal's own timezone, so it cannot be derived on the client
  // from `schedule` — a card that leaves it out can only say when the deal runs, never whether it
  // is running, which is the first thing anyone standing on a street wants to know.
  "availability",
  "available_today",
  "available_now",
  "availability_phase",
  // On tonight in the venue's zone, read from the schedule per request; "Tonight" is no longer a
  // category a deal is filed under.
  "tonight",
  "city",
  "address",
  "emoji",
  "source_url",
  "sponsored",
  "verification_status",
  "verified_at",
  "expires_at",
  // The zone expires_at's date is read in, so "Ends Oct 31" is the offer's last day where it runs
  // rather than wherever the phone is (app/verification.ts, expiryTimeZone).
  "expiry_timezone",
  "restaurant_photo_url",
  // How many branches the brand has and how many run the offer. Two integers rather than the arrays
  // they came from, which is the whole point: a card says "confirmed at 9,812 locations" without
  // carrying 9,812 rows to say it.
  "chain_location_count",
  "participating_location_count",
  // Which country the offer is in, so a card can say whose dollars its price is in; and how it is
  // redeemed - in the chain's app, on its website, or just at the counter.
  "country",
  "redemption",
  "redemption_note",
  "promo_code",
  "photo_url",
  "restaurant_logo_url",
  // 'brand' or 'national' for a chain-wide promotion. A 'national' deal has no location at all -
  // no pin, no distance - and its store finder is where a reader goes instead (drizzle/0050).
  "location_scope",
  "restaurant_locator_url",
  // The brand's own site, for its favicon when no logo is stored.
  "restaurant_website",
  // The badges a card shows: stale or verified, a hidden gem, a chain, and whether a chain's
  // branches run different offers.
  "effective_verification_status",
  "hidden_gem",
  "is_chain",
  "offer_varies_by_location",
  "distance_km",
  "latitude",
  "longitude",
  // A nationwide card under group=brand: the brand's name, and each of its offers already cut to
  // what the card prints. Absent from every other response.
  "brand_name",
  "chain_offers",
] as const;

/**
 * A participating location, cut to what a map pin is. The full row carries eligibility, offer
 * availability, postal prefix, region and source URL; a pin plots a point and names a street, and
 * says when that point is only the city's centre (`approximate`, present only when true).
 */
const COMPACT_PLACE_FIELDS = ["city", "address", "latitude", "longitude", "approximate"] as const;

type Row = Record<string, unknown>;

function pick(row: Row, fields: readonly string[]) {
  const out: Row = {};
  // Absent rather than null: a key with no value is bytes spent saying nothing, and every consumer
  // of this shape already treats a missing optional field and a null one the same way.
  for (const field of fields) if (row[field] !== undefined && row[field] !== null) out[field] = row[field];
  return out;
}

export function compactDeal(deal: Row) {
  const out = pick(deal, COMPACT_DEAL_FIELDS);
  const places = deal.participating_locations;
  if (Array.isArray(places) && places.length) {
    // Kept because the map genuinely needs them: a chain deal's pin belongs at each branch running
    // the offer, not at the restaurant's head office.
    out.participating_locations = places.map((place) => pick(place as Row, COMPACT_PLACE_FIELDS));
  }
  return out;
}

// A chain deal's location arrays, cut to a payload.
//
// The deal page caps its list at 250 because a reader cannot scroll a national chain. This is the
// same problem one layer out, and it was latent until US chains landed: /api/deals gives every deal
// three arrays over the same locations — chain_locations, participating_locations and
// other_brand_locations — and none of them was bounded. A Canadian Tim Hortons promotion confirmed
// at 120 branches made that 360 rows on a card nobody had opened. McDonald's US is about 10,000
// branches with a mappable address, so four McValue offers would have been 120,000 location objects
// in one response, on a route whose own history is a note about removing 140 KB of duplication.
//
// Nearest first, so the ones kept are the ones a reader can act on: the map plots the branches
// around them rather than 40 arbitrary ones in another state.
export const PAYLOAD_LOCATION_MAX = 40;

/** Rough ordering only - squared degrees, never shown, never compared across latitudes. */
function nearness(place: Row, point: { latitude: number; longitude: number }) {
  // null before Number(), not after: Number(null) is 0 and Number.isFinite(0) is true, so a branch
  // with no coordinates would otherwise become a real point in the Gulf of Guinea. That reads as
  // "very far away" from North America and so behaves correctly here entirely by accident.
  if (place.latitude == null || place.longitude == null) return Number.POSITIVE_INFINITY;
  const latitude = Number(place.latitude), longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return Number.POSITIVE_INFINITY;
  return (latitude - point.latitude) ** 2 + (longitude - point.longitude) ** 2;
}

function capPlaces(value: unknown, point: { latitude: number; longitude: number } | null) {
  if (!Array.isArray(value) || value.length <= PAYLOAD_LOCATION_MAX) return null;
  const rows = value as Row[];
  // Only sort when there is somewhere to sort from, so a bare nationwide browse keeps the order the
  // snapshot built rather than paying to shuffle rows nobody asked to be near.
  const ordered = point ? [...rows].sort((a, b) => nearness(a, point) - nearness(b, point)) : rows;
  return ordered.slice(0, PAYLOAD_LOCATION_MAX);
}

/**
 * Bound one deal's location arrays, and state the totals separately.
 *
 * The counts are taken before the cap and travel as their own fields, because a capped array is no
 * longer something to count: a card reading its length said "40 confirmed locations" of an offer
 * confirmed at 10,000. `chain_location_count` already worked this way; the confirmed total is new
 * here for the same reason.
 *
 * A total the snapshot already measured wins over the array. A large brand's arrays arrive holding
 * only the branches this request drew - the ones in range, or a page's worth - and their length is
 * how many were drawn, not how many there are.
 */
export function capDealLocations(deal: Row, point: { latitude: number; longitude: number } | null): Row {
  const participating = deal.participating_locations, chain = deal.chain_locations;
  const out: Row = { ...deal };
  const measured = (field: string, array: unknown[]) =>
    typeof deal[field] === "number" && (deal[field] as number) >= array.length ? (deal[field] as number) : array.length;
  if (Array.isArray(chain)) out.chain_location_count = measured("chain_location_count", chain);
  if (Array.isArray(participating)) out.participating_location_count = measured("participating_location_count", participating);
  for (const field of ["chain_locations", "participating_locations", "other_brand_locations"] as const) {
    const capped = capPlaces(deal[field], point);
    if (capped) out[field] = capped;
  }
  return out;
}
