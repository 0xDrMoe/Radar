"use client";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import { Link } from "../../../../i18n/navigation";
import ChromeLink from "../../../ChromeLink";
import { Empty, When, type SavedDeal, type SectionProps } from "../dashboard-shared";

type StatusFilter = "all" | "live" | "ended";
type Sort = "recent" | "restaurant";

// Every deal the reader saved, wherever it is and whether or not it is still running. The list used
// to be the saved deals that happened to be in the first 50 of the recommended feed, so a save in
// another city vanished, and an ended one vanished too. Ended deals now stay, marked, until the
// reader removes them: they saved it, so it is theirs to clear.
export default function SavedSection({ data, busy, mutate, reload }: SectionProps) {
  const t = useTranslations("dashboard");
  const saved = useMemo(() => data.savedDeals || [], [data.savedDeals]);
  const [query,setQuery] = useState(""),[city,setCity] = useState(""),[status,setStatus] = useState<StatusFilter>("all"),[sort,setSort] = useState<Sort>("recent");
  const [removed,setRemoved] = useState<Set<string>>(new Set());
  // Cities as the saved deals name them, with the province or state where the deal has one, so two
  // Kingstons are two choices. Only offered once there is more than one to choose between.
  const cities = useMemo(() => Array.from(new Set(saved.map(placeOf))).sort((a,b) => a.localeCompare(b)), [saved]);
  const needle = query.trim().toLowerCase();
  const kept = saved.filter((deal) => !removed.has(deal.id));
  const shown = kept
    .filter((deal) => status === "all" || (status === "live") === deal.live)
    .filter((deal) => !city || placeOf(deal) === city)
    .filter((deal) => !needle || `${deal.restaurant} ${deal.title} ${deal.cuisine} ${deal.city}`.toLowerCase().includes(needle))
    .sort((a,b) => sort === "restaurant" ? a.restaurant.localeCompare(b.restaurant) : 0);
  const narrowed = !!(needle || city || status !== "all");
  const remaining = kept.length;
  async function remove(deal:SavedDeal) {
    setRemoved((current) => new Set(current).add(deal.id));
    if (!await mutate({action:"favorite",dealId:deal.id,saved:false},t("saved.removed",{name:deal.restaurant}))) {
      setRemoved((current) => { const next = new Set(current); next.delete(deal.id); return next; });
      return;
    }
    // Read again in the background so the overview and the counts agree with the server; the row
    // is already gone from this list.
    void reload();
  }
  return <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("saved.kicker")}</span><h2>{t("saved.heading")}</h2></div><Link href="/">{t("saved.findMore")} <ChevronRight/></Link></div>
    {remaining > 0 && <div className="dash-filters" role="search" aria-label={t("filters.label")}>
      <label>{t("filters.search")}<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("saved.searchPlaceholder")}/></label>
      {cities.length > 1 && <label>{t("filters.city")}<select value={city} onChange={(event) => setCity(event.target.value)}><option value="">{t("filters.allCities")}</option>{cities.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>}
      <label>{t("filters.status")}<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">{t("saved.statusAll")}</option><option value="live">{t("saved.statusLive")}</option><option value="ended">{t("saved.statusEnded")}</option></select></label>
      <label>{t("filters.sort")}<select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="recent">{t("saved.sortRecent")}</option><option value="restaurant">{t("saved.sortRestaurant")}</option></select></label>
    </div>}
    {remaining > 0 && <p className="dash-count" aria-live="polite">{narrowed ? t("filters.showing",{shown:shown.length,total:remaining}) : t("saved.count",{count:remaining})}</p>}
    <div className="favorite-grid">{shown.map((deal) => <article className={`saved-dashboard-card${deal.live ? "" : " ended"}`} key={deal.id}>
      {deal.page === "hidden"
        ? <div className="saved-dashboard-static"><span className="deal-emoji">{deal.emoji || "🍽️"}</span><div><b>{deal.restaurant}</b><p>{deal.title}</p><small>{placeOf(deal)} · {deal.cuisine}</small></div></div>
        : <ChromeLink href={`/deals/${encodeURIComponent(deal.slug || deal.id)}`}><span className="deal-emoji">{deal.emoji || "🍽️"}</span><div><b>{deal.restaurant}</b><p>{deal.title}</p><small>{placeOf(deal)} · {deal.cuisine}</small></div><ChevronRight/></ChromeLink>}
      <div className="saved-dashboard-meta">{deal.live ? <span className="status on">{t("saved.live")}</span> : <span className="status">{t("saved.ended")}</span>}<small>{t("saved.savedAt")} <When stamp={deal.saved_at}/></small></div>
      <button onClick={() => remove(deal)} disabled={busy === "favorite"} aria-label={t("saved.removeAria",{name:deal.restaurant})}>{t("saved.remove")}</button>
    </article>)}
    {!remaining && <Empty title={t("saved.emptyTitle")} message={t("saved.emptyMessage")}/>}
    {remaining > 0 && !shown.length && <Empty title={t("filters.noMatchTitle")} message={t("filters.noMatchBody")} action={<button type="button" className="linklike" onClick={() => { setQuery(""); setCity(""); setStatus("all"); }}>{t("filters.clear")}</button>}/>}
    </div>
  </section>;
}

function placeOf(deal: SavedDeal) { return deal.region ? `${deal.city}, ${deal.region}` : deal.city; }
