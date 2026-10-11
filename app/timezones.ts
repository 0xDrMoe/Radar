// The timezone a person keeps on their profile, and the list they choose it from.
//
// The zone is not decoration. The hourly digest job formats the current time in it for every
// recipient, and `Intl.DateTimeFormat` throws a RangeError on a zone it does not know. So a
// free-text field that stored "Toronto", "Eastern" or "America/Torotno" as typed was storing a
// value that would later throw inside another person's job. The answer is to only ever store a
// zone the runtime has already accepted, and to offer the list rather than a blank box.
//
// Pure, with no Worker bindings, so the dashboard (a client component) and /api/user share it.

export const DEFAULT_TIMEZONE = "America/Toronto";

/**
 * The zone as this runtime spells it, or null when the runtime does not know it.
 *
 * Asking `Intl.DateTimeFormat` is the whole check, because it is the same call that would
 * otherwise throw later, so nothing it accepts here can fail there. It also accepts a zone in the
 * wrong case ("america/toronto") or a legacy alias; resolvedOptions() hands back the runtime's
 * own spelling, which is what gets stored.
 */
export function canonicalTimezone(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || raw.length > 64) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: raw }).resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Every zone the browser knows, with the person's current one guaranteed to be among them.
 *
 * `Intl.supportedValuesOf` lists canonical names only, so somebody whose stored zone is an alias,
 * or who saved one before this list existed, would otherwise see the select silently jump to the
 * first entry, and saving an unrelated field would move their roundup to Abidjan. Their own value
 * is kept at the top instead. When it is one the runtime rejects, it is still shown, so a save
 * that sends it back is refused with a reason rather than quietly rewritten.
 */
export function timezoneChoices(current: string | null | undefined): string[] {
  let zones: string[] = [];
  try {
    zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    zones = [];
  }
  const own = (current || "").trim() || DEFAULT_TIMEZONE;
  const list = zones.length ? zones : [DEFAULT_TIMEZONE];
  return list.includes(own) ? list : [own, ...list];
}
