// Which internal paths carry a locale, and adding it to one that should.
//
// Every consumer page lives under app/[locale], and a path without its locale is sent on by the
// middleware (proxy.ts) to whatever language the cookie or the browser names - with no cookie,
// English. So a link built by hand, rather than through next-intl's <Link> or router, has to carry
// the reader's locale itself, or a French reader who taps it lands on the English page.
//
// The routes outside that tree are English-only on purpose and are never prefixed: a locale in
// front of them is a page that does not exist. They are the ones proxy.ts's matcher leaves out,
// which has to stay a literal there, so the list is written twice and tests/locale-links.test.mjs
// holds the two together.
export const UNLOCALIZED_ROUTES = ["admin", "affiliate", "api", "creator", "portal-invite", "portal", "_next", "_vinext"] as const;

const LOCALES = ["en", "fr", "es"];

/**
 * True for a site-relative path to a localized page that does not name its locale yet:
 * "/dashboard/saved", "/", "/?suggest=1". False for "/fr/...", the English-only workspaces, the API,
 * static files, and anything that is not a site-relative path at all.
 */
export function needsLocale(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//")) return false;
  const pathname = path.split(/[?#]/)[0];
  // proxy.ts leaves every path with a dot in it alone: a file, not a page.
  if (pathname.includes(".")) return false;
  const first = pathname.split("/")[1] || "";
  return !LOCALES.includes(first) && !(UNLOCALIZED_ROUTES as readonly string[]).includes(first);
}

/** `path` with `locale` in front of it when it needs one: "/dashboard" in fr is "/fr/dashboard". */
export function localizedPath(path: string, locale?: string | null): string {
  if (!locale || !LOCALES.includes(locale) || !needsLocale(path)) return path;
  // The home page is "/fr", not "/fr/", and its query string follows directly.
  return path === "/" || path.startsWith("/?") || path.startsWith("/#") ? `/${locale}${path.slice(1)}` : `/${locale}${path}`;
}
