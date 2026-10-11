"use client";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Bell, ChevronRight, CreditCard, Heart, MailCheck, MapPin, PauseCircle } from "lucide-react";
import ChromeLink from "../../../ChromeLink";
import { Link } from "../../../../i18n/navigation";
import { isPaused, isPaymentFailing } from "../../../entitlement";
import { FREE_AREA_LIMIT } from "../../../plan-limits";
import { alertDaysOf, DealList, formatDay, type NotificationPreference, type PublicDeal, type SectionProps } from "../dashboard-shared";

// The overview answers two questions and nothing else: is anything waiting on me, and what is near
// me. It used to open on four stat tiles and a seven-day strip that restated the alerts tile, then
// a "deals near you" count that restated the list under it. The counts that stay are the three a
// reader acts on, and each is a link to the section it counts.
export default function OverviewSection({ data, pro, nearby }: SectionProps & { nearby: { deals: PublicDeal[]; total: number; area: { postal:string; radius:number; label:string|null } | null } }) {
  const t = useTranslations("dashboard"), locale = useLocale();
  const p = data.profile, saved = data.savedDeals || [], areas = data.locations || [];
  const pref:Partial<NotificationPreference> = data.notificationPreferences?.[0] || {};
  const savedIds = new Set(saved.map((deal) => deal.id));
  const ended = saved.filter((deal) => !deal.live).length;
  const defaultArea = areas.find((area) => area.is_default && area.active) || areas.find((area) => area.active);
  const dayLabels: Array<[string,string]> = [["1",t("alerts.dayMon")],["2",t("alerts.dayTue")],["3",t("alerts.dayWed")],["4",t("alerts.dayThu")],["5",t("alerts.dayFri")],["6",t("alerts.daySat")],["0",t("alerts.daySun")]];
  // Named days rather than a bare count: "Mon, Thu · 08:00" answers the question the tile asks.
  const chosenDays = dayLabels.filter(([value]) => alertDaysOf(pref).includes(value)).map(([,label]) => label);
  const alertSummary = !pref.enabled ? t("stats.alertsOff")
    : chosenDays.length ? t("stats.alertsOn",{days:chosenDays.join(", "),time:pref.delivery_time || "08:00"})
    : t("stats.alertsNoDays");
  // Only what the reader can act on, most urgent first, each with the one place it is fixed. A
  // waitlisted alert request is not here: there is nothing for them to do but wait.
  const attention: Array<{ key:string; icon:typeof Heart; text:string; section:"billing"|"alerts"|"areas"|"saved"; cta:string; tone:"bad"|"warn"|"info" }> = [];
  if (isPaymentFailing(p.plan_status)) attention.push({ key:"card", icon:CreditCard, text:t("attention.paymentFailed"), section:"billing", cta:t("attention.paymentFailedCta"), tone:"bad" });
  if (isPaused(p.paused_until)) attention.push({ key:"paused", icon:PauseCircle, text:t("attention.paused",{ date: formatDay(locale, String(p.paused_until)) }), section:"billing", cta:t("attention.pausedCta"), tone:"info" });
  if (data.consent?.status === "pending") attention.push({ key:"consent", icon:MailCheck, text:t("attention.confirmEmail"), section:"alerts", cta:t("attention.confirmEmailCta"), tone:"warn" });
  if (!areas.length && !p.home_postal) attention.push({ key:"area", icon:MapPin, text:t("attention.noArea"), section:"areas", cta:t("attention.noAreaCta"), tone:"info" });
  if (ended) attention.push({ key:"ended", icon:AlertTriangle, text:t("attention.savedEnded",{count:ended}), section:"saved", cta:t("attention.savedEndedCta"), tone:"warn" });
  const local = nearby.deals.filter((deal) => !savedIds.has(deal.id)).slice(0,6);
  const recent = saved.filter((deal) => deal.live).slice(0,4);
  return <>
    {!!attention.length && <section className="portal-card dash-attention" aria-labelledby="dash-attention-title"><div className="portal-card-head"><div><h2 id="dash-attention-title">{t("attention.heading")}</h2></div></div><ul>{attention.map(({key,icon:Icon,text,section,cta,tone}) => <li key={key} className={`dash-attention-${tone}`}><Icon aria-hidden="true"/><span>{text}</span><ChromeLink href={`/dashboard/${section}`}>{cta}<ChevronRight aria-hidden="true"/></ChromeLink></li>)}</ul></section>}
    <nav className="dash-glance" aria-label={t("glance.label")}>
      <ChromeLink href="/dashboard/saved"><Heart aria-hidden="true"/><span><b>{saved.length}</b>{t("stats.savedDeals")}</span><small>{ended ? t("glance.savedEnded",{count:ended}) : t("stats.savedHint")}</small></ChromeLink>
      <ChromeLink href="/dashboard/areas"><MapPin aria-hidden="true"/><span><b>{areas.length}</b>{t("stats.trackedAreas")}</span><small>{defaultArea ? t("glance.defaultArea",{label:defaultArea.label}) : pro ? t("stats.areasPro") : t("stats.areasFree",{count:areas.length,limit:FREE_AREA_LIMIT})}</small></ChromeLink>
      <ChromeLink href="/dashboard/alerts"><Bell aria-hidden="true"/><span><b>{pref.enabled ? t("stats.active") : t("stats.paused")}</b>{t("stats.dealAlerts")}</span><small>{alertSummary}</small></ChromeLink>
    </nav>
    {/* No area on file means no local feed. An earlier version fell back to the national
        recommended list, so an Ottawa account was shown Austin deals under a "near you" heading. */}
    {nearby.area
      ? <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("overview.nearbyKicker")}</span><h2>{t("overview.nearbyHeading",{area:nearby.area.label || nearby.area.postal})}</h2><p className="dash-card-note">{t("overview.nearbyCount",{count:nearby.total,radius:nearby.area.radius})}</p></div><ChromeLink href={`/?postal=${encodeURIComponent(nearby.area.postal)}&radius=${nearby.area.radius}`}>{t("overview.browseAll")} <ChevronRight/></ChromeLink></div>
          {/* "Nothing here yet" beats the section vanishing: Radar genuinely has no coverage in
              some areas, and a reader who added one deserves to be told so. */}
          <DealList deals={local} empty={t("overview.noCoverageTitle",{area:nearby.area.label || nearby.area.postal})} saveHint={t("overview.noCoverageBody")}/>
        </section>
      : <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("overview.nearbyKicker")}</span><h2>{t("overview.noAreaHeading")}</h2></div></div><div className="pro-upsell dash-setup"><div className="pro-upsell-icon"><MapPin/></div><div className="pro-upsell-body"><b>{t("overview.noAreaTitle")}</b><p>{t("overview.noAreaBody")}</p></div><Link className="primary" href="/dashboard/areas">{t("overview.noAreaCta")}</Link></div></section>}
    <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("overview.shortlistKicker")}</span><h2>{t("overview.shortlistHeading")}</h2></div>{saved.length > recent.length ? <ChromeLink href="/dashboard/saved">{t("overview.allSaved",{count:saved.length})} <ChevronRight/></ChromeLink> : <Link href="/">{t("overview.findDeals")} <ChevronRight/></Link>}</div><DealList deals={recent} empty={t("overview.buildShortlist")} saveHint={t("overview.saveHint")}/></section>
    {pro && !!data.comingSoonMarkets?.length && <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("overview.proKicker")}</span><h2>{t("overview.comingSoonHeading")}</h2></div><span className="sponsor-status">{t("account.proBadge")}</span></div><div className="tracked-locations">{data.comingSoonMarkets.map((market) => <article key={market.market}><span className="area-ring"><MapPin/></span><div><b>{market.market}</b><small>{market.region}, {market.country}</small></div></article>)}</div></section>}
  </>;
}
