"use client";
import { useMemo, useState } from "react";
import { ListCount, ListToolbar, listCountLabel, Pager, pageRows, selectRows, type ListSelection } from "../../ListScope";
import type { AdminFeedback } from "../types";
import { PanelHeader, StaffTime, StatePanel } from "../ui";
import { useListScope, useTabState, useWorkspace } from "../workspace";
import { DecisionNote } from "./DecisionNote";

// What people send from the "Send feedback" button on the public site (app/api/feedback/route.ts,
// kicker "Alpha feedback"). The form offers four types, and they split into two different jobs:
//
//   Tester feedback   bug, confusing, incorrect_deal: something about Radar as it is today is
//                     broken, unclear or wrong. Each one is worth acting on.
//   Product feedback  feature: what somebody wants Radar to do next. Read for patterns; one
//                     request is an opinion, ten are a roadmap item.
//
// Launch signals (who is waiting for the email pilot, who left an address for launch news) are a
// third thing and live on the Mailing list tab, not here.
//
// The server's `feedback` action enforces the same rules as accuracy reports: resolving needs a
// note of what was done, and a resolved item can be reopened only with reopen_reports and a reason.

const TYPE_LABELS: Record<string, string> = {
  bug: "Something is broken",
  confusing: "Something is confusing",
  incorrect_deal: "Incorrect deal information",
  feature: "Feature request",
};
const TESTER_TYPES = new Set(["bug", "confusing", "incorrect_deal"]);
const typeLabel = (type: string) => TYPE_LABELS[type] || type.replaceAll("_", " ");

const STATUS_FILTERS = [
  ["active", "Needs action (open and reviewing)"],
  ["open", "Open"],
  ["reviewing", "Reviewing"],
  ["resolved", "Resolved"],
  ["all", "All statuses"],
] as const;

type Decision = { id: number; kind: "resolve" | "reopen" };

