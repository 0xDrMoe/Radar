// Radar Canada or Radar US: which country's deals the homepage browses when nobody has said where
// they are.
//
// With no location the homepage used to list every deal in both countries at once, and a US "$5"
// sat beside a Canadian "$5" with nothing to say they were different money. A reader now browses
// one market at a time, chosen three ways, strongest first:
//
//   1. `?country=` in the URL - a shared link, or the switch just pressed;
//   2. the reader's own last choice, kept in localStorage;
//   3. a guess from the device's timezone setting - America/Toronto is Canada, America/Chicago the
//      US - and nothing when the zone says neither.
//
// The guess reads a setting on the reader's own device, never the request's IP address, and it only
// picks the starting list: the switch beside it changes it, and a searched location always wins,
// because a Knoxville ZIP is a US search whatever the timezone says. See app/redemption.ts for the
// Market type itself.
//
// A type-only import, and no runtime one, so the tests can load this file directly.
import type { Market } from "./redemption";

export const MARKET_STORAGE_KEY = "radar:market";

/** A market, or "all" for a reader who asked for both countries at once. */
export type MarketChoice = Market | "all";

/** The same rule as marketOf() in app/redemption.ts: "US" or "CA", any case, else nothing. */
export function parseMarket(value: string | null | undefined): Market | null {
  const code = String(value || "").trim().toUpperCase();
  return code === "US" || code === "CA" ? code : null;
}

/**
 * The reader's last choice. "all" is kept as a choice of its own rather than as nothing stored,
 * because nothing stored means "guess", and the guess would put a reader who deliberately asked
 * for both countries back on one of them at every visit.
 */
export function storedMarket(): MarketChoice | null {
  try {
    const value = localStorage.getItem(MARKET_STORAGE_KEY);
    return value === "all" ? "all" : parseMarket(value);
  } catch {
    return null;
  }
}

export function rememberMarket(choice: MarketChoice) {
  try {
    localStorage.setItem(MARKET_STORAGE_KEY, choice);
  } catch {
    // Storage refused (private mode): the choice lasts as long as the URL that carries it.
  }
}

// Every zone the IANA database files under Canada. Anything else in the Americas that is not in the
// US list below is a third country, and gets no guess.
const CANADIAN_ZONES = new Set([
  "America/Toronto", "America/Montreal", "America/Vancouver", "America/Edmonton", "America/Winnipeg",
  "America/Halifax", "America/St_Johns", "America/Regina", "America/Moncton", "America/Glace_Bay",
  "America/Goose_Bay", "America/Whitehorse", "America/Yellowknife", "America/Iqaluit",
  "America/Rankin_Inlet", "America/Resolute", "America/Cambridge_Bay", "America/Inuvik",
  "America/Dawson", "America/Dawson_Creek", "America/Fort_Nelson", "America/Creston",
  "America/Swift_Current", "America/Nipigon", "America/Thunder_Bay", "America/Rainy_River",
  "America/Atikokan", "America/Blanc-Sablon", "America/Pangnirtung",
]);

const US_ZONES = new Set([
  "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "America/Phoenix",
  "America/Anchorage", "America/Juneau", "America/Sitka", "America/Yakutat", "America/Nome",
  "America/Metlakatla", "America/Adak", "America/Boise", "America/Detroit", "America/Menominee",
  "Pacific/Honolulu",
]);

/** The market a timezone name belongs to, or null when it could be anywhere. */
export function marketForTimezone(zone: string | null | undefined): Market | null {
  const name = String(zone || "");
  if (CANADIAN_ZONES.has(name) || name.startsWith("Canada/")) return "CA";
  if (US_ZONES.has(name) || name.startsWith("US/") || /^America\/(Indiana|Kentucky|North_Dakota)\//.test(name)) return "US";
  return null;
}

export function guessMarket(): Market | null {
  try {
    return marketForTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

/**
 * The reader's own clock, for the API to read a national offer's "today" on - and a "my location"
 * search's, which has no clock of its own. Sent with the fetch only, never put in a shareable URL:
 * whoever opens the link has their own.
 */
export function readerTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}
