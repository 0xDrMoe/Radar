import { EXPIRY_GRACE_PERIOD_DAYS } from "./deal-lifecycle";
import { dateFormatter } from "./formatters";
import { dealLabels } from "./i18n/dealLabels";
import { categoryLabel } from "./i18n/staticEnums";

// SQLite's CURRENT_TIMESTAMP / datetime('now') produce a naive "YYYY-MM-DD HH:MM:SS" string
// that is always UTC but carries no timezone marker. `new Date(...)` treats a marker-less
// datetime string as LOCAL time per the JS spec, which silently shifts every comparison
// against "now" by whatever UTC offset the calling browser or server happens to be in —
// right only for viewers physically in UTC. Every deals/admin timestamp from D1 must be
// parsed through this instead of a bare `new Date(...)`.
export function parseSqlTimestamp(value: string): Date {
  return new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
}

// What Radar can say about whether a deal has been checked, in three states.
//
// - verified: staff checked it against its source within the last 30 days.
// - stale: it was verified, and that check is now more than 30 days old (the deals API computes
//   this as effective_verification_status; a row can also be stored as 'stale'). This is what
//   "Re-checking" means: a check is due on something that was checked.
// - unchecked: needs_review, or anything else - listed from its source and never checked by Radar.
//   Its verified_at is only the moment it was imported, so it is dated as "Listed", never as a
//   check. Calling these "Re-checking" put that word on 145 of 162 Canadian cards and claimed a
//   first check that never happened.
//
// The deal page and the cards should say the same thing about the same deal, so both read this.
export type VerificationState = "verified" | "stale" | "unchecked";

export function verificationState(deal: { effective_verification_status?: string | null; verification_status?: string | null }): VerificationState {
  const status = deal.effective_verification_status ?? deal.verification_status;
  return status === "verified" ? "verified" : status === "stale" ? "stale" : "unchecked";
}

/** "Listed Sep 22" for an unchecked deal, from when it was added; null when there is no date. */
export function listedLabel(deal: { created_at?: string | null; verified_at?: string | null }, locale?: string | null) {
  const value = deal.created_at || deal.verified_at;
  if (!value) return null;
  const date = parseSqlTimestamp(value);
  if (Number.isNaN(date.getTime())) return null;
  const sameYear = date.getFullYear() === new Date().getFullYear();
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" };
  const language = dateFormatLocale(locale);
  return dealLabels(locale || "en").listed(dateFormatter(`listed|${language}|${sameYear ? "short" : "full"}`, language, options).format(date));
}

export function dealTagLabel(deal: { sponsored?: number | boolean | null; effective_verification_status?: string | null; verification_status?: string | null; created_at?: string | null; verified_at?: string | null; category: string }, locale?: string | null) {
  const labels = dealLabels(locale || "en");
  const category = categoryLabel(deal.category, locale || "en");
  if (deal.sponsored) return `${labels.sponsored} · ${category}`;
  const state = verificationState(deal);
  if (state === "verified") return category;
  if (state === "stale") return `${labels.reChecking} · ${category}`;
  const listed = listedLabel(deal, locale);
  return listed ? `${listed} · ${category}` : category;
}

// What the deal page's branch line may say about one branch.
//
// It printed deal_locations.verified_at as "Confirmed <date>". Only two things write that column
// with a check behind it: the admin's Verify, which stamps the deal, the branch and a
// verification_events row in one batch, and a migration that does the same by hand. Everything else
// that writes it is not a check - an import seeding 'confirmed' at the moment it ran, a script
// confirming a chain's branches from the kind of page the promotion was on. The audit found 268 of
// the 409 verified live deals with a confirmed own branch dated at their import, and 374 dated more
// than twelve hours before their deal's first check: Deacon Brodies' Taco Tuesday read "Confirmed
// Sep 22, 2026", its import, when its one check was on the 30th.
//
// So a branch is dated by a check, or it says "Listed":
//   - the deal's own branch by the deal's latest check. A check of a deal is a check at its own
//     address: the Verify button confirms that branch unless told another, and drizzle/0054-0056
//     re-checked deals against the restaurant's own page and left the branch row where the import
//     put it. It is the date the deal's own "Last verified" line gives, so the two agree. A
//     brand-wide deal's every branch the same way, which is what brand-wide means, and so a branch
//     confirmed from the deal's own source page - the check re-read the page it rests on;
//   - any other branch by a check whose moment is its own verified_at: the Verify button's
//     per-location and all-locations forms stamp the branch with the check, and so did 0054 when
//     it linked a chain's other branches to a deal it had just checked;
//   - a confirmed branch that no check covers was listed, not checked: "Listed <date>", the moment
//     it was marked, never "Confirmed".
// The deal's own state still comes first: a deal that is stale says so at every branch, and one
// nobody has checked confirms none of them.

