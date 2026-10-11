import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { MapPin, Radar, Bell, Clock3, Palette, Check, Minus, X } from "lucide-react";
import ClientMessages from "../../../i18n/ClientMessages";
import PublicPage from "../../PublicPage";
import { localizedAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
import UpgradeCta from "./UpgradeCta";
import { getAppUser, hasPaidPro } from "../../auth";
import { availablePlans, displayPrices } from "../../stripe";
import { headers } from "next/headers";

// Three states, not two. A green check beside "1 area" would claim the free plan fully covers
// tracked areas when it is in fact capped — the standard comparison-table convention is to
// separate "included", "included but limited", and "not included" so the row's own value text
// isn't fighting its icon.
type Tier = "full" | "limited" | "none";

// Only what a subscriber gets today. "New-market early access" was a row here, and it showed a Pro
// subscriber nothing: the dashboard lists markets in 'researching' and renders the section only
// when there is one, and every market_coverage row has been 'covered'. A paid feature that is an
// empty list is not a feature. It can come back when there is a researching market to show.
const FEATURE_ROWS: Array<{ key: string; icon: typeof MapPin; free: Tier }> = [
  { key: "areas", icon: MapPin, free: "limited" },
  { key: "radius", icon: Radar, free: "limited" },
  { key: "alerts", icon: Bell, free: "limited" },
  { key: "history", icon: Clock3, free: "limited" },
  { key: "themes", icon: Palette, free: "limited" },
];

function TierIcon({ tier }: { tier: Tier }) {
  if (tier === "full") return <Check className="pro-icon-yes" />;
  if (tier === "limited") return <Minus className="pro-icon-partial" />;
  return <X className="pro-icon-no" />;
}

const HIGHLIGHT_KEYS = ["areas", "alerts", "history"] as const;
const FAQ_KEYS = ["cancel", "billing", "downgrade"] as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "pro" });
  const meta = await getTranslations({ locale, namespace: "metadata" });
  return pageMetadata({ title: t("pageTitle"), description: t("pageDescription"), alternates: localizedAlternates(locale, "/pro"), imageAlt: meta("ogImageAlt") });
}

export default async function Pro({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("pro");
  // Cloudflare stamps CF-IPCountry on every request at the edge. The country decides which of
  // the currencies the Stripe price already carries is shown; it never changes anything else on
  // the page, and never reaches Checkout, which makes its own currency decision from the same
  // price object. It is also why the colo page cache in worker/index.ts keeps this page once per
  // currency bucket (currencyBucket in app/pricing.ts) rather than once per address: a single copy
  // would hand one country's currency to every later visitor at that colo.
  //
  // A signed-out reader costs this page no D1 read at all: getAppUser answers null without a
  // session token, and the prices come from Stripe through a per-isolate cache (app/stripe.ts).
  // A signed-in reader carries __session, which keeps the Worker's copy out of it entirely.
  const country = (await headers()).get("CF-IPCountry");
  const [user, prices] = await Promise.all([getAppUser(), displayPrices(country)]);
  const pro = user ? hasPaidPro(user) : false;
  // PRICED_PAGE_MARKER in app/pricing.ts: rendered only beside real prices, and the Worker stores
  // a copy of this page for others only when it is there. A render made while Stripe could not be
  // reached has no prices, and is right for this visitor alone.
  const priced = Object.keys(prices).length > 0;

  // UpgradeCta's messages; see i18n/client-messages.ts.
  return <ClientMessages namespaces={["pro", "apiErrors"]}><PublicPage className="pro-page">
    <header className="pro-hero" data-radar-priced={priced ? "" : undefined}>
      <span className="kicker">{t("kicker")}</span>
      <h1>{t("heading")}</h1>
      <p>{t("subtitle")}</p>
      <UpgradeCta pro={pro} plans={availablePlans()} prices={prices}/>
    </header>

    <section className="pro-table-section" aria-label={t("tableCaption")}>
      {/* A table to a screen reader, a grid to the eye. It was divs and spans, so "1 area" was read
          with nothing to say which plan it belonged to. The roles give every cell its row and
          column header and leave the CSS grid, and its phone layout, exactly as it was. The first
          column header is visible only to assistive technology; on screen the feature names say
          what that column is. */}
      <div className="pro-table" role="table" aria-label={t("tableCaption")}>
        <div className="pro-table-head" role="row">
          <span role="columnheader" className="pro-table-head-feature"><span className="sr-only">{t("columnFeature")}</span></span>
          <span role="columnheader">{t("columnFree")}</span>
          <span role="columnheader" className="pro-table-head-pro">{t("columnPro")}</span>
        </div>
        {FEATURE_ROWS.map(({ key, icon: Icon, free }) => <div className="pro-table-row" role="row" key={key}>
          <span className="pro-table-feature" role="rowheader"><Icon/>{t(`features.${key}.label`)}</span>
          <span className="pro-table-cell" role="cell"><TierIcon tier={free}/>{t(`features.${key}.free`)}</span>
          <span className="pro-table-cell pro-table-cell-pro" role="cell"><TierIcon tier="full"/>{t(`features.${key}.pro`)}</span>
        </div>)}
      </div>
      <p className="pro-table-legend">
        <span><Check className="pro-icon-yes"/>{t("legendFull")}</span>
        <span><Minus className="pro-icon-partial"/>{t("legendLimited")}</span>
        <span><X className="pro-icon-no"/>{t("legendNone")}</span>
      </p>
    </section>

    <section className="pro-highlights">
      <h2>{t("highlightsHeading")}</h2>
      <div className="pro-highlight-grid">
        {HIGHLIGHT_KEYS.map((key) => <article key={key}><h3>{t(`highlights.${key}.title`)}</h3><p>{t(`highlights.${key}.body`)}</p></article>)}
      </div>
    </section>

    <section className="pro-faq">
      <h2>{t("faqHeading")}</h2>
      <div className="pro-faq-list">
        {FAQ_KEYS.map((key) => <details key={key}><summary>{t(`faq.${key}.q`)}</summary><p>{t(`faq.${key}.a`)}</p></details>)}
      </div>
    </section>
  </PublicPage></ClientMessages>;
}
