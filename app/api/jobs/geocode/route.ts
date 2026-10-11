import { env } from "cloudflare:workers";
import { apiError, hasJobSecret } from "../../../api-utils";
import { displayCity, resolvePostal, unlimitedGeocodes } from "../../../postal";
import { geocodeAddress, NOMINATIM_MIN_INTERVAL_MS } from "../../../geocode";

const DEFAULT_BATCH_SIZE = 25;
// Same ceiling as the translation job, for the same reason: a manual `?limit=` call should be able
// to clear a backlog in one shot, while a mistyped value still can't run the job away.
const MAX_BATCH_SIZE = 300;

// Restaurant locations are paced one a second by Nominatim's usage policy, so this batch is
// deliberately much smaller than the area batch: it has to finish inside a request, not just
// inside an hour. At 6 an hour the job repairs new locations comfortably faster than staff add
// them, which is all the steady state needs to do.
const LOCATION_BATCH_SIZE = 6;
const MAX_LOCATION_BATCH_SIZE = 20;
// How long a location the geocoder could not place waits before it is asked about again.
const RETRY_AFTER_DAYS = 7;

interface PendingAreaRow {
  id: number;
  postal: string;
}

interface CoarseLocationRow {
  id: string;
  address: string;
  city: string;
  region: string | null;
  country: string | null;
  full_postal: string | null;
}

// Backfills coordinates onto tracked areas saved before /api/user started geocoding them, and
// repairs any area whose save-time lookup failed — the save deliberately never blocks on the
// geocoder, so a transient outage leaves rows for this job to pick up rather than losing the area.
//
// Areas without coordinates still receive alert email; they just fall back to postal-prefix
// matching, which is coarser. So this job is a quality repair, not a liveness requirement, and it
// is safe for it to be unconfigured.
export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string>;
  if (!hasJobSecret(request, runtime.GEOCODE_JOB_SECRET)) {
    return apiError(401, "INVALID_SCHEDULER", "Scheduler authentication failed.");
  }

  const url = new URL(request.url);
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(url.searchParams.get("limit")) || DEFAULT_BATCH_SIZE));

  // Only active areas, because an area the user turned off feeds nothing. Oldest first so a
  // backlog drains in a stable order instead of re-attempting the same tail every hour.
  const pending = await env.DB.prepare(
    "SELECT id,postal FROM saved_locations WHERE active=1 AND (latitude IS NULL OR longitude IS NULL) ORDER BY id LIMIT ?",
  ).bind(batchSize).all<PendingAreaRow>();

  let resolved = 0;
  let unresolved = 0;
  for (const area of pending.results) {
    // resolvePostal already negative-caches a postal code it cannot place, so an area with a
    // typo'd code costs one external lookup a day, not one per run.
    const place = await resolvePostal(area.postal, unlimitedGeocodes).catch(() => null);
    if (!place) { unresolved++; continue; }
    await env.DB.prepare(
      "UPDATE saved_locations SET latitude=?,longitude=?,city=?,region=?,country=COALESCE(?,country),timezone=COALESCE(?,timezone) WHERE id=?",
    ).bind(place.latitude, place.longitude, displayCity(place.city), place.region, place.country, place.timezone, area.id).run();
    resolved++;
  }

  // ── Restaurant locations ──────────────────────────────────────────────────
  //
  // A different question from the areas above: an area is a postal code, a location is a street
  // address, and only the second can be put on a map. 172 of 237 operating locations were never
  // asked, so they carry the postal-prefix centroid app/geocode.ts falls back to — which is why a
  // map of Ottawa was one pin holding 31 deals.
  //
  // Two repairable states, and one that only looks repairable. A row with no coordinate has
  // nothing to lose, and a 'city' row is a known placeholder. But a row with a real coordinate and
  // no precision recorded — 62 of them, predating geo_precision — is not evidence of a problem:
  // re-geocoding those would spend ten hours of batches to *replace* good coordinates with
  // whatever Nominatim happens to return, which is not obviously better and might be worse.
  // 'street' is skipped because asking the same geocoder the same question gets the same answer,
  // and 'exact' is done.
  const locationBatch = Math.max(
    1,
    Math.min(MAX_LOCATION_BATCH_SIZE, Number(url.searchParams.get("locations")) || LOCATION_BATCH_SIZE),
  );
  //
  // An address the geocoder could not place is asked again after RETRY_AFTER_DAYS, not next hour.
  // Once the backlog drained, the queue was only the addresses Nominatim has no answer for - three
  // of them on 2026-10-03 - and every hour asked all of them again: three lookups, three
  // `geocoded_at` writes and an audit row, 24 times a day, for the answer it got the hour before.
  const coarse = await env.DB.prepare(
    `SELECT id,address,city,region,country,full_postal FROM restaurant_locations
      WHERE status='operating' AND (latitude IS NULL OR geo_precision='city')
        AND (geocoded_at IS NULL OR geocoded_at < datetime('now','-${RETRY_AFTER_DAYS} days'))
      ORDER BY geocoded_at IS NOT NULL, geocoded_at, id LIMIT ?`,
  ).bind(locationBatch).all<CoarseLocationRow>();

  let located = 0;
  let unlocated = 0;
  for (const [index, location] of coarse.results.entries()) {
    // Paced, not parallel. Nominatim blocks a caller that exceeds one request a second, and being
    // blocked would break the postal geocoding this app already depends on.
    if (index > 0) await new Promise((resume) => setTimeout(resume, NOMINATIM_MIN_INTERVAL_MS));
    const found = await geocodeAddress({
      address: location.address,
      city: location.city,
      region: location.region,
      country: location.country,
      postal: location.full_postal,
    });
    if (!found) {
      // Stamped even on failure, so a stubborn address goes to the back of the queue instead of
      // being retried first every hour while the rest of the backlog waits behind it.
      await env.DB.prepare("UPDATE restaurant_locations SET geocoded_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(location.id).run();
      unlocated++;
      continue;
    }
    await env.DB.prepare(
      "UPDATE restaurant_locations SET latitude=?,longitude=?,geo_precision=?,geocoded_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?",
    ).bind(found.latitude, found.longitude, found.precision, location.id).run();
    located++;
  }

  // No geocode_job_runs table: unlike the digest and translation jobs, this one has no
  // duplicate-run hazard worth a migration — it is idempotent, and a row it fails to resolve is
  // simply picked up again next hour. Failures go to audit_log so a persistent one is still
  // visible in admin.
  if (unresolved || unlocated) {
    await env.DB.prepare(
      "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,details) VALUES('system:cron','system','area_geocode_failed','job','geocode',?)",
    ).bind(JSON.stringify({
      unresolved, attempted: pending.results.length, unlocated, locationsAttempted: coarse.results.length,
    }).slice(0, 1500)).run();
  }

  return Response.json({
    ok: true,
    areas: { attempted: pending.results.length, resolved, unresolved },
    locations: { attempted: coarse.results.length, located, unlocated },
  });
}