/**
 * How far apart a branch's verified_at and a check can be and still be the same check. The Verify
 * button writes both in one batch and a migration in one file, seconds apart; in the catalogue every
 * confirmed branch was within 2 seconds of one of its deal's checks or more than 12 hours from all
 * of them.
 */
export const SAME_CHECK_SECONDS = 120;

/** One of a deal's checks - a verification_events row - as the branch line reads it. */
export interface DealCheck {
  status: string;
  verified_at: string;
}

export type BranchCheckState = "confirmed" | "listed" | "lapsed" | "unconfirmed";

export interface BranchConfirmation {
  state: BranchCheckState;
  /** When: the check's moment for "confirmed", the listing's for "listed", null otherwise. */
  at: string | null;
}

/**
 * `fromDealSource`: the branch was confirmed from the very page the deal itself is checked against
 * (deal_locations.source_url equals deals.source_url). That is how scripts/brand-wide-eligibility.sql
 * confirms a chain's branches - "the brand publishes this offer for this brand" - so a check of the
 * deal re-reads the page the branch rests on, and dates it, the way it dates a brand-wide deal's
 * branches. A branch confirmed from any other page (its own store page, a sibling promotions page)
 * needs a check of its own.
 */
type BranchInput = { eligibility: string | null; verified_at: string | null; own: boolean; fromDealSource?: boolean };

/**
 * The branch line for every branch of one deal. A national chain's list is 250 rows, rendered live
 * whenever the URL carries a parameter the page reads, so the deal's checks are read once here,
 * newest first, and not once per branch.
 */
export function branchConfirmations(
  deal: { verification: string; brandWide?: boolean; listedAt?: string | null },
  checks: readonly DealCheck[],
): (branch: BranchInput) => BranchConfirmation {
  const passed = checks
    .filter((check) => check.status === "verified")
    .map((check) => ({ at: check.verified_at, time: parseSqlTimestamp(check.verified_at).getTime() }))
    .filter((check) => !Number.isNaN(check.time))
    .sort((a, b) => b.time - a.time);
  const latest = passed[0]?.at ?? null;
  return (branch) => {
    if (branch.eligibility !== "confirmed") return { state: "unconfirmed", at: null };
    // Confirmed once, but the deal's check has lapsed: "not yet" would be untrue, and so would a date.
    if (deal.verification === "stale") return { state: "lapsed", at: null };
    // eligibility='confirmed' on a deal nobody has checked is what its import wrote.
    if (deal.verification !== "verified") return { state: "unconfirmed", at: null };
    if (branch.own || deal.brandWide || branch.fromDealSource) {
      if (latest) return { state: "confirmed", at: latest };
    } else if (branch.verified_at) {
      const stamped = parseSqlTimestamp(branch.verified_at).getTime();
      const check = passed.find((entry) => Math.abs(entry.time - stamped) <= SAME_CHECK_SECONDS * 1000);
      if (check) return { state: "confirmed", at: check.at };
    }
    return { state: "listed", at: branch.verified_at || deal.listedAt || null };
  };
}

/** One branch's line - see branchConfirmations, which a page listing many branches should use. */
export function branchConfirmation(
  branch: BranchInput,
  deal: { verification: string; brandWide?: boolean; listedAt?: string | null },
  checks: readonly DealCheck[],
): BranchConfirmation {
  return branchConfirmations(deal, checks)(branch);
}

export function verificationStatusLabel(status?: string | null, locale?: string | null) {
  const labels = dealLabels(locale || "en");
  return status === "verified" ? labels.checked : labels.reChecking;
}

