"use client";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import BrandLogo from "./BrandLogo";
import ChromeLink from "./ChromeLink";
import RedemptionPill from "./RedemptionPill";
import { readerTimezone } from "./market";
import { appOnly, noAppNeeded, parseRedemption, type Market } from "./redemption";
import { regionName } from "./region-names";
import { endDateLabel } from "./verification";

// The national chains' deals for one market, beside the local results.
//
// Two kinds of deal, one section. 'national' deals (drizzle/0050) are a chain Radar holds no
// branches for, placed by the chain's footprint - asked from Knoxville, a chain with no restaurant
// in Tennessee is not in the list. And with `chains=separate`, the branch deals of every chain
// marked national (drizzle/0051) come here instead of the local list, placed as that list places
// them: near the reader, when the page knows where the reader is. Canada's chains are all of the
// second kind, which is how Canada has this section at all.
//
// One card per brand (`group=brand`), listing what the brand is running. A card per offer put
// McDonald's in the list four times and Boston Pizza six, and a list of the same names over and
// over read as a wall of promotions rather than a list of places. The question a reader brings here
// is not "what is near me" but "what can I get, and do I need their app for it", so the filter is by
// redemption, applied offer by offer, and every offer carries its own answer - and, for a branch
// deal, where it runs.

type Offer = {
  id: string;
  slug?: string;
  title: string;
  price: string;
  schedule: string;
  availability?: string;
  available_today?: boolean;
  redemption?: string | null;
  redemption_note?: string | null;
  promo_code?: string | null;
  expires_at?: string | null;
  expiry_timezone?: string | null;
  location_scope?: string | null;
  city?: string;
  participating_location_count?: number | null;
  schedule_varies?: boolean;
};

type NationalDeal = Offer & {
  restaurant: string;
  brand_name?: string;
  chain_offers?: Offer[];
  emoji?: string;
  source_url?: string;
  restaurant_website?: string | null;
  restaurant_logo_url?: string | null;
};

type Filter = "all" | "noApp" | "app" | "code";

// The whole list in one request: the API takes pages this large for the compact nationwide list,
// and every page costs it the same filter and sort, so one page is a third of the CPU of three.
// A list longer than this would want a page of its own, not a bigger section on this one.
const LIST_MAX = 200;
// The loop is for a server that still caps a page at 50: four of those are the same 200.
const MAX_PAGES = 4;
// Cards shown before "Show all", and offers on one card before its "+N more".
const COLLAPSED = 6;
const OFFERS_SHOWN = 3;

const matches = (filter: Filter, offer: Offer) => {
  if (filter === "all") return true;
  const methods = parseRedemption(offer.redemption);
  if (filter === "noApp") return noAppNeeded(methods);
  if (filter === "app") return appOnly(methods);
  return methods.includes("code");
};

// A card's offers. An answer from before group=brand carries none, and its card is its one offer.
const offersOf = (deal: NationalDeal): Offer[] => (deal.chain_offers?.length ? deal.chain_offers : [deal]);

