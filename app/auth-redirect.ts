import { localizedPath } from "./locale-path";

// Where the sign-in and sign-up pages send a reader afterwards: the redirect_url they were given if
// it is a path on this site, the fallback if not, in the page's own `locale`.
//
// The locale matters because most links here are next-intl <Link>s, which put it on /sign-in but
// not on the redirect_url inside: the header's "/sign-in?redirect_url=%2Fdashboard" renders as
// /fr/sign-in?redirect_url=%2Fdashboard, and a bare /dashboard afterwards is sent on by the
// middleware to the cookie's language, or English without one. A redirect_url that names its
// language already keeps it, and the English-only workspaces (/admin, /creator, /portal) get none.
export function safeAuthRedirect(search: string, fallback = "/dashboard", locale?: string) {
  const value = new URLSearchParams(search).get("redirect_url");
  if (!value) return localizedPath(fallback, locale);

  try {
    const origin = "https://radar.invalid";
    const url = new URL(value, origin);
    if (url.origin !== origin || !url.pathname.startsWith("/")) return localizedPath(fallback, locale);
    // The output is checked as well as the input, as safeReturnPath in search.ts does. Resolving dot
    // segments can make a protocol-relative path out of one that did not start as one -
    // "/.//evil.example", "/%2e//evil.example" and "/a/..//evil.example" all come out as
    // "//evil.example" - and Clerk would send the reader there after signing in.
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (path.startsWith("//") || path.startsWith("/\\")) return localizedPath(fallback, locale);
    return localizedPath(path, locale);
  } catch {
    return localizedPath(fallback, locale);
  }
}
