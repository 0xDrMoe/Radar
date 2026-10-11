"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock3, Lock, Mail } from "lucide-react";
import { Link } from "../../../../i18n/navigation";
import { deliveryState, deliveryTone } from "../../../delivery-history";
import { HISTORY_ROWS, historyRows } from "../../../plan-limits";
import { Empty, ProUpsell, When, type EmailDelivery, type SectionProps } from "../dashboard-shared";

type Filter = "all" | "good" | "issues";

// The alert emails Radar has sent the reader, newest first: what each was, whether it arrived, and,
// when it did not, a reason in words (never the provider's raw error, which /api/user keeps). Free
// keeps the last HISTORY_ROWS.free; Pro keeps HISTORY_ROWS.pro and gets them as a CSV, from a route
// that checks the plan itself (app/api/user/history/export).
export default function HistorySection({ data, pro }: SectionProps) {
  const t = useTranslations("dashboard");
  const [filter,setFilter] = useState<Filter>("all");
  const deliveries = data.deliveries || [];
  const shown = deliveries.filter((delivery) => {
    const outcome = deliveryTone(deliveryState(delivery.status));
    return filter === "all" || (filter === "good" ? outcome === "good" : outcome === "bad" || outcome === "warn");
  });
  // The upsell is said once, where it is true: under a list that has reached the Free window.
  const atWindow = !pro && deliveries.length >= historyRows(false);
  return <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("history.kicker")}</span><h2>{t("history.heading")}</h2></div>{pro ? <a className="primary" href="/api/user/history/export">{t("history.exportCsv")}</a> : <Link className="pro-locked-action purchase-cta" href="/pro" title={t("history.exportLockTitle")}><Lock/>{t("history.exportCsv")}</Link>}</div>{/* eslint-disable-line @next/next/no-html-link-for-pages -- the export link is a downloadable API response, not an app page; Link would let Next prefetch it on hover and needlessly trigger the export */}
    {!!deliveries.length && <div className="dash-filters" role="group" aria-label={t("filters.label")}><label>{t("filters.status")}<select value={filter} onChange={(event) => setFilter(event.target.value as Filter)}><option value="all">{t("history.filterAll")}</option><option value="good">{t("history.filterDelivered")}</option><option value="issues">{t("history.filterIssues")}</option></select></label><p className="dash-count" aria-live="polite">{filter === "all" ? t("history.count",{count:deliveries.length,limit:historyRows(pro)}) : t("filters.showing",{shown:shown.length,total:deliveries.length})}</p></div>}
    <div className="audit-list delivery-list">{shown.map((delivery) => <DeliveryRow key={delivery.id} delivery={delivery}/>)}{!deliveries.length && <Empty title={t("history.emptyTitle")} message={t("history.emptyMessage")} action={<Link href="/dashboard/alerts">{t("history.setUpAlerts")}</Link>}/>}{!!deliveries.length && !shown.length && <p className="dash-card-note">{t("history.noneMatch")}</p>}</div>
    {!!deliveries.length && <p className="delivery-note">{t("history.approximate")}</p>}
    {atWindow && <ProUpsell icon={Clock3} title={t("history.freeTierTitle",{free:HISTORY_ROWS.free})} body={t("history.freeTierBody",{pro:HISTORY_ROWS.pro})} cta={t("areas.upgrade")}/>}
  </section>;
}

function DeliveryRow({delivery}:{delivery:EmailDelivery}) {
  const t = useTranslations("dashboard.history");
  const state = deliveryState(delivery.status), tone = deliveryTone(state);
  // Two facts at most, so the line stays scannable: what the message was, then either why it did
  // not arrive or the one positive signal we have. sent_at is only set once the send happened; a
  // queued or failed row has only created_at, which is still the moment the person cares about.
  const details = [t("dealRoundup"), delivery.reason ? t(`reason.${delivery.reason}`) : delivery.opened ? t("opened") : null].filter(Boolean);
  return (
    <article className={`delivery-row ${tone}`}>
      <Mail/>
      <div><b>{t(`state.${state}`)}</b><small>{details.join(" · ")}</small></div>
      <When stamp={delivery.sent_at || delivery.created_at}/>
    </article>
  );
}
