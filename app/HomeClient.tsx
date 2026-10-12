"use client";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import ChromeLink, { useChromeNavigate } from "./ChromeLink";
import BrandLogo from "./BrandLogo";
import BranchPicker from "./BranchPicker";
import { BRANCH_SEARCH_MIN, type BranchOption } from "./branch-search";
import { fetchSession } from "./session-cache";
import SiteFooter from "./SiteFooter";
import CardMedia from "./CardMedia";
import InfoTip from "./InfoTip";
import SiteHeader from "./SiteHeader";
import Turnstile, { useLazyTurnstile } from "./Turnstile";
import { useTypewriter, useTypewriterAfterIntro } from "./Typewriter";
import { MAIN_CONTENT_ID } from "./main-content";
import { useApiErrorText, type ApiErrorBody } from "./api-error-text";
import { dateFormatLocale, dealTagLabel, verificationState, verificationStatusLabel, expiringSoonLabel, endDateLabel, MAX_PRICE_TIER, narrowPriceTier, priceTierSymbol, priceTierLabel, hasExpired, parseSqlTimestamp } from "./verification";
import { allowedRadii, DEFAULT_RADIUS_KM } from "./radius";
import { categoryLabel, cuisineLabel } from "./i18n/staticEnums";
import { dealLabels } from "./i18n/dealLabels";
import { hasProAccess } from "./entitlement";
import { POSTAL_STORAGE_KEY, RETURN_STORAGE_KEY } from "./return-path";
import NationalDeals from "./NationalDeals";
import RedemptionPill from "./RedemptionPill";
import { marketOf, type Market } from "./redemption";
import { guessMarket, parseMarket, readerTimezone, rememberMarket, storedMarket } from "./market";
import {
  ArrowUp,
  Bell,
  CalendarClock,
  Clock3,
  Heart,
  History,
  LocateFixed,
  MapPin,
  Pause,
  Play,
  Search,
  Send,
  Share2,
  Shuffle,
  Sparkles,
  Star,
  UserRound,
  X,
} from "lucide-react";

type CreatorPick = { id: string; slug: string; emoji: string; restaurant: string; title: string; note: string | null };
type CreatorPicks = { creator: { handle: string; name: string }; picks: CreatorPick[] };

/**
 * Whose picks to show, if anyone's.
 *
 * The link wins over the cookie. Somebody who has just arrived from one creator should see that
 * creator, even if a different one brought them here last month - the same rule app/CreatorLink.tsx
 * applies when it overwrites the cookie a moment later.
 *
 * The cookie is the fallback rather than the source, so a reader who followed a creator's link on
 * Monday still gets their rail on Thursday. Read here rather than on the server because the whole
 * page is cached: a rail that varied by cookie server-side would make this page uncacheable for a
 * feature that is at most twelve rows deep.
 */
function creatorForPicks(): string {
  const fromLink = (new URLSearchParams(location.search).get("c") || "").trim().toLowerCase();
  if (fromLink) return fromLink;
  const cookie = document.cookie.split("; ").find((entry) => entry.startsWith("radar_creator="));
  return cookie ? decodeURIComponent(cookie.slice("radar_creator=".length)).trim().toLowerCase() : "";
}