// The tier maths lives in app/price-tiers.ts, which imports nothing, so the backfill script can
// import the same code the site runs instead of keeping a second copy that drifts. Re-exported
// here because this is where every existing caller already looks for it.
import { MAX_PRICE_TIER } from "./price-tiers";
export { MAX_PRICE_TIER, priceTierSymbol, narrowPriceTier, estimatePriceTier } from "./price-tiers";

export function priceTierLabel(tier?: number | null, locale?: string | null) {
  return tier && tier >= 1 && tier <= MAX_PRICE_TIER ? dealLabels(locale || "en").priceTiers[tier - 1] : null;
}

// BCP-47 tags per locale for Intl date formatting — "fr-CA"/"en-CA" rather than plain "fr"/"en"
// since this site's core markets are Canadian (matches the existing "en-CA" this replaces).
const DATE_FORMAT_LOCALE: Record<string, string> = { en: "en-CA", fr: "fr-CA", es: "es" };

// Exported so every date on the site resolves its BCP-47 tag the same way. The deal detail page
// and app/LocalTime.tsx each had their own copy of this table.
export function dateFormatLocale(locale?: string | null) {
  return DATE_FORMAT_LOCALE[locale || "en"] || "en-CA";
}

// A deal's own expiry is realistically days to a few months out — a value further out than this
// has only ever shown up as a "this doesn't really expire" placeholder someone typed instead of
// leaving expires_at blank (e.g. a literal "2100-01-01"), which then displayed as a nonsensical
// "Ends Jan 1, 2100" on the card. Treat anything this far out as "no end date" rather than
// rendering it, since a placeholder in this column has no reliable format to detect otherwise.
const MAX_PLAUSIBLE_EXPIRY_YEARS = 3;

// expires_at is an instant: the moment an offer stops. Admin writes it as the end of the last day
// in the restaurant's own zone, so Swiss Chalet's offers that run through October 31 are stored as
// '2026-11-01 03:59:59', which is 23:59:59 on the 31st in Toronto. What a card prints is a calendar
// date, and a calendar date only exists in some zone. Formatted in whatever zone the code happened
// to run in, that instant is November 1 on the Worker (which renders in UTC) and on any reader east
// of Toronto, so the card said the offer ran a day longer than it does.
//
// So the date is read in the offer's zone: its location's, or for a nationwide promotion, which has
// no location, Pacific time, the zone the national rows are written against. That is the last zone
// in the country to reach the end of the day, so no reader is told an offer has ended while it is
// still running where they are. Null when neither is known, which falls back to the runtime's zone
// as before.
export const NATIONAL_EXPIRY_TIME_ZONE = "America/Los_Angeles";

/** The zone an offer's end date is read in. The API sends it as `expiry_timezone`. */
export function expiryTimeZone(deal: { location_scope?: string | null; timezone?: string | null }): string | null {
  if (deal.location_scope === "national") return NATIONAL_EXPIRY_TIME_ZONE;
  return deal.timezone || null;
}

// The last moment an offer runs, one second before it stops. An end stored at the stroke of
// midnight (or at 23:59:59, as admin writes it) belongs to the day before, and this is the instant
// whose date is that day.
const lastMomentOf = (end: number) => end - 1000;