export default function FeedbackTab() {
  const { data, busy, action, navCounts, canModerateFeedback, canReopenReports, openTab } = useWorkspace();
  const { listQueryFor, setListQueryFor, pageFor, setPageFor } = useListScope();
  const [typeFilter, setTypeFilter] = useTabState<string>("feedback.type", "");
  const [statusFilter, setStatusFilter] = useTabState<string>("feedback.status", "active");
  const [priorityFilter, setPriorityFilter] = useTabState<string>("feedback.priority", "");
  const [decision, setDecision] = useState<Decision | null>(null);

  const feedback = data.feedback;
  const all = useMemo(() => feedback || [], [feedback]);
  const query = listQueryFor("feedback");
  const narrowedByControls = Boolean(typeFilter) || statusFilter !== "all" || Boolean(priorityFilter);
  const filtered = all.filter((item) =>
    (!typeFilter || item.type === typeFilter)
    && (statusFilter === "all" || (statusFilter === "active" ? item.status !== "resolved" : item.status === statusFilter))
    && (!priorityFilter || (item.priority || "normal") === priorityFilter));
  const searchText = (row: AdminFeedback) => `${typeLabel(row.type)} ${row.message} ${row.email || ""} ${row.market || ""} ${row.deal_title || ""} ${row.status} ${row.resolution || ""}`;
  const testerAll = all.filter((item) => TESTER_TYPES.has(item.type));
  const productAll = all.filter((item) => !TESTER_TYPES.has(item.type));
  const testerList = selectRows(filtered.filter((item) => TESTER_TYPES.has(item.type)), searchText,
    { query, filtered: narrowedByControls, showAll: true });
  const productList = selectRows(filtered.filter((item) => !TESTER_TYPES.has(item.type)), searchText,
    { query, filtered: narrowedByControls, showAll: true });
  const feedbackReset = [query, typeFilter, statusFilter, priorityFilter].join("|");
  const showTester = !typeFilter || TESTER_TYPES.has(typeFilter);
  const showProduct = !typeFilter || !TESTER_TYPES.has(typeFilter);
  const defaultView = statusFilter === "active" && !typeFilter && !priorityFilter && !query;
  const clearFilters = () => { setTypeFilter(""); setStatusFilter("all"); setPriorityFilter(""); setListQueryFor("feedback")(""); };

  const busyKey = (item: AdminFeedback) => `feedback-${item.id}`;
  async function decide(item: AdminFeedback, status: string, note: { resolution?: string; reason?: string } = {}) {
    const result = await action({ action: "feedback", id: item.id, status, ...note }, busyKey(item));
    if (result) setDecision(null);
    return result;
  }

  function renderItem(item: AdminFeedback) {
    const resolved = item.status === "resolved";
    const rowBusy = busy === busyKey(item);
    const formFor = decision?.id === item.id ? decision.kind : null;
    return (
      <article key={item.id}>
        <div>
          <div className="sw-chips">
            <span className={`status ${resolved ? "on" : ""}`}>{item.status}</span>
            {item.priority === "high" && <span className="status sw-high">High priority</span>}
          </div>
          <h3>{typeLabel(item.type)}</h3>
          <p>{item.message}</p>
          {item.deal_id && (
            <div className="sw-report-deal">
              <span>Sent from {item.deal_title ? <b>{item.deal_title}</b> : `deal ${item.deal_id}`}{item.deal_restaurant ? ` · ${item.deal_restaurant}` : ""}</span>
              {item.deal_title && (
                <button type="button" className="sw-link" onClick={() => openTab("deals", `?deal=${encodeURIComponent(item.deal_id || "")}`)}>
                  Open the deal
                </button>
              )}
            </div>
          )}
          {item.type === "incorrect_deal" && !resolved && (
            <small className="sw-hint">A wrong deal is fixed on the deal itself. Check it against its source as you would an accuracy report.</small>
          )}
          <small>
            {item.market || "Area not given"} · {item.email || "Signed out, no reply address"} · <StaffTime value={item.created_at} />
            {item.page ? ` · from ${item.page}` : ""}
          </small>
          {resolved && (
            <div className="sw-closed-note">
              <b>
                Resolved{item.resolved_by_name ? ` by ${item.resolved_by_name}` : ""}
                {item.resolved_at ? <> on <StaffTime value={item.resolved_at} /></> : ""}
              </b>
              <p>{item.resolution || "No note was recorded."}</p>
              {!canReopenReports && <small>Resolved feedback can be reopened only by a supervisor or above.</small>}
            </div>
          )}
          {!resolved && item.resolution && (
            <div className="sw-closed-note">
              <b>Earlier resolution, before it was reopened</b>
              <p>{item.resolution}</p>
            </div>
          )}
          {formFor && (
            <DecisionNote
              id={`feedback-${item.id}-${formFor}`}
              field={formFor === "reopen" ? "reason" : "resolution"}
              label={formFor === "reopen" ? "Why is this being reopened?" : "What was done about it?"}
              hint={formFor === "reopen" ? "Recorded in the audit log with your name." : "For example: fixed in the next release, logged for the roadmap, or could not reproduce."}
              submitLabel={formFor === "reopen" ? "Reopen" : "Resolve"}
              busy={rowBusy}
              onCancel={() => setDecision(null)}
              onSubmit={(text) => formFor === "reopen" ? decide(item, "open", { reason: text }) : decide(item, "resolved", { resolution: text })}
            />
          )}
        </div>
        <div>
          {!resolved && canModerateFeedback && (
            <>
              {item.status === "open" && (
                <button disabled={rowBusy} onClick={() => decide(item, "reviewing")}>
                  {rowBusy && !formFor ? "Saving…" : "Mark reviewing"}
                </button>
              )}
              <button className="primary" disabled={rowBusy} aria-expanded={formFor === "resolve"} onClick={() => setDecision({ id: item.id, kind: "resolve" })}>Resolve…</button>
            </>
          )}
          {resolved && canReopenReports && (
            <button disabled={rowBusy} aria-expanded={formFor === "reopen"} onClick={() => setDecision({ id: item.id, kind: "reopen" })}>Reopen…</button>
          )}
        </div>
      </article>
    );
  }

  function renderSection(
    title: string,
    blurb: string,
    list: ListSelection<AdminFeedback>,
    total: number,
    listKey: string,
    noun: string,
    emptyWhy: string,
  ) {
    const paged = pageRows(list.matched, pageFor(listKey, feedbackReset));
    return (
      <section className="sw-feedback-group" aria-label={title}>
        <PanelHeader title={title}>{blurb}</PanelHeader>
        {!total ? (
          <StatePanel kind="empty" title={`No ${noun}s yet`}>{emptyWhy}</StatePanel>
        ) : !list.matched.length ? (
          <StatePanel
            kind="empty"
            title={defaultView ? "Nothing needs action" : `No ${noun} matches these filters`}
            action={<button type="button" className="sw-link" onClick={clearFilters}>Show everything</button>}
          >
            {defaultView ? "Everything here has been resolved. Choose Resolved or All statuses to read it." : "Change the type, status or priority, or clear the search."}
          </StatePanel>
        ) : (
          <>
            <ListCount>{listCountLabel(list, total, noun, true)}</ListCount>
            <div className="queue-list feedback-queue">{paged.rows.map(renderItem)}</div>
            <Pager paged={paged} noun={noun} onPage={setPageFor(listKey, feedbackReset)} />
          </>
        )}
      </section>
    );
  }

  return (
    <section className="portal-card sw-feedback">
      <PanelHeader title="Product feedback" actions={<span className="status on">{navCounts.openFeedback} need action</span>}>
        Notes people send with the Send feedback button on the site. Problems with Radar today are tester feedback; ideas for what it should do next are product feedback.
      </PanelHeader>
      <ListToolbar query={query} onQuery={setListQueryFor("feedback")} placeholder="Search by message, area, sender or deal" label="Search feedback">
        <label className="sw-filter">
          <span>Type</span>
          <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="sw-filter">
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            {STATUS_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="sw-filter">
          <span>Priority</span>
          <select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
            <option value="">Any priority</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
          </select>
        </label>
      </ListToolbar>
      {feedback === undefined ? (
        <StatePanel kind="error" title="Feedback did not load">
          The workspace answered without the feedback list. Reload the page; if it stays empty, your role may not include moderating feedback.
        </StatePanel>
      ) : (
        <>
          {showTester && renderSection(
            "Tester feedback",
            "Problems people hit using Radar: something broken, confusing, or a deal shown wrong. Fix or route each one, then resolve it with what was done.",
            testerList, testerAll.length, "feedback", "tester note",
            "Reports of something broken, confusing or wrong arrive here from the Send feedback button. Incorrect-deal notes are marked high priority.",
          )}
          {showProduct && renderSection(
            "Product feedback",
            "Feature requests: what people want Radar to do next. Read them for patterns; resolve once it is decided or logged.",
            productList, productAll.length, "feedback-product", "feature request",
            "Requests chosen as Feature request in the Send feedback form arrive here.",
          )}
        </>
      )}
    </section>
  );
}
