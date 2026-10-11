"use client";
import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { Fragment, useEffect, useState } from "react";
import { Ban, Bell, Clock3, CreditCard, Heart, LayoutDashboard, MapPin, Megaphone, MessageSquarePlus, Settings, ShieldCheck, Store, UserRound } from "lucide-react";
import { dashboardGroups, type DashboardSection } from "./sections";
import RadarMark from "../../RadarMark";
import RadarScan from "../../RadarScan";
import { applyAccent, storeAccent } from "../../applyAccent";
import { isAccentKey } from "../../theme-accents";
import ChromeLink from "../../ChromeLink";
import { purchaseHidden } from "../../app-context";
import { Link, useRouter } from "../../../i18n/navigation";
import { DEFAULT_RADIUS_KM, maxRadiusKm } from "../../radius";
import { hasProAccess } from "../../entitlement";
import { useApiErrorText, type ApiErrorBody } from "../../api-error-text";
import { MAIN_CONTENT_ID } from "../../main-content";
import { nearbyScope, type DashboardData, type MutatePayload, type MutateResult, type PublicDeal, type SavedLocation, type SectionProps, type UserProfile } from "./dashboard-shared";
import OverviewSection from "./sections/OverviewSection";
import SavedSection from "./sections/SavedSection";
import AreasSection from "./sections/AreasSection";
import HiddenRestaurantsSection from "./sections/HiddenRestaurantsSection";
import AlertsSection from "./sections/AlertsSection";
import HistorySection from "./sections/HistorySection";
import ContributionsSection from "./sections/ContributionsSection";
import AccountSection from "./sections/AccountSection";
import BillingSection from "./sections/BillingSection";
import PrivacySection from "./sections/PrivacySection";

const sectionIcons: Record<DashboardSection,typeof Heart> = {
  overview:LayoutDashboard, saved:Heart, areas:MapPin, preferences:Ban, alerts:Bell, history:Clock3,
  contributions:MessageSquarePlus, account:UserRound, billing:CreditCard, privacy:Settings,
};

// A failure whose text was already chosen for the reader. Anything else a request can throw, such
// as the browser's "Failed to fetch" or a JSON parse error on an HTML error page, is in English
// and says nothing a reader can act on, so the catch blocks show their translated fallback instead.
class ShownError extends Error {}

/** The local feed, which the overview and the hide-a-restaurant picker need and nothing else does. */
interface Nearby { deals: PublicDeal[]; total: number; area: { postal:string; radius:number; label:string|null } | null }

