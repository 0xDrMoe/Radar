"use client";
import NextLink from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ChevronDown, Clock, Globe, Heart, LayoutDashboard, LocateFixed, Map as MapIcon, Megaphone, Menu, Search, Sparkles, ShieldCheck, Store, UserPlus, UserRound, X } from "lucide-react";
import RadarMark from "./RadarMark";
import { fetchSession } from "./session-cache";
import ThemeMenu from "./ThemeMenu";
import CommandPalette, { type Command } from "./CommandPalette";
import ChromeLink, { isCurrentPage, useChromeNavigate } from "./ChromeLink";
import { purchaseHidden } from "./app-context";
import { MAIN_CONTENT_ID } from "./main-content";
import { Link, usePathname } from "../i18n/navigation";
import { loadClerkReact } from "./clerk-react";

// Only a signed-in reader is ever shown it, so @clerk/react is fetched for them alone
// (app/clerk-react.ts). A chunk that fails to load leaves the header without the account menu; the
// dashboard link beside it still works.
const UserButton = lazy(() =>
  loadClerkReact().then(
    (module) => ({ default: module.UserButton as ComponentType }),
    () => ({ default: (() => null) as ComponentType }),
  ),
);

// Each language names itself, so this stays fixed regardless of the active locale — the same
// convention used by nearly every language switcher (a French speaker still reads "English").
const languages: { code: "en" | "fr" | "es"; label: string }[] = [
  { code: "en", label: "English" },
  { code: "fr", label: "Français" },
  { code: "es", label: "Español" },
];

type HeaderSession = { role: string; name: string | null } | null;

/** Closes a disclosure when the reader presses anywhere outside it. */
function useCloseOnOutside(open: boolean, ref: React.RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [open, ref, close]);
}


