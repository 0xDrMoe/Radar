// Date formatters, built once and kept.
//
// Constructing an Intl.DateTimeFormat loads ICU locale and timezone data, and it is roughly two
// orders of magnitude more expensive than using one. That does not matter once; it matters a great
// deal in a loop, and every place this module replaced was in a loop — one per deal in
// availabilityFromSchedule, one per verification event in LocalTime, one per card in endDateLabel.
//
// The cost was not theoretical. Building a formatter per deal took 20.8ms for a 133-deal response,
// more than the Worker's per-request CPU limit, so /api/deals and every deal page failed under
// sustained load while cheap routes like /sitemap.xml served fine. Reusing them took the same work
// to 0.83ms.
//
// The key is supplied by the caller rather than derived from the options object, because deriving
// it would mean JSON.stringify on every call — reintroducing a smaller version of the same problem
// in the name of tidiness. Callers already know what varies: a timezone, a locale, a style.
//
// Unbounded growth is not a risk worth guarding. The key space is (locales × styles × timezones
// the catalog uses), which is dozens, and a Worker isolate is recycled long before a Map of that
// size is interesting.

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * A cached Intl.DateTimeFormat.
 *
 * `key` must vary with everything in `locale` and `options` that varies — a key that collides
 * returns the wrong formatter, which is a date silently rendered in the wrong zone rather than an
 * error. `fallback` is used when the options are rejected: a deal can carry a timezone this
 * runtime does not recognize, and DateTimeFormat throws a RangeError on one, which would
 * otherwise fail a whole response over a single bad row.
 */
export function dateFormatter(
  key: string,
  locale: string,
  options: Intl.DateTimeFormatOptions,
  fallback?: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(key);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat(locale, options);
  } catch {
    // The fallback is tried without a guard on purpose: if the caller's own fallback is also
    // invalid that is a bug in this codebase rather than bad data, and it should surface.
    formatter = new Intl.DateTimeFormat(locale, fallback || { ...options, timeZone: undefined });
  }
  FORMATTERS.set(key, formatter);
  return formatter;
}