export default function DashboardClient({ initialSection, canAdminister, canManageRestaurant, isCreator }:{ initialSection:DashboardSection; canAdminister?:boolean; canManageRestaurant?:boolean; isCreator?:boolean }) {
  const t = useTranslations("dashboard");
  const tNav = useTranslations("nav");
  const apiErrorText = useApiErrorText();
  // The <Link>s, ChromeLinks and pushes here are client-side navigations, unprefetched
  // (i18n/navigation.ts, and prefetch={false} on the next/link ones). Only a reader with Clerk's
  // session cookie gets this page - the Worker answers anyone else's request for it with a redirect
  // to sign-in - and that reader's requests skip the colo cache and the baked pages, so every page
  // they open is a render whichever way it is reached, and a flight is the cheaper render. It also
  // keeps Back in the same document: a signed-in page is sent no-store, and once Clerk has rewritten
  // the cookie (it does every few seconds while the tab has focus) the browser will not restore one
  // from its back/forward cache, so Back after a page load rendered the page all over again.
  const router = useRouter();
  const [data,setData] = useState<DashboardData|null>(null),[nearby,setNearby] = useState<Nearby>({ deals:[], total:0, area:null }),[error,setError] = useState(""),[notice,setNotice] = useState(""),[busy,setBusy] = useState(""),[undoArea,setUndoArea] = useState<SavedLocation|null>(null);
  // Pulls the account's saved theme/accent down into this browser's localStorage and applies
  // them immediately — the mechanism that makes appearance "global": a device that has never
  // customized these locally adopts whatever was last saved from any other device.
  function syncAppearance(profile:UserProfile) {
    const nextTheme = profile.theme === "light" || profile.theme === "dark" || profile.theme === "system" ? profile.theme : "dark";
    const nextAccent = isAccentKey(profile.accent_color) ? profile.accent_color : "coral";
    localStorage.setItem("radar-theme",nextTheme); storeAccent(nextAccent);
    const resolved = nextTheme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : nextTheme;
    document.documentElement.dataset.theme = resolved; applyAccent(nextAccent,resolved);
  }
  async function load() {
    try {
      const userResponse = await fetch("/api/user");
      const userResult = await userResponse.json() as DashboardData & ApiErrorBody;
      if (!userResponse.ok) throw new ShownError(apiErrorText.message(userResult,t("dashboardUnavailable")));
      // Saved deals come with the account now (/api/user reads them from the deals themselves), so
      // the only deal list this page still asks for is the local feed, and only on the two sections
      // that show it: the overview, and the picker that hides a restaurant from your results. Every
      // other section is one request.
      const wantsFeed = initialSection === "overview" || initialSection === "preferences";
      const scope = nearbyScope(userResult);
      const pro = hasProAccess(userResult.profile.plan, userResult.profile.plan_status, userResult.profile.past_due_since, new Date(), userResult.profile.paused_until, userResult.profile.role);
      const radius = Math.min(scope?.radius || DEFAULT_RADIUS_KM, maxRadiusKm(pro));
      // chains=separate, as the homepage asks: the local list leaves the national chains out.
      // Without it an area's feed opened on McDonald's and Tim Hortons, which reads as paid
      // placement, and the chains are something a reader turns on, never something led with.
      // With no area on file the picker falls back to the recommended list, which is then what the
      // reader is being shown; the overview never does, and says so instead.
      const feedUrl = !wantsFeed ? null
        : scope ? `/api/deals?limit=50&sort=recommended&chains=separate&postal=${encodeURIComponent(scope.postal)}&radius=${radius}`
        : initialSection === "preferences" ? "/api/deals?limit=50&sort=recommended" : null;
      // A local feed that fails is a missing section, not a broken dashboard: an unrecognized
      // postal 422s here, and that must not take the rest of the page down with it.
      let next:Nearby = { deals:[], total:0, area:null };
      const feedResponse = feedUrl ? await fetch(feedUrl).catch(() => null) : null;
      if (feedResponse?.ok) {
        const feed = await feedResponse.json() as { results?: PublicDeal[]; totalMatches?: number };
        next = { deals:feed.results || [], total:feed.totalMatches ?? feed.results?.length ?? 0, area:scope ? { postal:scope.postal, radius, label:scope.label } : null };
      }
      setData(userResult); setNearby(next);
      setError(""); syncAppearance(userResult.profile);
    } catch (cause) { setError(cause instanceof ShownError ? cause.message : t("couldNotLoad")); }
  }
  useEffect(() => {
    // Data fetch on mount: setState happens after the awaited fetch resolves, not
    // synchronously in the effect body — a standard, legitimate data-loading effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // load is a plain function re-created every render (not memoized), so listing it here would
    // re-run this mount-only fetch on every render instead of once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  // The rail exists only once the dashboard has loaded; before that the page is the loading card.
  const loaded = data !== null;
  useEffect(() => {
    // On a phone the sections are a rail that scrolls sideways (refinements.css), and the one
    // you are on can start past its right edge. Scrolled within the rail only, so the page does
    // not move.
    const nav = document.querySelector<HTMLElement>(".portal aside nav");
    const active = nav?.querySelector<HTMLElement>("a.active");
    if (nav && active && nav.scrollWidth > nav.clientWidth) nav.scrollLeft += active.getBoundingClientRect().left - nav.getBoundingClientRect().left - (nav.clientWidth - active.offsetWidth) / 2;
  },[initialSection,loaded]);
  useEffect(() => {
    // Stripe Checkout's success_url; one-time welcome notice, then drop the param so a refresh
    // or share of the URL doesn't keep re-showing it.
    if (!new URLSearchParams(window.location.search).has("upgraded")) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotice(t("welcomeToPro"));
    window.history.replaceState(null,"",window.location.pathname);
  },[t]);
  async function mutate(payload:MutatePayload,message:string) {
    setBusy(payload.action + (payload.id ? `-${payload.id}` : "")); setNotice("");
    try {
      const response = await fetch("/api/user",{ method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload) });
      const result = await response.json().catch(() => ({})) as MutateResult & ApiErrorBody;
      if (!response.ok) throw new ShownError(apiErrorText.message(result,t("changeCouldNotBeSaved")));
      setNotice(message); return result;
    } catch (cause) { setNotice(cause instanceof ShownError ? cause.message : t("changeCouldNotBeSaved")); return null; }
    finally { setBusy(""); }
  }
  // Every upgrade prompt on this page ends here or at ProUpsell's link. Neither goes anywhere in a
  // tab the iOS app opened outside the US storefront, where the app may not sell Pro through the
  // website (app/app-context.ts); the prompts themselves are hidden there by `purchase-cta`.
  function upgrade() { if (purchaseHidden()) return; router.push("/pro"); }
  async function undoRemoval() {
    if (!undoArea) return;
    if (await mutate({action:"location",label:undoArea.label,postal:undoArea.postal,radius:undoArea.radius},t("areas.areaRestored"))) { setUndoArea(null); await load(); }
  }
  // Before the dashboard has loaded, the card is the page's content, so it is the page's one <main>.
  if (error) return <main id={MAIN_CONTENT_ID} tabIndex={-1} className="portal-loading portal-error"><Heart/><h1>{t("errorTitle")}</h1><p>{error}</p><button onClick={load}>{t("tryAgain")}</button><Link href="/">{t("backToDeals")}</Link></main>;
  if (!data) return <main id={MAIN_CONTENT_ID} tabIndex={-1} className="portal-loading"><div className="portal-loading-body"><RadarScan /><p>{t("preparingDashboard")}</p></div></main>;
  const p = data.profile;
  const pro = hasProAccess(p.plan, p.plan_status, p.past_due_since, new Date(), p.paused_until, p.role);
  const props:SectionProps = { data, pro, busy, mutate, reload:load, setNotice, upgrade };
  const label = (key:DashboardSection) => t(`nav.${key}`);
  const navLink = (key:DashboardSection) => { const Icon = sectionIcons[key]; return <ChromeLink key={key} className={initialSection === key ? "active" : ""} aria-current={initialSection === key ? "page" : undefined} href={key === "overview" ? "/dashboard" : `/dashboard/${key}`}><Icon/>{label(key)}{key === "billing" && pro && <i>{t("account.proBadge")}</i>}</ChromeLink>; };
  const workspaces = canManageRestaurant || isCreator || canAdminister;
  // The dashboard keeps its own sidebar chrome instead of SiteHeader, so it opens with the site's
  // skip link itself: first on the page, past the section rail, to the content column. That column
  // is the page's one <main>, and it takes focus from the link without joining the tab order, as
  // PublicPage's does. The rail is grouped by what somebody came to do (sections.ts). The group
  // headings are visual only, as in the staff workspace: every link already names its section, and
  // a heading read between links would be read on every pass along the rail.
  return <div className="portal">
    <a className="skip-link" href={`#${MAIN_CONTENT_ID}`}>{tNav("skipToContent")}</a>
    <aside className="dash-rail"><Link className="brand" href="/"><RadarMark />Radar<i>.</i></Link><nav aria-label={t("nav.label")}>{navLink("overview")}{dashboardGroups.map((group) => <Fragment key={group.key}><span className="nav-group" aria-hidden="true">{t(`nav.group.${group.key}`)}</span>{group.sections.map(navLink)}</Fragment>)}{workspaces && <span className="nav-group" aria-hidden="true">{t("nav.group.workspaces")}</span>}{canManageRestaurant && <NextLink href="/portal" prefetch={false}><Store/>{t("nav.restaurantPortal")}</NextLink>}{isCreator && <NextLink href="/creator" prefetch={false}><Megaphone/>{t("nav.creatorWorkspace")}</NextLink>}{canAdminister && <NextLink href="/admin" prefetch={false}><ShieldCheck/>{t("nav.staffWorkspace")}</NextLink>}</nav><Link className="backlink" href="/">{t("nav.browseDeals")}</Link></aside>
    <main id={MAIN_CONTENT_ID} tabIndex={-1} className="portal-main" data-section={initialSection}><header><div><span className="kicker">{t("kicker")}</span><h1>{initialSection === "overview" ? (p.name ? t("welcomeBack",{name:p.name.split(" ")[0]}) : t("welcomeBackNoName")) : label(initialSection)}</h1><p>{initialSection === "overview" ? t("subtitle") : t(`sectionIntro.${initialSection}`)}</p></div><div className="profile-chip"><span>{(p.name || p.email)[0].toUpperCase()}</span><div><b>{p.name || p.email.split("@")[0]}</b><small>{pro ? t("account.radarPro") : t("account.freePlan")}</small></div></div></header>
      {/* Always mounted: mutate() clears the notice before setting it, and a live region that is
          removed and re-inserted already holding its text is often not read at all. */}
      <div className="sr-only" role="status" aria-live="polite">{notice}</div>
      {notice && <div className="admin-notice">{notice}{undoArea && <button onClick={undoRemoval}>{t("undo")}</button>}<button aria-label={t("dismiss")} onClick={() => {setNotice("");setUndoArea(null);}}>×</button></div>}
      {initialSection === "overview" && <OverviewSection {...props} nearby={nearby}/>}
      {initialSection === "saved" && <SavedSection {...props}/>}
      {initialSection === "areas" && <AreasSection {...props} onRemoved={(area) => { setUndoArea(area); window.setTimeout(() => setUndoArea(null),10000); }}/>}
      {initialSection === "preferences" && <HiddenRestaurantsSection {...props} candidates={nearby.deals} localFeed={!!nearby.area}/>}
      {initialSection === "alerts" && <AlertsSection {...props}/>}
      {initialSection === "history" && <HistorySection {...props}/>}
      {initialSection === "contributions" && <ContributionsSection/>}
      {initialSection === "account" && <AccountSection {...props}/>}
      {initialSection === "billing" && <BillingSection {...props}/>}
      {initialSection === "privacy" && <PrivacySection {...props}/>}
      <footer><span>{t("footer.controls")}</span><span>{t("footer.privacyNote")}</span></footer>
    </main>
  </div>;
}