// The one shared nav for every public-facing page (home, deal detail, for-restaurants, terms,
// privacy). Dashboards, the admin workspace, and the restaurant portal keep their own sidebar
// chrome from portal.css — this is deliberately not used there.
//
// Rendered as the page's <header>, outside its <main> (see app/PublicPage.tsx), so it is the
// banner landmark, and it opens with a skip link on every page: to the page's <main> by default,
// or to `skipToId` where a page has a better place to land (the home page's deal list).
//
// The links to the site's own pages are ChromeLinks (app/ChromeLink.tsx), chosen by whether the
// reader carries a session cookie. Without one, each is a plain page load, which the Worker answers
// without a render - the baked home, static and sign-in pages, the colo's copy of /pro, and for the
// dashboard a redirect to the baked sign-in page - where a client-side <Link>'s flight is a render
// every time. With one, the Worker renders every page they open whichever way it is asked for, so
// each is a client-side navigation, unprefetched: the flight is the cheaper render, and Back stays
// in the same document. The command palette follows the same rule (useChromeNavigate).
export default function SiteHeader({
  skipToId,
  onSuggest,
  onNearMe,
  onAvailableNow,
  centerSlot,
  brandHref,
  exploreHref,
}: {
  skipToId?: string;
  onSuggest?: () => void;
  // The home page searches around the reader, or narrows its list to what is on now, without
  // leaving the page. Elsewhere both are links to the home page that ask for the same, which
  // HomeClient reads on load: `near=1` asks for the reader's location once and is then dropped from
  // the address; `availableNow` is the list's own filter, so that link is a list anyone can share.
  onNearMe?: () => void;
  onAvailableNow?: () => void;
  centerSlot?: React.ReactNode;
  // In-page anchors on the home page (#top, #results); everywhere else both lead to the home page
  // in the reader's language. Typed as anchors: a page only ever hands the header a place on itself,
  // and the home page's own address, "/", is ChromeLink's to localize.
  brandHref?: `#${string}`;
  exploreHref?: `#${string}`;
}) {
  const t = useTranslations("nav");
  const tTheme = useTranslations("theme");
  const tCommand = useTranslations("commandPalette");
  const locale = useLocale();
  const pathname = usePathname();
  const navigate = useChromeNavigate();
  const [session, setSession] = useState<HeaderSession>(null);
  // Distinguishes "nobody is signed in" from "we have not asked yet". Without it the header
  // paints Sign in / Create account for a moment on every load and then swaps them for the
  // account controls, which is a flicker every signed-in reader sees on every page.
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [exploreOpen, setExploreOpen] = useState(false);
  const [contributeOpen, setContributeOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const exploreRef = useRef<HTMLDivElement>(null);
  const exploreTriggerRef = useRef<HTMLButtonElement>(null);
  const contributeRef = useRef<HTMLDivElement>(null);
  const contributeTriggerRef = useRef<HTMLButtonElement>(null);
  const langRef = useRef<HTMLDivElement>(null);
  const langTriggerRef = useRef<HTMLButtonElement>(null);
  const langItemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  useEffect(() => {
    // Shared with HomeClient, which asks the same question on the same page load. See
    // app/session-cache.ts. Settles either way: a failed request means we cannot know, and showing
    // the signed-out controls is the only useful thing left to do - they lead somewhere, an empty
    // slot does not.
    fetchSession()
      .then((user) => setSession(user as HeaderSession))
      .finally(() => setSessionLoaded(true));
  }, []);

  const closeExplore = useCallback(() => setExploreOpen(false), []);
  const closeContribute = useCallback(() => setContributeOpen(false), []);
  const closeLang = useCallback(() => setLangOpen(false), []);
  useCloseOnOutside(exploreOpen, exploreRef, closeExplore);
  useCloseOnOutside(contributeOpen, contributeRef, closeContribute);
  useCloseOnOutside(langOpen, langRef, closeLang);

  // The language list is a menu of radio items (the menu-button pattern): opening it moves focus
  // onto the language in use, the arrow keys move between languages, Escape closes it and returns
  // to the button, and Tab leaves it closed. Before, it said role="menu" to a screen reader and then
  // behaved like three loose links, with no items and no arrow keys - a menu announced and then not
  // provided.
  const activeLangIndex = Math.max(0, languages.findIndex(({ code }) => code === locale));
  useEffect(() => {
    if (langOpen) langItemRefs.current[activeLangIndex]?.focus();
  }, [langOpen, activeLangIndex]);
  function onLangTriggerKey(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    setLangOpen(true);
  }
  function onLangMenuKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = langItemRefs.current.filter((item): item is HTMLAnchorElement => Boolean(item));
    const at = items.indexOf(document.activeElement as HTMLAnchorElement);
    const move = (to: number) => { event.preventDefault(); items[(to + items.length) % items.length]?.focus(); };
    if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(items.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      setLangOpen(false);
      langTriggerRef.current?.focus();
    } else if (event.key === "Tab") setLangOpen(false);
  }

  // Where signing in or creating an account returns the reader: their dashboard, in the language
  // they started in. The sign-in page would add the locale to a bare /dashboard itself
  // (app/auth-redirect.ts), but a link says where it goes: ChromeLink localizes the path, and the
  // address inside it is written out with its locale (tests/locale-links.test.mjs).
  const afterSignIn = encodeURIComponent(`/${locale}/dashboard`);

  // The commands navigate the way the header's links do (see above): a page load for a reader
  // without a session cookie, a client-side push for one with it, by the same locale-less paths.
  // The one exception is Explore on the home page, which is a place on this page (#results), and
  // so a jump within it for everyone.
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: "home", label: tCommand("home"), icon: <RadarMark />, run: () => (exploreHref ? window.location.assign(exploreHref) : navigate("/")) },
      { id: "near-me", label: tCommand("nearMe"), icon: <LocateFixed />, run: () => (onNearMe ? onNearMe() : navigate("/?near=1")) },
      { id: "available-now", label: tCommand("availableNow"), icon: <Clock />, run: () => (onAvailableNow ? onAvailableNow() : navigate("/?availableNow=true#results")) },
      { id: "cities", label: tCommand("cities"), icon: <MapIcon />, run: () => navigate("/cities") },
    ];
    if (session) {
      list.push(
        { id: "dashboard", label: tCommand("dashboard"), icon: <LayoutDashboard />, run: () => navigate("/dashboard") },
        { id: "saved", label: tCommand("saved"), icon: <Heart />, run: () => navigate("/dashboard/saved") },
        { id: "alerts", label: tCommand("alerts"), icon: <Megaphone />, run: () => navigate("/dashboard/alerts") },
      );
    } else {
      list.push(
        { id: "sign-in", label: tCommand("signIn"), icon: <UserRound />, run: () => navigate(`/sign-in?redirect_url=${afterSignIn}`) },
        { id: "sign-up", label: tCommand("createAccount"), icon: <UserPlus />, run: () => navigate(`/sign-up?redirect_url=${afterSignIn}`) },
      );
    }
    list.push(
      { id: "suggest", label: tCommand("suggestDeal"), icon: <Megaphone />, run: () => (onSuggest ? onSuggest() : navigate("/?suggest=1")) },
      { id: "for-restaurants", label: tCommand("forRestaurants"), icon: <Store />, run: () => navigate("/for-restaurants") },
    );
    // Not offered in a tab the iOS app opened outside the US storefront (see app/app-context.ts).
    // Only ever read on the client: the palette renders no commands until it is opened.
    if (!purchaseHidden()) list.push({ id: "pro", label: tCommand("pro"), icon: <Sparkles />, run: () => navigate("/pro") });
    return list;
  }, [session, navigate, afterSignIn, exploreHref, onSuggest, onNearMe, onAvailableNow, tCommand]);

  return (
    <header className="site-header">
      <nav className="nav site-nav" aria-label={t("mainLabel")}>
        <a className="skip-link" href={`#${skipToId || MAIN_CONTENT_ID}`}>
          {skipToId ? t("skipToDeals") : t("skipToContent")}
        </a>
        <ChromeLink className="brand" href={brandHref ?? "/"}>
          <RadarMark />
          Radar
          <i>.</i>
        </ChromeLink>
        {/* Below the drawer's width the menu hides every link, so the one thing most readers open
            the site for stays on the bar. Its label is visible text, hidden only on the narrowest
            phones (site-chrome.css), so it is also the control's name. */}
        {onNearMe ? (
          <button type="button" className="nav-quick-near" onClick={onNearMe}>
            <LocateFixed /> <span className="nav-quick-label">{t("nearMe")}</span>
          </button>
        ) : (
          <ChromeLink className="nav-quick-near" href="/?near=1">
            <LocateFixed /> <span className="nav-quick-label">{t("nearMe")}</span>
          </ChromeLink>
        )}
        <button
          className="nav-burger"
          aria-label={mobileOpen ? t("closeMenu") : t("openMenu")}
          aria-expanded={mobileOpen}
          aria-controls="site-nav-links"
          onClick={() => setMobileOpen((open) => !open)}
        >
          {mobileOpen ? <X /> : <Menu />}
        </button>
        {centerSlot}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- closing the mobile menu on an inside click is a mouse/touch convenience; every actual control here (links, buttons) already has its own keyboard support */}
        <div
          id="site-nav-links"
          className={`nav-links${mobileOpen ? " open" : ""}`}
          onClick={() => setMobileOpen(false)}
        >
          <div className="nav-primary">
            {/* A disclosure of the ways into the deals, each with a line saying what it does. In the
                drawer its button is hidden and the list is always shown (site-chrome.css), so on a
                phone each is one tap from the menu rather than two. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the disclosure from any control inside it */}
            <div
              className="nav-dropdown explore-dropdown"
              ref={exploreRef}
              onKeyDown={(e) => {
                if (e.key !== "Escape" || !exploreOpen) return;
                setExploreOpen(false);
                exploreTriggerRef.current?.focus();
              }}
            >
              <button
                ref={exploreTriggerRef}
                type="button"
                className="nav-dropdown-trigger"
                aria-expanded={exploreOpen}
                aria-controls="explore-links"
                onClick={(e) => {
                  e.stopPropagation();
                  setExploreOpen((open) => !open);
                }}
              >
                {t("explore")} <ChevronDown />
              </button>
              {/* Always in the page, so the drawer can show it; on the one-row bar it stays out of
                  sight until the button opens it. A class rather than `hidden`, which Tailwind's
                  base styles make impossible for the drawer to override. */}
              <div className={`nav-dropdown-menu explore-menu${exploreOpen ? " open" : ""}`} id="explore-links">
                {onNearMe ? (
                  <button type="button" onClick={() => { setExploreOpen(false); onNearMe(); }}>
                    <LocateFixed /><span>{t("nearMe")}<small>{t("nearMeHint")}</small></span>
                  </button>
                ) : (
                  <ChromeLink href="/?near=1">
                    <LocateFixed /><span>{t("nearMe")}<small>{t("nearMeHint")}</small></span>
                  </ChromeLink>
                )}
                {onAvailableNow ? (
                  <button type="button" onClick={() => { setExploreOpen(false); onAvailableNow(); }}>
                    <Clock /><span>{t("availableNow")}<small>{t("availableNowHint")}</small></span>
                  </button>
                ) : (
                  <ChromeLink href="/?availableNow=true#results">
                    <Clock /><span>{t("availableNow")}<small>{t("availableNowHint")}</small></span>
                  </ChromeLink>
                )}
                <ChromeLink href="/cities" aria-current={isCurrentPage("/cities", pathname) ? "page" : undefined}>
                  <MapIcon /><span>{t("cities")}<small>{t("citiesHint")}</small></span>
                </ChromeLink>
                <ChromeLink href={exploreHref ?? "/"} onClick={() => setExploreOpen(false)}>
                  <Search /><span>{t("allDeals")}<small>{t("allDealsHint")}</small></span>
                </ChromeLink>
              </div>
            </div>
            <ChromeLink href="/pro" className="nav-pro-link purchase-cta" aria-current={isCurrentPage("/pro", pathname) ? "page" : undefined}>{t("pro")}</ChromeLink>
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            {/* A disclosure, not a menu: a button that shows two ordinary links. aria-haspopup told
                screen readers a menu was coming, with arrow keys, and neither was. */}
            {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- Escape closes the disclosure from any control inside it */}
            <div
              className="nav-dropdown"
              ref={contributeRef}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key !== "Escape" || !contributeOpen) return;
                setContributeOpen(false);
                contributeTriggerRef.current?.focus();
              }}
            >
              <button
                ref={contributeTriggerRef}
                type="button"
                className="nav-dropdown-trigger"
                aria-expanded={contributeOpen}
                aria-controls="contribute-links"
                onClick={() => setContributeOpen((open) => !open)}
              >
                {t("contribute")} <ChevronDown />
              </button>
              {contributeOpen && (
                <div className="nav-dropdown-menu" id="contribute-links">
                  {onSuggest ? (
                    <button
                      type="button"
                      onClick={() => {
                        onSuggest();
                        setContributeOpen(false);
                      }}
                    >
                      {t("suggestDeal")}
                    </button>
                  ) : (
                    <ChromeLink href="/?suggest=1" onClick={() => setContributeOpen(false)}>
                      {t("suggestDeal")}
                    </ChromeLink>
                  )}
                  <ChromeLink href="/for-restaurants" onClick={() => setContributeOpen(false)} aria-current={isCurrentPage("/for-restaurants", pathname) ? "page" : undefined}>
                    {t("forRestaurants")}
                  </ChromeLink>
                </div>
              )}
            </div>
          </div>
          <div className="nav-actions">
            {session && (
              <>
                <ChromeLink href="/dashboard/saved">{t("saved")}</ChromeLink>
                <ChromeLink href="/dashboard/alerts">{t("alerts")}</ChromeLink>
              </>
            )}
            {/* The English-only workspaces, outside the locale tree, so next/link rather than
                next-intl's: unprefetched like every other link here (see i18n/navigation.ts). */}
            {(session?.role === "admin" || session?.role === "owner") && (
              <NextLink className="iconbtn adminbtn" href="/admin" title={t("staffWorkspace")} prefetch={false}>
                <ShieldCheck />
              </NextLink>
            )}
            {/* The two account types that have a workspace of their own instead of the admin one.
                Shown on the role alone: each workspace re-checks its real conditions on entry and
                sends anyone who does not meet them back to the dashboard. */}
            {session?.role === "creator" && (
              <NextLink className="iconbtn adminbtn" href="/creator" title={t("creatorWorkspace")} prefetch={false}>
                <Megaphone />
              </NextLink>
            )}
            {session?.role === "restaurant" && (
              <NextLink className="iconbtn adminbtn" href="/portal" title={t("restaurantPortal")} prefetch={false}>
                <Store />
              </NextLink>
            )}
            {/* Driven by /api/session rather than by Clerk's <Show>, which is the same fact read
                twice. Asking Clerk meant every signed-out reader had to download Clerk to be told
                they were signed out; the server already said so in a response the header was
                fetching anyway. */}
            {sessionLoaded && !session && (
              <>
                <ChromeLink className="accountbtn" href={`/sign-in?redirect_url=${afterSignIn}`}>
                  <UserRound /> {t("signIn")}
                </ChromeLink>
                <ChromeLink className="accountbtn signupbtn" href={`/sign-up?redirect_url=${afterSignIn}`}>
                  {t("createAccount")}
                </ChromeLink>
              </>
            )}
            {sessionLoaded && session && (
              <>
                <ChromeLink className="accountbtn" href="/dashboard">
                  <UserRound />
                  {/* Its own box so a long first name can end in an ellipsis (site-chrome.css). */}
                  <span className="accountbtn-label">{session.name?.split(" ")[0] || t("dashboard")}</span>
                </ChromeLink>
                {/* Clerk is mounted whenever a session cookie is present, which is exactly when this
                    branch renders. See app/ClerkClientProvider.tsx. */}
                <Suspense fallback={null}><UserButton /></Suspense>
              </>
            )}
            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
            <div className="nav-dropdown lang-dropdown" ref={langRef} onClick={(e) => e.stopPropagation()}>
              <button
                ref={langTriggerRef}
                type="button"
                className="nav-dropdown-trigger"
                aria-haspopup="menu"
                aria-expanded={langOpen}
                aria-controls="language-menu"
                title={t("language")}
                onClick={() => setLangOpen((open) => !open)}
                onKeyDown={onLangTriggerKey}
              >
                {/* Named "Language: EN" rather than replacing the visible "EN" with "Language",
                    so a voice-control user can say what they see. */}
                <Globe /> <span className="sr-only">{t("language")}: </span>{locale.toUpperCase()} <ChevronDown />
              </button>
              {langOpen && (
                // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- focus lives on the items (roving), as the menu pattern prescribes
                <div className="nav-dropdown-menu" role="menu" id="language-menu" aria-label={t("language")} onKeyDown={onLangMenuKey}>
                  {languages.map(({ code, label }, index) => (
                    // Each language names itself in its own language, so `lang` lets a screen reader
                    // say "Français" in French; hrefLang says the same of the page it leads to.
                    //
                    // next-intl's <Link> for every reader, signed in or not, unlike the ChromeLinks
                    // around it: on the click it writes the NEXT_LOCALE cookie that sends a bare URL
                    // (a digest email's /deals/..., the root) to the language just chosen. A page
                    // load would leave that to the response, and the response does not reliably say
                    // it. A baked page always does (prerenderedPage in worker/index.ts writes the
                    // path's locale), but the colo's copy of a page replays the cookie only if the
                    // render it was stored from set one, and next-intl sets it only for a request
                    // whose NEXT_LOCALE was missing or named another language: a copy of /fr/pro
                    // stored from a French reader's visit carries none, and switching to it would
                    // leave the old language in the cookie. So the switch costs a flight's render,
                    // where a page load could have cost none. next-intl never prefetches a link that
                    // changes the locale.
                    <Link
                      key={code}
                      ref={(node: HTMLAnchorElement | null) => { langItemRefs.current[index] = node; }}
                      href={pathname}
                      locale={code}
                      lang={code}
                      hrefLang={code}
                      role="menuitemradio"
                      aria-checked={code === locale}
                      tabIndex={-1}
                      className={code === locale ? "active" : undefined}
                      onClick={() => setLangOpen(false)}
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <ThemeMenu inline labels={{ colorTheme: tTheme("colorTheme"), light: tTheme("light"), system: tTheme("system"), dark: tTheme("dark") }} />
          </div>
        </div>
        {/* Deliberately outside .nav-links: that div is display:none on mobile until the burger
            menu opens, and being a descendant of a display:none ancestor would have made both the
            trigger button AND the Ctrl/Cmd+K shortcut's own overlay unrenderable on small screens
            — a fixed-position overlay still can't paint once an ancestor is display:none. */}
        <CommandPalette commands={commands} placeholder={tCommand("placeholder")} noMatches={tCommand("noMatches")} />
      </nav>
    </header>
  );
}
