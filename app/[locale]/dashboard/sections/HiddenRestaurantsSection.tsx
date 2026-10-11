"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Ban } from "lucide-react";
import { Empty, type PublicDeal, type SectionProps } from "../dashboard-shared";

// Restaurants the reader never wants in their results. Hiding one only changes what *their* results
// show, so the restaurants offered for hiding are the ones they actually see: the local feed for
// their default area, or the recommended list when they have told Radar nothing about where they
// are, which is then what they are being shown. Hiding is never a Pro feature.
export default function HiddenRestaurantsSection({ data, busy, mutate, reload, candidates, localFeed }: SectionProps & { candidates: PublicDeal[]; localFeed: boolean }) {
  const t = useTranslations("dashboard");
  const [query,setQuery] = useState("");
  const hidden = data.excludedRestaurants || [];
  const hiddenIds = new Set(hidden.map((restaurant) => restaurant.restaurant_id));
  const needle = query.trim().toLowerCase();
  const matches = (name:string,cuisine:string) => !needle || `${name} ${cuisine}`.toLowerCase().includes(needle);
  const offered = Array.from(new Map(candidates.filter((deal) => deal.canonical_restaurant_id && !hiddenIds.has(deal.canonical_restaurant_id)).map((deal) => [deal.canonical_restaurant_id as string,deal])).values())
    .filter((deal) => matches(deal.restaurant,deal.cuisine));
  async function exclude(restaurantId:string,name:string) { if (await mutate({action:"exclude_restaurant",restaurantId},t("preferences.restaurantHidden",{name}))) await reload(); }
  async function include(restaurantId:string,name:string) { if (await mutate({action:"include_restaurant",restaurantId},t("preferences.restaurantRestored",{name}))) await reload(); }
  return <>
    <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("preferences.kicker")}</span><h2>{t("preferences.heading")}</h2></div><span className="status on">{t("preferences.hiddenCount",{count:hidden.length})}</span></div>
      <div className="tracked-locations">{hidden.map((restaurant) => <article key={restaurant.restaurant_id}><Ban/><div><b>{restaurant.name}</b><small>{restaurant.cuisine}</small></div><button disabled={busy === `include_restaurant-${restaurant.restaurant_id}`} onClick={() => include(restaurant.restaurant_id,restaurant.name)}>{t("preferences.addBack")}</button></article>)}</div>
      {!hidden.length && <Empty title={t("preferences.emptyTitle")} message={t("preferences.emptyMessage")} action={<span/>}/>}
    </section>
    <section className="portal-card"><div className="portal-card-head"><div><h2>{t("preferences.hideSubhead")}</h2><p className="dash-card-note">{localFeed ? t("preferences.candidatesLocal") : t("preferences.candidatesNational")}</p></div></div>
      {!!candidates.length && <div className="dash-filters" role="search" aria-label={t("filters.label")}><label>{t("filters.search")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("preferences.searchPlaceholder")}/></label></div>}
      <div className="tracked-locations">{offered.map((deal) => <article key={deal.canonical_restaurant_id}><span className="deal-emoji">{deal.emoji || "🍽️"}</span><div><b>{deal.restaurant}</b><small>{deal.cuisine}</small></div><button disabled={busy === `exclude_restaurant-${deal.canonical_restaurant_id}`} onClick={() => exclude(deal.canonical_restaurant_id as string,deal.restaurant)}>{t("preferences.hide")}</button></article>)}</div>
      {!offered.length && <p className="dash-card-note">{needle ? t("filters.noMatchBody") : t("preferences.noCandidates")}</p>}
    </section>
  </>;
}
