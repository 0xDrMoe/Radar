"use client";
import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ListCount, ListToolbar, listCountLabel, Pager, pageRows, selectRows } from "../../ListScope";
import { isOpenReport, questionsDeal } from "../../../accuracy-reports";
import { sqlDate } from "../format";
import type { AdminReport } from "../types";
import { EMPTY_GEO, GeoFilter, geoIsSet, matchesGeo, PanelHeader, StaffTime, StatePanel, type GeoFilterValue } from "../ui";
import { useListScope, useTabState, useWorkspace } from "../workspace";
import { DecisionNote } from "./DecisionNote";

// Readers telling Radar a deal is wrong or over (app/api/reports/route.ts). The work is on the deal;
// the report is the record of what was found. Every rule below is also enforced by the server's
// `report` action — this screen only decides what to offer:
//   - closing (resolved or rejected) needs a written resolution;
//   - a completed report can be reopened only with reopen_reports (supervisor and above), with a
//     reason; everyone else sees who completed it and when.

/** The categories the public report form offers, in its order, with the words staff read. */
const CATEGORY_LABELS: Record<string, string> = {
  deal_ended: "Deal has ended",
  incorrect_price: "Wrong price",
  incorrect_schedule: "Wrong days or hours",
  restaurant_closed: "Restaurant closed",
  wrong_location: "Wrong location",
  misleading_terms: "Misleading terms",
  duplicate_listing: "Duplicate listing",
};
const categoryLabel = (category: string) => CATEGORY_LABELS[category] || category.replaceAll("_", " ");

const STATUS_FILTERS = [
  ["active", "Needs action (open and reviewing)"],
  ["open", "Open"],
  ["reviewing", "Reviewing"],
  ["resolved", "Resolved"],
  ["rejected", "Rejected"],
  ["all", "All statuses"],
] as const;

const STATUS_RANK: Record<string, number> = { open: 0, reviewing: 1 };

function placeLabel(report: AdminReport) {
  if (!report.city && (report.location_scope === "brand" || report.location_scope === "national"))
    return report.location_scope === "brand" ? "Every branch of the chain" : "National offer";
  const parts = [report.city, report.region].filter(Boolean);
  return parts.length ? parts.join(", ") : "Place not recorded";
}

type Decision = { id: number; kind: "resolved" | "rejected" | "reopen" };

