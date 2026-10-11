"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Flag, Lightbulb } from "lucide-react";
import ChromeLink from "../../../ChromeLink";
import { useApiErrorText, type ApiErrorBody } from "../../../api-error-text";
import { isOpenReport } from "../../../accuracy-reports";
import { Empty, SectionLoading, When } from "../dashboard-shared";

interface Suggestion { reference: string | null; restaurant: string; deal: string; status: string; reason: string | null; created_at: string; updated_at: string | null }
interface Report { id: number; category: string; status: string; created_at: string; resolved_at: string | null; deal: { id: string; slug: string | null; title: string | null; restaurant: string | null } }

// Statuses a reader is told about, in their words. Anything the workspace adds later reads as
// "in review" for a suggestion and "being checked" for a report rather than as a raw value.
const SUGGESTION_STATES = ["pending","needs_information","approved","rejected","withdrawn"];
const REPORT_CATEGORIES = ["deal_ended","incorrect_price","incorrect_schedule","restaurant_closed","wrong_location","misleading_terms","duplicate_listing"];
const suggestionState = (status:string) => SUGGESTION_STATES.includes(status) ? status : "pending";
const openSuggestion = (status:string) => status === "pending" || status === "needs_information" || !SUGGESTION_STATES.includes(status);

type Kind = "all" | "suggestions" | "reports";
type Stage = "all" | "open" | "closed";

// What the reader has sent Radar and where each stands. A suggestion used to end at a reference
// number on the form and a report at a toast, so nobody could tell whether sending one did anything,
// or why a suggestion was turned down. Fetched only when this section is open.
export default function ContributionsSection() {
  const t = useTranslations("dashboard");
  const apiErrorText = useApiErrorText();
  const [state,setState] = useState<{ suggestions: Suggestion[]; reports: Report[] } | null>(null),[error,setError] = useState("");
  const [kind,setKind] = useState<Kind>("all"),[stage,setStage] = useState<Stage>("all");
  async function load() {
    setError("");
    try {
      const response = await fetch("/api/user/contributions");
      const result = await response.json().catch(() => ({})) as ApiErrorBody & { suggestions?: Suggestion[]; reports?: Report[] };
      if (!response.ok) { setError(apiErrorText.message(result,t("contributions.loadFailed"))); return; }
      setState({ suggestions: result.suggestions || [], reports: result.reports || [] });
    } catch { setError(t("contributions.loadFailed")); }
  }
  useEffect(() => {
    // Mount-only fetch; state is set after the request resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const suggestions = (state?.suggestions || []).filter((row) => stage === "all" || (stage === "open") === openSuggestion(row.status));
  const reports = (state?.reports || []).filter((row) => stage === "all" || (stage === "open") === isOpenReport(row.status));
  const total = (state?.suggestions.length || 0) + (state?.reports.length || 0);
  return <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("contributions.kicker")}</span><h2>{t("contributions.heading")}</h2></div><ChromeLink href="/?suggest=1">{t("contributions.suggestCta")}</ChromeLink></div>
    <p className="field-error" role="alert">{error}</p>
    {error && <button type="button" onClick={load}>{t("tryAgain")}</button>}
    {!state && !error && <SectionLoading/>}
    {state && !!total && <div className="dash-filters" role="group" aria-label={t("filters.label")}>
      <label>{t("contributions.typeFilter")}<select value={kind} onChange={(event) => setKind(event.target.value as Kind)}><option value="all">{t("contributions.typeAll")}</option><option value="suggestions">{t("contributions.typeSuggestions",{count:state.suggestions.length})}</option><option value="reports">{t("contributions.typeReports",{count:state.reports.length})}</option></select></label>
      <label>{t("filters.status")}<select value={stage} onChange={(event) => setStage(event.target.value as Stage)}><option value="all">{t("contributions.stageAll")}</option><option value="open">{t("contributions.stageOpen")}</option><option value="closed">{t("contributions.stageClosed")}</option></select></label>
    </div>}
    {state && !total && <Empty title={t("contributions.emptyTitle")} message={t("contributions.emptyMessage")} action={<ChromeLink href="/?suggest=1">{t("contributions.suggestCta")}</ChromeLink>}/>}
    {state && kind !== "reports" && !!state.suggestions.length && <><h3 className="preferences-subhead">{t("contributions.suggestionsHeading")}</h3><div className="audit-list dash-contributions">{suggestions.map((row, index) => { const status = suggestionState(row.status); return <article key={row.reference || index}><Lightbulb aria-hidden="true"/><div><b>{row.restaurant}</b><p>{row.deal}</p><small>{row.reference ? `${row.reference} · ` : ""}{t("contributions.sent")} <When stamp={row.created_at}/></small>{row.reason && <p className="dash-reason"><b>{t("contributions.reasonLabel")}</b> {row.reason}</p>}{status === "needs_information" && <p className="dash-reason">{t("contributions.needsInformation")}</p>}</div><span className={`status ${status === "approved" ? "on" : ""}`}>{t(`contributions.suggestionState.${status}`)}</span></article>; })}{!suggestions.length && <p className="dash-card-note">{t("contributions.noneMatch")}</p>}</div></>}
    {state && kind !== "suggestions" && !!state.reports.length && <><h3 className="preferences-subhead">{t("contributions.reportsHeading")}</h3><div className="audit-list dash-contributions">{reports.map((row) => { const open = isOpenReport(row.status); const category = REPORT_CATEGORIES.includes(row.category) ? row.category : "other"; return <article key={row.id}><Flag aria-hidden="true"/><div><b>{row.deal.slug ? <ChromeLink href={`/deals/${encodeURIComponent(row.deal.slug)}`}>{row.deal.restaurant || row.deal.title}</ChromeLink> : (row.deal.restaurant || row.deal.title || t("contributions.removedDeal"))}</b><p>{t(`contributions.category.${category}`)}</p><small>{t("contributions.sent")} <When stamp={row.created_at}/></small></div><span className={`status ${open ? "" : "on"}`}>{open ? t("contributions.reportState.open") : row.status === "rejected" ? t("contributions.reportState.rejected") : t("contributions.reportState.resolved")}</span></article>; })}{!reports.length && <p className="dash-card-note">{t("contributions.noneMatch")}</p>}</div></>}
    {state && !!total && <p className="dash-card-note">{t("contributions.footnote")}</p>}
  </section>;
}
