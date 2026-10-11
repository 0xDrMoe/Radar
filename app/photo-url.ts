/**
 * The address a page asks for when it draws a photo stored in R2.
 *
 * app/api/photo serves every object with a year of immutable caching, so a browser that has one
 * never asks for it again. That was fine while the bytes behind a key never changed. Two things
 * broke it:
 *
 *   - Until the route started declaring Content-Length, most responses were cut short and still
 *     looked complete. Browsers cached the top of a photo over grey, for a year, under the same
 *     URL the cards keep asking for.
 *   - scripts/resize-r2-photos.mjs re-encodes the existing photos in place, under the same keys,
 *     at a fraction of their size. A browser holding the old copy would never see the new one.
 *
 * A browser caches by the whole URL, query included, and the route ignores the query. So adding a
 * generation to the address reaches every browser at once, with no change to a key or a row.
 * Bump PHOTO_GENERATION whenever objects already in R2 are rewritten in place again.
 *
 * Only our own /api/photo paths are touched. An admin may set a photo to any https URL, and a
 * query string on someone else's image could change what their server returns.
 */
export const PHOTO_GENERATION = "2";

export function photoSrc(url: string): string {
  if (!url.startsWith("/api/photo/") || url.includes("?")) return url;
  return `${url}?v=${PHOTO_GENERATION}`;
}