export default function ReportsTab() {
  const { data, busy, action, navCounts, canModerateFeedback, canReopenReports, openTab } = useWorkspace();
  const { listQueryFor, setListQueryFor, pageFor, setPageFor } = useListScope();
  const [statusFilter, setStatusFilter] = useTabState<string>("reports.status", "active");
  const [categoryFilter, setCategoryFilter] = useTabState<string>("reports.category", "");
  const [geo, setGeo] = useTabState<GeoFilterValue>("reports.geo", EMPTY_GEO);
  // One note form open at a time, so the server's field error can only belong to it.
  const [decision, setDecision] = useState<Decision | null>(null);

  const reports = data.reports;
  const all = useMemo(() => reports || [], [reports]);
  // Open first, then reviewing, then closed; high priority first within each; newest first after
  // that. The server orders the same way, so its 100-row limit never hides open work.
  const ordered = useMemo(() => [...all].sort((a, b) =>
    (STATUS_RANK[a.status] ?? 2) - (STATUS_RANK[b.status] ?? 2)
    || (a.priority === "high" ? 0 : 1) - (b.priority === "high" ? 0 : 1)
    || sqlDate(b.created_at).getTime() - sqlDate(a.created_at).getTime()), [all]);
  const filtered = ordered.filter((report) =>
    (statusFilter === "all" || (statusFilter === "active" ? isOpenReport(report.status) : report.status === statusFilter))
    && (!categoryFilter || report.category === categoryFilter)
    && matchesGeo({ country: report.country, region: report.region, city: report.city, postal: report.postal }, geo));
  const narrowedByControls = statusFilter !== "all" || Boolean(categoryFilter) || geoIsSet(geo);
  const reportList = selectRows(filtered,
    (row) => `${categoryLabel(row.category)} ${row.notes || ""} ${row.deal_id} ${row.deal_title || ""} ${row.deal_restaurant || ""} ${row.city || ""} ${row.status} ${row.resolution || ""}`,
    { query: listQueryFor("reports"), filtered: narrowedByControls, showAll: true });
  const reportReset = [listQueryFor("reports"), statusFilter, categoryFilter, geo.country, geo.region, geo.city, geo.postal].join("|");
  const reportPage = pageRows(reportList.matched, pageFor("reports", reportReset));
  const places = useMemo(() => all.map((r) => ({ country: r.country, region: r.region, city: r.city, postal: r.postal })), [all]);
  const categories = useMemo(() => {
    const seen = new Set(Object.keys(CATEGORY_LABELS));
    for (const report of all) seen.add(report.category);
    return [...seen];
  }, [all]);

  const busyKey = (report: AdminReport) => `report-${report.id}`;
  async function decide(report: AdminReport, status: string, note: { resolution?: string; reason?: string } = {}) {
    const result = await action({ action: "report", id: report.id, status, ...note }, busyKey(report));
    if (result) setDecision(null);
    return result;
  }

  return (
    <section className="portal-card sw-reports">
      <PanelHeader
        title="Accuracy reports"
        actions={<span className="status">{navCounts.openReports} need action</span>}
      >
        Readers telling us a deal has ended or is wrong. Check the deal against its source, fix the deal, then close the report with what you found.
      </PanelHeader>
      <ListToolbar query={listQueryFor("reports")} onQuery={setListQueryFor("reports")} placeholder="Search by deal, restaurant, note or resolution" label="Search reports">
        <label className="sw-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="sw-filter">
          <span>Category</span>
          <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
            <option value="">All categories</option>
            {categories.map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
          </select>
        </label>
      </ListToolbar>
      <GeoFilter places={places} value={geo} onChange={setGeo} label="Filter reports by place" />
      {reports === undefined ? (
        <StatePanel kind="error" title="Reports did not load">
          The workspace answered without the reports list. Reload the page; if it stays empty, your role may not include moderating feedback.
        </StatePanel>
      ) : !all.length ? (
        <StatePanel kind="empty" title="No accuracy reports yet">
          When a reader reports a deal from its page — ended, wrong price, wrong hours — it lands here, open, for someone to check.
        </StatePanel>
      ) : !reportList.matched.length ? (
        <StatePanel
          kind="empty"
          title={statusFilter === "active" && !categoryFilter && !geoIsSet(geo) && !listQueryFor("reports") ? "Nothing needs action" : "No report matches these filters"}
          action={<button type="button" className="sw-link" onClick={() => { setStatusFilter("all"); setCategoryFilter(""); setGeo(EMPTY_GEO); setListQueryFor("reports")(""); }}>Show every report</button>}
        >
          {statusFilter === "active" && !categoryFilter && !geoIsSet(geo) && !listQueryFor("reports")
            ? "Every report has been resolved or rejected. Completed ones are under the Resolved and Rejected statuses."
            : "Change the status, category or place, or clear the search."}
        </StatePanel>
      ) : (
        <>
          <ListCount>{listCountLabel(reportList, all.length, "report", true)}</ListCount>
          <div className="queue-list feedback-queue">
            {reportPage.rows.map((report) => {
              const open = isOpenReport(report.status);
              const rowBusy = busy === busyKey(report);
              const formFor = decision?.id === report.id ? decision.kind : null;
              return (
                <article key={report.id} className={open ? undefined : "sw-report-closed"}>
                  <div>
                    <div className="sw-chips">
                      <span className={`status ${report.status === "resolved" ? "on" : ""}`}>{report.status}</span>
                      {report.priority === "high" && <span className="status sw-high">High priority</span>}
                      {open && questionsDeal(report.category) && <span className="status" title="While this report is open the deal reads Re-checking to the public and ranks lower in search. Resolving or rejecting it ends that.">Deal shows Re-checking</span>}
                    </div>
                    <h3>{categoryLabel(report.category)}</h3>
                    <div className="sw-report-deal">
                      {report.deal_title ? (
                        <>
                          <b>{report.deal_title}</b>
                          <span>{report.deal_restaurant || "Restaurant not recorded"} · {placeLabel(report)}{report.deal_status ? ` · deal is ${report.deal_status}` : ""}</span>
                        </>
                      ) : (
                        <span>This deal ({report.deal_id}) no longer exists.</span>
                      )}
                      {report.deal_title && (
                        <button type="button" className="sw-link" onClick={() => openTab("deals", `?deal=${encodeURIComponent(report.deal_id)}`)}>
                          Open the deal
                        </button>
                      )}
                    </div>
                    <p>{report.notes || "The reader added no notes."}</p>
                    <small>
                      Reported <StaffTime value={report.created_at} />
                      {report.location_id ? ` · about branch ${report.location_id}` : ""}
                    </small>
                    {report.source_url && (
                      <a href={report.source_url} target="_blank" rel="noreferrer">
                        Reader&apos;s supporting source <ExternalLink size={12} aria-hidden="true" />
                      </a>
                    )}
                    {!open && (
                      <div className="sw-closed-note">
                        <b>
                          {report.status === "rejected" ? "Rejected" : "Resolved"}
                          {report.resolved_by_name ? ` by ${report.resolved_by_name}` : ""}
                          {report.resolved_at ? <> on <StaffTime value={report.resolved_at} /></> : ""}
                        </b>
                        <p>{report.resolution || "No resolution was recorded."}</p>
                        {!canReopenReports && <small>Completed reports can be reopened only by a supervisor or above. Ask {report.resolved_by_name || "a supervisor"} if this needs another look.</small>}
                      </div>
                    )}
                    {open && report.resolution && (
                      <div className="sw-closed-note">
                        <b>Earlier resolution, before it was reopened</b>
                        <p>{report.resolution}</p>
                      </div>
                    )}
                    {formFor && (
                      <DecisionNote
                        id={`report-${report.id}-${formFor}`}
                        field={formFor === "reopen" ? "reason" : "resolution"}
                        label={formFor === "reopen" ? "Why is this report being reopened?" : formFor === "resolved" ? "What did you find, and what did you change?" : "Why was the deal right?"}
                        hint={formFor === "reopen" ? "Recorded in the audit log with your name." : "Shown on the report and in the audit log. Name what was wrong and what you did."}
                        submitLabel={formFor === "reopen" ? "Reopen report" : formFor === "resolved" ? "Resolve report" : "Reject report"}
                        busy={rowBusy}
                        onCancel={() => setDecision(null)}
                        onSubmit={(text) => formFor === "reopen" ? decide(report, "open", { reason: text }) : decide(report, formFor, { resolution: text })}
                      />
                    )}
                  </div>
                  <div>
                    {open && canModerateFeedback && (
                      <>
                        {report.status === "open" && (
                          <button disabled={rowBusy} onClick={() => decide(report, "reviewing")}>
                            {rowBusy && !formFor ? "Saving…" : "Mark reviewing"}
                          </button>
                        )}
                        <button className="primary" disabled={rowBusy} aria-expanded={formFor === "resolved"} onClick={() => setDecision({ id: report.id, kind: "resolved" })}>Resolve…</button>
                        <button disabled={rowBusy} aria-expanded={formFor === "rejected"} onClick={() => setDecision({ id: report.id, kind: "rejected" })}>Reject…</button>
                      </>
                    )}
                    {!open && canReopenReports && (
                      <button disabled={rowBusy} aria-expanded={formFor === "reopen"} onClick={() => setDecision({ id: report.id, kind: "reopen" })}>Reopen…</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <Pager paged={reportPage} noun="report" onPage={setPageFor("reports", reportReset)} />
        </>
      )}
    </section>
  );
}
