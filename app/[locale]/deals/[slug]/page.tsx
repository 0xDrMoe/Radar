import type { Metadata } from "next";
import { cache } from "react";
import { env } from "cloudflare:workers";
import { notFound, permanentRedirect } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../../../i18n/ClientMessages";
import InfoTip from "../../../InfoTip";
import DetailActions from "./DetailActions";
import OfferLocations from "./OfferLocations";
import AddToCalendar from "./AddToCalendar";
import HelpfulFeedback from "./HelpfulFeedback";
import AlsoHere, { type AlsoHereOffer } from "./AlsoHere";
import { DealView, OfferLink } from "./DealActivity";
import BackToResults from "./BackToResults";
import ChromeLink from "../../../ChromeLink";
import PromoCode from "./PromoCode";
import BrandLogo from "../../../BrandLogo";
import CardMedia from "../../../CardMedia";
import { photoSrc } from "../../../photo-url";
import PublicPage from "../../../PublicPage";
import LocalTime from "../../../LocalTime";
import { getAppUser } from "../../../auth";
import { normalizedPostal, validPostal } from "../../../api-utils";
import { regionCode } from "../../../geocode";
import { provinceForPostal, regionForZip } from "../../../zip-regions";
import { kmBetween, safeReturnPath, weekRank } from "../../../search";
import { similarDealsQuery } from "../../../similar-deals";
import { isSupportedLocale } from "../../../i18n/dealLabels";
import { categoryLabel, cuisineLabel } from "../../../i18n/staticEnums";
import { expiringSoonLabel, expiryTimeZone, lastDayIso, lastDayLongLabel, priceTierSymbol, priceTierLabel, estimatePriceTier, hasExpired, verificationStatusLabel, dateFormatLocale, parseSqlTimestamp, branchConfirmations } from "../../../verification";
import { dateFormatter } from "../../../formatters";
import { ownerConfirmationCurrent } from "../../../owner-confirmation";
import { dealPageVisibility, publicDealPredicate } from "../../../deal-lifecycle";
import { underReviewSql } from "../../../accuracy-reports";
import { dealPageTitle, effectiveVerificationStatus, offerPrice, sentences, splitUsFootprint } from "../../../deal-meta";
import { translatedAlternates } from "../../../alternates";
import { getSiteOrigin } from "../../../siteMetadata";
import { CURRENCY, appOnly, displayPromoCode, marketOf, parseRedemption, type RedemptionMethod } from "../../../redemption";
import { regionName } from "../../../region-names";
import { referencesAlcohol } from "../../../alcohol";
import { drinkJurisdiction } from "../../../drink-rules";
import { MIN_CITY_RESTAURANTS, cityDeals, cityPath, citySlug, guidePlacement, restaurantCount, type CityKey } from "../../../city-pages";

// The catalog key for each way of redeeming an offer (messages: redemption.*).
const METHOD_KEY: Record<RedemptionMethod, "methodInStore" | "methodApp" | "methodOnline" | "methodCode"> = {
  in_store: "methodInStore", app: "methodApp", online: "methodOnline", code: "methodCode",
};

/** A link Radar may render as an href: https only, so no stored value can become a script URL. */
const safeHref = (url: string | null | undefined) => (url && /^https:\/\//i.test(url) ? url : null);

export const dynamic = "force-dynamic";

/**
 * How many addresses this page will hand the browser at once.
 *
 * A national chain promotion runs at every branch: McDonald's is about 13,000 US locations, Subway
 * more than 20,000. Every one of them would otherwise be serialised into the page payload — and
 * into the prerendered copy, three times over, once per locale. The cap is what keeps a chain deal
 * page the same weight as any other.
 *
 * It is not a limit on what a reader can reach. A postal or ZIP code narrows to their own state
 * first, in SQL, so the cap only ever bites on the unscoped page — which is exactly the page whose
 * prompt asks for one.
 */
const LOCATION_LIST_MAX = 250;

interface DealDetailRow {
  /** "fr,es": the locales deal_translations holds a title for, or null for none. */
  translated_locales: string | null;
  id: string;
  restaurant: string;
  title: string;
  category: string;
  cuisine: string;
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
  verified_at: string;
  restaurant_id: string | null;
  location_id: string | null;
  status: string;
  publish_at: string | null;
  expires_at: string | null;
  terms: string | null;
  restrictions: string | null;
  internal_notes: string | null;
  verification_status: string;
  /** 1 while a reader's report that the deal has ended or is wrong waits on staff. */
  under_review: number;
  deleted_at: string | null;
  // A restaurant manager's "still running" from the portal (drizzle/0069): theirs, never a check.
  owner_confirmed_at: string | null;
  slug: string | null;
  description: string | null;
  locale: string;
  discount_percent: number | null;
  savings_cents: number | null;
  updated_at: string;
  canonical_restaurant: string | null;
  restaurant_website: string | null;
  is_chain: number | null;
  hidden_gem: number | null;
  restaurant_photo_url: string | null;
  branch_id: string | null;
  branch_address: string | null;
  branch_city: string | null;
  region: string | null;
  country: string | null;
  phone: string | null;
  official_url: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  /** 'city' when the branch's coordinate is only its city's centre (docs/GEOCODING.md). */
  branch_geo_precision: string | null;
  // 'brand' when the offer runs at every operating branch (drizzle/0049); 'national' when it runs
  // at a chain whose branches Radar does not hold, and the brand row places it (drizzle/0050).
  location_scope: string | null;
  redemption: string | null;
  redemption_note: string | null;
  promo_code: string | null;
  photo_url: string | null;
  restaurant_logo_url: string | null;
  restaurant_gallery: string | null;
  restaurant_country: string | null;
  restaurant_footprint: string | null;
  restaurant_locator_url: string | null;
  created_at: string | null;
  /** 'public' | 'retired' | 'hidden' - see dealPageVisibility in app/deal-lifecycle.ts. */
  page_visibility: string;
  /** 1 when the address asked for is a deal_aliases entry for this row, not its own slug or id. */
  via_alias: number;
  /** 1 when the restaurant has another operating branch, so its title names no city (titleCity). */
  other_branches: number;
}

/** The /api/photo/... paths in restaurants.gallery, or none when it is empty or unreadable. */
function galleryPhotos(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === "string" && url.startsWith("/api/photo/")).slice(0, 6) : [];
  } catch {
    return [];
  }
}

/** The region codes in a national chain's footprint ({"TN": 214, ...}). */
function footprintRegions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    return Object.entries(parsed as Record<string, unknown>).filter(([, n]) => Number(n) > 0).map(([region]) => region.toUpperCase()).sort();
  } catch {
    return [];
  }
}

interface VerificationEventRow {
  status: string;
  method: string;
  source_url: string;
  verified_at: string;
  notes: string | null;
}

// How many of a deal's checks the page reads. The list shows the latest five; the rest are only
// there to date a branch whose own check was older than those (branchConfirmation). No deal has had
// more than three.
const CHECKS_READ = 20;
const CHECKS_SHOWN = 5;

interface DealLocationDetailRow {
  id: string;
  restaurant_id: string;
  address: string;
  city: string;
  region: string | null;
  country: string;
  postal_prefix: string;
  latitude: number | null;
  longitude: number | null;
  geo_precision: string | null;
  timezone: string;
  phone: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  slug: string | null;
  neighborhood: string | null;
  full_postal: string | null;
  official_url: string | null;
  eligibility: string | null;
  eligibility_source: string | null;
  eligibility_verified_at: string | null;
}

interface DealItemRow {
  id: number;
  name: string;
  original_price: string | null;
  discounted_price: string;
}

interface SimilarDealRow {
  id: string;
  slug: string | null;
  restaurant: string;
  title: string;
  price: string;
  schedule: string;
  cuisine: string;
  emoji: string;
}

