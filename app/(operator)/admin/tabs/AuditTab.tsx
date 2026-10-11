"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Lock, RefreshCw, Search } from "lucide-react";
import { formatRole } from "../../../permissions";
import { sqlDate } from "../format";
import type { AdminAuditEvent } from "../types";
import { PanelHeader, StaffTime, StatePanel } from "../ui";
import { useTabState, useWorkspace } from "../workspace";

// The audit log as a feed: one entry per change, newest first, grouped by day, each told as a
// sentence ("Dana paused 'Tuesday wings' at Joe's") with the structured record a click away.
//
// It reads GET /api/admin/audit rather than the 400 rows in the workspace payload, so a search or
// a filter reaches the whole log, a page of 100 at a time. That route answers to owners and admins
// only, the same rule as the page itself.
//
// The log is append-only: database triggers (drizzle/0071) refuse any edit or deletion, and this
// screen offers neither. It only reads.

interface AuditRow extends AdminAuditEvent {
  actor_name: string | null;
  actor_email: string | null;
  deal_title: string | null;
  deal_restaurant: string | null;
}
interface AuditFacets {
  actions: string[];
  targetTypes: string[];
  actors: { id: string; name: string | null; role: string | null }[];
}
interface AuditFilters {
  q: string;
  actor: string;
  action: string;
  target: string;
  from: string;
  to: string;
}
const NO_FILTERS: AuditFilters = { q: "", actor: "", action: "", target: "", from: "", to: "" };

const words = (value: string) => value.replaceAll("_", " ");
const lowerFirst = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
// The owner-approval actions, as the end of "a request to ...". For decisions logged before the
// request's summary was kept with them.
const REQUESTED_ACTIONS: Record<string, string> = {
  bulk_lifecycle: "change every deal in a market",
  delete_sponsorship: "delete a sponsorship",
  affiliate_payout: "pay an affiliate",
  setting: "change an operator switch",
};
const LIFECYCLE_VERBS: Record<string, string> = {
  live: "published",
  paused: "paused",
  archived: "archived",
  expired: "ended",
  draft: "moved back to draft",
  scheduled: "scheduled",
};
// Detail keys as a person would say them. Anything not listed is shown with its key spelled out.
const DETAIL_LABELS: Record<string, string> = {
  status: "Status",
  previousStatus: "Previous status",
  city: "City",
  market: "Market",
  restaurant: "Restaurant",
  title: "Deal",
  dealId: "Deal",
  locationId: "Location",
  locationCount: "Locations",
  confirmedLocations: "Locations confirmed",
  targetEmail: "Account",
  previousRole: "Previous role",
  newRole: "New role",
  role: "Role",
  permission: "Permission",
  permissions: "Permissions",
  granted: "Granted",
  hidden: "Hidden",
  enabled: "Enabled",
  sponsored: "Sponsored",
  email: "Email",
  restaurantId: "Restaurant ID",
  resolution: "Resolution",
  approvalId: "Owner approval",
  requestedAction: "Requested action",
  requestedBy: "Requested by",
  decision: "Decision",
  summary: "Summary",
  reopened: "Reopened",
  completed: "Completed",
  completedAt: "Completed at",
  submitter: "Submitted by",
  reasonCode: "Reason code",
  suggestionId: "Suggestion",
  kind: "Kind",
  note: "Note",
  rows: "Rows",
  filters: "Filters",
  truncated: "Hit the row limit",
  changed: "Deals changed",
  fixed: "Fixed",
  failed: "Failed",
  drinkRules: "Drink rules",
};

function parseDetails(raw: string | null): { entries: [string, unknown][]; unreadable: boolean } {
  if (!raw) return { entries: [], unreadable: false };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { entries: [], unreadable: true };
    return { entries: Object.entries(parsed).filter(([, value]) => value !== null && value !== undefined && value !== ""), unreadable: false };
  } catch {
    // Details are capped at 1,500 characters when written, so a very long one can be cut mid-way.
    return { entries: [], unreadable: true };
  }
}

function detailValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(detailValue).join(", ") || "None";
  if (value && typeof value === "object") return Object.entries(value).map(([k, v]) => `${DETAIL_LABELS[k] || words(k)}: ${detailValue(v)}`).join(" · ");
  return String(value);
}

/** One entry as a sentence, after the actor's name. Falls back to the raw action for anything new. */
function describe(event: AuditRow, details: Record<string, unknown>): string {
  const str = (key: string) => (typeof details[key] === "string" ? (details[key] as string) : "");
  const title = event.deal_title || str("title");
  const restaurant = event.deal_restaurant || str("restaurant");
  const deal = title ? `'${title}'${restaurant ? ` at ${restaurant}` : ""}` : restaurant ? `a deal at ${restaurant}` : "a deal";
  const account = str("targetEmail") || str("email") || "an account";
  const status = str("status");
  switch (event.action) {
    case "lifecycle":
      return `${LIFECYCLE_VERBS[status] || `set to ${words(status || "a new status")}`} ${deal}`;
    case "save_deal":
      return `saved ${deal}${status === "draft" ? " as a draft" : ""}`;
    case "verify":
      return `verified ${deal} against its source`;
    case "bulk_lifecycle":
      return `${LIFECYCLE_VERBS[status] || "changed"} every deal in ${str("city") || "a market"}`;
    case "publish_drafts":
      return "published drafts from the review queue";
    case "archive_drafts":
      return "archived drafts from the review queue";
    case "review_deal_change":
      return `reviewed a restaurant manager's edit to ${deal}`;
    case "resolve_staff_reminder":
      return `closed a reminder for ${deal}`;
    case "user":
      return `changed ${account}'s role${str("previousRole") ? ` from ${formatRole(str("previousRole"))}` : ""}${str("newRole") ? ` to ${formatRole(str("newRole"))}` : ""}`;
    case "user_visibility":
      return `${details.hidden ? "hid" : "unhid"} ${account} ${details.hidden ? "from roles other than owner and admin" : "in the user list"}`;
    case "creator_profile":
      return `updated the creator link for ${event.target_id === event.actor_id ? "their own account" : "a creator"}`;
    case "creator_application":
      return `decided an affiliate application${status ? ` (${words(status)})` : ""}`;
    case "creator_commission":
      return `decided a commission${status ? ` (${words(status)})` : ""}`;
    case "affiliate_payout":
      return "sent an affiliate payout";
    case "plan_grant":
      return "changed a complimentary Pro grant";
    case "set_role_permission":
      return `${details.granted ? "granted" : "revoked"} ${formatRole(str("permission") || "a permission")} ${details.granted ? "to" : "from"} the ${formatRole(str("role") || "a")} role`;
    case "suggestion":
      return `${status ? `marked a suggestion ${words(status)}` : "reviewed a suggestion"}${restaurant ? ` for ${restaurant}` : ""}`;
    case "convert_suggestion":
      return `turned a suggestion${restaurant ? ` for ${restaurant}` : ""} into a draft`;
    case "feedback":
      return `${details.reopened ? "reopened" : status ? `marked as ${words(status)}` : "updated"} a feedback item`;
    case "report":
      return `${details.reopened ? "reopened" : status ? `marked as ${words(status)}` : "updated"} an accuracy report`;
    case "subscriber":
      return "changed a mailing-list subscription";
    case "accept_waitlist":
      return "let someone in from the waitlist";
    case "invite_restaurant_manager":
      return `invited ${str("email") || "someone"} to manage a restaurant`;
    case "revoke_restaurant_manager":
      return "revoked a restaurant manager's access";
    case "set_restaurant_photo":
      return "set a restaurant's photo";
    case "sponsorship":
    case "create_sponsorship":
    case "update_sponsorship":
      return `${event.action === "create_sponsorship" ? "created" : "changed"} a sponsorship${str("market") ? ` in ${str("market")}` : ""}`;
    case "delete_sponsorship":
      return "deleted a sponsorship";
    case "setting":
      return "changed an operator setting";
    case "owner_approval_requested":
      return `asked an owner to approve: ${str("summary") || words(str("requestedAction") || "an action")}`;
    case "decide_owner_approval": {
      // Older rows carry only the action key, which reads badly as English ("a request to
      // setting"), so they get a phrase for it; newer ones carry the request's own summary.
      const asked = str("summary") ? `a request to ${lowerFirst(str("summary"))}` : `a request to ${REQUESTED_ACTIONS[str("requestedAction")] || words(str("requestedAction") || "act")}`;
      return `${str("decision") === "approve" ? "approved" : "declined"} ${asked}${details.failed ? ", which then failed" : ""}`;
    }
    case "cancel_owner_approval":
      return "withdrew their own request for an owner's approval";
    case "export_data":
      return `exported ${words(event.target_id)}${typeof details.rows === "number" ? ` (${details.rows} rows)` : ""}`;
    default:
      return `${words(event.action)} on ${words(event.target_type)} ${event.target_id}`;
  }
}

