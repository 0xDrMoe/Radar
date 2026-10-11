// How far "near me" reaches.
//
// Its own import-free module for the same reason app/price-tiers.ts is one: the number is used by
// the deals API, the homepage picker, the saved-area validator, the digest job and the dashboard,
// and five copies of a literal are five chances for the picker to offer a radius the server will
// not accept. app/search.ts keeps its own `nextRadius` ladder instead of importing this, because
// that file is deliberately import-free so tests can transpile it standalone.

// 25 km, not 10. 10 km is a city-center number: it covers downtown Ottawa and stops short of
// Kanata, Orleans and the whole of Gatineau, so a first visit outside the core opened on an
// almost-empty feed and the fix was a control most people never touched. 25 km reaches across a
// metro area, which is the distance someone will actually drive for dinner.
export const DEFAULT_RADIUS_KM = 25;

// What the picker offers and what /api/user accepts, in one place - the two used to be separate
// lists with a comment on each asking the reader to keep them in step.
export const RADIUS_OPTIONS = [2, 5, 10, 25, 50] as const;
export const PRO_RADIUS_OPTIONS = [...RADIUS_OPTIONS, 75, 100];

export function allowedRadii(pro: boolean): number[] {
  return pro ? PRO_RADIUS_OPTIONS : [...RADIUS_OPTIONS];
}

/** The furthest a search or an alert reaches on this plan. A 100 km area kept from Pro reaches 50 on Free. */
export function maxRadiusKm(pro: boolean): number {
  return Math.max(...allowedRadii(pro));
}
