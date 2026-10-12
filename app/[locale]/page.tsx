import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../i18n/ClientMessages";
import HomeClient from "../HomeClient";
import HomeRecentChecks from "../HomeRecentChecks";
import { homeListings, roundedDown, type CatalogStats, type HomeListings } from "../home-listings";
import { localizedAlternates } from "../alternates";
import { pageMetadata } from "../siteMetadata";

const FAQ_KEYS = ["q1", "q2", "q3", "q4"] as const;

async function faqJsonLd(locale: string) {
  const t = await getTranslations({ locale, namespace: "home.faq" });
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_KEYS.map((key) => ({
      "@type": "Question",
      name: t(`${key}.question`),
      acceptedAnswer: { "@type": "Answer", text: t(`${key}.answer`) },
    })),
  };
}

// Without this, the homepage had no server-rendered canonical/hreflang at all — HomeClient's
// own client-side effect sets `<link rel=canonical>` after mount (to collapse filter/search
// query strings back to the bare path), but that's invisible to a crawler that doesn't run JS,
// and it never told anyone the fr/es versions exist in the first place. The title and
// description are the site's own, in the page's language, and its link preview names this page
// rather than the bare domain.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "metadata" });
  return pageMetadata({
    title: t("siteTitle"),
    description: t("siteDescription"),
    alternates: localizedAlternates(locale, ""),
    imageAlt: t("ogImageAlt"),
  });
}

// The catalogue's part of the server HTML (app/home-listings.ts). cloudflare:workers is imported
// here rather than at the top for the reason app/app-release.ts gives: tests/rendered-html.test.mjs
// renders this page in plain Node, with no D1. Without a database, or when the read fails, the page
// renders without the list - the deals below still load in the browser - and the failure is logged.
async function loadListings(): Promise<HomeListings | null> {
  try {
    const { env } = await import("cloudflare:workers");
    const db = (env as unknown as { DB?: D1Database }).DB;
    if (!db) return null;
    return await homeListings(db);
  } catch (error) {
    console.error("home page listings failed", error);
    return null;
  }
}

// The hero's "1,000+ deals · 500+ restaurants · 60+ cities", in the page's language. Rounded down
// (roundedDown), so a figure baked at deploy stays true while deals are added and retired between
// deploys. Nothing when the catalogue is too small to say it or could not be read: the hero then
// counts what the list below loads, as it always has.
async function catalogSummary(stats: CatalogStats | undefined, locale: string): Promise<string | undefined> {
  if (!stats || stats.deals < 10 || !stats.restaurants || !stats.cities) return undefined;
  const t = await getTranslations({ locale, namespace: "home.hero" });
  const number = new Intl.NumberFormat(locale);
  const figure = (count: number) => {
    const { value, plus } = roundedDown(count);
    return { count: value, label: `${number.format(value)}${plus ? "+" : ""}` };
  };
  const deals = figure(stats.deals), restaurants = figure(stats.restaurants), cities = figure(stats.cities);
  return t("catalogStats", {
    deals: deals.count, dealsLabel: deals.label,
    restaurants: restaurants.count, restaurantsLabel: restaurants.label,
    cities: cities.count, citiesLabel: cities.label,
  });
}

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const faqLd = await faqJsonLd(locale);
  const requestHeaders = await headers();
  const turnstileSiteKey = requestHeaders.get("x-turnstile-site-key") || undefined;
  const listings = await loadListings();
  const summary = await catalogSummary(listings?.stats, locale);
  // The quick-city chips link to their guide, where the city has one.
  const cityGuides = Object.fromEntries((listings?.guides || []).map((city) => [`${city.name}|${city.region}`, city.slug]));
  // What HomeClient and the components it draws read; see i18n/client-messages.ts.
  return (
    <ClientMessages namespaces={["home", "market", "national", "branchPicker", "redemption", "apiErrors"]}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd).replace(/</g, "\\u003c") }}
      />
      <HomeClient
        turnstileSiteKey={turnstileSiteKey}
        cityGuides={cityGuides}
        catalogSummary={summary}
        recentChecks={listings ? <HomeRecentChecks listings={listings} locale={locale} /> : null}
      />
    </ClientMessages>
  );
}
