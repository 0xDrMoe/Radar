// Why a search term might not be a person looking for food.
//
// The public search box is open to anyone, and every term it receives is recorded (app/api/deals,
// recordSearch). Scanners and bots type SQL, script tags and URLs into it; a script hammering one
// term makes it look like the most popular dish in the city. Left unmarked, those rows sit at the
// top of the Growth section's sourcing list as though somebody wanted them.
//
// This only ever says a term LOOKS like abuse. A pattern cannot know intent - "select" is a word,
// "www" can be part of a restaurant's name, and a burst can be a newsletter going out - so the
// Growth section labels every match "Possible abuse — not confirmed". Only a member of staff
// recording a verdict in search_term_flags (POST /api/admin/growth) can turn that into
// "Confirmed abuse". Pure and cheap: a handful of regexes over at most a hundred short strings per
// request, so it costs nothing against the Worker's CPU budget.

export type SearchSignalCode = "sql" | "script" | "url" | "long" | "repeated" | "burst";

export interface SearchSignal {
  code: SearchSignalCode;
  /** Plain words for the reviewer: what the term has that made it stand out. */
  label: string;
}

/** Longer than any dish, cuisine or restaurant name anyone types. Recorded terms are capped at 80. */
export const LONG_TERM_LENGTH = 60;
/** A burst needs at least this many searches on one day, so two searches on a quiet day are not one. */
export const BURST_MIN_DAY = 10;
/** ...and that day must hold at least this share of the term's searches in the whole range. */
export const BURST_SHARE = 0.7;

const SQL = /\bunion\b.{0,40}\bselect\b|\bselect\b.{0,60}\bfrom\b|\b(?:drop|alter|truncate)\s+table\b|\binsert\s+into\b|\bsleep\s*\(|\bwaitfor\s+delay\b|\bbenchmark\s*\(|\bor\s+['"]?\d+['"]?\s*=\s*['"]?\d+|['"]\s*(?:or|and)\s+['"]?\w+['"]?\s*=|;\s*--|--\s*$|\/\*|\bexec(?:\s|\()|\bxp_\w+|\binformation_schema\b|0x[0-9a-f]{8,}/i;
const SCRIPT = /<\s*\/?\s*(?:script|img|svg|iframe|body|object|embed|a)\b|javascript\s*:|\bon(?:error|load|click|mouseover|focus)\s*=|\{\{|\$\{|<\?php|%3c|&#x?\d+;|\.\.\/|\/etc\/passwd|\balert\s*\(|\bdocument\.cookie\b/i;
// The recorder folds punctuation to spaces, so a URL usually arrives as "https example com". Both
// shapes are caught: the raw one in case that ever changes, the folded one as it is stored today.
// Only endings that are not also food words: "top", "site" and "online" would flag "sushi top".
const URL_LIKE = /https?:\/\/|\bwww\.|\bhttps?\s+\S|\bwww\s+\S|\b[a-z0-9-]{2,}[.\s](?:com|net|org|ru|cn|xyz|biz)\b/i;
const REPEATED = /(.)\1{5,}/;

/**
 * The patterns a term matches, in a fixed order. `peakDay` is the most searches the term had on a
 * single UTC day in the range, `searches` its total in the range, and `rangeDays` how long the
 * range is - a one-day range cannot have a burst, everything in it is one day.
 */
export function searchSignals(term: string, stats: { searches: number; peakDay: number; rangeDays: number }): SearchSignal[] {
  const signals: SearchSignal[] = [];
  const text = String(term || "");
  if (SQL.test(text)) signals.push({ code: "sql", label: "Looks like a database query fragment" });
  if (SCRIPT.test(text)) signals.push({ code: "script", label: "Looks like script or markup" });
  if (URL_LIKE.test(text)) signals.push({ code: "url", label: "Contains a web address" });
  if (text.length > LONG_TERM_LENGTH) signals.push({ code: "long", label: `Unusually long (${text.length} characters)` });
  if (REPEATED.test(text)) signals.push({ code: "repeated", label: "The same character repeated many times" });
  if (
    stats.rangeDays > 1 &&
    stats.peakDay >= BURST_MIN_DAY &&
    stats.searches > 0 &&
    stats.peakDay / stats.searches >= BURST_SHARE
  )
    signals.push({ code: "burst", label: `Sudden burst: ${stats.peakDay} of ${stats.searches} searches on one day` });
  return signals;
}

export const SEARCH_VERDICTS = ["confirmed_abuse", "not_abuse"] as const;
export type SearchVerdict = (typeof SEARCH_VERDICTS)[number];

export function isSearchVerdict(value: unknown): value is SearchVerdict {
  return typeof value === "string" && (SEARCH_VERDICTS as readonly string[]).includes(value);
}