// Wrapped in React's cache() because both generateMetadata and the component below ask for the
// same deal on the same request, and without it this wide multi-join query ran twice for every
// page view — once to produce a title, once to render. cache() dedupes per request, so the second
// caller gets the first one's result instead of a second round trip and a second row to
// deserialize. Nothing is shared between requests.
//
// Every row is read, whatever its status, and page_visibility says what the page may do with it.
// Filtering in the WHERE clause would make a retired deal indistinguishable from a missing one,
// and a retired deal keeps its page.
//
// The EXISTS reads idx_locations_restaurant_region (restaurant_id, region, city, address) and stops
// at the restaurant's first other branch.
//
// A duplicate listing folded into another keeps its row, archived, with a deal_aliases row naming
// the one kept. Its old address then matches both rows, and a bare LIMIT 1 took whichever SQLite
// read first - usually the archived twin, so the link showed "no longer available" for an offer
// that is live one row over. The public row is preferred, then the row the address names itself;
// `via_alias` tells the page it arrived by an alias, and the page redirects to the kept deal's own
// address. An alias is recorded by the retired deal's id, and the address may carry its slug.
const getDeal = cache(async (slug:string) => {
  return env.DB.prepare(`SELECT d.*,${dealPageVisibility} page_visibility,CASE WHEN d.slug=? OR d.id=? THEN 0 ELSE 1 END via_alias,r.name canonical_restaurant,r.website restaurant_website,r.is_chain,r.hidden_gem,r.photo_url restaurant_photo_url,r.logo_url restaurant_logo_url,r.gallery restaurant_gallery,r.country restaurant_country,r.footprint restaurant_footprint,r.locator_url restaurant_locator_url,l.id branch_id,l.address branch_address,l.city branch_city,l.region,l.country,l.phone,l.official_url,l.timezone,l.latitude,l.longitude,l.geo_precision branch_geo_precision,
    (SELECT group_concat(t.locale) FROM deal_translations t WHERE t.deal_id=d.id AND t.title IS NOT NULL) translated_locales,
    ${underReviewSql("d")} under_review,
    EXISTS(SELECT 1 FROM restaurant_locations x WHERE x.restaurant_id=d.restaurant_id AND x.id<>l.id AND x.status='operating') other_branches
    FROM deals d LEFT JOIN restaurants r ON r.id=d.restaurant_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
    WHERE d.slug=? OR d.id=? OR d.id IN (SELECT canonical_deal_id FROM deal_aliases WHERE alias_id=? OR alias_id IN (SELECT id FROM deals WHERE slug=?))
    ORDER BY CASE WHEN ${publicDealPredicate} THEN 0 ELSE 1 END, via_alias LIMIT 1`).bind(slug,slug,slug,slug,slug,slug).first<DealDetailRow>();
});

// The site's home market, for a deal with no branch to take a zone from. The same fallback
// app/LocalTime.tsx uses for its server-rendered pass, so a date in the meta description and the
// date on the page are the same day.
const HOME_TIME_ZONE = "America/Toronto";
const DATE_STYLE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/**
 * A stored timestamp as the page shows it before hydration: LocalTime's "date" style, in the
 * branch's own time zone. The meta description used to format it with no zone at all, which on
 * the Worker is UTC, and an evening check in Ottawa said one day in search results and another on
 * the page.
 */
function pageDate(value: string | null | undefined, locale: string, timeZone: string | null): string {
  if (!value) return "";
  const date = parseSqlTimestamp(value);
  if (Number.isNaN(date.getTime())) return "";
  const zone = timeZone || HOME_TIME_ZONE;
  return dateFormatter(`deal-page-date|${locale}|${zone}`, dateFormatLocale(locale), { ...DATE_STYLE, timeZone: zone }, DATE_STYLE).format(date);
}

/**
 * The deal's own share card (scripts/deal-og.mjs), drawn at deploy: the offer, the restaurant and
 * when it runs. A slug the generator cannot name a file after, or a deal published since the last
 * deploy, is answered with /og.png by the Worker (the /og/deals/ branch in worker/index.ts), so
 * the address is safe to name either way.
 */
function shareCardPath(deal: DealDetailRow): string {
  const cardSlug = deal.slug || deal.id;
  return /^[A-Za-z0-9._-]+$/.test(cardSlug) ? `/og/deals/${cardSlug}.png` : "/og.png";
}

/** The languages the deal's own words exist in: English, and each locale it has been translated into. */
function translatedLocales(deal: Pick<DealDetailRow, "translated_locales">): string[] {
  return ["en", ...String(deal.translated_locales || "").split(",").map((locale) => locale.trim()).filter((locale) => locale && locale !== "en")];
}

/**
 * The city guide the deal may belong to, judged on the row alone: the city its branch is in, unless
 * it is a national promotion. Only then is the guide read, and the guide still has the last word on
 * whether it exists (MIN_CITY_RESTAURANTS) and whether it lists the deal (guidePlacement).
 */
function guideCityOf(deal: DealDetailRow): CityKey | null {
  const name = (deal.branch_city || deal.city || "").trim();
  const country = deal.country ?? deal.restaurant_country;
  if (deal.location_scope === "national" || !name || !country) return null;
  return { name, region: deal.region || "", country };
}

/**
 * The deal's verification as a reader may be told it - see effectiveVerificationStatus - and
 * "Re-checking" while a reader's report that it has ended or is wrong waits on staff
 * (app/accuracy-reports.ts), as its card says.
 */
function dealVerification(deal: DealDetailRow): string {
  return deal.under_review ? "stale" : checkedStatus(deal);
}

/**
 * The same, leaving reports aside: whether Radar has ever checked the deal, and so whether its
 * verified_at is a check date. A report does not turn an import's date into one.
 */
function checkedStatus(deal: DealDetailRow): string {
  return effectiveVerificationStatus(deal.verification_status, parseSqlTimestamp(deal.verified_at || ""));
}

/**
 * The date shown beside "Listed": when the deal reached Radar. For a deal imported from a
 * directory verified_at is that same moment, which is exactly why it cannot be called a check.
 */
function listedAt(deal: DealDetailRow): string {
  return deal.created_at || deal.verified_at;
}

/**
 * The city a deal's title may name ("Ottawa, ON"): only for a restaurant with a single location,
 * whose offer is in that one city. A chain's or a multi-location restaurant's deal never names one,
 * even when this page is about one of its branches: the offer is the brand's, a searcher looks for
 * it by the brand's name, and a city in the title would read as though it ran there alone. The
 * region goes with the city, so Richmond, BC and Richmond, VA never share a title.
 */
function titleCity(deal: DealDetailRow): string | null {
  if (deal.is_chain || !deal.branch_id || deal.other_branches || deal.location_scope === "brand" || deal.location_scope === "national") return null;
  const city = (deal.branch_city || "").trim();
  const region = (deal.region || "").trim();
  return city ? [city, region].filter(Boolean).join(", ") : null;
}

/**
 * Where the offer is, for the meta description: "1200 Bank St, Ottawa". Nothing for a national or
 * brand-wide deal: the branch the row points at is one of many, not where the offer is.
 */
function dealPlace(deal: DealDetailRow): string {
  if (deal.location_scope === "national" || deal.location_scope === "brand") return "";
  const address = (deal.branch_address || deal.address || "").trim();
  const city = (deal.branch_city || deal.city || "").trim();
  if (address && city && address.toLowerCase().includes(city.toLowerCase())) return address;
  return [address, city].filter(Boolean).join(", ");
}

/**
 * Washington, DC and the territories by name, as one list in the reader's language: "Washington,
 * DC, Puerto Rico and Guam". The territories are ISO region codes, so Intl names them; DC is not
 * one, and comes from the catalog.
 */
function placeList(codes: string[], locale: string, dcName: string): string {
  const language = dateFormatLocale(locale);
  let names: Intl.DisplayNames | null = null;
  try { names = new Intl.DisplayNames([language], { type: "region" }); } catch { /* the codes themselves */ }
  const listed = codes.map((code) => (code === "DC" ? dcName : names?.of(code) || code));
  try { return new Intl.ListFormat(language, { type: "conjunction" }).format(listed); } catch { return listed.join(", "); }
}