/** The calendar date `instant` falls on in `timeZone`, as whole days since 1970-01-01. */
function dayNumber(instant: number, timeZone: string | null | undefined) {
  const zone = timeZone || "";
  const parts = dateFormatter(`ymd|${zone}`, "en-CA", { timeZone: zone || undefined, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(instant);
  const part = (type: string) => Number(parts.find((entry) => entry.type === type)?.value);
  return Math.round(Date.UTC(part("year"), part("month") - 1, part("day")) / 86400000);
}

function yearOf(instant: number, timeZone: string | null | undefined) {
  return new Date(dayNumber(instant, timeZone) * 86400000).getUTCFullYear();
}

/**
 * The last day an offer runs, as a card prints it ("Oct 31"), read in `timeZone` (see
 * expiryTimeZone). Null when there is no end, or it is a placeholder.
 */
export function endDateLabel(expiresAt?: string | null, locale?: string | null, timeZone?: string | null) {
  if (!expiresAt) return null;
  const end = parseSqlTimestamp(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  const last = lastMomentOf(end);
  const zone = timeZone || "";
  const year = yearOf(last, zone);
  const thisYear = yearOf(Date.now(), zone);
  if (year > thisYear + MAX_PLAUSIBLE_EXPIRY_YEARS) return null;
  const sameYear = year === thisYear;
  // toLocaleDateString builds a formatter internally on every call, and this runs once per deal
  // card. Same cost, same fix as everywhere else — see app/formatters.ts. The zone is in the key,
  // because a formatter reused across zones prints the wrong day without any error.
  const options: Intl.DateTimeFormatOptions = sameYear
    ? { month: "short", day: "numeric", timeZone: zone || undefined }
    : { month: "short", day: "numeric", year: "numeric", timeZone: zone || undefined };
  const language = dateFormatLocale(locale);
  return dateFormatter(`end|${language}|${sameYear ? "short" : "full"}|${zone}`, language, options).format(last);
}

/**
 * The last day an offer runs, in `timeZone`, as YYYY-MM-DD: schema.org's priceValidUntil and a
 * <time> element's datetime. The stored value is the instant it stops, so its own date is the next
 * day for every offer that ends at midnight, and for a US national one ending at the end of a day
 * in Los Angeles (07:59:59 UTC the next morning) its first ten characters were a day late too.
 */
export function lastDayIso(expiresAt?: string | null, timeZone?: string | null): string | null {
  if (!expiresAt) return null;
  const end = parseSqlTimestamp(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  return new Date(dayNumber(lastMomentOf(end), timeZone) * 86400000).toISOString().slice(0, 10);
}

/**
 * The last day an offer runs, spelled out ("November 1, 2026"), in `timeZone` - the deal page's
 * "Offer ends". Not a moment to convert into the reader's zone: an offer that runs through
 * November 1 in Los Angeles runs through November 1, even for a reader in Toronto, where its last
 * second falls on the 2nd.
 */
export function lastDayLongLabel(expiresAt?: string | null, locale?: string | null, timeZone?: string | null): string | null {
  if (!expiresAt) return null;
  const end = parseSqlTimestamp(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  const zone = timeZone || "";
  const language = dateFormatLocale(locale);
  const style: Intl.DateTimeFormatOptions = { month: "long", day: "numeric", year: "numeric" };
  return dateFormatter(`last-day|${language}|${zone}`, language, { ...style, timeZone: zone || undefined }, style).format(lastMomentOf(end));
}

// Distinguishes an already-past expiry (still shown during EXPIRY_GRACE_PERIOD_DAYS, labeled
// "Recently ended") from one that's merely coming up soon ("Ends today"/"in N days") — callers
// use this to style the two cases differently instead of treating every expiringSoonLabel() as
// the same "hurry, it's ending" urgency.
export function hasExpired(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const end = parseSqlTimestamp(expiresAt).getTime();
  return !Number.isNaN(end) && end < Date.now();
}

/**
 * "Ends today", "Ends tomorrow", "Ends in 3 days" or "Recently ended", counted in calendar days in
 * the offer's own zone (see expiryTimeZone). It used to divide the time left by 24 hours and round
 * up, so an offer ending tonight read "Ends tomorrow" all morning, and one that ended an hour ago
 * read "Ends today".
 */
export function expiringSoonLabel(expiresAt?: string | null, locale?: string | null, timeZone?: string | null) {
  if (!expiresAt) return null;
  const end = parseSqlTimestamp(expiresAt).getTime();
  if (Number.isNaN(end)) return null;
  const now = Date.now();
  const days = dayNumber(lastMomentOf(end), timeZone) - dayNumber(now, timeZone);
  if (days < -EXPIRY_GRACE_PERIOD_DAYS || days > 7) return null;
  const labels = dealLabels(locale || "en");
  // Whether it has ended is an instant, the same comparison as hasExpired.
  if (end < now) return labels.recentlyEnded;
  if (days <= 0) return labels.endsToday;
  if (days === 1) return labels.endsTomorrow;
  return labels.endsInDays(days);
}
