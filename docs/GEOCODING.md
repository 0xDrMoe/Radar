# Geocoding

Two different questions get called "geocoding" here, and conflating them is what caused the bug
this document exists to explain.

| | Input | Answer | Used by |
| --- | --- | --- | --- |
| **Postal** | `K1N` | the middle of that postal area | search, tracked areas, digest matching |
| **Address** | `110 Murray St, Ottawa, ON` | that building | restaurant locations, the map |

`geocodePostal()` has been in `app/geocode.ts` since the beginning. `geocodeAddress()` had not —
which meant restaurant locations, which have real street addresses, were only ever resolved to the
postal-prefix centroid in `fallbackPlaces`.

The result: **172 of 237 operating locations shared a coordinate with their city.** Thirty-one
Ottawa deals sat on 45.4215,-75.6972, the middle of the city, where none of those restaurants are.
The phone app's map was one pin holding thirty-one deals, and distance sorting was measuring to
city halls.

## How good is a coordinate?

`restaurant_locations.geo_precision` now records that, because two numbers alone cannot say.

| Value | Means |
| --- | --- |
| `exact` | Building or door level. What a street address should give. |
| `street` | The right road, an arbitrary point along it. Hundreds of meters, not kilometers. |
| `city` | A centroid. The coordinate is a placeholder, not a location. |
| `NULL` | Never geocoded. |

`geocoded_at` records when it was last attempted, successfully or not.

**What a reader sees.** A `city` coordinate is never drawn as a door. `/api/deals` marks each such
branch `approximate: true` (absent on every other branch, so placed ones cost no bytes), and the
deal page's own query reads the column directly. The deal page's map then drops its marker, frames
the wider area and says the address could not be placed exactly; the app draws the pin with a
dashed-circle glyph in the muted colour, and its callout and sheet say "Approximate location". A
pin shared by a placed branch and a centroid is a placed pin. `street` and `NULL` are drawn as
ordinary pins: a street point is the right road, and a `NULL` row with a coordinate predates the
column (see below).

The important rule is in `geocodeAddress()`: **a city-level answer is refused, not stored.** A
geocoder always answers something. Writing a city centroid back would overwrite a placeholder with
a placeholder, stamp the row as freshly geocoded, and stop it ever being retried — the failure
would look exactly like success.

Precision comes from Nominatim's own `place_rank` (30 = building, 26-27 = street), not from its
`category`/`type`/`addresstype` fields. Those three are inconsistent enough to lose good matches:
8870 SW 136th St in Miami is a real building that comes back as category `place`, type `house`,
addresstype `place`, and an allowlist built on them discards it. The type vocabulary is kept only
as a fallback for records that arrive without a usable rank.

## Providers

Mapbox first, when configured; OpenStreetMap's Nominatim otherwise.

- **Mapbox** is gated on `MAPBOX_ACCESS_TOKEN` *and* `MAPBOX_PERMANENT_GEOCODING=true`, the same
  gate `geocodeMapbox()` uses. Mapbox forbids storing results from the standard endpoint, and these
  go into the database, so without the permanent entitlement the token is not touched at all.
  Neither is set today, so in practice everything below goes through Nominatim.
- **Nominatim** needs no key. Its usage policy requires a request to identify the application, and
  caps callers at **one request per second** — exceed it and the caller is blocked outright, which
  would take postal geocoding down with it. `NOMINATIM_MIN_INTERVAL_MS` is exported so every caller
  paces itself against the same number. Its data is ODbL; storing it is permitted with attribution.

A location with a suite or unit in its address gets one retry with that part stripped:
OpenStreetMap maps the building, not "Suite RR001" inside it. The full address is always tried
first, because a numbered shop in a mall sometimes *is* mapped.

## Keeping it fixed

`/api/jobs/geocode` runs hourly from `worker/index.ts`'s `scheduled()`. It already repaired tracked
areas; it now also takes six restaurant locations per run — small because it pays a second per
address and has to finish inside a request, and ample because six an hour outpaces the rate staff
add locations.

It selects `latitude IS NULL OR geo_precision = 'city'`, oldest attempt first — a row with no
coordinate, or one known to be a placeholder.

Deliberately **not** `geo_precision IS NULL`. Sixty-two rows have a real coordinate and no
precision recorded, simply because they predate the column. They are not evidence of a problem, and
re-geocoding them would spend ten hours of batches replacing good coordinates with whatever
Nominatim happened to return — not obviously better, possibly worse. They stay as they are, and
`NULL` there means "unclassified", not "broken".

A location it cannot resolve still gets its `geocoded_at` stamped, so a stubborn address moves to
the back of the queue instead of blocking the rest of the backlog behind it on every run.

`?locations=N` raises the batch to at most 20 for a manual catch-up.

## The one-time repair

The 175 rows that predated all this were fixed by `scripts/backfill-location-coords.mjs`, which
imports `app/geocode.ts` and calls the same `geocodeAddress()` — not a reimplementation, so the
backfill and the ongoing job cannot drift. It emitted `drizzle/0031_location_coordinates.sql`,
which is reviewable as a diff before it lands and applies to every environment identically.

To do it again after a bulk import:

```bash
# Export the rows still on a centroid
npx wrangler d1 execute radar --remote --command \
  "SELECT id,address,city,region,country,full_postal FROM restaurant_locations
    WHERE status='operating' AND (geo_precision IS NULL OR geo_precision='city')" > coarse.json

node scripts/backfill-location-coords.mjs coarse.json drizzle/00XX_more_coordinates.sql
```

It takes about a second per address, and a little longer for the ones with a suite.