// "Closest first" needs a point to measure from: prefer the postal code the visitor searched
// with on the way in (carried through the `return` link back to homepage search), falling back
// to their signed-in account's home postal code. Only reads the postal_cache table that the
// public search path already populates — no live geocoding here, so a cold cache just means no
// distance sort rather than a slow SSR request.
/**
 * Where the reader is, when they have told us — and it is only ever because they told us.
 *
 * This used to answer with coordinates alone, for sorting. It now also answers with a region,
 * because sorting is not enough once a chain is national: a promotion confirmed at every US
 * McDonald's is thousands of addresses, and "closest first" still hands the reader thousands of
 * them. The region is what narrows the list to something a person can read, and postal_cache
 * already stores it beside the coordinates, so knowing it costs nothing extra.
 *
 * Three sources, strongest first:
 *   1. `?postal=` (or `?zip=`) on this page's own URL. The reader typed it, or followed a link
 *      that carried it, and it is the only one that scopes the list.
 *   2. `?return=`, which carries the search they arrived from.
 *   3. A signed-in reader's home postal, which they set once in their dashboard.
 *
 * Nothing here reads an IP address. Cloudflare would hand us a region for free on every request,
 * and a page that silently decided which state you were in — and was wrong — is worse than one
 * that asks. It would also have to be wrong on the prerendered copy, which has no request at all.
 */
export interface VisitorArea {
  // Null when the region came from a ZIP prefix rather than the geocoder's cache: that tells us
  // which state, never whereabouts in it. The list is still narrowed; it just is not sorted by
  // distance, and no card claims a distance it cannot measure.
  latitude: number | null;
  longitude: number | null;
  /** Two-letter state or province code, as restaurant_locations stores it. */
  region: string;
  country: string;
  /** Normalized, as postal_cache keys on it. */
  postal: string;
  /** True when it came from this page's own query string, which is what scopes the list. */
  fromQuery: boolean;
}

type AreaRow = { latitude: number; longitude: number; region: string; country: string };

async function lookupPostal(postal: string): Promise<AreaRow | null> {
  return env.DB.prepare(
    "SELECT latitude,longitude,region,country FROM postal_cache WHERE normalized_postal=? AND status='resolved'",
  ).bind(postal).first<AreaRow>();
}

