"use client";
import { useCallback, type ComponentProps } from "react";
import { useLocale } from "next-intl";
import { Link, usePathname, useRouter } from "../i18n/navigation";
import { useHasSession } from "./has-session";
import { localizedPath } from "./locale-path";

// Which kind of link the site's own pages use, chosen by who is reading.
//
// A link's kind decides what the Worker has to do with the click. A client-side <Link> fetches the
// target's RSC flight, and a flight is rendered for every request: worker/index.ts never answers
// one from a baked file or the colo cache. A plain <a> is a document request, and for a reader
// without Clerk's session cookie the Worker answers nearly every public page's document without a
// render: the baked file for the home page, the static pages, the sign-in and sign-up shells and
// the deal pages (BAKED_PAGES), the colo's copy for /pro (per currency bucket), a not-found page or
// a deal published since the deploy, and for the dashboard a 307 to the baked sign-in page
// (signedOutDashboardRedirect). So signed out, a plain link is the click that costs nothing, where
// a flight costs a render: the footer's dashboard link, as a <Link>, was two (the dashboard's flight
// and then sign-in's), against none.
//
// A reader who carries the cookie is the other way round. isSignedIn in worker/index.ts keeps every
// request of theirs out of the bake and the cache, so each page they open is rendered whichever way
// it is asked for, and the flight is the cheaper render - no HTML pass, and none of the requests a
// page load brings with it (/api/session, the manifest). Measured locally on 2026-10-01, median CPU
// of a signed-in document against its flight: /en 8.0-8.9 ms against 2.3-2.7, /en/terms 7.2-9.1
// against 3.2-4.5, /en/pro 8.1-9.9 against 5.4-6.3, a deal page 10.5-10.9 against 6.7-7.4 - and
// more in production. And a client-side navigation keeps Back
// in the same document. A signed-in page is sent no-store, and Clerk rewrites __session every few
// seconds while the tab has focus, which bars a no-store page from the back/forward cache: Back
// after a page load rendered the page it went back to all over again, and refetched what it shows.
// What a page load gave a screen reader for free, a client-side navigation does not: the browser
// announces no new page and leaves focus where it was. app/RouteAnnouncer.tsx, mounted once in
// RootShell, says the new page's title and moves focus to its <main>.
//
// So the kind is chosen by the same fact the Worker goes by: whether the request this page was
// rendered for carried __session. RootShell reads it (hasSession) and hands it down through a
// context (app/has-session.tsx), so the first render, on the server, already has the right kind.
// /api/session would be a worse source on both counts: it answers after hydration, and it can
// disagree with the cookie (a token that has expired is no user to the API, and still a signed-in
// request to the Worker, which renders it). The HTML that differs by it is never shared: a request
// carrying the cookie is never baked, stored or answered from a store, so the copies every
// signed-out reader gets are always the signed-out render, with plain links. Nothing here makes a
// signed-in page cacheable; it only changes which links that page renders.
//
// The context is the request's, not the moment's. A reader who signs out keeps client-side links
// until their next page load (each one then a flight the Worker renders, as before), and one who
// signs in on the baked sign-in page keeps plain links until theirs (each one a document the Worker
// renders): either way the cost is one render a click, never a wrong page.
//
// Nor for a link to the page the reader is already on. A client-side navigation to the same route
// does not mount its page again, it hands the mounted one new props, and what the home page shows
// is set up once, on mount, from the address (HomeClient reads location.search there and nowhere
// else): signed in on /en?q=wings, the footer's "Browse deals" (href "/") changed the address bar to
// /en and left the wings search and its results on screen, with no request for new ones. Any link
// whose path is the current page's, whatever its query or place on the page, is a plain <a> for
// every reader. Signed in, that click is a document the Worker renders, which is what it cost before
// these links were client-side; a link to a place on the page itself ("#results") was always plain.
// usePathname is next-intl's, without the locale, so the server render already knows the page.
//
// Not for every link to a page under the locale. A link whose target does its work when the locale
// layout first mounts has to stay a page load for everyone: the deal page's creator byline, whose
// ?c= CreatorLink records once, as the layout mounts, which a client-side navigation never does
// again. The language switcher is next-intl's <Link> for both kinds of reader instead, for the
// cookie its click writes (see SiteHeader). The English-only workspaces (/admin, /creator, /portal)
// sit outside the locale tree and are next/link with prefetch={false}, rendered for every request
// whichever way they are reached. tests/chrome-links.test.mjs fails on a client-side link a
// signed-out reader can follow to a page the Worker answers without rendering, and renders these
// both ways.

type ChromeLinkProps = Omit<ComponentProps<"a">, "href"> & {
  /**
   * A page under the reader's locale, written without the locale ("/terms", "/?suggest=1",
   * "/privacy#storage", "/sign-in?redirect_url=..."), which each kind of link localizes its own way;
   * or a place on this page ("#results"), which is the same plain anchor for everyone.
   */
  href: `/${string}` | `#${string}`;
};

/**
 * Whether `href` (a locale-less path, as ChromeLink takes) is the page at `pathname` (next-intl's
 * usePathname, also locale-less), whatever query or place on the page it adds.
 */
export function isCurrentPage(href: string, pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const normal = (path: string) => {
    let decoded = path;
    try { decoded = decodeURI(path); } catch { /* a malformed escape compares as written */ }
    return decoded.replace(/\/+$/, "") || "/";
  };
  return normal(href.split(/[?#]/)[0]) === normal(pathname);
}

/**
 * A link to one of the site's own pages: a plain <a href="/{locale}/..."> for a reader without a
 * session cookie, and next-intl's <Link> with prefetching off for a reader with one, unless it goes
 * to the page the reader is on, which is a plain link for everyone. See above.
 */
export default function ChromeLink({ href, children, ...props }: ChromeLinkProps) {
  const hasSession = useHasSession();
  const locale = useLocale();
  const pathname = usePathname();
  if (href.startsWith("#")) return <a {...props} href={href}>{children}</a>;
  // The home page with a place on it ("/#results") goes to next-intl as an object: as a string it
  // comes out as "/fr/#results", a trailing slash the router would have to be redirected past.
  if (hasSession && !isCurrentPage(href, pathname)) return <Link {...props} href={href.startsWith("/#") ? { pathname: "/", hash: href.slice(1) } : href} prefetch={false}>{children}</Link>;
  return <a {...props} href={localizedPath(href, locale)}>{children}</a>;
}

/**
 * ChromeLink's rule for a navigation started from code (the command palette, a deal card's click):
 * a client-side push for a reader with a session cookie, a page load of the localized address for
 * one without, or for anyone going to the page they are on. Takes the same locale-less paths.
 */
export function useChromeNavigate(): (path: `/${string}`) => void {
  const hasSession = useHasSession();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  return useCallback((path: `/${string}`) => {
    if (hasSession && !isCurrentPage(path, pathname)) router.push(path);
    else window.location.assign(localizedPath(path, locale));
  }, [hasSession, locale, pathname, router]);
}
