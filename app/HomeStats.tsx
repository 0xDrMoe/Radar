import { getTranslations } from "next-intl/server";
import { dateFormatter } from "./formatters";
import { roundedDown, type HomeListings } from "./home-listings";
import { dateFormatLocale, parseSqlTimestamp } from "./verification";

// The hero's figures: how many deals, restaurants and cities the public catalogue holds, and how
// many of its deals were checked against their source in the past month. Every number is counted
// from the catalogue (catalogStats in app/home-listings.ts) and rounded down, so a page baked at
// deploy stays true while deals come and go. A server component, handed to HomeClient as a node,
// like HomeRecentChecks.

/** Below this the catalogue is too small for figures to say anything; the hero falls back to its line. */
const MIN_DEALS = 10;

function shortDate(value: string, locale: string): string {
  const date = parseSqlTimestamp(value);
  if (Number.isNaN(date.getTime())) return "";
  // UTC, for the reason app/HomeRecentChecks.tsx gives: one baked copy for every reader.
  return dateFormatter(`home-stats|${locale}`, dateFormatLocale(locale), { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

export default async function HomeStats({ listings, locale }: { listings: HomeListings; locale: string }) {
  const { stats, recentChecks } = listings;
  if (stats.deals < MIN_DEALS || !stats.restaurants || !stats.cities) return null;
  const t = await getTranslations({ locale, namespace: "home.stats" });
  const number = new Intl.NumberFormat(locale);
  const figure = (count: number) => {
    const { value, plus } = roundedDown(count);
    return { count: value, label: `${number.format(value)}${plus ? "+" : ""}` };
  };
  const since = shortDate(stats.checkedSince, locale);
  const latest = recentChecks[0] ? shortDate(recentChecks[0].verifiedAt, locale) : "";
  const items = [
    { key: "deals", ...figure(stats.deals) },
    { key: "restaurants", ...figure(stats.restaurants) },
    { key: "cities", ...figure(stats.cities) },
    ...(stats.checked > 0 && since ? [{ key: "checked", ...figure(stats.checked) }] : []),
  ];
  return (
    <section className="hero-stats" aria-label={t("label")}>
      <dl>
        {items.map((item) => (
          <div key={item.key} className={`hero-stat hero-stat-${item.key}`}>
            <dt>{t(item.key, { count: item.count, date: since })}</dt>
            <dd>{item.label}</dd>
          </div>
        ))}
      </dl>
      {latest && (
        <p className="hero-stats-note">
          <span className="hero-stats-pulse" aria-hidden="true" />
          {t("latest", { date: latest })}
        </p>
      )}
    </section>
  );
}