async function resolveVisitorArea(queryPostal: string | null, rawReturn: string | null): Promise<VisitorArea | null> {
  // Validated before it reaches the database, so a junk query string is a page that ignores it
  // rather than a lookup. validPostal covers both a Canadian A1A1A1 and a US 5- or 9-digit ZIP.
  const fromQuery = queryPostal && validPostal(normalizedPostal(queryPostal)) ? normalizedPostal(queryPostal) : null;
  let postal = fromQuery;
  if (!postal && rawReturn) {
    try { postal = normalizedPostal(new URL(rawReturn, "https://radar.invalid").searchParams.get("postal")) || null; } catch { /* malformed return path — ignore */ }
  }
  if (!postal) {
    const user = await getAppUser();
    if (user) {
      const profile = await env.DB.prepare("SELECT home_postal FROM users WHERE id=?").bind(user.userId).first<{ home_postal: string | null }>();
      if (profile?.home_postal) postal = normalizedPostal(profile.home_postal);
    }
  }
  if (!postal) return null;
  const row = await lookupPostal(postal);
  if (row) return { ...row, region: regionCode(row.region), postal, fromQuery: Boolean(fromQuery) };
  // A US ZIP the geocoder has never been asked about still names its own state. postal_cache holds
  // a year of Canadian postal codes and almost no American ones, so without this the narrowing was
  // dead on arrival for exactly the readers it was built for.
  const region = regionForZip(postal);
  if (region) return { latitude: null, longitude: null, region, country: "US", postal, fromQuery: Boolean(fromQuery) };
  // And a Canadian code the cache has never seen still names its province by its first letter.
  // Only after the cache, which alone has a point to sort by distance from.
  const province = provinceForPostal(postal);
  if (province) return { latitude: null, longitude: null, region: province, country: "CA", postal, fromQuery: Boolean(fromQuery) };
  // An unresolved postal is not an error here. The reader still gets the page, with every location
  // and the prompt, and - when they typed the code on this page - a line saying it could not be
  // placed (`unplaced` below), rather than the same prompt as if they had typed nothing.
  return null;
}
export async function generateMetadata({params}:{params:Promise<{slug:string;locale:string}>}):Promise<Metadata> {
  const { slug, locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : "en";
  const t = await getTranslations({ locale, namespace: "metadata" });
  const deal = await getDeal(slug);
  // A draft, a deal scheduled for later and a deleted one have no page (the component below answers
  // 404), and nothing here may describe one either: its title alone would say what is coming.
  if (!deal || deal.page_visibility === "hidden") return { title: t("notFoundTitle"), robots: { index: false, follow: false } };
  const retired = deal.page_visibility === "retired";
  const restaurant = deal.canonical_restaurant || deal.restaurant;
  // The template is the locale's ("{title} chez {restaurant}"); the deal's own words are whatever
  // the catalog holds. The city only for a single-location restaurant (titleCity): a chain's branch
  // pages share a title, and their descriptions, which carry each branch's address, tell them apart.
  const city = titleCity(deal);
  const title = dealPageTitle(city ? t("dealTitleCity", { title: deal.title, restaurant, city }) : t("dealTitle", { title: deal.title, restaurant }));
  // The description opens with what kind of offer it is and where, the words a search for "happy
  // hour" or "food deals" is matched against, which the title (the deal's own name) often lacks.
  const category = categoryLabel(deal.category, locale);
  // The price, the hours, the address and when it was last looked at - in the branch's own zone,
  // so it is the date the page shows. "Last checked" only for a deal Radar has actually checked
  // recently: an import's verified_at is the moment it was imported. A retired deal gives no price
  // at all; the page is kept for old links, and the offer it describes is over.
  const checkedAs = checkedStatus(deal);
  // A stale deal was checked, just not lately, so its date is still a check date.
  const everChecked = checkedAs === "verified" || checkedAs === "stale";
  const checked = everChecked
    ? pageDate(deal.verified_at, locale, deal.timezone)
    : pageDate(listedAt(deal), locale, deal.timezone);
  const description = retired
    ? t("dealRetired", { restaurant })
    : sentences([
        deal.price ? t("dealLeadPrice", { category, restaurant, price: deal.price }) : t("dealLead", { category, restaurant }),
        deal.schedule,
        dealPlace(deal),
        checked ? t(everChecked ? "dealLastChecked" : "dealListed", { date: checked }) : null,
      ]);
  // Self-referencing, with hreflang alternates, only in the languages the deal has actually been
  // translated into (deal_translations). Without a translation the /fr and /es pages are the English
  // offer inside French or Spanish labels, which Google treats as duplicates of the English page
  // (only the template is localized), so they point their canonical at it and declare no
  // translations, the way the English-only pages do (app/alternates.ts).
  const alternates = translatedAlternates(locale, `/deals/${encodeURIComponent(deal.slug || deal.id)}`, translatedLocales(deal));
  // The deal's own share card, which says the offer, the restaurant and when it runs - which a
  // restaurant's photo never said and a site-wide image could not. The restaurant's photo, which
  // this used to be, is still the page's own image.
  const image = shareCardPath(deal);
  const imageAlt = `${restaurant} — ${deal.title}`;
  return {
    title,
    description,
    alternates,
    openGraph: { title, description, type: "website", siteName: "Radar", url: alternates.canonical, images: [{ url: image, width: 1200, height: 630, alt: imageAlt }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    // Kept for the links already out there, but no longer something a search should turn up.
    // "follow" so the rest of the site it links to is still crawled through it.
    ...(retired ? { robots: { index: false, follow: true } } : {}),
  };
}
export default async function DealPage({params,searchParams}:{params:Promise<{slug:string;locale:string}>;searchParams:Promise<{return?:string;postal?:string;zip?:string;all?:string}>}) {
  const { slug, locale: rawLocale } = await params;
  const locale = isSupportedLocale(rawLocale) ? rawLocale : "en";
  setRequestLocale(locale);
  const t = await getTranslations("dealDetail");
  const deal = await getDeal(slug);
  // Drafts, deals scheduled for later and deleted ones answer exactly as a slug that never existed
  // does. They used to render in full - price, hours, address, "Last verified" - under a banner
  // claiming the offer had been available once, and nothing kept them out of search results.
  if (!deal || deal.page_visibility === "hidden") notFound();
  // An old address of a listing folded into this one: send it to this deal's own page, with the
  // query it came with, rather than render a second copy under the retired address.
  if (deal.via_alias) {
    const query = new URLSearchParams(Object.entries(await searchParams).filter((entry): entry is [string, string] => typeof entry[1] === "string")).toString();
    permanentRedirect(`/${locale}/deals/${encodeURIComponent(deal.slug || deal.id)}${query ? `?${query}` : ""}`);
  }
  // The offer's last day where it runs (a US national one, in Los Angeles; see expiryTimeZone).
  const endZone = expiryTimeZone(deal) || deal.timezone || HOME_TIME_ZONE;
  const lastDay = lastDayIso(deal.expires_at, endZone), lastDayLabel = lastDayLongLabel(deal.expires_at, locale, endZone);
  // Only a retired deal gets here without being public: its page stays, with the banner.
  const unavailable = deal.page_visibility !== "public";
  const tMeta = await getTranslations("metadata");
  // What the page may claim about checking this deal - see effectiveVerificationStatus.
  const verification = dealVerification(deal);
  const verified = verification === "verified";
  // The same three states as the cards (verificationState in app/verification.ts): checked lately,
  // checked but due again ("Re-checking", dated by that check), or only ever listed.
  const stale = verification === "stale";
  // Under review, the date is still the one the deal had before the report: its last check if it
  // ever had one, else when it was listed.
  const reported = Boolean(deal.under_review);
  const checkedAs = checkedStatus(deal);
  const shownDate = checkedAs === "verified" || checkedAs === "stale" ? deal.verified_at : listedAt(deal);
  // A detail-page view is the click-through moment for a sponsored listing (there's no separate
  // "click" event fired from the search results card) — count it against whichever sponsorship
  // row is currently running for this deal. Best-effort: a tracking failure should never break
  // the page a paying sponsor's deal is trying to render.
  if (deal.sponsored) {
    try { await env.DB.prepare("UPDATE sponsorships SET clicks=clicks+1 WHERE deal_id=? AND status='active'").bind(deal.id).run(); } catch { /* tracking only */ }
  }
  const query = await searchParams;
  const rawReturn = query.return || null;
  // `?all=1` is the escape hatch from a scoped list, so "show all locations" is a link rather than
  // a second copy of the list shipped to the browser against the chance somebody wants it.
  const showingAll = query.all === "1";
  // Resolved before the queries below rather than alongside them, because the location query is
  // scoped by it. That costs one round trip on a request that carries a postal code, and nothing at
  // all on one that does not — which is every prerender and every cold shared link.
  const typedPostal = query.postal || query.zip || null;
  const area = showingAll ? null : await resolveVisitorArea(typedPostal, rawReturn);
  // Scoping in SQL, not in JS. The difference only shows up at national scale, and it is the whole
  // point: filtering after the fact still reads every row out of D1 and still hands the client a
  // payload with thousands of addresses in it.
  const scopeToRegion = area?.fromQuery ? area : null;
  // The reader typed a code on this page and it placed them nowhere: malformed, or a prefix that
  // is no state's or province's. They are told so, rather than shown the prompt they just answered.
  const unplaced = !showingAll && Boolean(typedPostal?.trim()) && !scopeToRegion;
  const similarQuery = similarDealsQuery(deal);
  // `CASE WHEN l.id=?` first, so the address this page is actually about can never be the row the
  // cap drops. Without it a 13,000-branch promotion would order by eligibility and then the
  // alphabet, and the deal's own branch would sit somewhere around Kansas.
  const LOCATION_SELECT = "SELECT l.*,dl.eligibility,dl.source_url eligibility_source,dl.verified_at eligibility_verified_at FROM deal_locations dl JOIN restaurant_locations l ON l.id=dl.location_id";
  const LOCATION_ORDER = "ORDER BY CASE WHEN l.id=? THEN 0 ELSE 1 END,CASE dl.eligibility WHEN 'confirmed' THEN 0 ELSE 1 END,l.city,l.address LIMIT ?";
  // A 'brand' deal runs at every operating branch, so its list is the brand's own branches, read
  // straight from restaurant_locations in the order of idx_locations_restaurant_region. That order
  // is what makes it cheap: the scoped list reads the rows of one state and stops at the cap, where
  // the join above read every link the deal had - all 10,482 for McDonald's - to show one state.
  // The deal's own branch is put first separately (see ownBranch below) rather than by a CASE in
  // the ORDER BY, which would force a sort of every branch.
  const brandWide = deal.location_scope === "brand" && Boolean(deal.restaurant_id);
  // A 'national' deal has no branches on Radar at all (drizzle/0050): nothing below is asked about
  // its locations, and the page sends the reader to the chain's own store finder instead.
  const national = deal.location_scope === "national";
  const BRANCH_SELECT ="SELECT l.*,'confirmed' eligibility,NULL eligibility_source,NULL eligibility_verified_at FROM restaurant_locations l";
  const locationList = (region: VisitorArea | null) => brandWide
    ? region
      ? env.DB.prepare(`${BRANCH_SELECT} WHERE l.restaurant_id=? AND l.region=? AND l.status='operating' AND l.country=? ORDER BY l.city,l.address LIMIT ?`).bind(deal.restaurant_id,region.region,region.country,LOCATION_LIST_MAX)
      : env.DB.prepare(`${BRANCH_SELECT} WHERE l.restaurant_id=? AND l.status='operating' ORDER BY l.region,l.city,l.address LIMIT ?`).bind(deal.restaurant_id,LOCATION_LIST_MAX)
    // Scoped, the deal's own branch is kept whatever its region (`OR l.id=?`). A Gatineau deal
    // opened by an Ottawa reader who typed their postal code would otherwise list only Ontario
    // branches, drop the address the page is about, and point Directions across the river.
    : region
      ? env.DB.prepare(`${LOCATION_SELECT} WHERE dl.deal_id=? AND l.status='operating' AND ((l.region=? AND l.country=?) OR l.id=?) ${LOCATION_ORDER}`).bind(deal.id,region.region,region.country,deal.location_id,deal.location_id,LOCATION_LIST_MAX)
      : env.DB.prepare(`${LOCATION_SELECT} WHERE dl.deal_id=? AND l.status='operating' ${LOCATION_ORDER}`).bind(deal.id,deal.location_id,LOCATION_LIST_MAX);
  // How many this offer has. A brand deal scoped to a state counts that state, from the same index,
  // and does not name a national total: counting a national brand's branches reads every one of
  // them, which is the cost the scoped list exists to avoid. Unscoped it counts them all, but only
  // on the prerendered page, read from a local copy of D1. Rendered live - a parameter the page
  // reads, a client navigation - the same count read 10,482 McDonald's rows from production per
  // render, so a live unscoped brand list names no total, the way /api/deals/[slug] names none.
  const prerendering = (env as unknown as Record<string, string>).RADAR_PRERENDER === "1";
  const locationCount = national ? null : brandWide
    ? scopeToRegion
      ? env.DB.prepare("SELECT COUNT(*) n FROM restaurant_locations WHERE restaurant_id=? AND region=? AND status='operating' AND country=?").bind(deal.restaurant_id,scopeToRegion.region,scopeToRegion.country).first<{ n: number }>()
      : prerendering
        ? env.DB.prepare("SELECT COUNT(*) n FROM restaurant_locations WHERE restaurant_id=? AND status='operating'").bind(deal.restaurant_id).first<{ n: number }>()
        : null
    // Joined the same way the list above is, not a bare count of deal_locations. A link whose
    // location row is gone is not a place anybody can be sent, and "250 of 5,698" is a promise about
    // 5,698 of them. The US chain harvest made the gap visible - 5,698 links, 5,416 rows - because a
    // deal is linked to every branch of a brand and branches come and go between harvests.
    : env.DB.prepare("SELECT COUNT(*) n FROM deal_locations dl JOIN restaurant_locations l ON l.id=dl.location_id WHERE dl.deal_id=? AND l.status='operating'").bind(deal.id).first<{ n: number }>();
  const guideCity = guideCityOf(deal);
  const [locations,verifications,items,similar,alsoHere,locationTotal,translation,pick,ownBranch,guide] = await Promise.all([
    national ? { results: [] as DealLocationDetailRow[] } : locationList(scopeToRegion).all<DealLocationDetailRow>(),
    env.DB.prepare("SELECT status,method,source_url,verified_at,notes FROM verification_events WHERE deal_id=? ORDER BY verified_at DESC LIMIT ?").bind(deal.id,CHECKS_READ).all<VerificationEventRow>(),
    env.DB.prepare("SELECT id,name,original_price,discounted_price FROM deal_items WHERE deal_id=? ORDER BY sort_order,id").bind(deal.id).all<DealItemRow>(),
    // Other restaurants running the same kind of deal - see app/similar-deals.ts for what counts.
    env.DB.prepare(similarQuery.sql).bind(...similarQuery.params).all<SimilarDealRow>(),
    // The rest of the week at this address.
    //
    // A venue running a different special every night had them scattered: each night is its own
    // deal row, so Montana's Taco Tuesday appeared only at the bottom of Wing Monday's page under
    // "Similar offers", below the map and the feedback widget, mixed in with the same brand's
    // Kingston and Kitchener deals. A reader wanting to know what Tuesday looks like had no reason
    // to think that list was where to find out.
    //
    // Scoped to location_id, not restaurant_id: on a chain that is the difference between "also
    // here" and "also somewhere in this brand", and only the first is true of the address this
    // page is about.
    env.DB.prepare(
      `SELECT d.id,d.slug,d.title,d.price,d.schedule,d.emoji FROM deals d
        WHERE d.restaurant_id=? AND d.location_id=? AND d.id<>?
          AND ${publicDealPredicate}
        LIMIT 8`,
    ).bind(deal.restaurant_id,deal.location_id,deal.id).all<AlsoHereOffer>(),
    // How many this offer has - see locationCount above. Asked on every render rather than only when
    // the list is scoped, because the rows above are capped and so no longer speak for the total.
    locationCount,
    locale === "en" ? null : env.DB.prepare("SELECT title,description,schedule,price,terms,restrictions FROM deal_translations WHERE deal_id=? AND locale=?").bind(deal.id,locale).first<{title:string|null;description:string|null;schedule:string|null;price:string|null;terms:string|null;restrictions:string|null}>(),
    // Whoever picked this deal first, and only if their profile is still active.
    //
    // One byline, not a list. Two creators claiming the same find turns a credit into a
    // leaderboard, and the rule that settles it is the same one app/CreatorLink.tsx uses for
    // attribution: the first to bring somebody here keeps it. `created_at` is that order.
    //
    // The note is a creator's own words rendered on a page Radar publishes, so it is escaped by
    // React like any other string and never fed to dangerouslySetInnerHTML. The length cap lives
    // at the write end (PICK_NOTE_MAX in app/api/creator/route.ts).
    env.DB.prepare(
      `SELECT p.note,p.handle,c.display_name
         FROM creator_picks p JOIN creator_profiles c ON c.handle=p.handle AND c.status='active'
        WHERE p.deal_id=? ORDER BY p.created_at LIMIT 1`,
    ).bind(deal.id).first<{note:string|null;handle:string;display_name:string|null}>(),
    // The deal's own branch, for a brand list: that list is in state order, or is one state, and the
    // address the page is about has to lead it wherever it falls - including when the reader's own
    // state has no branch and the list falls back to every state. One row, by primary key.
    brandWide && deal.location_id
      ? env.DB.prepare(`${BRANCH_SELECT} WHERE l.id=? AND l.status='operating'`).bind(deal.location_id).first<DealLocationDetailRow>()
      : null,
    // The city guide's deals, for the deal's links into it: the guide and the topic pages that list
    // this offer. Without them a guide was reached only from the index and the footer, and a deal
    // page - where most readers arriving from search land - led nowhere near it. Read only for a
    // deal that can be in one, and never for a retired one, which a guide never lists.
    !unavailable && guideCity ? cityDeals(env.DB, guideCity) : null,
  ]);
  // A postal code in a state this offer does not reach would otherwise render a location section
  // with nothing in it — the reader's own ZIP turning a working page into an empty one. Fall back to
  // every location and say why, which is strictly more than they had before they typed it.
  //
  // Judged on the rows in that state, not on the rows returned: the per-branch list keeps the deal's
  // own branch wherever it is, so an Austin ZIP on an Ottawa deal returns one Ottawa row and still
  // found nothing in Texas.
  const emptyScope = !national && Boolean(scopeToRegion) && !locations.results.some((location) =>
    location.region === scopeToRegion?.region && location.country === scopeToRegion?.country);
  const listed = emptyScope ? (await locationList(null).all<DealLocationDetailRow>()).results : locations.results;
  const locationRows = ownBranch && !listed.some((location) => location.id === ownBranch.id)
    ? [ownBranch, ...listed].slice(0, LOCATION_LIST_MAX)
    : listed;
  // What each branch line may say: "Confirmed" with the date of the check that covered it, "Listed"
  // with the date it was marked when no check did - see branchConfirmation. The deal's own branch,
  // and every branch of a brand-wide deal (read straight from restaurant_locations, with no date of
  // their own), as of the deal's latest check; so is a branch confirmed from the deal's own source
  // page, which that check re-read (a chain promotion's branches, scripts/brand-wide-eligibility.sql).
  // A retired deal's checks are history, and none of them says the offer still stands - the banner
  // says it does not. So its branches read as a deal whose check has lapsed ("Not confirmed
  // recently"), never "Confirmed" on the date of a check: Wingstop's $16.99 meal deal, archived by
  // drizzle/0059 because the price had ended in July, would otherwise go on saying "Confirmed Sep 30".
  const checks = verifications.results;
  // A report puts a checked deal's branches back to "lapsed", as an old check does; a deal nobody
  // ever checked stays unconfirmed rather than claiming a check it never had.
  const branchVerification = reported ? (checkedAs === "verified" ? "stale" : checkedAs) : verification;
  const branchLine = branchConfirmations({ verification: unavailable && branchVerification === "verified" ? "stale" : branchVerification, brandWide, listedAt: listedAt(deal) }, checks);
  const confirmationOf = (location: DealLocationDetailRow) =>
    branchLine({
      eligibility: location.eligibility,
      verified_at: location.eligibility_verified_at,
      own: location.id === deal.location_id,
      fromDealSource: Boolean(deal.source_url) && location.eligibility_source === deal.source_url,
    });
  // Same overlay semantics as the /api/deals endpoint: category/cuisine stay canonical English
  // for anything logic-driven (structured data, relevance query above); only display fields get
  // translated copy, falling back per-field to English when a field hasn't been translated yet.
  const displayTitle = translation?.title || deal.title;
  const displayDescription = translation?.description ?? deal.description;
  const displaySchedule = translation?.schedule || deal.schedule;
  const displayPrice = translation?.price || deal.price;
  const displayTerms = translation?.terms ?? deal.terms;
  const displayRestrictions = translation?.restrictions ?? deal.restrictions;
  const displayCategory = categoryLabel(deal.category,locale);
  // Whose dollars, and how to get it. A national deal has no branch to take a country from, so its
  // brand row answers; an unrecognised country claims neither market.
  const market = marketOf(deal.country ?? deal.restaurant_country);
  const redemptionMethods = parseRedemption(deal.redemption);
  const promoCode = displayPromoCode(deal.promo_code);
  const gallery = galleryPhotos(deal.restaurant_gallery);
  const brandName = deal.canonical_restaurant || deal.restaurant;
  const regions = national ? footprintRegions(deal.restaurant_footprint) : [];
  // A drink deal says whose prices they are, the legal age where it runs, and to drink
  // responsibly: one line in the terms (app/drink-rules.ts). A national chain's is placed by
  // footprint, not a branch, so it says it doesn't run where state law forbids it.
  const drinkRule = !national && referencesAlcohol(deal) ? drinkJurisdiction(deal.country, deal.region) : null;
  const drinkNote = drinkRule
    ? t("drinkNote", { place: regionName(drinkRule.region, drinkRule.country), age: drinkRule.drinkingAge })
    : national && (deal.restaurant_country || "").toUpperCase() === "US" && referencesAlcohol(deal) ? t("drinkNoteNational") : null;
  // How far a national chain reaches. In the US that is the fifty states, and Washington, DC and the
  // territories by name: counted together they had Subway "in 55 states". A Canadian footprint is
  // provinces and territories, and its sentence already says so.
  const usFootprint = national && market !== "CA" && regions.length > 1 ? splitUsFootprint(regions) : null;
  const footprintLine = !national || regions.length < 2 ? null
    : !usFootprint ? t("nationalProvinces",{brand:brandName,count:regions.length})
    : [
        usFootprint.states === 50 ? t("nationalStatesAll",{brand:brandName})
          : usFootprint.states > 1 ? t("nationalStates",{brand:brandName,count:usFootprint.states}) : null,
        usFootprint.others.length ? t("nationalAlsoIn",{places:placeList(usFootprint.others,locale,t("nationalDC"))}) : null,
      ].filter(Boolean).join(" ") || null;
  // A reader who has told us where they are, at a chain whose footprint does not reach there: Del
  // Taco's national price is no use to a Knoxville ZIP, and the page says so rather than letting
  // the store finder break the news.
  const notInRegion = national && area?.region && regions.length ? !regions.includes(area.region.toUpperCase()) : false;
  const locatorUrl = safeHref(deal.restaurant_locator_url);
  const tRedemption = await getTranslations("redemption");
  const tMarket = await getTranslations("market");
  const marketName = market ? tMarket(market) : "";
  // Built field by field rather than spread. `location` is the whole restaurant_locations row
  // joined with deal_locations, and every prop handed to a client component is serialised into
  // the page payload — so the spread was publishing restaurant_id, postal_prefix, full_postal,
  // status, created_at/updated_at and the internal eligibility source URL to anyone who opened
  // view-source. OfferLocations declares exactly these fields; the eligibility and its date are
  // resolved here into what the branch line says, so neither raw value is published.
  const locationsWithDistance = locationRows.map((location) => ({
    id: location.id,
    address: location.address,
    city: location.city,
    region: location.region,
    phone: location.phone,
    official_url: location.official_url,
    confirmation: confirmationOf(location),
    latitude: location.latitude,
    longitude: location.longitude,
    // A 'city' coordinate is the city's centre standing in for an address the geocoder could not
    // place (docs/GEOCODING.md). The map draws it as an area and says so, rather than pinning a door.
    approximate: location.geo_precision === "city",
    timezone: location.timezone,
    // A ZIP-derived area has a state but no point, so there is no distance to state. Null rather
    // than a guess: the picker simply shows no "12 km" hint on those rows.
    distance_km: area?.latitude != null && area.longitude != null && location.latitude != null && location.longitude != null
      ? kmBetween({ latitude: area.latitude, longitude: area.longitude }, { latitude: location.latitude, longitude: location.longitude })
      : null,
  }));
  // The deal's own address first, always. The SQL orders by eligibility then city, and once a
  // national promotion is confirmed at every branch that leaves the alphabet in charge: an Ottawa
  // deal page opened its location list on Guelph and pointed Directions there. A visitor arriving
  // with a ?return= gets a distance sort, but a shared link and every prerendered page have no
  // reference point at all, which is exactly when this mattered.
  const ordered = area?.latitude != null
    ? [...locationsWithDistance].sort((a, b) => (a.distance_km ?? Infinity) - (b.distance_km ?? Infinity))
    : locationsWithDistance;
  const sortedLocations = [
    ...ordered.filter((location) => location.id === deal.location_id),
    ...ordered.filter((location) => location.id !== deal.location_id),
  ];
  // What the location section says about itself. Three states, and the reader is told which one
  // they are in rather than left to wonder whether a short list is the whole truth:
  //   narrowed  — a postal code in the URL matched locations in that state or province.
  //   elsewhere — it matched none, so this is everything, and we say the state we looked in.
  //   open      — nobody has said where they are. Every location, and a prompt.
  const dealPath = `/${locale}/deals/${encodeURIComponent(deal.slug || deal.id)}`;
  // A scoped brand list counted its state, not the country - see locationCount. One whose state had
  // no branch fell back to every state, and what it counted was that state's zero; a live unscoped
  // one counted nothing. Either way a list shorter than the cap is every branch there is, and a
  // full one is a page of a longer list whose length nobody read, so it names no total.
  const uncounted = brandWide && (emptyScope || !locationTotal);
  const counted = uncounted
    ? (sortedLocations.length < LOCATION_LIST_MAX ? sortedLocations.length : null)
    : (locationTotal?.n ?? sortedLocations.length);
  const regionCounted = brandWide && Boolean(scopeToRegion) && !emptyScope;
  const total = regionCounted ? null : counted;
  // Capped means the reader is holding a page of a longer list. Saying so is the difference between
  // a prompt that sounds optional and one that explains itself. With no count, a full page is taken
  // to be one.
  const capped = sortedLocations.length >= LOCATION_LIST_MAX && (counted == null || counted > sortedLocations.length);
  const locationScope = scopeToRegion && !emptyScope
    ? { kind: "narrowed" as const, region: scopeToRegion.region, postal: scopeToRegion.postal,
        total, regionTotal: regionCounted ? counted : null, capped, showAllHref: capped ? null : `${dealPath}?all=1` }
    : scopeToRegion
      ? { kind: "elsewhere" as const, region: scopeToRegion.region, postal: scopeToRegion.postal,
          total, regionTotal: null, capped, showAllHref: null }
      : { kind: "open" as const, region: null, postal: null, total, regionTotal: null, capped, showAllHref: null, unplaced };
  // Falls back to a locale-prefixed path when nothing usable came in via ?return= (e.g. a
  // direct/shared link) — the un-prefixed form used to 302 through the default locale before
  // landing back on the page a visitor (or a crawler reading the breadcrumb below) actually saw.
  // Laid out as a week reads: the nightly specials Monday to Sunday, then the offers that run most
  // days. This used parseScheduleText, which reads days only as part of a time window and so found
  // nothing in a bare "Wed" - Montana's whole week sorted as unknown and kept whatever order D1
  // returned. weekRank uses the availability line's own reading; see app/search.ts.
  const alsoHereOffers = [...alsoHere.results].sort((a, b) => weekRank(a.schedule) - weekRank(b.schedule));
  // A national deal has no city to go back to: its market's nationwide list is where it was found.
  const defaultReturn = national || !deal.city ? `/${locale}${market ? `?country=${market}` : ""}` : `/${locale}?city=${encodeURIComponent(deal.city)}`;
  const returnPath = safeReturnPath(rawReturn,defaultReturn);
  const expiring = !unavailable ? expiringSoonLabel(deal.expires_at,locale,expiryTimeZone(deal)) : null;
  const effectivePriceTier = deal.price_tier ?? estimatePriceTier(deal.price);
  const base = await getSiteOrigin();
  const dealUrl = new URL(`/${locale}/deals/${encodeURIComponent(deal.slug || deal.id)}`, base).toString();
  // A number, or no price at all. This used to fall back to the free text ("Half price wings"),
  // which is not a schema.org price, and before that took the only dollar figure in the text
  // whatever it was: "$5 off burgers" went out as a $5 offer, a "$5+ purchase" threshold as the
  // price of free chili. offerPrice (app/deal-meta.ts) says when a figure really is the price.
  const numericPrice = offerPrice(deal.price);
  // A city with too few restaurants in it has no guide to link to (app/city-pages.ts).
  const guideSlug = guideCity && guide && restaurantCount(guide) >= MIN_CITY_RESTAURANTS ? citySlug(guideCity.name, guideCity.region) : null;
  const placement = guideCity && guide && guideSlug ? guidePlacement(guide, deal) : null;
  const guideAt = guideSlug ? { slug: guideSlug } : null;
  const restaurantName = deal.canonical_restaurant || deal.restaurant;
  const restaurantSite = safeHref(deal.restaurant_website);
  // A pin only when the branch was placed at its door. A city-centre stand-in is a point in a park
  // as far as a map or a search engine can tell, and the page already declines to pin it.
  const preciseGeo = deal.latitude != null && deal.longitude != null && deal.branch_geo_precision !== "city";
  const validFrom = deal.publish_at ? parseSqlTimestamp(deal.publish_at) : null;
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "Offer",
    name: displayTitle,
    description: displayDescription || tMeta("dealTitle", { title: displayTitle, restaurant: deal.canonical_restaurant || deal.restaurant }),
    // Whose dollars. Every deal was Canadian when this said "CAD" unconditionally; a McValue price
    // is in US dollars, and a crawler told otherwise would show it to a searcher as Canadian.
    ...(numericPrice != null ? { price: numericPrice, priceCurrency: CURRENCY[market || "CA"] } : {}),
    availability: unavailable ? "https://schema.org/Discontinued" : "https://schema.org/InStock",
    url: dealUrl,
    image: new URL(shareCardPath(deal), base).toString(),
    // The canonical English category ("Happy hour", "Food deal"), as the other logic-driven fields are.
    category: deal.category,
    ...(validFrom && !Number.isNaN(validFrom.getTime()) ? { validFrom: validFrom.toISOString() } : {}),
    ...(lastDay ? { priceValidUntil: lastDay } : {}),
    // A national promotion has no branch to name; where it can be had is the country it runs in.
    ...(national && market ? { eligibleRegion: { "@type": "Country", name: market } } : {}),
    seller: {
      "@type": "Restaurant",
      name: restaurantName,
      ...(restaurantSite ? { url: restaurantSite } : {}),
      ...(deal.cuisine && deal.cuisine !== "Other" ? { servesCuisine: deal.cuisine } : {}),
      ...(!national && deal.phone ? { telephone: deal.phone } : {}),
      ...(deal.branch_address ? { address: { "@type": "PostalAddress", streetAddress: deal.branch_address, addressLocality: deal.branch_city || deal.city, addressRegion: deal.region, addressCountry: deal.country } } : {}),
      ...(!national && preciseGeo ? { geo: { "@type": "GeoCoordinates", latitude: deal.latitude, longitude: deal.longitude } } : {}),
    },
  };
  // Home > City > Deal, every step an indexed page. The middle one is the city's guide when the
  // city has one, and otherwise the index of city guides: the city's search (/?city=) canonicalizes
  // to the home page, so a breadcrumb through it pointed at Home twice. A national deal has no city
  // and goes straight under Home. Never the ?return= the reader came in with: the breadcrumb is the
  // page's account of where it sits, and it was a different one per visitor.
  const cityStep = guideCity && guideAt
    ? { name: `${guideCity.name} deals`, item: new URL(`/en${cityPath(guideAt)}`, base).toString() }
    : national || !deal.city ? null : { name: "Deals by city", item: new URL("/en/cities", base).toString() };
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { name: "Radar", item: new URL(`/${locale}`, base).toString() },
      ...(cityStep ? [cityStep] : []),
      { name: restaurantName, item: dealUrl },
    ].map((step, index) => ({ "@type": "ListItem", position: index + 1, ...step })),
  };
  // What the page's client components read; see i18n/client-messages.ts.
  return <ClientMessages namespaces={["dealDetail", "detailActions", "offerLocations", "branchPicker", "addToCalendar", "helpfulFeedback", "apiErrors"]}><PublicPage className="deal-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(structuredData).replace(/</g, "\\u003c")}} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{__html: JSON.stringify(breadcrumbJsonLd).replace(/</g, "\\u003c")}} />
    <DealView dealId={deal.id}/><div className="deal-page-subnav"><BackToResults href={returnPath} label={t("backToResults")} preferStored={!rawReturn}/></div><article className="deal-page-card">
    {unavailable && <div className="coverage-banner">{t("unavailableBanner")}</div>}
    <header>
      {/* The branch's own page stands in for a restaurant with no website on file; the deal's
          source_url never does. That is where the offer was found - often a third-party deal
          listing site - and the photo proxy asked it for a picture of the restaurant on every
          view, and got a 404 every time. */}
      <CardMedia website={deal.restaurant_website} photoUrl={deal.photo_url || deal.restaurant_photo_url} extraPhotoUrls={gallery} logoUrl={deal.restaurant_logo_url} emoji={deal.emoji || "🍽️"} className="deal-page-art" priority alt={restaurantName}>
        <BrandLogo name={brandName} website={deal.restaurant_website} logoUrl={deal.restaurant_logo_url} className="brand-logo-lg" />
      </CardMedia>
      <div>
        {/* The heading says what the page is about, the offer and where it is, as its <title> does.
            The deal's name is set smaller under the restaurant's, as it always was. */}
        <h1>{restaurantName}<span className="sr-only">: </span><span className="deal-type">{displayTitle}</span></h1>
        <div className="deal-subhead">
          {/* Beside the tag it explains; at the end of the row it wrapped onto a line of its own. */}
          <span className="deal-type-tag"><span className="tag muted">{displayCategory}</span><InfoTip text={t("dealTypeTooltip")}/></span>
          {/* Which Radar this is. A McValue "$5" and a Canadian "$5" are different money, and a
              shared link lands here with no search around it to say which country it came from. */}
          {market && <span className={`market-chip market-${market.toLowerCase()}`}>{t(market === "US" ? "marketUS" : "marketCA")}</span>}
          {deal.sponsored ? <span className="sponsored">{t("sponsored")}</span> : null}
          {deal.hidden_gem ? <span className="gem-badge">{t("hiddenGem")}</span> : null}
          {expiring && <span className={`expiring-badge${hasExpired(deal.expires_at) ? " expired" : ""}`}>{expiring}</span>}
        </div>
        <p>{displayDescription || t("defaultDescription",{cuisine:cuisineLabel(deal.cuisine,locale),city:deal.city || marketName})}</p>
        {/* The credit links back to the creator's own tracked link rather than off-site: it is
            the one URL Radar controls, it shows the rest of what they picked, and it means a
            reader arriving from the byline is attributed to them like any other visit. A plain
            page load for every reader, never a ChromeLink: CreatorLink, which records the visit
            from ?c=, runs once when the locale layout mounts, and a client-side navigation keeps
            that layout, so a signed-in reader's click would never be counted. */}
        {pick && <p className="deal-pick-byline"><a href={`/${locale}?c=${encodeURIComponent(pick.handle)}`}><b>{t("pickedBy",{name:pick.display_name || pick.handle})}</b></a><InfoTip text={t("pickedByTip",{name:pick.display_name || pick.handle})}/>{pick.note && <span>&ldquo;{pick.note}&rdquo;</span>}</p>}
      </div>
    </header>
    <div className="deal-facts">
      <span><b>{t("priceLabel")}<InfoTip text={t("priceTooltip")}/></b>{displayPrice}{priceTierSymbol(effectivePriceTier) && <span className="price-tier-tag" title={priceTierLabel(effectivePriceTier,locale) || undefined}> {priceTierSymbol(effectivePriceTier)}</span>}</span>
      <span><b>{t("scheduleLabel")}<InfoTip text={t("scheduleTooltip")}/></b>{displaySchedule}</span>
      {/* "Last verified" only for a deal that is verified and current. 262 live deals imported
          from directories carried verified_at = the import time under this label, with a tooltip
          saying our team had confirmed them; they are "Listed", with the date they arrived.
          A retired deal has none of the three: each says whether the offer stands now, which the
          banner has already answered, and "Last verified" with its "confirmed this offer was still
          accurate" tooltip contradicted it - an offer archived for being wrong (0059's Wingstop)
          went on claiming a check of the very price it was archived for. The metadata gives a
          retired deal no date either. */}
      {!unavailable && <span>
        <b>{verified ? t("lastVerified") : stale ? t("reChecking") : t("listed")}<InfoTip text={verified ? t("lastVerifiedTooltip") : reported ? t("reCheckingReportedTooltip") : stale ? t("reCheckingTooltip") : t("listedTooltip")}/></b>
        {checks.length ? (
          <details className="verification-inline">
            <summary><LocalTime value={shownDate} sourceTimeZone={deal.timezone}/></summary>
            {/* `status` and `method` are internal vocabulary — this list used to print them raw,
                so a reader saw "verified · source_review". The status has a translated label
                already; the method is how we checked, which is our business, not theirs. */}
            <div className="verification-summary">{checks.slice(0,CHECKS_SHOWN).map((event,index) => <article key={index}><b>{verificationStatusLabel(String(event.status),locale)}</b><span><LocalTime value={event.verified_at} style="dateTime" sourceTimeZone={deal.timezone}/></span>{event.source_url && <a href={event.source_url} target="_blank" rel="noreferrer">{t("source")}</a>}</article>)}</div>
          </details>
        ) : <LocalTime value={shownDate} sourceTimeZone={deal.timezone}/>}
      </span>}
      {/* The restaurant vouching for its own offer, shown as exactly that and apart from Radar's
          checks above: it never makes a deal "Verified" (app/owner-confirmation.ts). Only while
          recent, and never on a retired deal, whose banner already says the offer is over. */}
      {!unavailable && deal.owner_confirmed_at && ownerConfirmationCurrent(deal.owner_confirmed_at) && <span>
        <b>{t("ownerConfirmed")}<InfoTip text={t("ownerConfirmedTooltip")}/></b>
        <LocalTime value={deal.owner_confirmed_at} sourceTimeZone={deal.timezone}/>
      </span>}
      <span>
        <b>{t("offerEnds")}<InfoTip text={t("offerEndsTooltip")}/></b>
        {/* The offer's last day where it runs, not converted to the reader's zone - lastDayLongLabel. */}
        {lastDay && lastDayLabel ? <time dateTime={lastDay}>{lastDayLabel}</time> : t("noEndDate")}
      </span>
    </div>
    {/* How to get it, before anything else a reader acts on. "Do I need their app?" is the first
        question a chain deal raises, and the answer decides whether the rest of the page matters. */}
    {(redemptionMethods.length > 0 || promoCode || deal.redemption_note) && (
      <section className="redemption-block" aria-labelledby="redemption-heading">
        <h2 id="redemption-heading">{tRedemption("heading")}</h2>
        {redemptionMethods.length > 0 && (
          <ul className="redemption-methods">
            {redemptionMethods.map((method) => <li key={method} className={`redemption-method redemption-${method.replace("_", "-")}`}>{tRedemption(METHOD_KEY[method])}</li>)}
          </ul>
        )}
        {appOnly(redemptionMethods) && <p className="redemption-app-only"><b>{tRedemption("badgeAppOnly")}</b> {tRedemption("appOnlyNote")}</p>}
        {promoCode && <PromoCode code={promoCode} copyLabel={tRedemption("copyCode")} copiedLabel={tRedemption("codeCopied")}/>}
        {deal.redemption_note && <p className="redemption-note">{deal.redemption_note}</p>}
      </section>
    )}
    <DetailActions dealId={deal.id}/>
    {!unavailable && deal.expires_at && (
      <AddToCalendar title={displayTitle} restaurant={deal.canonical_restaurant || deal.restaurant} expiresAt={deal.expires_at} schedule={displaySchedule} url={dealUrl}/>
    )}
    <section className="terms-section"><div className="terms-card"><div className="terms-card-head"><h2>{t("termsRestrictions")}</h2><OfferLink dealId={deal.id} href={deal.source_url} label={t("viewOfficialOffer")}/></div><p>{displayTerms || t("seeSourceForTerms")}</p>{displayRestrictions && <p className="terms-restrictions"><b>{t("restrictions")}</b> {displayRestrictions}</p>}{drinkNote && <p className="terms-drink-note">{drinkNote}</p>}</div></section>
    {!!items.results.length && <section className="deal-items-section"><h2>{t("whatsIncluded")}</h2><ul className="deal-items-list">{items.results.map((item) => <li key={item.id}><span className="deal-item-name">{item.name}</span><span className="deal-item-prices">{item.original_price && <s className="deal-item-original">{item.original_price}</s>}<b className="deal-item-discounted">{item.discounted_price}</b></span></li>)}</ul></section>}
    {!!alsoHereOffers.length && <AlsoHere offers={alsoHereOffers} timezone={deal.timezone}/>}
    {/* The map is rendered by OfferLocations, not here: it belongs to whichever branch the reader
        has selected, and that selection lives in the picker. */}
    {gallery.length > 1 && (
      <section className="deal-gallery"><h2>{t("galleryHeading")}</h2><div className="deal-gallery-strip">
        {/* eslint-disable-next-line @next/next/no-img-element -- stored /api/photo paths, sized by CSS */}
        {gallery.map((src) => <img key={src} src={photoSrc(src)} alt="" loading="lazy" decoding="async"/>)}
      </div></section>
    )}
    {national ? (
      // No branch list: Radar holds none for this chain (drizzle/0050). Where the reader goes is the
      // chain's own store finder, and what the page can say is which country and how many states.
      <section className="national-where">
        <h2>{t("whereHeading")}</h2>
        <p>{t(market === "CA" ? "nationalBodyCA" : "nationalBodyUS",{brand:brandName})}</p>
        {footprintLine && <p className="national-footprint">{footprintLine}</p>}
        {notInRegion && area && <p className="national-not-here">{t("nationalNotInRegion",{brand:brandName,region:regionName(area.region,market)})}</p>}
        {locatorUrl && <a className="national-locator" href={locatorUrl} target="_blank" rel="noreferrer">{t("findLocation",{brand:brandName})} ↗</a>}
        <p className="national-note">{t("noBranchList",{brand:brandName})}</p>
      </section>
    ) : (
      <section><h2>{deal.is_chain ? t("offerLocationsHeading") : t("restaurantLocationHeading")}</h2><OfferLocations locations={sortedLocations} scope={locationScope} formAction={dealPath} returnParam={rawReturn}/></section>
    )}
    <HelpfulFeedback dealId={deal.id}/>
    {/* The guide is English in every locale (app/[locale]/cities), so its links name their pages
        in English and say so. Plain links to the /en address, not ChromeLinks: a ChromeLink adds
        the reader's locale, and /fr/cities/... is only a redirect to the page these mean. */}
    {placement && guideCity && guideAt && (
      <section className="deal-guide">
        <h2>{t("guideHeading",{city:guideCity.name})}</h2>
        <ul className="city-topics" lang="en">
          <li><a href={`/en${cityPath(guideAt)}`} hrefLang="en">{`${guideCity.name} guide`}</a></li>
          {placement.topics.map((topic) => <li key={topic.slug}><a href={`/en${cityPath(guideAt, topic.slug)}`} hrefLang="en">{`${guideCity.name} ${topic.label}`}</a></li>)}
        </ul>
      </section>
    )}
    {/* Other restaurants only - this restaurant's own week is "Also at this location" above -
        so the heading no longer has to be worked out from what came back. The city is the
        page's own for every item, so the meta line gives the schedule instead: when you could
        go is the next thing to decide between two wing nights. */}
    {!!similar.results.length && <section><h2>{t("similarOffers")}</h2><div className="similar-deals">{similar.results.map((item) => <ChromeLink key={item.id} href={`/deals/${encodeURIComponent(item.slug || item.id)}`}><span aria-hidden="true">{item.emoji || "🍽️"}</span><b>{item.restaurant}</b><small>{item.title} · {item.price}</small><small className="similar-meta">{cuisineLabel(item.cuisine,locale)} · {item.schedule}</small></ChromeLink>)}</div></section>}
  </article></PublicPage></ClientMessages>;
}
