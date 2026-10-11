"use client";
import { useLocale, useTranslations } from "next-intl";
import ChromeLink from "./ChromeLink";
import RadarMark from "./RadarMark";
import { SUPPORT_PHONE } from "./business-contact";

// The one footer for every public-facing page. Before this, the home page, the restaurant page
// and the two legal pages each ended in a different hand-rolled <footer>, and the deal detail and
// Pro pages ended in nothing at all — so the site's exits changed shape depending on where you
// landed. A single grouped-column footer with a legal bottom bar is the convention every
// comparable site converged on, and it is also the only way to keep those exits consistent.
//
// Dashboards, the admin workspace and the restaurant portal keep their own chrome and do not use
// this, the same split SiteHeader already follows.
//
// ChromeLinks, for the reason SiteHeader gives (app/ChromeLink.tsx): for a reader without a session
// cookie, plain page loads, which the Worker answers from its baked and cached copies, and for one
// with it, client-side navigations, unprefetched, since every page that reader opens is rendered
// either way and a flight is the cheaper render. As prefetching <Link>s these were rendered as soon
// as the footer came into view: thirteen renders within 65 ms when the home page was scrolled to the
// bottom (measured against the built Worker, 2026-09-30).
//
// The dashboard link is one of them now. It was the one <Link> left here, for every reader, on the
// grounds that the dashboard renders whichever way it is reached; but signed out it no longer does.
// The Worker answers a signed-out reader's page load of /{locale}/dashboard with the 307 to sign-in
// itself (signedOutDashboardRedirect in worker/index.ts), and the sign-in page it leads to is baked:
// no render at all, where the <Link> cost two, the dashboard's flight and then sign-in's.
//
// The paths are written without the locale, which each kind of link adds its own way. What the
// sign-in links return the reader to is written out with it.
function columns(locale: string) {
  // Back to the dashboard after signing in, in the language the reader signed in from.
  const afterSignIn = encodeURIComponent(`/${locale}/dashboard`);
  return [
    { key: "discover", links: [
      { key: "browse", href: "/" },
      { key: "pro", href: "/pro" },
      { key: "suggest", href: "/?suggest=1" },
      { key: "creators", href: "/for-creators" },
      { key: "cities", href: "/cities" },
    ] },
    // "Correct a listing", not "Claim your restaurant": nobody can claim a page yet (the portal is
    // invitation-only, and /for-restaurants says its form creates no ownership). What that page does
    // offer is the form for sending an offer or a correction, which carries id="inquiry".
    { key: "restaurants", links: [
      { key: "list", href: "/for-restaurants" },
      { key: "correct", href: "/for-restaurants#inquiry" },
    ] },
    { key: "account", links: [
      { key: "signIn", href: `/sign-in?redirect_url=${afterSignIn}` },
      { key: "signUp", href: `/sign-up?redirect_url=${afterSignIn}` },
      { key: "dashboard", href: "/dashboard" },
      { key: "support", href: "/support" },
    ] },
    { key: "legal", links: [
      { key: "terms", href: "/terms" },
      { key: "privacy", href: "/privacy" },
      { key: "ageSuitability", href: "/age-suitability" },
    ] },
  ] as const;
}

// `onSuggest` is passed only by the page that actually hosts the suggest modal (HomeClient). The
// href alone was not enough: /?suggest=1 is read once, on mount, so clicking this row from the
// home page — the one page where the modal is already mounted a few nodes up — changed the URL
// and did nothing at all. Every other page still navigates, which mounts the home page and opens
// it there. Same split SiteHeader already makes for the same link.
export default function SiteFooter({ onSuggest }: { onSuggest?: () => void }) {
  const t = useTranslations("siteFooter");
  const locale = useLocale();
  return (
    <footer className="site-footer">
      <div className="site-footer-top">
        <div className="site-footer-brand">
          <ChromeLink className="brand" href="/"><RadarMark />Radar<i>.</i></ChromeLink>
          <p>{t("tagline")}</p>
        </div>
        <nav className="site-footer-nav" aria-label={t("navLabel")}>
          {columns(locale).map((column) => (
            <div key={column.key}>
              {/* A label, not a heading: four "Discover", "Legal"... h2s at the foot of every page
                  were most of the page's outline, beside the page's own sections. Each list is
                  still named by its label for a screen reader. */}
              <p className="site-footer-heading" id={`site-footer-${column.key}`}>{t(`columns.${column.key}.title`)}</p>
              <ul aria-labelledby={`site-footer-${column.key}`}>
                {column.links.map((link) => (
                  // The Pro link sells Pro: hidden where the app may not (app/app-context.ts).
                  <li key={link.key} className={link.key === "pro" ? "purchase-cta" : undefined}>
                    {link.key === "suggest" && onSuggest
                      ? <button type="button" onClick={onSuggest}>{t(`columns.${column.key}.${link.key}`)}</button>
                      : <ChromeLink href={link.href}>{t(`columns.${column.key}.${link.key}`)}</ChromeLink>}
                  </li>
                ))}
                {column.key === "legal" && (
                  <>
                    <li><a href="mailto:support@cedartechsolutions.ca">{t("columns.legal.dataRequests")}</a></li>
                    {/* Published under the AGPL, which has anyone running a modified copy for others offer them
                        its source: a fork points this, and the link in the Terms, at its own. */}
                    <li><a href="https://github.com/0xDrMoe/radar">{t("columns.legal.sourceCode")}</a></li>
                  </>
                )}
                {column.key === "restaurants" && (
                  <li><a href="mailto:support@cedartechsolutions.ca">{t("columns.restaurants.contact")}</a></li>
                )}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="site-footer-bottom">
        <p>{t("copyright", { year: new Date().getFullYear() })}</p>
        {/* Who runs Radar and how to reach them, on every page: Ontario and Quebec want the
            operator's contact details in front of anyone buying Pro online. */}
        <p className="site-footer-contact">
          {t("operatedBy")}{" · "}
          <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>{" · "}
          <a href={`tel:${SUPPORT_PHONE.tel}`}>{SUPPORT_PHONE.display}</a>
        </p>
        {/* The accuracy caveat belongs in the footer of every page, not only in the terms: it is
            the single most important thing for a visitor to know before driving to a restaurant. */}
        <p className="site-footer-disclaimer">{t("disclaimer")}</p>
      </div>
    </footer>
  );
}