function relative(at: Date, now: number) {
  const seconds = Math.round((now - at.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric", year: at.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

function dayHeading(at: Date, now: number) {
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diff = Math.round((startOf(new Date(now)) - startOf(at)) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  return at.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function auditQuery(filters: AuditFilters, before?: number) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) if (value.trim()) params.set(key, value.trim());
  if (before) params.set("before", String(before));
  const text = params.toString();
  return `/api/admin/audit${text ? `?${text}` : ""}`;
}

export default function AuditTab() {
  const { isAdminPlus, now, openTab } = useWorkspace();
  const [filters, setFilters] = useTabState<AuditFilters>("audit.filters", NO_FILTERS);
  const [expandedId, setExpandedId] = useTabState<number | null>("audit.expandedId", null);
  const [searchText, setSearchText] = useState(filters.q);
  const [events, setEvents] = useState<AuditRow[]>([]);
  const [facets, setFacets] = useState<AuditFacets | null>(null);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState("");
  // The newest request wins: typing quickly must not let an older, slower answer land last.
  const requestSeq = useRef(0);

  const fetchPage = useCallback(async (applied: AuditFilters) => {
    const seq = ++requestSeq.current;
    setState("loading");
    setMoreError("");
    try {
      const response = await fetch(auditQuery(applied));
      if (!response.ok) throw new Error(String(response.status));
      const json = await response.json() as { events: AuditRow[]; nextCursor: number | null; facets?: AuditFacets };
      if (seq !== requestSeq.current) return;
      setEvents(json.events);
      setNextCursor(json.nextCursor);
      if (json.facets) setFacets(json.facets);
      setState("ready");
    } catch {
      if (seq === requestSeq.current) setState("error");
    }
  }, []);

  useEffect(() => {
    if (!isAdminPlus) return;
    // Fetching the log for the current filters; state is set after the awaited response.
    fetchPage(filters);
  }, [filters, fetchPage, isAdminPlus]);

  // The search box applies itself a moment after typing stops, not on every key.
  useEffect(() => {
    if (searchText === filters.q) return;
    const timer = setTimeout(() => setFilters((current) => ({ ...current, q: searchText.slice(0, 80) })), 350);
    return () => clearTimeout(timer);
  }, [searchText, filters.q, setFilters]);

  async function loadMore() {
    if (!nextCursor) return;
    const seq = requestSeq.current;
    setLoadingMore(true);
    setMoreError("");
    try {
      const response = await fetch(auditQuery(filters, nextCursor));
      if (!response.ok) throw new Error(String(response.status));
      const json = await response.json() as { events: AuditRow[]; nextCursor: number | null };
      if (seq !== requestSeq.current) return;
      setEvents((current) => [...current, ...json.events]);
      setNextCursor(json.nextCursor);
    } catch {
      setMoreError("The next page could not be loaded. Try again.");
    } finally {
      setLoadingMore(false);
    }
  }

  const setFilter = (key: keyof AuditFilters) => (value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const filtersOn = Object.values(filters).some((value) => value.trim());
  const clearFilters = () => { setSearchText(""); setFilters(NO_FILTERS); };

  const days = useMemo(() => {
    const groups: { label: string; key: string; rows: AuditRow[] }[] = [];
    for (const event of events) {
      const at = sqlDate(event.created_at);
      const key = at.toDateString();
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.rows.push(event);
      else groups.push({ key, label: dayHeading(at, now), rows: [event] });
    }
    return groups;
  }, [events, now]);

  if (!isAdminPlus)
    return <StatePanel kind="error" title="The audit log is for owners and admins">Your role cannot read the audit log. Ask an owner if you need to know who changed something.</StatePanel>;

  const select = (label: string, key: keyof AuditFilters, choices: { value: string; label: string }[], allLabel: string) => (
    <label className="city-select">
      <select aria-label={label} value={filters[key]} onChange={(e) => setFilter(key)(e.target.value)}>
        <option value="">{allLabel}</option>
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
      <ChevronDown />
    </label>
  );

  return (
    <section className="portal-card sw-audit">
      <PanelHeader
        title="Administrative history"
        actions={<button type="button" className="tool-button" onClick={() => fetchPage(filters)} disabled={state === "loading"}><RefreshCw /> Refresh</button>}
      >
        Every change made in the staff workspace: who did it, with which role, to what, and when.
      </PanelHeader>
      <p className="sw-audit-integrity"><Lock aria-hidden="true" /> This log is append-only. Entries cannot be edited or deleted by anyone, including owners; the database refuses both.</p>
      <div className="inventory-tools list-tools">
        <label className="portal-search">
          <Search />
          <input aria-label="Search the audit log" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search people, actions, records and reasons" />
        </label>
      </div>
      <div className="sw-audit-filters" role="group" aria-label="Filter the audit log">
        {select("Filter by person", "actor", (facets?.actors || []).map((a) => ({ value: a.id, label: `${a.name || a.id}${a.role ? ` (${formatRole(a.role)})` : ""}` })), "Everyone")}
        {select("Filter by action", "action", (facets?.actions || []).map((a) => ({ value: a, label: words(a) })), "All actions")}
        {select("Filter by record type", "target", (facets?.targetTypes || []).map((t) => ({ value: t, label: words(t) })), "All record types")}
        <label className="sw-audit-date">
          <span>From</span>
          <input type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => setFilter("from")(e.target.value)} />
        </label>
        <label className="sw-audit-date">
          <span>To</span>
          <input type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => setFilter("to")(e.target.value)} />
        </label>
        {filtersOn && <button type="button" className="sw-link" onClick={clearFilters}>Clear filters</button>}
      </div>

      {state === "loading" && !events.length ? (
        <StatePanel kind="loading" title="Loading the audit log">Reading the newest entries…</StatePanel>
      ) : state === "error" ? (
        <StatePanel kind="error" title="The audit log could not be loaded" action={<button type="button" className="tool-button" onClick={() => fetchPage(filters)}>Try again</button>}>
          Nothing was changed. Check your connection and try again.
        </StatePanel>
      ) : !events.length ? (
        filtersOn ? (
          <StatePanel kind="empty" title="No entries match these filters" action={<button type="button" className="tool-button" onClick={clearFilters}>Clear filters</button>}>
            The whole log was searched, not only the latest page. Try a wider date range or a different person or action.
          </StatePanel>
        ) : (
          <StatePanel kind="empty" title="Nothing has been recorded yet">Every change made in the workspace appears here as it happens.</StatePanel>
        )
      ) : (
        <>
          <p className="list-count-line" aria-live="polite">
            {state === "loading" ? "Updating…" : `${events.length} ${events.length === 1 ? "entry" : "entries"}${nextCursor ? ", newest first — more below" : filtersOn ? " match" : ""}`}
          </p>
          <div className="sw-audit-feed">
            {days.map((group) => (
              <section key={group.key} className="sw-audit-day" aria-label={group.label}>
                <h3 className="sw-audit-day-head"><span>{group.label}</span></h3>
                <ol>
                  {group.rows.map((event) => {
                    const at = sqlDate(event.created_at);
                    const parsed = parseDetails(event.details);
                    const detailMap = Object.fromEntries(parsed.entries);
                    const name = event.actor_name || event.actor_email || "Someone no longer on record";
                    const expanded = expandedId === event.id;
                    const panelId = `audit-more-${event.id}`;
                    const dealLink = event.target_type === "deal" ? event.target_id : typeof detailMap.dealId === "string" ? detailMap.dealId : "";
                    const rows: [string, ReactNode][] = [
                      ["Record", <>{words(event.target_type)} <code>{event.target_id}</code></>],
                      ...parsed.entries.filter(([key]) => key !== "dealId" || !dealLink).map(([key, value]): [string, ReactNode] => [DETAIL_LABELS[key] || words(key), detailValue(value)]),
                      ["Actor ID", <code key="actor">{event.actor_id}</code>],
                      ["Request ID", event.request_id ? <code key="req">{event.request_id}</code> : "Not recorded"],
                    ];
                    if (event.before_values) rows.push(["Before", <code key="before">{event.before_values}</code>]);
                    if (event.after_values) rows.push(["After", <code key="after">{event.after_values}</code>]);
                    if (parsed.unreadable) rows.push(["Details", <code key="raw">{event.details}</code>]);
                    return (
                      <li key={event.id} className="sw-audit-entry">
                        <i className="sw-avatar" aria-hidden="true">{name.charAt(0).toUpperCase()}</i>
                        <div className="sw-audit-body">
                          <div className="sw-audit-meta">
                            <b>{name}</b>
                            <span className="role-badge">{formatRole(event.actor_role || "unknown")}</span>
                            <time dateTime={at.toISOString()} title={at.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}>{relative(at, now)}</time>
                          </div>
                          <p className="sw-audit-sentence">{name} {describe(event, detailMap)}.</p>
                          {event.reason && <blockquote className="sw-audit-reason">{event.reason}</blockquote>}
                          <div className="sw-audit-links">
                            {dealLink && <button type="button" className="sw-link" onClick={() => openTab("deals", `?deal=${encodeURIComponent(dealLink)}`)}>Open the deal</button>}
                            <button type="button" className="sw-link" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpandedId(expanded ? null : event.id)}>
                              {expanded ? "Fewer details" : "More details"} <ChevronDown className={expanded ? "flipped" : ""} aria-hidden="true" />
                            </button>
                          </div>
                          {expanded && (
                            <dl id={panelId} className="sw-facts sw-audit-details">
                              <div><dt>When</dt><dd><StaffTime value={at} format="long" /></dd></div>
                              <div><dt>Action</dt><dd><code>{event.action}</code></dd></div>
                              {rows.map(([label, value], index) => <div key={`${label}-${index}`}><dt>{label}</dt><dd>{value}</dd></div>)}
                            </dl>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </section>
            ))}
          </div>
          {nextCursor && (
            <div className="sw-audit-more">
              <button type="button" className="tool-button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load older entries"}</button>
              {moreError && <span role="alert">{moreError}</span>}
            </div>
          )}
          {!nextCursor && events.length > 0 && <p className="list-count-line">That is the {filtersOn ? "last matching entry" : "beginning of the log"}.</p>}
        </>
      )}
    </section>
  );
}
