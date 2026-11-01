// How far "near me" reaches.
//
// Its own import-free module for the same reason app/price-tiers.ts is one: the number is used by
// the deals API, the homepage picker, the saved-area validator, the digest job and the dashboard,
// and five copies of a literal are five chances for the picker to offer a radius the server will
// not accept. app/search.ts keeps its own `nextRadius` ladder instead of importing this, because
// that file is deliberately import-free so tests can transpile it standalone; a test holds the two
// in step.

// 5 km: the distance someone actually goes for a deal on an ordinary evening - a short drive, a
// bike ride, a long walk. The default used to be 25 km because 10 km opened on an almost-empty
// feed outside downtown Ottawa, and the fix was a control most people never touched. A wide
// default answered that by burying the places around the corner under ones half an hour away.
// The thin-area problem is now handled where it happens: a search left on the default widens
// itself one step at a time, up to AUTO_WIDEN_MAX_KM, until there is something worth showing
// (see autoWidenRadius), and says that it did.
export const DEFAULT_RADIUS_KM = 5;

// What the picker offers and what /api/user accepts, in one place - the two used to be separate
// lists with a comment on each asking the reader to keep them in step. 1 km is walking distance.
// Nobody looks for a happy hour 75 or 100 km away, so Pro's extra reach stops at 50: a rural or
// exurban area, or an alert that covers a whole metro.
export const RADIUS_OPTIONS = [1, 2, 5, 10, 25] as const;
export const PRO_RADIUS_OPTIONS = [...RADIUS_OPTIONS, 50];
/** The radii only Pro may choose, shown locked to everyone else so the ceiling is visible. */
export const PRO_ONLY_RADII = PRO_RADIUS_OPTIONS.filter((value) => !(RADIUS_OPTIONS as readonly number[]).includes(value));

/** The smallest radius a search or an alert is measured over, whatever it was asked for. */
export const MIN_RADIUS_KM = RADIUS_OPTIONS[0];

/**
 * A tracked area's radius when none was chosen. Wider than the search default, because an alert
 * cannot widen itself the way a search on screen does, and a roundup that never has anything in
 * it is worse than one that reaches a little further.
 */
export const DEFAULT_AREA_RADIUS_KM = 10;

// Auto-widening: a search on the default radius that finds fewer than AUTO_WIDEN_MIN_RESULTS deals
// steps out one radius at a time, never past AUTO_WIDEN_MAX_KM. A radius the reader picked is left
// alone: they get the "widen" offer instead, because they asked for that distance.
export const AUTO_WIDEN_MIN_RESULTS = 4;
export const AUTO_WIDEN_MAX_KM = 25;

// What a market-coverage verdict is measured over, independent of the radius searched: a reader
// who narrows to 1 km downtown should not be told the city is thin. Metro scale, which is what
// the old 25 km default was standing in for.
export const COVERAGE_REACH_KM = 25;

export function allowedRadii(pro: boolean): number[] {
  return pro ? PRO_RADIUS_OPTIONS : [...RADIUS_OPTIONS];
}

/** The furthest a search or an alert reaches on this plan. A 50 km area kept from Pro reaches 25 on Free. */
export function maxRadiusKm(pro: boolean): number {
  return Math.max(...allowedRadii(pro));
}

/** A requested radius held to what this plan allows. Clamped rather than refused, so a link or a lapsed plan still searches. */
export function clampRadius(value: unknown, pro: boolean, fallback = DEFAULT_RADIUS_KM): number {
  const requested = Number(value);
  const radius = Number.isFinite(requested) && requested > 0 ? requested : fallback;
  return Math.max(MIN_RADIUS_KM, Math.min(maxRadiusKm(pro), radius));
}

/**
 * The radius a default search should be retried at, or null to keep what it found. `found` is the
 * number of matches at `radius`. Only steps up the plan's own options and never past
 * AUTO_WIDEN_MAX_KM, so an empty rural search ends at a readable "nothing within 25 km" rather
 * than at a list of places an hour away.
 */
export function autoWidenRadius(radius: number, found: number, pro: boolean): number | null {
  if (found >= AUTO_WIDEN_MIN_RESULTS) return null;
  const next = allowedRadii(pro).find((value) => value > radius);
  return next != null && next <= AUTO_WIDEN_MAX_KM ? next : null;
}

/**
 * A radius read from a link or an old saved value, moved onto one of the options: the largest
 * option at or under it, so a bookmarked 100 km search opens at 50 rather than on a blank picker.
 * The plan's own ceiling is still applied by whoever serves it (clampRadius).
 */
export function snapRadius(value: unknown, fallback = DEFAULT_RADIUS_KM): number {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return fallback;
  return [...PRO_RADIUS_OPTIONS].reverse().find((option) => option <= requested) ?? MIN_RADIUS_KM;
}

export type TravelMode = "walk" | "bike" | "drive";

/** How a radius is usually covered, for the picker's labels: walking up to 2 km, a bike or short drive at 5, a drive beyond. */
export function travelMode(km: number): TravelMode {
  return km <= 2 ? "walk" : km <= 5 ? "bike" : "drive";
}
