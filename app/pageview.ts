// Counting page views without recording anyone (drizzle/0062_pageviews.sql, app/api/pageview).
//
// Everything here reduces what a browser reports to a small fixed set of buckets, because the table
// it feeds must not be able to grow with what a caller sends: a forged path or referrer lands in
// "other", never in a row of its own.

export const PAGE_KINDS = ["home", "deal", "guide", "page", "other"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

const LOCALES = new Set(["en", "fr", "es"]);
// Pages of the site that are not a deal, the guide or the home page.
const STATIC_PAGES = new Set(["pro", "for-restaurants", "for-creators", "support", "terms", "privacy", "age-suitability", "launch", "sign-in", "sign-up", "dashboard"]);

/** The locale and kind of a public path, or null when it is not a public page worth counting. */
export function classifyPath(path: string): { locale: string; kind: PageKind } | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const segments = path.split(/[?#]/)[0].split("/").filter(Boolean);
  const locale = segments[0];
  if (!locale || !LOCALES.has(locale)) return null;
  const [, section, rest] = segments;
  if (!section) return { locale, kind: "home" };
  if (section === "deals" && rest && segments.length === 3) return { locale, kind: "deal" };
  if (section === "cities" && segments.length <= 4) return { locale, kind: "guide" };
  if (section === "ottawa" && segments.length <= 3) return { locale, kind: "guide" };
  if (STATIC_PAGES.has(section) && segments.length === 2) return { locale, kind: "page" };
  return { locale, kind: "other" };
}

// Where a visit came from, as the handful of sources worth telling apart. A search engine and a
// social network are different questions from "somebody linked it"; everything else outside is one
// bucket, because the long tail of referrers is neither actionable nor safe to store verbatim.
const SOURCES: ReadonlyArray<readonly [string, RegExp]> = [
  ["google", /(^|\.)google\./],
  ["bing", /(^|\.)bing\.com$/],
  ["duckduckgo", /(^|\.)duckduckgo\.com$/],
  ["brave", /(^|\.)search\.brave\.com$/],
  ["yahoo", /(^|\.)yahoo\./],
  ["facebook", /(^|\.)(facebook|fb)\.com$|(^|\.)l\.facebook\.com$/],
  ["instagram", /(^|\.)instagram\.com$/],
  ["reddit", /(^|\.)reddit\.com$/],
  ["x", /(^|\.)(x|twitter)\.com$|^t\.co$/],
  ["tiktok", /(^|\.)tiktok\.com$/],
  ["youtube", /(^|\.)youtube\.com$|^youtu\.be$/],
  ["linkedin", /(^|\.)linkedin\.com$|^lnkd\.in$/],
  ["ai", /(^|\.)(chatgpt\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/],
];

export const SOURCE_NAMES = ["direct", "internal", "other", ...SOURCES.map(([name]) => name)] as const;

/** The bucket a referrer falls in, given the host the page was served from. */
export function classifySource(referrer: unknown, host: string): string {
  if (typeof referrer !== "string" || !referrer) return "direct";
  let hostname: string;
  try { hostname = new URL(referrer).hostname.toLowerCase(); } catch { return "other"; }
  const own = host.split(":")[0].toLowerCase();
  if (hostname === own || hostname === `www.${own}` || hostname.endsWith(`.${own}`)) return "internal";
  // The AI assistants first: gemini.google.com would otherwise be counted as Google search.
  const ai = SOURCES.find(([name]) => name === "ai");
  if (ai && ai[1].test(hostname)) return "ai";
  return SOURCES.find(([, pattern]) => pattern.test(hostname))?.[0] ?? "other";
}

/** A request whose user agent says it is a machine: not a view, whatever ran the script. */
export function looksAutomated(userAgent: string | null): boolean {
  return !userAgent || /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor|curl|wget|python|node-fetch|axios/i.test(userAgent);
}