export default function NationalDeals({ country, region, near, query, locale, onVisit }: {
  /** The market on screen, or null for both. */
  country: Market | null;
  /** The reader's state or province, when a search named one: the list keeps the chains that trade there. */
  region?: string | null;
  /** Where the local list is measured from, when it is: a chain's branch deal is kept when it runs within the radius. */
  near?: { latitude: number; longitude: number; radius: number } | null;
  query?: string;
  locale: string;
  onVisit?: (deal: NationalDeal) => void;
}) {
  const t = useTranslations("national");
  // As numbers, not the object: the page hands over a new one on every render, and an effect that
  // depended on it would fetch on every render too.
  const nearLatitude = near?.latitude ?? null, nearLongitude = near?.longitude ?? null, nearRadius = near?.radius ?? null;
  const key = `${country || ""}|${region || ""}|${nearLatitude},${nearLongitude},${nearRadius}|${query || ""}|${locale}`;
  const [loaded, setLoaded] = useState<{ key: string; deals: NationalDeal[] } | null>(null);
  // `open` is the cards showing all their offers, by id.
  const [view, setView] = useState<{ key: string; filter: Filter; expanded: boolean; open: string[] }>({ key, filter: "all", expanded: false, open: [] });
  // A new market, region or query starts the list over, unfiltered and collapsed.
  if (view.key !== key) setView({ key, filter: "all", expanded: false, open: [] });

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const deals: NationalDeal[] = [];
      let cursor: string | null = "0";
      for (let page = 0; cursor != null && page < MAX_PAGES && deals.length < LIST_MAX; page++) {
        const params = new URLSearchParams({ scope: "national", chains: "separate", group: "brand", locale, view: "compact", limit: String(LIST_MAX - deals.length), cursor });
        if (country) params.set("country", country);
        if (region) params.set("province", region);
        if (nearLatitude != null && nearLongitude != null) {
          params.set("lat", String(nearLatitude));
          params.set("lng", String(nearLongitude));
          if (nearRadius != null) params.set("radius", String(nearRadius));
        }
        if (query) params.set("q", query);
        // A national offer has no branch, so its "today" is the reader's.
        const clock = readerTimezone();
        if (clock) params.set("tz", clock);
        const response = await fetch(`/api/deals?${params}`, { signal: controller.signal });
        if (!response.ok) break;
        const body = await response.json().catch(() => ({})) as { results?: NationalDeal[]; nextCursor?: string | null };
        deals.push(...(body.results || []));
        cursor = body.nextCursor ?? null;
      }
      setLoaded({ key, deals });
    })().catch(() => {
      // Aborted by a newer search, or the list failed: the local results are still the page, and a
      // section that is simply absent is the honest way to say it could not be loaded.
    });
    return () => controller.abort();
  }, [key, country, region, nearLatitude, nearLongitude, nearRadius, query, locale]);

  const deals = useMemo(() => (loaded?.key === key ? loaded.deals : []), [loaded, key]);
  // Brands with at least one offer of each kind: a filter keeps a card when any of its offers pass.
  const counts = useMemo(() => {
    const brandsWith = (filter: Filter) => deals.filter((deal) => offersOf(deal).some((offer) => matches(filter, offer))).length;
    return { all: deals.length, noApp: brandsWith("noApp"), app: brandsWith("app"), code: brandsWith("code") };
  }, [deals]);
  if (!deals.length) return null;

  const filter = view.key === key ? view.filter : "all";
  const expanded = view.key === key && view.expanded;
  const open = view.key === key ? view.open : [];
  // Each card with only the offers the filter keeps, and the cards it leaves with none dropped: a
  // reader who asked for promo codes is not shown a brand's in-app deals to get to its code.
  const shown = deals
    .map((deal) => ({ deal, offers: offersOf(deal).filter((offer) => matches(filter, offer)) }))
    .filter((card) => card.offers.length > 0);
  const visible = expanded ? shown : shown.slice(0, COLLAPSED);
  const filters: Array<[Filter, string]> = [["all", t("filterAll")], ["noApp", t("filterNoApp")], ["app", t("filterApp")], ["code", t("filterCode")]];

  return (
    <section className="national-deals" aria-labelledby="national-deals-heading">
      <div className="national-deals-head">
        <div>
          <h3 id="national-deals-heading">{t("heading")}</h3>
          <p>{region ? t("subRegion", { region: regionName(region, country) }) : t(country === "CA" ? "subCA" : country === "US" ? "subUS" : "subAll")}</p>
        </div>
        <div className="national-filters" role="group" aria-label={t("filterAria")}>
          {filters.filter(([value]) => value === "all" || counts[value] > 0).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={filter === value ? "active" : ""}
              aria-pressed={filter === value}
              onClick={() => setView({ key, filter: value, expanded: false, open: [] })}
            >
              {label} <small>{counts[value]}</small>
            </button>
          ))}
        </div>
      </div>
      {visible.length ? (
        <div className="national-grid">
          {visible.map(({ deal, offers }) => {
            const brand = deal.brand_name || deal.restaurant;
            const isOpen = open.includes(deal.id);
            const listed = isOpen ? offers : offers.slice(0, OFFERS_SHOWN);
            return (
              <article key={deal.id} className="national-card" aria-label={brand}>
                <div className="national-card-brand">
                  <BrandLogo name={brand} website={deal.restaurant_website} logoUrl={deal.restaurant_logo_url} />
                  <b>{brand}</b>
                  {offers.length > 1 && <small>{t("count", { count: offers.length })}</small>}
                </div>
                <ul className="national-offers">
                  {listed.map((offer) => {
                    const ends = endDateLabel(offer.expires_at, locale, offer.expiry_timezone);
                    return (
                      <li key={offer.id}>
                        {/* A ChromeLink, like the deal cards beside it (app/ChromeLink.tsx): the
                            baked deal page for a reader without a session cookie, a client-side
                            navigation for one with it. */}
                        <ChromeLink
                          className={`national-offer${offer.available_today === false ? " not-today" : ""}`}
                          href={`/deals/${encodeURIComponent(offer.slug || offer.id)}`}
                          onClick={() => onVisit?.({ ...deal, ...offer, restaurant: brand })}
                        >
                          <span className="national-offer-head">
                            <strong>{offer.title}</strong>
                            <RedemptionPill redemption={offer.redemption} promoCode={offer.promo_code} note={offer.redemption_note} />
                          </span>
                          <span className="national-card-price">{offer.price}</span>
                          <span className="national-card-meta">
                            {/* A branch deal runs where its branch is, and the offer says where: a
                                Boston Pizza Wing Wednesday in Surrey is not an offer at every Boston
                                Pizza. One run at several branches says how many. */}
                            {offer.location_scope === "national" ? ""
                              : (offer.participating_location_count ?? 0) > 1 ? `${t("locations", { count: offer.participating_location_count! })} · `
                              : offer.city ? `${offer.city} · ` : ""}
                            {/* The schedule itself when the offer is not on today: "Oct 6 only" or
                                "Wednesdays" tells a reader when to come back, where "See schedule"
                                makes them open the deal to find out. */}
                            {offer.available_today ? offer.availability || offer.schedule : offer.schedule}
                            {/* The times above are the nearest branch's; the others differ. */}
                            {offer.schedule_varies && ` · ${t("scheduleVaries")}`}
                            {ends && ` · ${t("endsOn", { date: ends })}`}
                          </span>
                        </ChromeLink>
                      </li>
                    );
                  })}
                </ul>
                {offers.length > OFFERS_SHOWN && (
                  <button
                    type="button"
                    className="national-card-more"
                    aria-expanded={isOpen}
                    onClick={() => setView({ key, filter, expanded, open: isOpen ? open.filter((id) => id !== deal.id) : [...open, deal.id] })}
                  >
                    {isOpen ? t("showFewer") : t("moreOffers", { count: offers.length - OFFERS_SHOWN })}
                  </button>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <p className="national-empty">{t("empty")}</p>
      )}
      {shown.length > COLLAPSED && (
        <button type="button" className="national-more" onClick={() => setView({ key, filter, expanded: !expanded, open })}>
          {expanded ? t("showFewer") : t("showAll", { count: shown.length })}
        </button>
      )}
    </section>
  );
}
