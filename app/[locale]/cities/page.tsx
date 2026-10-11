import type { Metadata } from "next";
import { cache } from "react";
import { env } from "cloudflare:workers";
import { notFound, permanentRedirect } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import { englishOnlyAlternates } from "../../alternates";
import { GUIDES_PATH, guideCities } from "../../city-pages";
import ChromeLink from "../../ChromeLink";
import PublicPage from "../../PublicPage";
import { getSiteOrigin, pageMetadata } from "../../siteMetadata";
import { dealPageTitle } from "../../deal-meta";
import { CityLinks, guidesIndexJson } from "./CityGuide";

export const dynamic = "force-dynamic";

const load = cache(() => guideCities(env.DB));

// Every city guide in one place, so each is one link from the footer rather than reachable only
// from its own deals. English only, like the guides (app/[locale]/cities/[city]).
export async function generateMetadata(): Promise<Metadata> {
  const cities = await load();
  if (!cities.length) return {};
  return pageMetadata({
    title: dealPageTitle("Happy hours and food deals by city"),
    description: `Restaurant happy hours and daily food deals in ${cities.length} ${cities.length === 1 ? "city" : "cities"} across Canada and the US, each with the days, hours and prices it runs and the date it was last checked.`,
    alternates: englishOnlyAlternates(GUIDES_PATH),
  });
}

export default async function CityGuides({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (locale !== "en") permanentRedirect(`/en${GUIDES_PATH}`);
  setRequestLocale(locale);
  const cities = await load();
  if (!cities.length) notFound();
  const origin = (await getSiteOrigin()).origin;
  return (
    <PublicPage className="legal city-page">
      <article lang="en">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: guidesIndexJson(origin, cities) }} />
        <span className="kicker">CITY GUIDES</span>
        <h1>Happy hours and food deals by city</h1>
        <p className="lead">
          A guide for every city where Radar lists deals at enough restaurants to be worth one. Each lists every
          deal with the days and hours it runs, and the date it was last checked against the restaurant&rsquo;s own page.
        </p>
        <CityLinks cities={cities} />
        <p>
          Not seeing your city? <ChromeLink href="/">Search any city or postal code</ChromeLink> on the map, or{" "}
          <ChromeLink href="/?suggest=1">suggest a deal</ChromeLink> for it.
        </p>
      </article>
    </PublicPage>
  );
}
