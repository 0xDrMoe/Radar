import { getTranslations } from "next-intl/server";
import ChromeLink from "./ChromeLink";
import { cityPath } from "./city-pages";
import { dateFormatter } from "./formatters";
import type { HomeListings } from "./home-listings";
import { dateFormatLocale, parseSqlTimestamp } from "./verification";

// The home page's server-rendered list: the deals most recently checked against their source, and
// the city guides. Plain links in the HTML, for the reason app/home-listings.ts gives. A server
// component, handed to HomeClient as a node, so none of it is in the client bundle.

function checkedOn(value: string, locale: string): string {
  const date = parseSqlTimestamp(value);
  if (Number.isNaN(date.getTime())) return "";
  // UTC, because this is baked once for every reader; a day either side of midnight is not worth a
  // date that changes with the reader's zone after hydration.
  return dateFormatter(`home-checked|${locale}`, dateFormatLocale(locale), { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

export default async function HomeRecentChecks({ listings, locale }: { listings: HomeListings; locale: string }) {
  const { recentChecks, guides } = listings;
  if (!recentChecks.length && !guides.length) return null;
  const t = await getTranslations({ locale, namespace: "home.recentChecks" });
  return (
    <section className="recent-checks" aria-labelledby="recent-checks-heading">
      <div className="recent-checks-intro">
        <span className="kicker">{t("kicker")}</span>
        <h2 id="recent-checks-heading">{t("heading")}</h2>
        <p>{t("body")}</p>
      </div>
      {recentChecks.length > 0 && (
        <ul className="recent-checks-list">
          {recentChecks.map((deal) => {
            const date = checkedOn(deal.verifiedAt, locale);
            return (
              <li key={deal.id}>
                <ChromeLink href={`/deals/${encodeURIComponent(deal.slug || deal.id)}`} className="recent-check-link">
                  <span className="recent-check-restaurant">{deal.restaurant}</span>
                  <span className="recent-check-title">{deal.title}</span>
                </ChromeLink>
                <span className="recent-check-meta">
                  {[deal.place, date ? t("checked", { date }) : ""].filter(Boolean).join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {guides.length > 0 && (
        <nav className="recent-checks-guides" aria-label={t("guidesLabel")}>
          <span>{t("guidesLabel")}</span>
          <ul>
            {/* English only, like the guides themselves: a plain link, since /fr/cities and
                /es/cities only redirect here. */}
            {guides.map((city) => (
              <li key={city.slug}><a href={`/en${cityPath(city)}`}>{city.region ? `${city.name}, ${city.region}` : city.name}</a></li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
