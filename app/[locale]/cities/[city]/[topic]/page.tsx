import type { Metadata } from "next";
import { cache } from "react";
import { env } from "cloudflare:workers";
import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { englishOnlyAlternates } from "../../../../alternates";
import { GUIDES_PATH, cityDeals, cityHomeQuery, cityPath, guideCities, lastChecked, publishedTopics, restaurantCount } from "../../../../city-pages";
import ChromeLink from "../../../../ChromeLink";
import PublicPage from "../../../../PublicPage";
import { getSiteOrigin, pageMetadata } from "../../../../siteMetadata";
import { dealPageTitle } from "../../../../deal-meta";
import { DealList, TopicLinks, cityLabel, itemListJson } from "../../CityGuide";

export const dynamic = "force-dynamic";

/** The topic's deals, or null when the slugs name no guide, no topic, or one with too little in it to be a page. */
const resolve = cache(async (citySlug: string, topicSlug: string) => {
  const city = (await guideCities(env.DB)).find((candidate) => candidate.slug === citySlug);
  if (!city) return null;
  const published = publishedTopics(await cityDeals(env.DB, city));
  const entry = published.find(({ topic }) => topic.slug === topicSlug);
  return entry ? { ...entry, city, published } : null;
});

export async function generateMetadata({ params }: { params: Promise<{ city: string; topic: string }> }): Promise<Metadata> {
  const { city: citySlug, topic: slug } = await params;
  const found = await resolve(citySlug, slug);
  if (!found) return {};
  const { city, topic, deals } = found;
  const date = lastChecked(deals);
  return pageMetadata({
    title: dealPageTitle(`${cityLabel(city)} ${topic.label}: ${deals.length} listed`),
    description: `${deals.length} ${topic.label} at ${restaurantCount(deals)} ${cityLabel(city)} restaurants, with the days, hours and prices each one runs.${date ? ` Last checked ${date}.` : ""}`,
    alternates: englishOnlyAlternates(cityPath(city, slug)),
  });
}

export default async function CityTopicPage({ params }: { params: Promise<{ locale: string; city: string; topic: string }> }) {
  const { locale, city: citySlug, topic: slug } = await params;
  if (locale !== "en") permanentRedirect(`/en${GUIDES_PATH}/${encodeURIComponent(citySlug)}/${encodeURIComponent(slug)}`);
  setRequestLocale(locale);
  const found = await resolve(citySlug, slug);
  if (!found) notFound();
  const { city, topic, deals, published } = found;
  const origin = (await getSiteOrigin()).origin;
  const date = lastChecked(deals);
  return (
    <PublicPage className="legal city-page">
      <article lang="en">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: itemListJson(origin, city, `${city.name} ${topic.label}`, deals, slug) }} />
        <span className="kicker">{cityLabel(city).toUpperCase()}</span>
        <h1>{city.name} {topic.label}</h1>
        <p className="lead">
          {deals.length} {topic.label} at {restaurantCount(deals)} {city.name} restaurants.
          {date ? ` The most recent check was ${date}.` : ""}
        </p>
        <p>
          Each one shows the days it runs and the date Radar last checked it against the restaurant&rsquo;s own
          page. Confirm with the restaurant before you go. This is part of the{" "}
          <ChromeLink href={cityPath(city)}>{city.name} guide</ChromeLink>, or{" "}
          <ChromeLink href={cityHomeQuery(city)}>open {city.name} on the map</ChromeLink> to see what is on right now.
        </p>
        <DealList city={city} deals={deals} />
        <h2>More {city.name} deals</h2>
        <TopicLinks city={city} topics={published} current={slug} />
      </article>
    </PublicPage>
  );
}