const RECENT_KEY = "radar:recent";
type RecentDeal = { id: string; slug?: string; restaurant: string; title: string; emoji: string };
function loadRecentlyViewed(): RecentDeal[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function pushRecentlyViewed(deal: { id: string; slug?: string; restaurant: string; title: string; emoji: string }) {
  try {
    const list = loadRecentlyViewed().filter((item) => item.id !== deal.id);
    list.unshift({ id: deal.id, slug: deal.slug, restaurant: deal.restaurant, title: deal.title, emoji: deal.emoji });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 6)));
  } catch {
    /* localStorage unavailable (e.g. private browsing) — recently viewed just won't persist */
  }
}
// Whether the reader has asked to see the national chains (NationalDeals). Off until they do: a
// panel of McDonald's and Boston Pizza above the local list read as a paid placement, which it is
// not, and it put the one restaurant a reader could not have found without Radar below the ones
// they pass every day. Kept on this device, like the country choice.
const CHAINS_KEY = "radar:chains";
function storedShowChains() {
  try {
    return localStorage.getItem(CHAINS_KEY) === "1";
  } catch {
    return false;
  }
}
type LocationOffer = { id: string; slug?: string; title: string; price: string; schedule: string; category: string; address: string; city: string; source_url: string; available_today?: boolean };
type ChainLocation = { city: string; address: string; postal_prefix: string; source_url: string; offer_available?: boolean; offer?: LocationOffer | null; offers?: LocationOffer[] };
type Deal = {
  id: string;
  restaurant: string;
  title: string;
  category: string;
  category_label?: string;
  cuisine: string;
  cuisine_label?: string;
  save_count?: number;
  schedule: string;
  city: string;
  postal_prefix: string;
  address: string;
  price: string;
  price_tier: number | null;
  emoji: string;
  source_url: string;
  sponsored: number;
  active: number;
  status: string;
  effective_verification_status: string;
  verified_at: string;
  created_at: string;
  expires_at: string | null;
  // The zone expires_at's date is read in (app/verification.ts, expiryTimeZone).
  expiry_timezone?: string | null;
  terms: string | null;
  restrictions: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  restaurant_website: string | null;
  restaurant_photo_url?: string | null;
  amenities: string;
  dietary_options: string;
  accessibility: string;
  is_chain: boolean;
  hidden_gem: boolean;
  vertical: string;
  chain_brand: string | null;
  chain_location_count: number;
  /** Branches running the offer. Counted by the API before it capped the array below. */
  participating_location_count?: number;
  chain_locations: ChainLocation[];
  participating_locations?: ChainLocation[];
  other_brand_locations?: ChainLocation[];
  brand_offers?: LocationOffer[];
  offer_varies_by_location?: boolean;
  search_keywords: string;
  slug?: string;
  distance_km?: number | null;
  availability?: string;
  available_today?: boolean;
  available_now?: boolean;
  availability_phase?: "now" | "upcoming" | "ended" | "unavailable";
  /** On tonight in the venue's zone, computed by the API from the schedule - not the stored category. */
  tonight?: boolean;
  /** Where the offer is priced: 'US' or 'CA'. */
  country?: string | null;
  /** How it is redeemed - see app/redemption.ts. */
  redemption?: string | null;
  redemption_note?: string | null;
  promo_code?: string | null;
  photo_url?: string | null;
  restaurant_logo_url?: string | null;
};
// Price tiers travel in the URL as a comma list ("1,2") so a filtered view stays shareable.
// Anything that isn't a whole 1-5 is dropped rather than defaulting, so a hand-edited URL can
// never select a tier the UI has no chip for.
// Formatted in the browser, so it lands in the reader's timezone, and against the locale they
// actually chose rather than whatever their browser happens to be set to — a reader on /fr with
// an en-US browser was getting American date order.
function readerDate(value: string | null | undefined, locale: string) {
  if (!value) return "";
  const date = parseSqlTimestamp(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(dateFormatLocale(locale), { month: "short", day: "numeric", year: "numeric" });
}

const PRICE_TIERS = Array.from({ length: MAX_PRICE_TIER }, (_, index) => index + 1);
// A link written while the site had five tiers still filters: ?priceTier=4 is narrowed to $$$
// rather than dropped, which would have quietly shown the whole catalog instead.
function parsePriceTiers(value: string | null) {
  if (!value) return [];
  return Array.from(new Set(value.split(",").map((part) => narrowPriceTier(Number(part.trim())))))
    .filter((tier): tier is number => tier != null)
    .sort((a, b) => a - b);
}

// Fast food or a sit-down meal, read off restaurants.service_style.
const SERVICE_STYLES = ["quick", "sit_down"] as const;
type ServiceStyle = (typeof SERVICE_STYLES)[number];
function parseServiceStyles(value: string | null): ServiceStyle[] {
  if (!value) return [];
  return SERVICE_STYLES.filter((style) => value.split(",").map((part) => part.trim()).includes(style));
}

type Session = {
  id: string;
  email: string;
  name: string;
  role: string;
  plan: string;
  plan_status: string;
  past_due_since: string | null;
  paused_until: string | null;
  home_postal: string | null;
  alerts_enabled: number;
  alert_days: string;
  alert_time: string;
  distance_unit: string;
  country: string;
};
type ResolvedLocation = {
  postal?: string;
  neighborhood?: string | null;
  city: string;
  region: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
  accuracy: "postal" | "city" | "device";
};
type SessionResponse = { user: Session | null };
type UserResponse = { favorites?: string[] };
// A deals request that failed in a way somebody wrote a sentence for. The class exists so the
// catch can tell those apart from everything else: a message this code composed is safe to put in
// front of a visitor, and an arbitrary Error's message is not.
class DealsLoadError extends Error {}

type DealsResponse = {
  results?: Deal[];
  uniqueOfferCount?: number;
  cityCount?: number;
  nextCursor?: string | null;
  totalMatches?: number;
  latestVerificationDate?: string | null;
  resolvedLocation?: ResolvedLocation | null;
  resolvedCity?: string | null;
  coverage?: "covered" | "established" | "limited" | "no_coverage";
  error?: { code?: string; message?: string };
};
const cats =["All deals", "Happy hour", "Food deal", "Tonight"];
// What each popular chip searches for. The words stay English because the catalogue is: deal text
// is not translated (the DeepL pass never ran), so "huîtres" would match nothing. Only the chip's
// label is the reader's language (home.filters.popularTerms), and the search box shows the term
// actually searched, so what a French reader sees in it is what matched.
const popularSearches = ["oysters", "cocktails", "wings", "pizza", "patio"];
// The quick-city chips, by their key in cityCenters; each one's label is translated
// (home.cityChips), which is how a French reader gets Montréal rather than Montreal.
// Only places with a real number of listings (2026-10-02: Ottawa 70 cards, Calgary 10, London and
// Saskatoon about as many; Toronto, Montreal, Vancouver, New York, Chicago and Seattle 2 to 7). A
// chip for a city that answers with three cards promises coverage the catalogue does not have. A
// reader can still type any city or postal code. Ottawa leads because it is where Radar is deep.
//
// Each carries its province, which is how its city guide is found (cityGuides): London ON, not KY.
const quickCities = [
  ["Ottawa", "ottawa", "ON"],
  ["Calgary", "calgary", "AB"],
  ["London", "london", "ON"],
  ["Saskatoon", "saskatoon", "SK"],
] as const;
// A reader who turned the hero's motion off, remembered on this device.
const MOTION_KEY = "radar:motion";
// Deal categories the navbar switcher can scope the site to. Only "restaurant" has any
// data today — the rest render a coming-soon panel — but adding a new one here is enough
// to expose it in the nav; see the "vertical" filter in app/api/deals/route.ts.
const verticals = [
  { key: "restaurant", labelKey: "restaurants", emoji: "🍽️" },
  { key: "retail", labelKey: "retail", emoji: "🛍️" },
] as const;
type VerticalKey = (typeof verticals)[number]["key"];
const defaultVertical: VerticalKey = "restaurant";
function parseVertical(value: string | null): VerticalKey {
  return verticals.some((v) => v.key === value) ? (value as VerticalKey) : defaultVertical;
}
const cityCenters: Record<string, [number, number]> = {
  Toronto: [43.6532, -79.3832],
  Montreal: [45.5019, -73.5674],
  Vancouver: [49.2827, -123.1207],
  Calgary: [51.0447, -114.0719],
  Edmonton: [53.5461, -113.4938],
  Ottawa: [45.4215, -75.6972],
  Gatineau: [45.4765, -75.7013],
  Hamilton: [43.2557, -79.8711],
  London: [42.9849, -81.2453],
  Windsor: [42.3149, -83.0364],
  Waterloo: [43.4643, -80.5204],
  Barrie: [44.3894, -79.6903],
  Winnipeg: [49.8951, -97.1384],
  "Quebec City": [46.8139, -71.208],
  "New York": [40.7128, -74.006],
  Chicago: [41.8781, -87.6298],
  Seattle: [47.6062, -122.3321],
  Saskatoon: [52.1332, -106.67],
};
// These example queries are proper nouns/search terms (cities, postal codes, dish names) —
// kept in English for all locales like popularSearches above, matching the original i18n
// plan's decision that locale-aware search terms are out of scope. The "Try" in front of them is
// not a search term, and is translated (home.hero.searchTry).
const INTENT_QUERIES = ["“sushi happy hour”", "“$5 wings”", "“patio brunch”", "“oyster night”"];
const WHERE_QUERIES = ["“Ottawa”", "“K1P 5J8”", "“Knoxville”", "“90210”"];
// The offers a chain card should actually list.
//
// A chain collapses to one card per brand (app/api/deals/route.ts keys the group on
// canonical_restaurant_id), and the card was then rendered from the one deal that happened to
// represent the group - so Montana's, which runs Wing Monday, Taco Tuesday, rib Wednesday and a
// Thursday platter at the same address, advertised Wing Monday and nothing else. The other three
// were reachable only by opening the card and changing location.
//
// The card's address is already the nearest participating one (route.ts moves `address` there as
// it groups), and that location carries its own `offers`. Those are the right ones to list: the
// brand's offers in another city are on `brand_offers` too, and listing a Kingston special on an
// Ottawa card would be worse than listing one.
//
// Not only chains: an independent running a different special each night is one card per address
// too now, with its nights on that address's `offers`, and a single-offer card has a list of one.
function offersForCard(deal: Deal): LocationOffer[] {
  const here = deal.chain_locations?.find((location) => location.address === deal.address);
  const offers = here?.offers?.length ? here.offers : deal.brand_offers || [];
  // One brand can run the same offer at several addresses; the card is about what is on, not
  // where, so identical ones collapse.
  const seen = new Set<string>();
  return offers.filter((offer) => {
    const key = `${offer.schedule}|${offer.title}|${offer.price}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function kmBetween(a: [number, number], b: [number, number]) {
  const r = 6371,
    toRad = (v: number) => (v * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]),
    dLon = toRad(b[1] - a[1]);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(x));
}
const KM_PER_MILE = 1.60934;
// Radius is always stored/sent in km (matching the backend's kmBetween/nextRadius) — these only
// convert what's shown on screen, never the underlying value.
// Read the counts, not the arrays. /api/deals bounds a national chain's location arrays at 40 and
// sends the real totals as their own fields, so a length here would have a McValue offer confirmed
// at 9,812 branches reading "40 confirmed locations". The array length stays as the fallback for a
// response cached before those fields existed.
const brandLocationCount = (deal: Deal) => deal.chain_location_count || deal.chain_locations?.length || 0;
const confirmedLocationCount = (deal: Deal) => deal.participating_location_count ?? deal.participating_locations?.length ?? 1;

function formatDistance(km: number, unit: "km" | "mi") {
  return unit === "mi" ? `${(km / KM_PER_MILE).toFixed(1)} mi` : `${km.toFixed(1)} km`;
}
function formatRadius(km: number, unit: "km" | "mi") {
  return unit === "mi" ? `${Math.round(km / KM_PER_MILE)} mi` : `${km} km`;
}
export default function HomeClient({ turnstileSiteKey, cityGuides = {}, catalogSummary, recentChecks = null }: {
  turnstileSiteKey?: string;
  /** "1,000+ deals · 500+ restaurants · 60+ cities", counted on the server over the whole catalogue (app/home-listings.ts). */
  catalogSummary?: string;
  /** "Ottawa|ON" to "ottawa-on", for each city with a guide (app/home-listings.ts). */
  cityGuides?: Record<string, string>;
  /** The server-rendered list of recently checked deals and the city guides (app/HomeRecentChecks.tsx). */
  recentChecks?: React.ReactNode;
} = {}) {
  // How this page sends a reader to another of the site's pages from code, as its links do
  // (ChromeLink): a page load without a session cookie, a client-side push with one.
  const navigate = useChromeNavigate();
  const t = useTranslations("home");
  const tMarket = useTranslations("market");
  const tNational = useTranslations("national");
  const locale = useLocale();
  const searchAbort = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const lastQueryRef = useRef("");
  const skipNextDebounce = useRef(true);
  const [postal, setPostal] = useState(""),
    [area, setArea] = useState("Across North America"),
    [deals, setDeals] = useState<Deal[]>([]),
    [cat, setCat] = useState("All deals"),
    [loading, setLoading] = useState(true),
    [saved, setSaved] = useState<string[]>([]),
    [session, setSession] = useState<Session | null>(null),
    [selected, setSelected] = useState<Deal | null>(null),
    [chainLocation, setChainLocation] = useState(""),
    [offerIndex, setOfferIndex] = useState<number | null>(null),
    [suggest, setSuggest] = useState(false),
    [submitted, setSubmitted] = useState(false),
    [suggestError, setSuggestError] = useState<{ message: string; fields?: Record<string, string> } | null>(null),
    [suggestBusy, setSuggestBusy] = useState(false),
    [notice, setNotice] = useState(""),
    [userPosition, setUserPosition] = useState<[number, number] | null>(null),
    [radius, setRadius] = useState(DEFAULT_RADIUS_KM),
    [radiusUnit, setRadiusUnit] = useState<"km" | "mi">("km"),
    // Tracks the last (session, resolvedLocation.country) pair the guest-unit inference below
    // reacted to, so that pair can be compared during render instead of inside an effect.
    [guestUnitSyncKey, setGuestUnitSyncKey] = useState(""),
    [feedback, setFeedback] = useState(false),
    [feedbackSent, setFeedbackSent] = useState(false),
    [feedbackDealId, setFeedbackDealId] = useState<string | null>(null),
    [leadEmail, setLeadEmail] = useState(""),
    [leadStatus, setLeadStatus] = useState<"idle" | "busy" | "done" | "error">("idle"),
    // Tracked separately from the digest form above rather than sharing its state. Both are on
    // the page at once, and one shared "done" would blank whichever form the person did not fill
    // in — telling them they had joined a list they had not.
    [appLeadEmail, setAppLeadEmail] = useState(""),
    [appLeadStatus, setAppLeadStatus] = useState<"idle" | "busy" | "done" | "error">("idle"),
    [availableNow, setAvailableNow] = useState(false),
    [verifiedOnly, setVerifiedOnly] = useState(false),
    [priceTiers, setPriceTiers] = useState<number[]>([]),
    [serviceStyles, setServiceStyles] = useState<ServiceStyle[]>([]),
    [coverage, setCoverage] = useState<"covered" | "established" | "limited" | "no_coverage">("covered"),
    [vertical, setVertical] = useState<VerticalKey>(defaultVertical);
  // The country this homepage browses when no location is set - see app/market.ts - and the query
  // the last load actually ran with, which the nationwide list below repeats.
  const [market, setMarket] = useState<Market | null>(null);
  const [appliedQuery, setAppliedQuery] = useState("");
  const [showChains, setShowChains] = useState(false);
  const [surpriseBusy, setSurpriseBusy] = useState(false);
  const [catalogRestaurants, setCatalogRestaurants] = useState(0);
  const [catalogCities, setCatalogCities] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [totalMatches, setTotalMatches] = useState(0);
  const [latestVerificationDate, setLatestVerificationDate] = useState<string | null>(null);
  const [resolvedLocation, setResolvedLocation] = useState<ResolvedLocation | null>(null);
  // The radius the list on screen was searched with, which the slider is not until the next search.
  const [appliedRadius, setAppliedRadius] = useState(DEFAULT_RADIUS_KM);
  const [cuisine, setCuisine] = useState("All cuisines"),
    [dealQuery, setDealQuery] = useState(""),
    [sort, setSort] = useState("recommended"),
    [loadError, setLoadError] = useState(false),
    [recentlyViewed, setRecentlyViewed] = useState<RecentDeal[]>([]),
    [creatorPicks, setCreatorPicks] = useState<CreatorPicks | null>(null),
    [showBackToTop, setShowBackToTop] = useState(false);
  const apiErrorText = useApiErrorText();
  // One widget per lead form, each rendered on that form's first focus or press, sharing one
  // script load. See useLazyTurnstile in app/Turnstile.tsx for why they no longer mount on load.
  const appLeadTurnstile = useLazyTurnstile(turnstileSiteKey);
  const leadTurnstile = useLazyTurnstile(turnstileSiteKey);
  // The hero's motion - the typed heading word, the typed placeholders and the radar sweep behind
  // them - runs for as long as the page is open, so the reader gets a control to stop it (WCAG
  // 2.2.2). Reduced motion already stops all of it, and hides the control with nothing to pause.
  const [motionPaused, setMotionPaused] = useState(false);
  const tryPrefix = `${t("hero.searchTry")} `;
  const intentPlaceholder = useTypewriterAfterIntro(t("hero.searchQueryIntro"), tryPrefix, INTENT_QUERIES, { paused: motionPaused });
  const wherePlaceholder = useTypewriterAfterIntro(t("hero.searchLocationLabel"), tryPrefix, WHERE_QUERIES, { typeMs: 45, paused: motionPaused });
  const heroWords = useMemo(() => t.raw("hero.words") as string[], [t]);
  const heroWord = useTypewriter(heroWords, { holdMs: 1800, paused: motionPaused });
  function toggleMotion() {
    const next = !motionPaused;
    setMotionPaused(next);
    try {
      if (next) localStorage.setItem(MOTION_KEY, "paused");
      else localStorage.removeItem(MOTION_KEY);
    } catch {
      /* The choice lasts until the page is closed. */
    }
  }
  // A city's name as the reader writes it, for the cities with a quick chip; any other keeps its own.
  const cityLabel = (name: string) => {
    const chip = quickCities.find(([city]) => city === name);
    return chip ? t(`cityChips.${chip[1]}`) : name;
  };
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const linkedCity = params.get("city");
    const linkedPostal = params.get("postal");
    const linkedQuery = params.get("q") || "";
    const linkedCuisine = params.get("cuisine") || "All cuisines";
    const linkedCategory = params.get("category") || "All deals";
    const linkedSort = params.get("sort") || "recommended";
    const linkedRadius = Number(params.get("radius")) || DEFAULT_RADIUS_KM;
    const linkedVertical = parseVertical(params.get("vertical"));
    // Reading the URL's query string to seed initial filter state on mount — a
    // legitimate sync-with-an-external-system effect, not a derivable render value.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDealQuery(linkedQuery);
    setCuisine(linkedCuisine);
    setCat(linkedCategory);
    setSort(linkedSort);
    setRadius(linkedRadius);
    setVertical(linkedVertical);
    setAvailableNow(params.get("availableNow") === "true");
    setVerifiedOnly(params.get("verifiedOnly") === "true");
    setPriceTiers(parsePriceTiers(params.get("priceTier")));
    setServiceStyles(parseServiceStyles(params.get("serviceStyle")));
    if (linkedCity) { setPostal(linkedCity); setArea(linkedCity); }
    else if (linkedPostal) { setPostal(linkedPostal); setArea(linkedPostal.toUpperCase()); }
    if (params.get("suggest") === "1") {
      setSuggest(true);
      params.delete("suggest");
      const rest = params.toString();
      history.replaceState(null, "", rest ? `${location.pathname}?${rest}` : location.pathname);
    }
    // Which country to browse. A place in the link decides that by itself; otherwise the link's own
    // `country`, the reader's last choice, or a guess from their device's timezone - so a first
    // visit from Toronto opens on Canadian deals instead of a mixed list of two currencies.
    const located = Boolean(linkedCity || linkedPostal || params.get("lat") || params.get("lng"));
    const linkedMarket = parseMarket(params.get("country"));
    const stored = storedMarket();
    const initialMarket = linkedMarket || (stored === "all" ? null : stored || guessMarket());
    setMarket(initialMarket);
    if (initialMarket && !linkedMarket && !located) {
      params.set("country", initialMarket);
      history.replaceState(null, "", `${location.pathname}?${params}`);
    }
    // A non-restaurant vertical has no results UI to fetch for yet — see the "Coming soon"
    // branch further down — so skip the request entirely instead of loading data no one sees.
    if (linkedVertical === defaultVertical) loadDeals(params.toString() ? `?${params.toString()}` : "");
    else setLoading(false);
    setRecentlyViewed(loadRecentlyViewed());
    setShowChains(storedShowChains());
    try {
      if (localStorage.getItem(MOTION_KEY) === "paused") setMotionPaused(true);
    } catch {
      /* Storage refused: the hero moves until the reader pauses it again. */
    }
    // Silent on every failure, including an unknown handle. A rail that is not there is the
    // ordinary case - almost nobody arrives from a creator link - so there is nothing to report
    // and no error state worth rendering for it.
    const pickHandle = creatorForPicks();
    if (pickHandle) {
      fetch(`/api/creator-picks?c=${encodeURIComponent(pickHandle)}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((body) => { if (body && (body as CreatorPicks).picks?.length) setCreatorPicks(body as CreatorPicks); })
        .catch(() => {});
    }
    // Filter state lives in the URL via history.pushState (see searchParams() below), which would
    // otherwise let search engines index every filter combination as a distinct duplicate-content
    // URL. Keep canonical pinned to the bare path regardless of query string.
    let canonicalLink = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement("link");
      canonicalLink.rel = "canonical";
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.href = `${location.origin}${location.pathname}`;
    // A ?utm_source= visit is recorded by app/CreatorLink.tsx, which mounts on every page.
    // Shared with SiteHeader, which mounts on this same page and asks the same question. See
    // app/session-cache.ts.
    fetchSession()
      .then(async (rawUser) => {
        const d = { user: rawUser as SessionResponse["user"] };
        setSession(d.user);
        if (d.user) {
          setRadiusUnit(d.user.distance_unit === "mi" ? "mi" : "km");
          const u = await fetch("/api/user").then((r) => r.json()) as UserResponse;
          setSaved(u.favorites || []);
          // This used to only fill the location box, which was worse than doing nothing: a
          // signed-in Ottawa user saw "K2C 0J4" sitting in the Where field while the results
          // behind it were still the unscoped national list, Austin deals included. Run the
          // search the field is claiming. Guarded on the URL carrying no location or query of
          // its own, so a shared link, a ?city= link, or a search already in progress wins.
          const untouched = !linkedCity && !linkedPostal && !linkedQuery && !params.get("lat") && !params.get("lng");
          if (d.user.home_postal && untouched) {
            setPostal(d.user.home_postal);
            setArea(d.user.home_postal.toUpperCase());
            const scoped = new URLSearchParams(location.search);
            scoped.set("postal", d.user.home_postal);
            // The postal code says which country; a browsing market left beside it would filter the
            // reader's own area out whenever the two disagreed.
            scoped.delete("country");
            // replaceState, not push: landing on the home page and being scoped to your own
            // area is the starting point, not a step to press Back through.
            history.replaceState(null, "", `${location.pathname}?${scoped}`);
            loadDeals(`?${scoped}`);
          }
        }
      });
    return undefined;
    // loadDeals is a plain function re-created every render (not memoized), so listing it here
    // would re-run this mount-only URL-hydration effect on every render instead of once. It only
    // ever reads freshly-parsed URL params and stable setters, so the stale-closure risk that
    // exhaustive-deps is guarding against doesn't apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Keyed on which dialog is open, not just whether one is: "Report incorrect information" swaps
  // the detail dialog for the feedback one, and a boolean key left the trap holding the detached
  // detail section while focus fell to the page behind.
  const dialogKind = feedback ? "feedback" : selected ? "detail" : suggest ? "suggest" : null;
  useEffect(() => {
    if (!dialogKind) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => (dialog?.querySelector<HTMLElement>("button,a,input,select,textarea") || dialog)?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFeedback(false); setSelected(null); setSuggest(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      // Focus can end up outside when the control that held it is replaced (a form swapped for
      // its success message); bring it back in rather than letting Tab walk the page behind.
      if (!dialog.contains(document.activeElement)) { event.preventDefault(); first.focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown",onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown",onKeyDown); if (previous?.isConnected) previous.focus(); };
  }, [dialogKind]);
  // A sent form is replaced by its thank-you, taking the focused submit button with it. The
  // thank-you heading takes focus instead, which also reads the outcome out.
  useEffect(() => {
    if (feedbackSent || submitted) dialogRef.current?.querySelector<HTMLElement>(".success h2")?.focus();
  }, [feedbackSent, submitted]);
  useEffect(() => {
    const restore = () => {
      const params = new URLSearchParams(location.search);
      setPostal(params.get("postal") || "");
      setDealQuery(params.get("q") || "");
      setCat(params.get("category") || "All deals");
      setCuisine(params.get("cuisine") || "All cuisines");
      setSort(params.get("sort") || "recommended");
      setRadius(Number(params.get("radius")) || DEFAULT_RADIUS_KM);
      setAvailableNow(params.get("availableNow") === "true");
      setVerifiedOnly(params.get("verifiedOnly") === "true");
      setPriceTiers(parsePriceTiers(params.get("priceTier")));
      setServiceStyles(parseServiceStyles(params.get("serviceStyle")));
      const restoredVertical = parseVertical(params.get("vertical"));
      setVertical(restoredVertical);
      // A located page takes its country from the place; only a browse carries the market itself.
      if (!params.get("city") && !params.get("postal") && !params.get("lat") && !params.get("lng")) setMarket(parseMarket(params.get("country")));
      setArea(params.get("city") || params.get("postal")?.toUpperCase() || "Across North America");
      if (restoredVertical === defaultVertical) loadDeals(params.toString() ? `?${params}` : "");
      else setLoading(false);
    };
    addEventListener("popstate",restore);
    return () => removeEventListener("popstate",restore);
    // Same reasoning as the mount effect above: loadDeals is unmemoized, and `restore` always
    // reads current URL params fresh rather than closing over stale state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (skipNextDebounce.current) { skipNextDebounce.current = false; return undefined; }
    const timer = setTimeout(() => {
      const current = new URLSearchParams(location.search).get("q") || "";
      if (dealQuery === current) return;
      runDiscovery({ q: dealQuery || null });
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealQuery]);
  // Guests have no stored preference, so infer km/mi from wherever their search just resolved
  // to — skipped once signed in, since the session-load effect already sets an authoritative
  // value from their profile and a search in a different country shouldn't override it. Adjusted
  // directly during render (comparing against the last-seen key) rather than in an effect, since
  // this has no side effect beyond React state itself.
  const guestUnitKey = `${session ? "1" : "0"}:${resolvedLocation?.country ?? ""}`;
  if (guestUnitKey !== guestUnitSyncKey) {
    setGuestUnitSyncKey(guestUnitKey);
    if (!session && resolvedLocation?.country) setRadiusUnit(resolvedLocation.country === "US" ? "mi" : "km");
  }
  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 700);
    addEventListener("scroll",onScroll,{ passive:true });
    return () => removeEventListener("scroll",onScroll);
  }, []);
  async function loadDeals(q = "", append = false) {
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    lastQueryRef.current = q;
    if (!append) setLoading(true);
    try {
      // `locale` is appended only to the fetch, never to the pushState/shareable URL built by
      // searchParams() — the URL should be shareable across locales, not pinned to whoever sent it.
      const fetchParams = new URLSearchParams(q.replace(/^\?/, ""));
      fetchParams.set("locale", locale);
      // A "my location" search names no place, and so no clock: the reader's own goes with it.
      const clock = fetchParams.has("lat") ? readerTimezone() : null;
      if (clock) fetchParams.set("tz", clock);
      // National chains are shown in their own section, beside this list (NationalDeals), for the
      // restaurants vertical that section belongs to. Fetch-only, like `locale`.
      if ((fetchParams.get("vertical") || defaultVertical) === defaultVertical) fetchParams.set("chains", "separate");
      const response = await fetch(`/api/deals?${fetchParams}`, { signal: controller.signal });
      // Parsed before the status is checked, and defensively, because a failing response often has
      // no body to parse at all. A 500 from the worker arrives with zero bytes, and calling
      // .json() on that throws "Unexpected end of JSON input" — which then became the notice the
      // visitor read, in place of the sentence written for exactly this case. Same idiom as the
      // other fetches in this file: an unreadable body is an empty object, not an exception.
      const d = await response.json().catch(() => ({})) as DealsResponse;
      // The route explains a refused search in English (an unknown postal code, a city outside
      // coverage, too many lookups); the notice says the same thing in the reader's language, chosen
      // by the error's code.
      if (!response.ok) throw new DealsLoadError(apiErrorText.message(d, t("notices.dealsLoadFailedGeneric")));
      const rows = d.results || [];
      setDeals((current) => append ? [...current, ...rows] : rows);
      if (!append) setAppliedQuery(fetchParams.get("q") || "");
      if (!append) setAppliedRadius(Number(fetchParams.get("radius")) || DEFAULT_RADIUS_KM);
      // The hero's "N restaurants · M cities": the same cards the list below counts as matches,
      // before any filter or place narrows them (see cityCount in app/api/deals/route.ts). No
      // fallback to rows.length - a page size is not a catalog size, and the badge has its own
      // wording for "not known yet".
      setCatalogRestaurants(d.uniqueOfferCount || 0);
      setCatalogCities(d.cityCount || 0);
      setNextCursor(d.nextCursor || null);
      setTotalMatches(d.totalMatches ?? rows.length);
      setLatestVerificationDate(d.latestVerificationDate || null);
      setResolvedLocation(d.resolvedLocation || null);
      setCoverage(d.coverage || "covered");
      if (d.resolvedCity && q.includes("postal="))
        setArea(t("results.areaPostalSearch", { city: d.resolvedCity }));
      setNotice("");
      setLoadError(false);
      const shared = new URLSearchParams(location.search).get("deal");
      if (shared) {
        const found = rows.find((deal: Deal) => deal.id === shared);
        if (found) setSelected(found);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setDeals([]);
      setCoverage("limited");
      setLoadError(true);
      // Only a message this code wrote is shown. Anything else reaching here is a bug, and a
      // visitor should not be reading its text: "Unexpected end of JSON input" was on the site
      // for real, in the notice bar, where the explanation belongs.
      setNotice(cause instanceof DealsLoadError ? cause.message : t("notices.dealsLoadFailedGeneric"));
    } finally {
      setLoading(false);
    }
  }
  function searchParams(overrides: Record<string, string | number | null> = {}) {
    const current = new URLSearchParams(location.search);
    // `postal` doubles as the where-input's displayed text, which isn't always a real postal/ZIP —
    // arriving via a ?city= link (or clicking a quick-city button before it clears the field) leaves
    // it holding a city name for display while city/lat/lng in the URL already carry the resolved
    // location. Sending that text through as postal= alongside them made the backend 422 on any
    // later filter change (cuisine, sort, availableNow, …), since it validates postal strictly
    // instead of deferring to the city/lat/lng already present.
    const normalizedPostal = postal.trim().replace(/[\s-]/g,"").toUpperCase();
    const isValidPostal = /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(normalizedPostal) || /^\d{5}(\d{4})?$/.test(normalizedPostal);
    const values: Record<string, string | number | null> = {
      q: dealQuery || null,
      postal: isValidPostal ? postal : null,
      radius,
      category: cat === "All deals" ? null : cat,
      cuisine: cuisine === "All cuisines" ? null : cuisine,
      availableNow: availableNow ? "true" : null,
      verifiedOnly: verifiedOnly ? "true" : null,
      priceTier: priceTiers.length ? [...priceTiers].sort().join(",") : null,
      serviceStyle: serviceStyles.length ? serviceStyles.join(",") : null,
      vertical: vertical === defaultVertical ? null : vertical,
      sort,
      ...overrides,
    };
    for (const [key,value] of Object.entries(values)) { if (value == null || value === "") current.delete(key); else current.set(key,String(value)); }
    current.delete("cursor");
    current.delete("deal");
    return current;
  }
  // Mirrors isPro() in app/auth.ts — the same two fields the server checks, so the picker can
  // never offer a radius the API would reject.
  const isProSession = hasProAccess(session?.plan, session?.plan_status, session?.past_due_since, new Date(), session?.paused_until, session?.role);
  function togglePriceTier(tier: number) {
    const next = priceTiers.includes(tier) ? priceTiers.filter((value) => value !== tier) : [...priceTiers, tier].sort((a, b) => a - b);
    setPriceTiers(next);
    runDiscovery({ priceTier: next.length ? next.join(",") : null });
  }
  const serviceStyleLabel = (style: ServiceStyle) => t(style === "quick" ? "filters.quickService" : "filters.sitDownService");
  const filtersActive = Boolean(dealQuery) || cat !== "All deals" || cuisine !== "All cuisines" || availableNow || verifiedOnly || priceTiers.length > 0 || serviceStyles.length > 0;
  function clearFilters() {
    setCat("All deals");
    setCuisine("All cuisines");
    setDealQuery("");
    setAvailableNow(false);
    setVerifiedOnly(false);
    setPriceTiers([]);
    setServiceStyles([]);
    runDiscovery({ category:null,cuisine:null,q:null,availableNow:null,verifiedOnly:null,priceTier:null,serviceStyle:null });
  }
  function toggleServiceStyle(style: ServiceStyle) {
    const next = serviceStyles.includes(style) ? serviceStyles.filter((value) => value !== style) : SERVICE_STYLES.filter((value) => value === style || serviceStyles.includes(value));
    setServiceStyles(next);
    runDiscovery({ serviceStyle: next.length ? next.join(",") : null });
  }
  function runDiscovery(overrides: Record<string, string | number | null> = {}) {
    const params = searchParams(overrides);
    history.pushState(null,"",`${location.pathname}${params.toString() ? `?${params}` : ""}`);
    loadDeals(params.toString() ? `?${params}` : "");
  }
  function search(e?: React.FormEvent) {
    e?.preventDefault();
    const locationInput = postal.trim();
    if (!locationInput && !dealQuery.trim() && !new URLSearchParams(location.search).get("city")) {
      setNotice(t("notices.enterSearch"));
      return;
    }
    const normalized = locationInput.replace(/[\s-]/g, "").toUpperCase();
    const isPostal = /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(normalized) || /^\d{5}(\d{4})?$/.test(normalized);
    setNotice("");
    setUserPosition(null);
    if (!locationInput || isPostal) {
      if (locationInput) setArea(locationInput.toUpperCase());
      // A postal or ZIP code says which country by itself, and a browsing market left in the URL
      // beside it would filter the reader's own area out whenever the two disagreed.
      runDiscovery({ postal: locationInput || null, city: null, lat: null, lng: null, q: dealQuery || null, ...(locationInput ? { country: null } : {}) });
      document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    // Not a recognizable postal/ZIP — treat it as a city name instead of rejecting it. A known
    // pin resolves instantly to lat/lng client-side (same radius-based path as "Use my
    // location"); anything else goes to the backend's resolveCityText (postal_cache + Nominatim).
    setArea(locationInput);
    const knownName = Object.keys(cityCenters).find((name) => name.toLowerCase() === locationInput.toLowerCase());
    const overrides: Record<string, string | number | null> = { postal: null, lat: null, lng: null, city: knownName ? null : locationInput, q: dealQuery || null, country: null };
    if (knownName) {
      const center = cityCenters[knownName];
      overrides.lat = String(center[0]);
      overrides.lng = String(center[1]);
      setUserPosition(center);
    }
    const params = searchParams(overrides);
    history.pushState(null,"",`${location.pathname}?${params}`);
    loadDeals(`?${params}`);
    document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" });
  }
  // The Restaurants / Retail switch is a tab list: one tab stop, the arrow keys (and Home / End)
  // move between tabs and select as they go, and each tab names the panel it controls.
  function onVerticalKey(event: React.KeyboardEvent<HTMLDivElement>) {
    const at = verticals.findIndex((v) => v.key === vertical);
    const to = event.key === "ArrowRight" ? at + 1
      : event.key === "ArrowLeft" ? at - 1
      : event.key === "Home" ? 0
      : event.key === "End" ? verticals.length - 1
      : null;
    if (to == null) return;
    event.preventDefault();
    const next = verticals[(to + verticals.length) % verticals.length].key;
    switchVertical(next);
    document.getElementById(`vertical-tab-${next}`)?.focus();
  }
  function switchVertical(next: VerticalKey) {
    if (next === vertical) return;
    setVertical(next);
    const params = new URLSearchParams(location.search);
    if (next === defaultVertical) params.delete("vertical"); else params.set("vertical",next);
    history.pushState(null,"",`${location.pathname}${params.toString() ? `?${params}` : ""}`);
    // A vertical with no live data has no results UI to fetch for — see the "Coming soon"
    // branch below. The restaurant tab's own deals/filters are still valid from the last
    // load (nothing about them could have changed while another tab was active).
    if (next !== defaultVertical) return;
    loadDeals(params.toString() ? `?${params}` : "");
  }
  function city(c: string) {
    setPostal("");
    setArea(cityLabel(c));
    setCat("All deals");
    setCuisine("All cuisines");
    // Resolve to lat/lng up front, same as useMyLocation — a bare city= string only ever did a
    // strict city-name match server-side with no radius, which is exactly what kept a search from
    // reaching a neighboring town's deals.
    const center = cityCenters[c];
    setUserPosition(center || null);
    const params = new URLSearchParams();
    if (center) { params.set("lat",String(center[0])); params.set("lng",String(center[1])); }
    else params.set("city",c);
    if (dealQuery) params.set("q",dealQuery);
    params.set("radius",String(radius));
    params.set("sort",sort);
    if (vertical !== defaultVertical) params.set("vertical",vertical);
    history.pushState(null,"",`?${params}`);
    loadDeals(`?${params}`);
    document.querySelector("#results")?.scrollIntoView({ behavior: "smooth" });
  }
  function useMyLocation() {
    if (!navigator.geolocation) {
      setNotice(t("notices.locationUnsupported"));
      return;
    }
    setNotice(t("notices.findingLocation"));
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const point: [number, number] = [coords.latitude, coords.longitude];
        setUserPosition(point);
        const nearest = Object.entries(cityCenters)
          .map(([name, center]) => [name, kmBetween(point, center)] as const)
          .sort((a, b) => a[1] - b[1])[0];
        setArea(
          nearest && nearest[1] < 100
            ? t("results.areaNearCity", { city: cityLabel(nearest[0]), radius: formatRadius(radius,radiusUnit) })
            : t("results.areaNearYou", { radius: formatRadius(radius,radiusUnit) }),
        );
        setNotice("");
        const params = searchParams({ postal:null, city:null, country:null });
        params.set("lat",String(point[0])); params.set("lng",String(point[1])); params.set("radius",String(radius));
        history.pushState(null,"",`?${params}`);
        loadDeals(`?${params}`);
        document
          .querySelector("#results")
          ?.scrollIntoView({ behavior: "smooth" });
      },
      () => setNotice(t("notices.locationDenied")),
      { enableHighAccuracy: false, timeout: 8000 },
    );
  }
  // A location is "set" the same way the rest of the page already treats it: a typed
  // postal/city, a resolved lat/lng (geolocation or a known city pin), or a location the
  // last search already resolved server-side — not just a non-default `area` label, which
  // can lag behind (e.g. right after resetArea()).
  function hasLocationSet() {
    return Boolean(postal.trim() || userPosition || resolvedLocation);
  }
  async function surpriseMe() {
    if (!hasLocationSet()) {
      setNotice(t("notices.setLocationFirst"));
      document.querySelector<HTMLInputElement>(".where-input")?.focus();
      document.querySelector(".search-box")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (surpriseBusy) return;
    setSurpriseBusy(true);
    setNotice("");
    // Only surprise with something actually open right now. available_today just means the
    // day matches, so a deal whose window already ended (or hasn't started) for today would
    // still pass that — available_now is the field search.ts computes from the deal's real
    // schedule + current time, exactly what the "Available now" filter/sort already use.
    // Asking the server for it (rather than filtering the already-loaded `deals` page) covers
    // active deals sitting past whatever page happened to load, not just what's on screen.
    let pool: Deal[];
    try {
      const fetchParams = searchParams({ availableNow:"true" });
      fetchParams.set("locale", locale);
      const response = await fetch(`/api/deals?${fetchParams}`);
      const body = await response.json().catch(() => ({})) as DealsResponse;
      if (!response.ok) throw new Error();
      pool = body.results || [];
    } catch {
      pool = deals.filter((d) => d.available_now);
    } finally {
      setSurpriseBusy(false);
    }
    if (!pool.length) {
      setNotice(t("notices.nothingOpenNow"));
      return;
    }
    const pick = pool[Math.floor(Math.random() * pool.length)];
    pushRecentlyViewed(pick);
    rememberReturn();
    visitDeal(pick);
  }
  async function sendFeedback(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...body,
        market: area,
        page: location.pathname + location.search,
        dealId: feedbackDealId,
      }),
    });
    if (r.ok) setFeedbackSent(true);
    else
      setNotice(t("notices.feedbackFailed"));
  }
  async function captureLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLeadStatus("busy");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    // Waits for the challenge the form's first focus started, if it has not finished yet.
    const token = await leadTurnstile.takeToken();
    const r = await fetch("/api/email/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, ...(token ? { "cf-turnstile-response": token } : {}), postal }),
    });
    setLeadStatus(r.ok ? "done" : "error");
  }
  // The app waitlist. Same endpoint as the digest form, different `source`, because on launch day
  // these are two different promises: one list asked about nearby deals, the other asked to be
  // told when the app ships, and only the second one has consented to hear about it.
  //
  // Deliberately offered to signed-in people too, unlike the digest form below. Someone with an
  // account is the likeliest person to install on day one, and having an account says nothing
  // about wanting an email when the app lands.
  async function captureAppLead(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setAppLeadStatus("busy");
    const body = Object.fromEntries(new FormData(e.currentTarget));
    const token = await appLeadTurnstile.takeToken();
    const r = await fetch("/api/email/capture", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...body, ...(token ? { "cf-turnstile-response": token } : {}), source: "ios-waitlist" }),
    });
    setAppLeadStatus(r.ok ? "done" : "error");
  }
  async function favorite(id: string) {
    if (!session) {
      // A page load of the sign-in page, which the Worker answers with its baked copy: whoever gets
      // here is signed out, and a client-side push fetched sign-in's flight, a render every time.
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a page load on purpose, as above
      window.location.assign(`/${locale}/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
      return;
    }
    const yes = !saved.includes(id);
    setSaved((s) => (yes ? [...s, id] : s.filter((x) => x !== id)));
    const response = await fetch("/api/user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "favorite", dealId: id, saved: yes }),
    });
    if (!response.ok) {
      setSaved((s) => (yes ? s.filter((x) => x !== id) : [...s,id]));
      const result = await response.json().catch(() => ({})) as ApiErrorBody;
      setNotice(apiErrorText.message(result, t("notices.saveFailed")));
    }
  }
  function openDeal(deal: Deal) {
    setSelected(deal);
    setChainLocation("");
    setOfferIndex(null);
    pushRecentlyViewed(deal);
    setRecentlyViewed(loadRecentlyViewed());
  }
  function retry() {
    loadDeals(lastQueryRef.current);
  }
  // Nothing to refetch: the local list leaves the national chains out either way, and the section
  // that holds them loads itself when it mounts.
  function toggleChains() {
    const next = !showChains;
    setShowChains(next);
    try {
      localStorage.setItem(CHAINS_KEY, next ? "1" : "0");
    } catch {
      /* The choice lasts until the page is closed. */
    }
  }
  function resetArea() {
    setPostal("");
    setUserPosition(null);
    setArea("Across North America");
    // Back to browsing, so back to the country being browsed.
    const params = searchParams({ postal: null, country: market });
    params.delete("city"); params.delete("lat"); params.delete("lng");
    history.pushState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`);
    loadDeals(params.toString() ? `?${params}` : "");
  }
  // Radar Canada or Radar US. Choosing one is a browse of that country, so any location set is
  // cleared with it: a Knoxville search with the switch on Canada would be an empty page that
  // looks like Radar has nothing in Knoxville.
  function chooseMarket(next: Market | null) {
    rememberMarket(next || "all");
    setMarket(next);
    setPostal("");
    setUserPosition(null);
    setArea("Across North America");
    const params = searchParams({ postal: null, city: null, lat: null, lng: null, country: next });
    history.pushState(null, "", `${location.pathname}${params.toString() ? `?${params}` : ""}`);
    loadDeals(params.toString() ? `?${params}` : "");
  }
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSuggestBusy(true);
    setSuggestError(null);
    const payload = Object.fromEntries(new FormData(e.currentTarget));
    const r = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await r.json().catch(() => ({})) as ApiErrorBody;
    setSuggestBusy(false);
    if (r.ok) setSubmitted(true);
    else setSuggestError({ message: apiErrorText.message(result, t("suggestModal.sendFailed")), fields: apiErrorText.fields(result) });
  }
  const cuisines = useMemo(
    () => [
      "All cuisines",
      ...Array.from(new Set(deals.map((d) => d.cuisine))).sort(),
    ],
    [deals],
  );
  const activeVertical = useMemo(
    () => verticals.find((v) => v.key === vertical) || verticals[0],
    [vertical],
  );
  const visible = deals;
  // Which country's deals are on screen. A searched place says so itself, and so does a device
  // location now: the API reads the point's country off the map (app/country-at.ts) rather than
  // filing every bare point under Canada. A point in neither country comes back without one, and
  // is answered by what it found; a browse is whatever the switch says.
  const deviceSearch = resolvedLocation?.accuracy === "device";
  const resultMarkets = new Set(deals.map((d) => marketOf(d.country)).filter((value): value is Market => value != null));
  const activeMarket: Market | null = resolvedLocation && marketOf(resolvedLocation.country)
    ? marketOf(resolvedLocation.country)
    : deviceSearch && resultMarkets.size === 1 ? [...resultMarkets][0] : market;
  // A card names its currency whenever the page could be holding both: "$5" is two different
  // prices on either side of the border, and nothing else on a card says which one it is.
  const showCurrency = !activeMarket || resultMarkets.size > 1;
  const marketOptions: Array<[Market | null, string]> = [["CA", tMarket("CA")], ["US", tMarket("US")], [null, tMarket("all")]];
  const chosenChainLocation = selected?.chain_locations?.find((location) => location.address === chainLocation);
  // The branches this offer is confirmed at, as the picker below reads them. A national promotion
  // at a large chain reaches 120 of them - Tim Hortons' Timbits Tuesday - and the <select> this
  // replaces for those could only be scrolled; see app/branch-search.ts for why its own keyboard
  // search was no help. Memoised on `selected` because indexing the list for search normalizes
  // every line, and that should not happen again on each keystroke.
  const chainBranchOptions = useMemo<BranchOption[]>(
    () =>
      (selected?.participating_locations || selected?.chain_locations?.filter((location) => location.offer_available !== false) || []).map(
        (location) => ({ value: location.address, label: `${location.city} · ${location.address}` }),
      ),
    [selected],
  );
  // An independent has one address and no picker, so its offers are simply the ones there.
  const venueLocation = selected && !selected.is_chain ? selected.chain_locations?.find((location) => location.address === selected.address) : undefined;
  const offerLocation = chosenChainLocation || venueLocation;
  // One address commonly runs several offers - Wing Wednesday and Pasta Tuesday at the same Boston
  // Pizza - so the address picker alone cannot say which one is being shown.
  const locationOffers = offerLocation?.offers?.length
    ? offerLocation.offers
    : offerLocation?.offer
      ? [offerLocation.offer]
      : [];
  // Until someone picks an offer, show the one the card was showing - the server chose it as the
  // one on today, and for a filtered search the one that matched - so opening a card never
  // changes the subject. At an address the card was not about, the one that runs today instead:
  // choosing an address used to land on its first offer, so a Wednesday reader choosing their
  // Montana's saw Wing Monday and had to find the Wednesday tab themselves.
  const leadIndex = locationOffers.findIndex((offer) => offer.id === selected?.id);
  const todayIndex = locationOffers.findIndex((offer) => offer.available_today);
  const shownIndex = offerIndex ?? (leadIndex >= 0 ? leadIndex : todayIndex >= 0 ? todayIndex : 0);
  const activeOffer = locationOffers[shownIndex] || locationOffers[0];
  const returnState = typeof window === "undefined" ? "/" : `${window.location.pathname}${window.location.search}`;
  // A deal page is prerendered, and a parameter it reads skips that copy for a render on the
  // Worker - which is what `?return=` did to every card here: every click a fresh server render, and
  // on a national chain's page about forty thousand D1 rows. So a deal link is the bare path. The
  // way back travels in sessionStorage (the deal page's back link reads it), and so does the postal
  // or ZIP code the reader searched with, which the deal page puts in its postal form: narrowing a
  // national chain's locations to their own state is one tap they choose, not a render every click.
  const searchedPostal = (() => {
    const normalized = postal.trim().replace(/[\s-]/g, "").toUpperCase();
    return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(normalized) || /^\d{5}(\d{4})?$/.test(normalized) ? normalized : "";
  })();
  // A deal page's address without the locale, which ChromeLink and navigate() write in: the
  // prerendered pages live at /en/deals/..., and a bare /deals/... is a redirect before it is a page.
  const dealPath = (d: { slug?: string | null; id: string }) => `/deals/${encodeURIComponent(d.slug || d.id)}` as const;
  // A dashboard page in the reader's language, through sign-in when they are signed out and back to
  // the same page after it. The address it returns to is written out with the locale: a bare
  // "/sign-in?redirect_url=%2Fdashboard%2Fsaved" took a French reader with no locale cookie to the
  // English sign-in page, and on to the English dashboard.
  const accountHref = (section: "saved" | "alerts" | "account") => {
    return session ? `/dashboard/${section}` as const : `/sign-in?redirect_url=${encodeURIComponent(`/${locale}/dashboard/${section}`)}` as const;
  };
  // Opening a deal goes the way ChromeLink's links do. Signed out, a page load: a client-side push
  // fetches the page's RSC payload (?_rsc, with an RSC header), which the Worker has to render on
  // every click - the prerendered file is HTML and cannot answer it - so every card opened from here
  // was a full server render and its D1 queries, 11,525 rows for a national chain's page, where a
  // page load of the same path is answered by the prerendered file, for nothing. Signed in, the
  // Worker renders the deal page either way (a session cookie keeps a request out of the bake), so
  // the push is the cheaper render, and Back returns to this page without rendering it again.
  const visitDeal = (d: { slug?: string | null; id: string }) => navigate(dealPath(d));
  const rememberReturn = () => {
    try {
      sessionStorage.setItem(RETURN_STORAGE_KEY, returnState);
      if (searchedPostal) sessionStorage.setItem(POSTAL_STORAGE_KEY, searchedPostal);
      else sessionStorage.removeItem(POSTAL_STORAGE_KEY);
    } catch { /* storage refused - the back link falls back to the city, and the form starts empty */ }
  };
  // The header and footer sit beside <main>, not inside it, so they are the page's banner and
  // contentinfo landmarks (see app/PublicPage.tsx, which every other public page uses; this page
  // builds the same frame itself because its header carries the vertical switch and its own skip
  // target). The overlays and floating controls stay outside <main> as well: they are not the
  // page's content, they sit over it.
  return (
    <>
      {loading && <div className="top-loader" aria-hidden="true" />}
      <SiteHeader
        skipToId={vertical === defaultVertical ? "results" : undefined}
        brandHref="#top"
        exploreHref="#results"
        onSuggest={() => setSuggest(true)}
        centerSlot={
          // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
          <div className="vertical-switch" role="tablist" aria-label={t("verticalSwitch.label")} onClick={(e) => e.stopPropagation()} onKeyDown={onVerticalKey}>
            {verticals.map((v) => (
              <button
                key={v.key}
                id={`vertical-tab-${v.key}`}
                type="button"
                role="tab"
                aria-selected={vertical === v.key}
                aria-controls="vertical-panel"
                tabIndex={vertical === v.key ? 0 : -1}
                className={vertical === v.key ? "active" : ""}
                onClick={() => switchVertical(v.key)}
              >
                {t(`verticalSwitch.${v.labelKey}`)}
              </button>
            ))}
          </div>
        }
      />
      <main id={MAIN_CONTENT_ID} tabIndex={-1}>
      {/* A coming-soon panel has nothing focusable in it, so the panel itself takes the tab stop
          the tab pattern expects after the tab list; the restaurant panel starts with controls. */}
      <div role="tabpanel" id="vertical-panel" aria-labelledby={`vertical-tab-${vertical}`} tabIndex={vertical === defaultVertical ? undefined : 0}>
      {vertical !== "restaurant" ? (
        <section className="hero coming-soon" id="top">
          <div className="eyebrow">
            <Sparkles /> {t(`verticalSwitch.${activeVertical.labelKey}`)}
          </div>
          <h1>{t("hero.comingSoon")}</h1>
          <p>{t("hero.comingSoonBody", { vertical: t(`verticalSwitch.${activeVertical.labelKey}`) })}</p>
        </section>
      ) : (
      <>
      <section className={`hero${motionPaused ? " motion-paused" : ""}`} id="top">
        <button
          type="button"
          className="motion-toggle"
          aria-label={motionPaused ? t("hero.resumeMotion") : t("hero.pauseMotion")}
          title={motionPaused ? t("hero.resumeMotion") : t("hero.pauseMotion")}
          onClick={toggleMotion}
        >
          {motionPaused ? <Play /> : <Pause />}
        </button>
        <div className="eyebrow">
          {/* The whole catalogue's size where the server could count it. The list's own count is of
              cards, one per place, and read as a count of deals it understated the catalogue by
              half; it stays only as the fallback for a page rendered without the database. */}
          <Sparkles /> {catalogSummary || (catalogRestaurants ? t("hero.catalogCount", { restaurants: catalogRestaurants, cities: catalogCities }) : t("hero.catalogPending"))}
        </div>
        {/* The heading is read as its whole phrase, once. The typed word changes letter by letter,
            so as the accessible name it was a partial word most of the time ("Disc on your
            Radar."), and a screen reader re-reading the heading got a different one each time. */}
        <h1>
          <span className="sr-only">{`${heroWords[0] || ""} ${t("hero.headingSuffix")}`}</span>
          <span aria-hidden="true">
            <em>
              <span className="hero-typewriter">{heroWord}</span>
            </em>{" "}
            {t("hero.headingSuffix")}
          </span>
        </h1>
        <p>{t("hero.subtitle")}</p>
        <form className="search-box" onSubmit={search}>
          <Search />
          <input
            className="intent-input"
            value={dealQuery}
            onChange={(e) => setDealQuery(e.target.value)}
            aria-label={t("hero.searchQueryLabel")}
            placeholder={intentPlaceholder}
          />
          <MapPin />
          <input
            className="where-input"
            value={postal}
            onChange={(e) => setPostal(e.target.value)}
            aria-label={t("hero.searchLocationLabel")}
            placeholder={wherePlaceholder}
          />
          <button>
            <Search /> {t("hero.searchButton")}
          </button>
        </form>
        <div className="location-tools">
          <button type="button" onClick={useMyLocation}>
            <LocateFixed /> {t("hero.useMyLocation")}
          </button>
          <label>
            {t("hero.radius")}{" "}
            <select
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              aria-label={t("hero.searchRadiusLabel")}
            >
              {/* The plans page sells Pro a radius "up to 100 km" and /api/user accepts 75 and 100
                  on a Pro tracked area, but this picker stopped at 50 for everyone — so the one
                  place a Pro subscriber actually searches could not reach the radius they pay
                  for. The set is shared with the server now rather than repeated here. */}
              {allowedRadii(isProSession).map((n) => (
                <option value={n} key={n}>
                  {formatRadius(n,radiusUnit)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={surpriseMe} disabled={surpriseBusy} title={t("hero.surpriseMeTitle")}>
            <Shuffle /> {surpriseBusy ? t("hero.surpriseMeFinding") : t("hero.surpriseMe")}
          </button>
        </div>
        {/* The region stays mounted and only its content comes and goes: one inserted already
            holding "Link copied" or a location error was often not read out. */}
        <div className="notice" role="status" aria-live="polite">
          {notice && <>
            <span>{notice}</span>
            <button type="button" aria-label={t("hero.dismissMessage")} onClick={() => setNotice("")}>
              <X />
            </button>
          </>}
        </div>
        <div className="city-links">
          {/* A chip whose city has a guide is a link to it, so the guide is linked from the page
              a crawler trusts most and a reader can open it in a new tab. A plain click keeps
              doing what the chip always did: filter the results below in place. */}
          {quickCities.map(([c, key, region]) => {
            const guide = cityGuides[`${c}|${region}`];
            if (!guide) return <button onClick={() => city(c)} key={c}>{t(`cityChips.${key}`)}</button>;
            return (
              <a
                key={c}
                className="city-chip"
                href={`/en/cities/${guide}`}
                onClick={(event) => {
                  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  city(c);
                }}
              >
                {t(`cityChips.${key}`)}
              </a>
            );
          })}
          {/* English only, like the guide itself (app/city-pages.ts): a plain link to the page a
              crawler can read, from the page it trusts most. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- a plain link, for the reason above */}
          <a className="city-guides-link" href="/en/cities">{t("hero.cityGuides")} →</a>
        </div>
      </section>
      <section className="results" id="results">
        <div className="results-top">
          <div>
            <span className="kicker">{latestVerificationDate ? t("results.latestSourceCheck", { date: readerDate(latestVerificationDate, locale) }) : t("results.sourceCheckedOffers")}</span>
            <h2>{t("results.heading")}</h2>
            <p className="results-sub">
              {area !== "Across North America" ? t("results.showingNear", { area })
                : activeMarket ? tMarket(activeMarket === "US" ? "acrossUS" : "acrossCA")
                : t("results.showingAcrossNorthAmerica")}
              {area !== "Across North America" && (
                <button type="button" className="change-area" onClick={resetArea}>
                  {t("results.changeArea")} <X />
                </button>
              )}
            </p>
            {/* Radar Canada and Radar US, one at a time, so a Canadian "$5" and an American one are
                never side by side without a word to say which is which. */}
            <div className="market-row">
              <div className="market-switch" role="group" aria-label={tMarket("switchAria")}>
                {marketOptions.map(([value, label]) => (
                  <button
                    type="button"
                    key={value || "all"}
                    className={activeMarket === value ? "active" : ""}
                    aria-pressed={activeMarket === value}
                    onClick={() => { if (activeMarket !== value) chooseMarket(value); }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activeMarket && <span className="market-prices">{tMarket(activeMarket === "US" ? "pricesUS" : "pricesCA")}</span>}
            </div>
            {(coverage === "limited" || coverage === "no_coverage") && !loading && (
              <p className="coverage-note">
                {coverage === "no_coverage" ? t("results.coverageNotCovered") : t("results.coverageGrowing")} {t("results.coverageSuggestion")}
              </p>
            )}
            {loadError && !loading && (
              <button type="button" className="retry-button" onClick={retry}>{t("results.tryAgain")}</button>
            )}
          </div>
          <span className="location" role="status" aria-live="polite">
            <LocateFixed />
            {loading
              ? t("results.scanning")
              : t(totalMatches === 1 ? "results.match" : "results.matches", { count: totalMatches })}
          </span>
        </div>
        {/* Editorial, so it sits above the reader's own history: somebody who followed a
            creator's link came for what that creator recommends, and burying it under a filter
            panel would make the link no different from any other way of arriving. Each pick
            carries its own line where the creator wrote one, which is the whole point - a list
            of deals without the reason is just a shorter search. */}
        {creatorPicks && (
          <div className="creator-picks" role="region" aria-label={t("creatorPicks.label", { name: creatorPicks.creator.name })}>
            {/* The creator earns commission from this link, so the row says so (FTC 16 CFR 255,
                Competition Bureau influencer guidance), quietly: a small label with the detail
                one tap away, beside the heading rather than on every pick. */}
            <span className="creator-picks-heading">
              <span><Sparkles /> {t("creatorPicks.heading", { name: creatorPicks.creator.name })}</span>
              <small>{t("creatorPicks.partner")} <InfoTip text={t("creatorPicks.partnerTip", { name: creatorPicks.creator.name })} /></small>
            </span>
            <div className="creator-picks-list">
              {creatorPicks.picks.map((item) => (
                <ChromeLink key={item.id} href={dealPath(item)}>
                  <span className="creator-pick-emoji" aria-hidden="true">{item.emoji}</span>
                  <span className="creator-pick-body">
                    <b>{item.restaurant}</b>
                    <small>{item.note || item.title}</small>
                  </span>
                </ChromeLink>
              ))}
            </div>
          </div>
        )}
        {recentlyViewed.length > 0 && (
          <div className="recently-viewed" role="region" aria-label={t("recentlyViewed.label")}>
            <span><History /> {t("recentlyViewed.heading")}</span>
            <div className="recently-viewed-list">
              {recentlyViewed.map((item) => (
                <ChromeLink key={item.id} href={dealPath(item)}>
                  <span aria-hidden="true">{item.emoji}</span>
                  <b>{item.restaurant}</b>
                </ChromeLink>
              ))}
            </div>
          </div>
        )}
        <div className="discovery-panel">
          <label className="filter-search">
            <Search />
            <input
              value={dealQuery}
              onChange={(e) => setDealQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") runDiscovery({ q:(e.currentTarget as HTMLInputElement).value || null }); }}
              placeholder={t("filters.searchPlaceholder")}
              aria-label={t("filters.searchAria")}
            />
          </label>
          <label>
            <span>{t("filters.cuisine")}</span>
            <select
              aria-label={t("filters.cuisineAria")}
              value={cuisine}
              onChange={(e) => { setCuisine(e.target.value); runDiscovery({ cuisine:e.target.value === "All cuisines" ? null : e.target.value }); }}
            >
              {cuisines.map((c) => (
                <option key={c} value={c}>{c === "All cuisines" ? t("filters.allCuisines") : cuisineLabel(c, locale)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>{t("filters.sortBy")}</span>
            <select
              value={sort}
              onChange={(e) => { setSort(e.target.value); runDiscovery({ sort:e.target.value }); }}
            >
              <option value="recommended">{t("filters.sortRecommended")}</option>
              <option value="distance" disabled={!userPosition && !resolvedLocation}>{t("filters.sortNearest")}</option>
              <option value="recently_added">{t("filters.sortNewest")}</option>
              <option value="most_saved">{t("filters.sortMostSaved")}</option>
              <option value="highest_savings">{t("filters.sortHighestSavings")}</option>
              <option value="price_low">{t("filters.sortPriceLow")}</option>
              <option value="price_high">{t("filters.sortPriceHigh")}</option>
              <option value="restaurant">{t("filters.sortRestaurant")}</option>
            </select>
          </label>
        </div>
        <div className="filter-toggle-row" role="group" aria-label={t("filters.quickFiltersAria")}>
          <label><input type="checkbox" checked={availableNow} onChange={(event) => {setAvailableNow(event.target.checked);runDiscovery({availableNow:event.target.checked ? "true" : null});}}/><span>{t("filters.availableNow")}</span></label>
          <label><input type="checkbox" checked={verifiedOnly} onChange={(event) => {setVerifiedOnly(event.target.checked);runDiscovery({verifiedOnly:event.target.checked ? "true" : null});}}/><span>{t("filters.verifiedOnly")}</span></label>
          <i className="toggle-divider" aria-hidden="true" />
          {/* Multi-select $ chips rather than a single "max price" dropdown: both intents are
              real on a deals site ("anything cheap" and "only the upscale ones"), and a dropdown
              can express one or the other but not both. */}
          <span className="filter-toggle-row-label" id="price-filter-label">{t("filters.price")}</span>
          <div className="price-tier-filter" role="group" aria-labelledby="price-filter-label">
            {PRICE_TIERS.map((tier) => {
              const on = priceTiers.includes(tier);
              const label = priceTierLabel(tier, locale) || String(tier);
              return (
                <button
                  type="button"
                  key={tier}
                  className={on ? "active" : ""}
                  aria-pressed={on}
                  title={label}
                  onClick={() => togglePriceTier(tier)}
                >
                  <span aria-hidden="true">{priceTierSymbol(tier)}</span>
                  <span className="sr-only">{label}</span>
                </button>
              );
            })}
          </div>
          <i className="toggle-divider" aria-hidden="true" />
          {/* Fast food or a sit-down meal. Two chips rather than a dropdown for the same reason
              the price tiers are chips: with neither on, both kinds are shown, which is what most
              people want and what a dropdown would need a third "either" row to say. */}
          <span className="filter-toggle-row-label" id="service-style-label">{t("filters.serviceStyle")}</span>
          <div className="service-style-filter" role="group" aria-labelledby="service-style-label">
            {SERVICE_STYLES.map((style) => (
              <button
                type="button"
                key={style}
                className={serviceStyles.includes(style) ? "active" : ""}
                aria-pressed={serviceStyles.includes(style)}
                onClick={() => toggleServiceStyle(style)}
              >
                {serviceStyleLabel(style)}
              </button>
            ))}
          </div>
          <i className="toggle-divider" aria-hidden="true" />
          <span className="filter-toggle-row-label">{t("filters.popular")}</span>
          {popularSearches.map((term) => (
            <button type="button" key={term} aria-pressed={dealQuery === term} onClick={() => { setDealQuery(term); runDiscovery({ q:term }); }} className={dealQuery === term ? "active" : ""}>{t(`filters.popularTerms.${term}`)}</button>
          ))}
        </div>
        {filtersActive && (
          <div className="active-filter-chips" role="group" aria-label={t("filters.activeFiltersAria")}>
            <span>{t("filters.filteringBy")}</span>
            {/* Each chip is named for what pressing it does; the visible value stays in the name. */}
            {dealQuery && <button aria-label={t("filters.removeFilterAria", { label: t("filters.search", { term: dealQuery }) })} onClick={() => { setDealQuery(""); runDiscovery({ q:null }); }}>{t("filters.search", { term: dealQuery })} <X /></button>}
            {cat !== "All deals" && <button aria-label={t("filters.removeFilterAria", { label: categoryLabel(cat, locale) })} onClick={() => { setCat("All deals"); runDiscovery({ category:null }); }}>{categoryLabel(cat, locale)} <X /></button>}
            {cuisine !== "All cuisines" && <button aria-label={t("filters.removeFilterAria", { label: cuisineLabel(cuisine, locale) })} onClick={() => { setCuisine("All cuisines"); runDiscovery({ cuisine:null }); }}>{cuisineLabel(cuisine, locale)} <X /></button>}
            {availableNow && <button aria-label={t("filters.removeFilterAria", { label: t("filters.availableNow") })} onClick={() => {setAvailableNow(false);runDiscovery({availableNow:null});}}>{t("filters.availableNow")} <X/></button>}
            {verifiedOnly && <button aria-label={t("filters.removeFilterAria", { label: t("filters.verifiedOnly") })} onClick={() => {setVerifiedOnly(false);runDiscovery({verifiedOnly:null});}}>{t("filters.verifiedOnly")} <X/></button>}
            {priceTiers.map((tier) => <button key={tier} aria-label={t("filters.removeFilterAria", { label: priceTierLabel(tier, locale) || priceTierSymbol(tier) || String(tier) })} onClick={() => togglePriceTier(tier)}>{priceTierSymbol(tier)} <X/></button>)}
            {serviceStyles.map((style) => <button key={style} aria-label={t("filters.removeFilterAria", { label: serviceStyleLabel(style) })} onClick={() => toggleServiceStyle(style)}>{serviceStyleLabel(style)} <X/></button>)}
            <button className="clear-filters" onClick={clearFilters}>{t("filters.clearFilters")}</button>
          </div>
        )}
        <div className="toolbar">
          <div className="filters">
            {cats.map((c) => (
              <button
                className={cat === c ? "active" : ""}
                aria-pressed={cat === c}
                onClick={() => { setCat(c); runDiscovery({ category:c === "All deals" ? null : c }); }}
                key={c}
              >
                {c === "All deals" ? t("filters.allDeals") : categoryLabel(c, locale)}
              </button>
            ))}
          </div>
          {vertical === defaultVertical && (
            <button type="button" role="switch" aria-checked={showChains} className="chains-toggle" onClick={toggleChains}>
              <span className="chains-switch" aria-hidden="true" />
              {tNational("toggle")}
            </button>
          )}
        </div>
        {/* National chains, in a section of their own: the promotions Radar holds no branches for
            (drizzle/0050), placed by whether the chain trades in the state searched, and every
            national chain's branch deals near the reader (drizzle/0051) - which the list below
            leaves out, in both markets. Shown when the reader turns chains on, and fetched only
            then: until they do, the page is the local list. */}
        {vertical === defaultVertical && showChains && (
          <NationalDeals
            country={activeMarket}
            region={resolvedLocation && !deviceSearch && marketOf(resolvedLocation.country) === activeMarket ? resolvedLocation.region : null}
            near={resolvedLocation ? { latitude: resolvedLocation.latitude, longitude: resolvedLocation.longitude, radius: appliedRadius } : null}
            query={appliedQuery}
            locale={locale}
            onVisit={(deal) => { pushRecentlyViewed({ ...deal, emoji: deal.emoji || "" }); rememberReturn(); }}
          />
        )}
        {loading ? (
          <div className="deal-grid skeleton-grid" aria-busy="true" aria-label={t("skeletonAria")}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div className="skeleton-card" key={i}>
                <div className="skeleton-media" />
                <div className="skeleton-line w60" />
                <div className="skeleton-line w40" />
                <div className="skeleton-line w80" />
              </div>
            ))}
          </div>
        ) : (
          <div className="deal-grid">
            {visible.map((d, i) => (
              // The whole card is a click target to the deal page (matching its pointer cursor) —
              // every real control inside it (heart, share, directions, menu, choose-location,
              // the title link, View details) stops propagation so it keeps its own behavior
              // instead of double-navigating. Keyboard users reach the same page via the title
              // link or "View details" link below, both real anchors already in the tab order.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/click-events-have-key-events
              <article
                className={`deal ${["peach", "yellow", "mint", "blue", "lilac", "rose"][i % 6]}`}
                key={d.id}
                style={{ animationDelay: `${Math.min(i, 11) * 35}ms` }}
                onClick={() => {
                  pushRecentlyViewed(d);
                  rememberReturn();
                  visitDeal(d);
                }}
              >
                <CardMedia website={d.restaurant_website} photoUrl={d.photo_url || d.restaurant_photo_url} logoUrl={d.restaurant_logo_url} emoji={d.emoji} emojiClassName="food" className="card-media">
                  <div className="card-top">
                    <div className="card-top-left">
                      <BrandLogo name={d.restaurant} website={d.restaurant_website} logoUrl={d.restaurant_logo_url} />
                      <span className="tag">{dealTagLabel(d, locale)}</span>
                    </div>
                    <button
                      className={`heart ${saved.includes(d.id) ? "saved" : ""}`}
                      aria-label={t("dealCard.save", { restaurant: d.restaurant })}
                      aria-pressed={saved.includes(d.id)}
                      title={saved.includes(d.id) ? t("dealCard.removeSaved") : t("dealCard.saveThis")}
                      onClick={(e) => {
                        e.stopPropagation();
                        favorite(d.id);
                      }}
                    >
                      <Heart fill="currentColor" />
                    </button>
                  </div>
                </CardMedia>
                <div className="deal-copy">
                  <div className="pill-row">
                    {/* Paid placement is ranked first (app/api/deals/route.ts), so it is labelled where it is ranked, not only on its own page: Terms §9 promises it, and an unlabelled paid listing at the top of the results is the native ad the FTC and the Competition Act are about. */}
                    {d.sponsored ? <span className="sponsored-badge">{t("dealCard.sponsored")}</span> : null}
                    {/* From the schedule, per request: the stored "Tonight" category said it of a Monday wing night every day. */}
                    {d.tonight && <span className="price-tier-pill tonight-pill">{dealLabels(locale).tonight}</span>}
                    <span className="cuisine-pill">{d.cuisine_label || cuisineLabel(d.cuisine, locale)}</span>
                    {priceTierSymbol(d.price_tier) && <span className="price-tier-pill" title={priceTierLabel(d.price_tier, locale) || undefined}>{priceTierSymbol(d.price_tier)}</span>}
                    {showCurrency && marketOf(d.country) && (
                      <span className="market-pill" title={tMarket(marketOf(d.country) === "US" ? "pricesUS" : "pricesCA")}>
                        {tMarket(marketOf(d.country) === "US" ? "chipUS" : "chipCA")}
                      </span>
                    )}
                    <RedemptionPill redemption={d.redemption} promoCode={d.promo_code} note={d.redemption_note} />
                    {/* Only above a threshold — a "2 saved" pill reads as evidence nobody wants this deal, the opposite of the social proof it's meant to be. */}
                    {(d.save_count || 0) >= 5 && <span className="save-count-pill"><Heart fill="currentColor" />{t("dealCard.savedCount", { count: d.save_count || 0 })}</span>}
                  </div>
                  <h3 className="restaurant-name">
                    <ChromeLink className="deal-title-link" onClick={(e) => { e.stopPropagation(); pushRecentlyViewed(d); rememberReturn(); }} href={dealPath(d)}>{d.restaurant}</ChromeLink>
                    {d.is_chain && <i className="chain-badge">{t("dealCard.chain")}</i>}
                    {/* The counterweight to the chain badge: a screen of Tim Hortons and Boston Pizza is
                        what a reader scrolls past, and this is the one word that tells them a line is worth
                        stopping on. Editorial, not derived - see drizzle/0045_hidden_gem.sql. */}
                    {d.hidden_gem && <i className="gem-badge">{t("dealCard.hiddenGem")}</i>}
                    {expiringSoonLabel(d.expires_at, locale, d.expiry_timezone) && <span className={`expiring-badge${hasExpired(d.expires_at) ? " expired" : ""}`}>{expiringSoonLabel(d.expires_at, locale, d.expiry_timezone)}</span>}
                  </h3>
                  <p className="deal-offer-line">{d.title}</p>
                  <p>
                    {/* A brand Radar only knows one address for is a chain in name and a single
                        restaurant in practice, and "1 confirmed location" tells a reader strictly
                        less than the street it is on. Count locations, not the chain flag. */}
                    <MapPin /> {brandLocationCount(d) > 1 ? t(confirmedLocationCount(d) === 1 || !d.participating_locations ? "dealCard.confirmedLocation" : "dealCard.confirmedLocations", { count: confirmedLocationCount(d) }) : `${d.city} · ${d.address}`}
                    {d.distance_km != null && ` · ${t("dealCard.away", { distance: formatDistance(d.distance_km,radiusUnit) })}`}
                  </p>
                  {d.availability && <p className={`availability-line ${d.availability_phase === "now" ? "available" : d.availability_phase === "upcoming" ? "upcoming" : ""}`}><Clock3 /> {d.availability}</p>}
                  {endDateLabel(d.expires_at, locale, d.expiry_timezone) && <p className="end-date-line"><CalendarClock /> {t("dealCard.endsLabel", { date: endDateLabel(d.expires_at, locale, d.expiry_timezone)! })}</p>}
                  {d.distance_km == null && userPosition && cityCenters[d.city] && (
                    <p className="distance-line">
                      <LocateFixed />
                      {" "}{t("dealCard.away", { distance: formatDistance(kmBetween(userPosition, cityCenters[d.city]),radiusUnit) })}{" "}
                      {t("dealCard.approxDistance")}
                    </p>
                  )}
                  {(() => {
                    const offers = offersForCard(d);
                    // One offer, or none to speak of, reads as it always did.
                    if (offers.length < 2) return (
                      <div className="time">
                        <Clock3 />
                        {d.schedule}
                        <b>{d.price}</b>
                      </div>
                    );
                    // Four is a week of nightly specials, which is the shape this exists for.
                    // Past that the card would out-grow the grid, so the rest are counted.
                    const shown = offers.slice(0, 4);
                    return (
                      <div className="time offer-week">
                        {shown.map((offer) => (
                          <span className={`offer-week-row${offer.available_today ? " today" : ""}`} key={`${offer.schedule}|${offer.title}`}>
                            <Clock3 />
                            <i>{offer.schedule}</i>
                            <b>{offer.title}</b>
                          </span>
                        ))}
                        {offers.length > shown.length && (
                          <span className="offer-week-more">{t("dealCard.moreOffers", { count: offers.length - shown.length })}</span>
                        )}
                      </div>
                    );
                  })()}
                  {d.is_chain && d.offer_varies_by_location && (
                    <p className="distance-line">{t("dealCard.priceVariesByLocation")}</p>
                  )}
                  <div className="card-actions">
                    <ChromeLink onClick={(e) => { e.stopPropagation(); pushRecentlyViewed(d); rememberReturn(); }} href={dealPath(d)}>
                      {t("dealCard.viewDetails")}
                    </ChromeLink>
                    {brandLocationCount(d) <= 1 && (
                      <a
                        onClick={(e) => e.stopPropagation()}
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${d.restaurant} ${d.address} ${d.city}`)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("dealCard.directions")}
                      </a>
                    )}
                    {brandLocationCount(d) > 1 ? (
                      <button onClick={(e) => { e.stopPropagation(); openDeal(d); }}>{t("dealCard.chooseLocation")}</button>
                    ) : (
                      <a onClick={(e) => e.stopPropagation()} href={d.source_url} target="_blank" rel="noreferrer">{t("dealCard.menu")}</a>
                    )}
                    <button
                      aria-label={t("dealCard.share", { restaurant: d.restaurant })}
                      onClick={async (e) => {
                        e.stopPropagation();
                        const url = new URL(`/deals/${encodeURIComponent(d.slug || d.id)}`,location.origin).toString();
                        try {
                          if (navigator.share) await navigator.share({ title: `${d.restaurant} — ${d.title}`, url });
                          else { await navigator.clipboard.writeText(url); setNotice(t("notices.shareLinkCopied")); }
                        } catch { /* A canceled native share is not an error. */ }
                      }}
                    >
                      <Share2 />
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}{" "}
        {!loading && nextCursor && (
          <button className="load-more" onClick={() => {
            const params = new URLSearchParams(location.search);
            params.set("cursor",nextCursor);
            loadDeals(`?${params}`,true);
          }}>{t("loadMore")}</button>
        )}
        {!loading && totalMatches > 0 && totalMatches < 4 && radius < 50 && (
          <button className="expand-radius" onClick={() => {
            const expanded = radius < 5 ? 5 : radius < 10 ? 10 : radius < 25 ? 25 : 50;
            setRadius(expanded); runDiscovery({ radius:expanded });
          }}>{t("expandRadius")}</button>
        )}
        {!loading && !visible.length && (
          <div className="empty">
            <div aria-hidden="true">🍽️</div>
            <h3>{t("empty.heading")}</h3>
            <p>{t("empty.body")}</p>
            {/* A search for "Tim Hortons" with chains off finds nothing here, since this list never
                holds them: saying why is the difference between an empty page and a hidden one. */}
            {vertical === defaultVertical && !showChains && (
              <p className="empty-chains">
                {tNational("hidden")}{" "}
                <button type="button" onClick={toggleChains}>{tNational("showChains")}</button>
              </p>
            )}
            <button
              onClick={() => {
                setCat("All deals");
                setCuisine("All cuisines");
                setDealQuery("");
                setPostal("");
                setArea("Across North America");
                setCoverage("covered");
                setUserPosition(null);
                // Everything in the country being browsed, not everything in both.
                history.replaceState(null, "", market ? `${location.pathname}?country=${market}` : location.pathname);
                loadDeals(market ? `?country=${market}` : "");
              }}
            >
              {t("empty.showAll")}
            </button>
          </div>
        )}
      </section>
      {recentChecks}
      <section className="restaurant-value" id="for-restaurants">
        <div className="restaurant-value-intro">
          <span className="kicker">{t("forRestaurantsSection.kicker")}</span>
          <h2>{t("forRestaurantsSection.heading")}</h2>
          <p>{t("forRestaurantsSection.body")}</p>
          {/* A ChromeLink, like the bottom nav's and the header's: a page load of the baked page for
              a reader without a session cookie, a client-side navigation for one with it. */}
          <ChromeLink className="primary" href="/for-restaurants">{t("forRestaurantsSection.cta")}</ChromeLink>
        </div>
        <div className="restaurant-benefits">
          <article><b>01</b><div><h3>{t("forRestaurantsSection.benefit1Title")}</h3><p>{t("forRestaurantsSection.benefit1Body")}</p></div></article>
          <article><b>02</b><div><h3>{t("forRestaurantsSection.benefit2Title")}</h3><p>{t("forRestaurantsSection.benefit2Body")}</p></div></article>
          <article><b>03</b><div><h3>{t("forRestaurantsSection.benefit3Title")}</h3><p>{t("forRestaurantsSection.benefit3Body")}</p></div></article>
        </div>
      </section>
      {/* The iPhone tease. No ship date on purpose: the App Store review queue and a bank
          verification neither of us controls sit between this page and the app, and a date
          printed here that slips is a worse first impression than no date at all. */}
      <section className="app-teaser" aria-labelledby="app-teaser-heading">
        <div className="app-teaser-copy">
          <span className="kicker">{t("appTeaser.kicker")}</span>
          <h2 id="app-teaser-heading">
            {t("appTeaser.headingLine1")}
            <br />
            {t("appTeaser.headingLine2")}
          </h2>
          <p>{t("appTeaser.body")}</p>
          {appLeadStatus === "done" ? (
            <p className="lead-capture-done">{t("appTeaser.leadCaptureDone")}</p>
          ) : (
            // onFocus is React's bubbling focusin, so focusing the address or the button arms the
            // challenge; the pointer covers Safari, where pressing a button does not focus it.
            <form className="lead-capture" onSubmit={captureAppLead} onFocus={appLeadTurnstile.arm} onPointerDown={appLeadTurnstile.arm}>
              <input
                type="email"
                name="email"
                required
                aria-label={t("suggestModal.emailLabel")}
                aria-invalid={appLeadStatus === "error" || undefined}
                autoComplete="email"
                placeholder={t("appTeaser.leadCapturePlaceholder")}
                value={appLeadEmail}
                onChange={(e) => setAppLeadEmail(e.target.value)}
              />
              {appLeadTurnstile.widget}
              <button disabled={appLeadStatus === "busy"}>
                <Bell /> {appLeadStatus === "busy" ? t("appTeaser.leadCaptureSending") : t("appTeaser.leadCaptureCta")}
              </button>
              {appLeadStatus === "error" && <small className="field-error" role="alert">{t("appTeaser.leadCaptureError")}</small>}
              {/* CASL: express consent is only express if it says what it is consent for, and an
                  unsubscribe has to exist before the first send, not after someone asks. */}
              <small className="lead-capture-or">{t("appTeaser.leadCaptureConsent")}</small>
            </form>
          )}
        </div>
        <div className="app-teaser-art" aria-hidden="true">
          <div className="app-teaser-phone">
            <span className="app-teaser-pin app-teaser-pin-1">🍺</span>
            <span className="app-teaser-pin app-teaser-pin-2">🍕</span>
            <span className="app-teaser-pin app-teaser-pin-3">🍣</span>
            <span className="app-teaser-live">● {t("appTeaser.onNow")}</span>
          </div>
        </div>
      </section>
      <section className="community">
        <div className="community-art" aria-hidden="true">
          <span>🍳</span>
          <span>🥐</span>
          <span>☕</span>
          <i />
        </div>
        <div className="community-title">
          <span className="kicker">{t("community.kicker")}</span>
          <h2>
            {t("community.headingLine1")}
            <br />
            {t("community.headingLine2")}
          </h2>
        </div>
        <div className="community-copy">
          <p>{t("community.body")}</p>
          {session ? (
            <button onClick={() => navigate("/dashboard/alerts")}>
              <Bell /> {t("community.cta")}
            </button>
          ) : leadStatus === "done" ? (
            <p className="lead-capture-done">{t("community.leadCaptureDone")}</p>
          ) : (
            <form className="lead-capture" onSubmit={captureLead} onFocus={leadTurnstile.arm} onPointerDown={leadTurnstile.arm}>
              <input
                type="email"
                name="email"
                required
                aria-label={t("suggestModal.emailLabel")}
                aria-invalid={leadStatus === "error" || undefined}
                autoComplete="email"
                placeholder={t("community.leadCapturePlaceholder")}
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
              />
              {leadTurnstile.widget}
              <button disabled={leadStatus === "busy"}>
                <Bell /> {leadStatus === "busy" ? t("community.leadCaptureSending") : t("community.leadCaptureCta")}
              </button>
              {leadStatus === "error" && <small className="field-error" role="alert">{t("community.leadCaptureError")}</small>}
              <small className="lead-capture-or">
                {t("community.leadCaptureOr")} <ChromeLink href={`/sign-in?redirect_url=${encodeURIComponent(`/${locale}/dashboard/alerts`)}`}>{t("community.cta")}</ChromeLink>
              </small>
            </form>
          )}
        </div>
      </section>
      </>
      )}
      </div>
      <section className="faq" id="faq" aria-labelledby="faq-heading">
        <div className="faq-intro">
          <span className="kicker">{t("faq.kicker")}</span>
          <h2 id="faq-heading">{t("faq.heading")}</h2>
        </div>
        <div className="faq-list">
          {(["q1", "q2", "q3", "q4"] as const).map((key) => (
            <details key={key} className="faq-item">
              <summary>{t(`faq.${key}.question`)}</summary>
              <p>{t(`faq.${key}.answer`)}</p>
            </details>
          ))}
        </div>
      </section>
      </main>
      <SiteFooter onSuggest={() => setSuggest(true)} />
      <nav className="mobile-bottom-nav" aria-label={t("mobileNav.label")}><a href="#results"><Search/><span>{t("mobileNav.explore")}</span></a><ChromeLink href={accountHref("saved")}><Heart/><span>{t("mobileNav.saved")}</span></ChromeLink><ChromeLink href={accountHref("alerts")}><Bell/><span>{t("mobileNav.alerts")}</span></ChromeLink><button onClick={() => setSuggest(true)}><Send/><span>{t("mobileNav.suggest")}</span></button><ChromeLink href={accountHref("account")}><UserRound/><span>{t("mobileNav.account")}</span></ChromeLink></nav>
      {/* Gated behind the same scroll threshold as back-to-top: rendered unconditionally, this
          fixed button used to sit on top of the hero search box and filter/sort controls near
          the top of the page (confirmed overlapping the "Sort by" select on mobile) — waiting
          until the visitor has scrolled past that zone means it only ever overlaps deal-card
          imagery, not anything interactive. */}
      {showBackToTop && (
        <button
          className="feedback-fab"
          onClick={() => {
            setFeedbackDealId(null);
            setFeedback(true);
            setFeedbackSent(false);
          }}
        >
          <Send /> {t("feedbackFab")}
        </button>
      )}
      {showBackToTop && (
        <button
          className="back-to-top"
          aria-label={t("backToTop")}
          onClick={() => document.querySelector("#top")?.scrollIntoView({ behavior: "smooth" })}
        >
          <ArrowUp />
        </button>
      )}
      {feedback && (
        // Backdrop click-to-dismiss is a mouse-only convenience; full keyboard access
        // (focus trap, Escape, focus restore) is already implemented via the dialogKind effect above.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="overlay" onMouseDown={() => setFeedback(false)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            className="modal feedback-modal"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label={t("feedbackModal.closeAria")}
              onClick={() => setFeedback(false)}
            >
              <X />
            </button>
            {feedbackSent ? (
              <div className="success">
                <div>✓</div>
                <h2 id="feedback-title" tabIndex={-1}>{t("feedbackModal.thankYouHeading")}</h2>
                <p>{t("feedbackModal.thankYouBody")}</p>
                <button className="primary" onClick={() => setFeedback(false)}>
                  {t("feedbackModal.done")}
                </button>
              </div>
            ) : (
              <>
                <span className="kicker">{t("feedbackModal.kicker")}</span>
                <h2 id="feedback-title">{t("feedbackModal.heading")}</h2>
                <form onSubmit={sendFeedback}>
                  <label>
                    {t("feedbackModal.typeLabel")}
                    <select
                      name="type"
                      defaultValue={selected ? "incorrect_deal" : "bug"}
                    >
                      <option value="bug">{t("feedbackModal.typeBug")}</option>
                      <option value="confusing">{t("feedbackModal.typeConfusing")}</option>
                      <option value="incorrect_deal">
                        {t("feedbackModal.typeIncorrectDeal")}
                      </option>
                      <option value="feature">{t("feedbackModal.typeFeature")}</option>
                    </select>
                  </label>
                  <label>
                    {t("feedbackModal.messageLabel")}
                    <textarea
                      name="message"
                      minLength={10}
                      maxLength={2000}
                      required
                      placeholder={t("feedbackModal.messagePlaceholder")}
                    />
                  </label>
                  <Turnstile siteKey={turnstileSiteKey} />
                  <button className="primary">
                    <Send /> {t("feedbackModal.send")}
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
      {selected && (
        // Backdrop click-to-dismiss is a mouse-only convenience; full keyboard access
        // (focus trap, Escape, focus restore) is already implemented via the dialogKind effect above.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="overlay" onMouseDown={() => setSelected(null)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
          <section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="detail-title"
            className="modal detail"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              aria-label={t("detailModal.closeAria")}
              onClick={() => setSelected(null)}
            >
              <X />
            </button>
            <CardMedia website={selected.restaurant_website} photoUrl={selected.restaurant_photo_url} logoUrl={selected.restaurant_logo_url} emoji={selected.emoji} className="detail-art" sizes="(max-width: 600px) 100vw, 500px">
              <BrandLogo name={selected.restaurant} website={selected.restaurant_website} logoUrl={selected.restaurant_logo_url} className="brand-logo-lg" />
            </CardMedia>
            <span className="tag">
              {categoryLabel(activeOffer?.category || selected.category, locale)} · {chosenChainLocation?.city || selected.city}
            </span>
            {expiringSoonLabel(selected.expires_at, locale, selected.expiry_timezone) && <span className={`expiring-badge${hasExpired(selected.expires_at) ? " expired" : ""}`}>{expiringSoonLabel(selected.expires_at, locale, selected.expiry_timezone)}</span>}
            <h2 id="detail-title">{selected.restaurant}</h2>
            {selected.hidden_gem && <p className="gem-note"><b>{t("dealCard.hiddenGem")}</b></p>}
            <p className="deal-offer-line">{activeOffer?.title || selected.title}</p>
            {selected.is_chain && (
              <p className="chain-note">
                <b>{t("detailModal.chainRestaurant")}</b> ·{" "}
                {selected.offer_varies_by_location
                  ? t("detailModal.priceVariesChoose")
                  : t("detailModal.availabilityVaries")}
              </p>
            )}
            {!selected.is_chain && <p>{selected.address}</p>}
            {selected.is_chain && (chainBranchOptions.length >= BRANCH_SEARCH_MIN ? (
              <BranchPicker
                options={chainBranchOptions}
                value={chainLocation}
                onChange={(address) => { setChainLocation(address); setOfferIndex(null); }}
                caption={t("detailModal.chooseOfferLocation")}
                note={` · ${t("dealCard.confirmedLocations", { count: chainBranchOptions.length })}`}
              />
            ) : (
              /* Short lists keep the native control. On a phone it opens the system picker, which
                 is one tap and no typing - a text filter over five addresses is worse than the
                 thing it replaces. */
              <label className="chain-picker">
                <span>{t("detailModal.chooseOfferLocation")}</span>
                <select value={chainLocation} onChange={(e) => { setChainLocation(e.target.value); setOfferIndex(null); }}>
                  <option value="">{t("detailModal.selectAddress")}</option>
                  {chainBranchOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                </select>
              </label>
            ))}
            {locationOffers.length > 1 && (
              // This address runs more than one deal — a different one on each night of the week,
              // typically. Without this the card showed whichever the API happened to list first
              // and the rest could not be reached at all.
              <div className="location-offer-switch" role="group" aria-label={t("detailModal.chooseOfferLocation")}>
                {locationOffers.map((offer, index) => (
                  <button
                    key={offer.id}
                    type="button"
                    className={index === shownIndex ? "on" : ""}
                    aria-pressed={index === shownIndex}
                    onClick={() => setOfferIndex(index)}
                  >
                    <b>{offer.title}</b>
                    <small>{offer.schedule}</small>
                  </button>
                ))}
              </div>
            )}
            {selected.is_chain && (selected.other_brand_locations?.length || 0) > 0 && (
              <details className="other-chain-locations">
                <summary>{t("detailModal.otherLocations", { brand: selected.chain_brand || "" })}</summary>
                <p>{t("detailModal.otherLocationsNote")}</p>
                <ul>{selected.other_brand_locations?.map((location) => <li key={`${location.city}-${location.address}`}>{location.city} · {location.address}</li>)}</ul>
              </details>
            )}
            {chosenChainLocation && <p className="chosen-location"><MapPin /> {chosenChainLocation.address}, {chosenChainLocation.city}</p>}
            <div className="detail-stats">
              <span>
                <Clock3 />
                {activeOffer?.schedule || selected.schedule}
              </span>
              <span>
                <Star fill="currentColor" />
                {activeOffer?.price || selected.price}
                {priceTierSymbol(selected.price_tier) && ` · ${priceTierSymbol(selected.price_tier)}`}
              </span>
              <span>
                <MapPin />
                {chosenChainLocation?.postal_prefix || selected.postal_prefix} {t("detailModal.areaSuffix")}
              </span>
              <span>
                <Star fill="currentColor" />
                {/* An unchecked deal's verified_at is when it was imported, not a check - see verificationState. */}
                {verificationState(selected) === "unchecked"
                  ? dealLabels(locale).listed(readerDate(selected.created_at || selected.verified_at, locale))
                  : `${verificationStatusLabel(selected.effective_verification_status, locale)} · ${t("detailModal.checkedOn", { date: readerDate(selected.verified_at, locale) })}`}
              </span>
              <span>
                <CalendarClock />
                {endDateLabel(selected.expires_at, locale, selected.expiry_timezone) ? t("dealCard.endsLabel", { date: endDateLabel(selected.expires_at, locale, selected.expiry_timezone)! }) : t("detailModal.noEndDate")}
              </span>
            </div>
            {selected.terms && (
              <p>
                <b>{t("detailModal.termsLabel")}</b> {selected.terms}
              </p>
            )}
            {selected.restrictions && (
              <p>
                <b>{t("detailModal.restrictionsLabel")}</b> {selected.restrictions}
              </p>
            )}
            {(!selected.is_chain || chosenChainLocation) && (
              <a className="primary linkprimary" href={activeOffer?.source_url || chosenChainLocation?.source_url || selected.source_url} target="_blank" rel="noreferrer">{t("detailModal.openWebsite")}</a>
            )}
            {selected.is_chain && chosenChainLocation && (
              <a className="secondary linkprimary" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${selected.restaurant} ${chosenChainLocation.address} ${chosenChainLocation.city}`)}`} target="_blank" rel="noreferrer">{t("detailModal.directionsToLocation")}</a>
            )}
            <button className="secondary" onClick={() => favorite(selected.id)}>
              {saved.includes(selected.id) ? t("detailModal.saved") : t("detailModal.saveThisSpot")}
            </button>
            <button
              className="report-link"
              onClick={() => {
                setFeedbackDealId(selected.id);
                setSelected(null);
                setFeedback(true);
                setFeedbackSent(false);
              }}
            >
              {t("detailModal.reportIncorrect")}
            </button>
            <small>
              {t("detailModal.confirmNote")}
            </small>
          </section>
        </div>
      )}
      {suggest && (
        <div className="overlay">
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="suggest-title" className="modal submit">
            <button
              className="close"
              aria-label={t("suggestModal.closeAria")}
              onClick={() => {
                setSuggest(false);
                setSubmitted(false);
                setSuggestError(null);
              }}
            >
              <X />
            </button>
            {submitted ? (
              <div className="success">
                <div>✓</div>
                <h2 id="suggest-title" tabIndex={-1}>{t("suggestModal.greatFind")}</h2>
                <p>{t("suggestModal.pendingReview")}</p>
                <button className="primary" onClick={() => setSuggest(false)}>
                  {t("suggestModal.done")}
                </button>
              </div>
            ) : (
              <>
                <span className="kicker">{t("suggestModal.kicker")}</span>
                <h2 id="suggest-title">{t("suggestModal.heading")}</h2>
                {suggestError && (
                  <p className="form-error" role="alert">
                    {suggestError.message}
                  </p>
                )}
                <form onSubmit={submit}>
                  <label>
                    {t("suggestModal.restaurantLabel")}
                    <input name="restaurant" required />
                    {suggestError?.fields?.restaurant && <small className="field-error">{suggestError.fields.restaurant}</small>}
                  </label>
                  <label>
                    {t("suggestModal.dealLabel")}
                    <input name="deal" placeholder={t("suggestModal.dealPlaceholder")} required />
                    {suggestError?.fields?.deal && <small className="field-error">{suggestError.fields.deal}</small>}
                  </label>
                  <label>
                    {t("suggestModal.sourceLabel")}
                    <input type="url" name="source" placeholder="https://" required />
                    {suggestError?.fields?.source && <small className="field-error">{suggestError.fields.source}</small>}
                  </label>
                  <div className="form-row">
                    <label>
                      {t("suggestModal.postalLabel")}
                      <input name="postal" required />
                      {suggestError?.fields?.postal && <small className="field-error">{suggestError.fields.postal}</small>}
                    </label>
                    <label>
                      {t("suggestModal.scheduleLabel")}
                      <input name="schedule" required />
                      {suggestError?.fields?.schedule && <small className="field-error">{suggestError.fields.schedule}</small>}
                    </label>
                  </div>
                  <label>
                    {t("suggestModal.relationshipLabel")}
                    <select name="relationship" required defaultValue="">
                      <option value="" disabled>{t("suggestModal.selectOne")}</option>
                      <option value="Owner or manager">{t("suggestModal.ownerManager")}</option>
                      <option value="Employee">{t("suggestModal.employee")}</option>
                      <option value="Customer">{t("suggestModal.customer")}</option>
                      <option value="Other">{t("suggestModal.other")}</option>
                    </select>
                    {suggestError?.fields?.relationship && <small className="field-error">{suggestError.fields.relationship}</small>}
                  </label>
                  <label>
                    {t("suggestModal.emailLabel")}
                    <input
                      type="email"
                      name="email"
                      defaultValue={session?.email || ""}
                      required
                    />
                    {suggestError?.fields?.email && <small className="field-error">{suggestError.fields.email}</small>}
                  </label>
                  <Turnstile siteKey={turnstileSiteKey} />
                  <button className="primary" disabled={suggestBusy}>{suggestBusy ? t("suggestModal.sending") : t("suggestModal.sendForReview")}</button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
    </>
  );
}
