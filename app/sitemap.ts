import type { MetadataRoute } from "next";
import { appStoreListingUrl } from "./app-release";
import { GUIDES_PATH, cityDeals, cityPath, guideCities, lastChanged, publishedTopics } from "./city-pages";
import { publicDealPredicate } from "./deal-lifecycle";
import { getSiteOrigin } from "./siteMetadata";
import { routing } from "../i18n/routing";

export const dynamic = "force-dynamic";

function asDate(value: string | null) {
  if (!value) return undefined;
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

// Every consumer path exists at all three locales (routing.locales), so each sitemap entry
// gets an `alternates.languages` map pointing at its siblings — this is what tells a search
// engine "these three URLs are translations of the same page" instead of leaving it to guess
// or, worse, treat the fr/es versions as unrelated pages with no listing of their own.
function localizedEntry(base: URL, path: string, rest: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">): MetadataRoute.Sitemap[number] {
  const languages = {
    ...Object.fromEntries(routing.locales.map((locale) => [locale, `${base}${locale}${path}`])),
    // The same x-default the pages themselves declare (app/alternates.ts).
    "x-default": `${base}${routing.defaultLocale}${path}`,
  };
  return { url: `${base}${routing.defaultLocale}${path}`, alternates: { languages }, ...rest };
}

// A deal translated into some locales: listed with the languages it exists in, and no others.
function translatedEntry(base: URL, path: string, translated: readonly string[], rest: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">): MetadataRoute.Sitemap[number] {
  const locales = routing.locales.filter((locale) => locale === routing.defaultLocale || translated.includes(locale));
  const languages = {
    ...Object.fromEntries(locales.map((locale) => [locale, `${base}${locale}${path}`])),
    "x-default": `${base}${routing.defaultLocale}${path}`,
  };
  return { url: `${base}${routing.defaultLocale}${path}`, alternates: { languages }, ...rest };
}

// The pages whose prose is English in every locale (englishOnlyAlternates in app/alternates.ts).
// Their /fr and /es addresses carry a canonical pointing at /en, so listing those addresses here as
// translations told a search engine the opposite of what the pages say about themselves.
function englishOnlyEntry(base: URL, path: string, rest: Omit<MetadataRoute.Sitemap[number], "url" | "alternates">): MetadataRoute.Sitemap[number] {
  return { url: `${base}${routing.defaultLocale}${path}`, ...rest };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { env } = await import("cloudflare:workers");
  const base = await getSiteOrigin();
  // lastmod is the newest of what the page shows changing: an edit, a staff check, an owner's
  // "still running". Checks and confirmations leave updated_at alone, and the page's "Checked" date
  // is exactly what a re-crawl should pick up. The translations decide which languages the deal is
  // listed in (translatedAlternates in app/alternates.ts).
  const { results } = await env.DB.prepare(
    `SELECT slug, id, updated_at, verified_at, owner_confirmed_at,
            (SELECT group_concat(t.locale) FROM deal_translations t WHERE t.deal_id=d.id AND t.title IS NOT NULL) translated_locales
       FROM deals d WHERE ${publicDealPredicate}`,
  ).all<{ slug: string | null; id: string; updated_at: string | null; verified_at: string | null; owner_confirmed_at: string | null; translated_locales: string | null }>();

  const dealEntries: MetadataRoute.Sitemap = (results || []).map((deal) => {
    const path = `/deals/${encodeURIComponent(deal.slug || deal.id)}`;
    const dates = [deal.updated_at, deal.verified_at, deal.owner_confirmed_at].map(asDate).filter((date): date is Date => Boolean(date));
    const rest = {
      lastModified: dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    };
    const translated = String(deal.translated_locales || "").split(",").filter((locale) => locale && locale !== routing.defaultLocale);
    return translated.length ? translatedEntry(base, path, translated, rest) : englishOnlyEntry(base, path, rest);
  });

  // The announcement is listed only once it exists. Until APP_STORE_URL is set the page 404s, and
  // a sitemap entry for a 404 is the one thing guaranteed to get the URL crawled before it is
  // ready — which is how an unreleased announcement ends up in a search result.
  const launchEntry: MetadataRoute.Sitemap = (await appStoreListingUrl())
    ? [englishOnlyEntry(base, "/launch", { changeFrequency: "monthly", priority: 0.6 })]
    : [];

  // The city guides: the index, each city with enough restaurants in it to be a guide, and each
  // topic with enough in it to be a page (app/city-pages.ts). English only, like the
  // age-suitability page. One read per guide; there are as many guides as cities deep enough to have one.
  const cities = await guideCities(env.DB);
  const guides = await Promise.all(cities.map(async (city) => ({ city, deals: await cityDeals(env.DB, city) })));
  const cityEntries: MetadataRoute.Sitemap = guides.length
    ? [
        englishOnlyEntry(base, GUIDES_PATH, { lastModified: asDate(lastChanged(guides.flatMap(({ deals }) => deals)) ?? null), changeFrequency: "weekly", priority: 0.7 }),
        ...guides.flatMap(({ city, deals }) => [
          englishOnlyEntry(base, cityPath(city), { lastModified: asDate(lastChanged(deals) ?? null), changeFrequency: "daily", priority: 0.8 }),
          ...publishedTopics(deals).map(({ topic, deals: topicDeals }) =>
            englishOnlyEntry(base, cityPath(city, topic.slug), { lastModified: asDate(lastChanged(topicDeals) ?? null), changeFrequency: "daily", priority: 0.7 })),
        ]),
      ]
    : [];

  return [
    localizedEntry(base, "", { changeFrequency: "daily", priority: 1 }),
    ...cityEntries,
    ...launchEntry,
    localizedEntry(base, "/pro", { changeFrequency: "monthly", priority: 0.5 }),
    localizedEntry(base, "/for-restaurants", { changeFrequency: "monthly", priority: 0.5 }),
    localizedEntry(base, "/for-creators", { changeFrequency: "monthly", priority: 0.5 }),
    translatedEntry(base, "/support", ["fr"], { changeFrequency: "monthly", priority: 0.3 }),
    translatedEntry(base, "/privacy", ["fr"], { changeFrequency: "yearly", priority: 0.2 }),
    translatedEntry(base, "/terms", ["fr"], { changeFrequency: "yearly", priority: 0.2 }),
    englishOnlyEntry(base, "/age-suitability", { changeFrequency: "yearly", priority: 0.2 }),
    // Deals come from publicDealPredicate alone. An archived or expired deal keeps its page for the
    // links already out there, but it is noindex (app/[locale]/deals/[slug]/page.tsx), and a
    // sitemap entry would invite the crawl that page asks not to be indexed from. The prerender
    // reads this list too (scripts/prerender-deals.mjs), so neither kind is baked.
    ...dealEntries,
  ];
}
