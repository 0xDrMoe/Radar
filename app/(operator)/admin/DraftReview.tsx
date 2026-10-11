"use client";

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import { Archive, ArrowLeft, ArrowRight, Check, Link2, Pencil, Search } from "lucide-react";
import { GatedButton } from "./GatedButton";
import { EMPTY_GEO, GeoFilter, StatePanel, countryName, geoFromSearch, geoIsSet, matchesGeo, type GeoFilterValue } from "./ui";
import { useTabState, useWorkspace } from "./workspace";
import { LIST_PAGE_SIZE, Pager, pageRows } from "../ListScope";
import { describeWindows } from "../../schedule-text";
import {
  DRAFT_BLOCKER_TEXT, DRAFT_SKIP_TEXT, draftReadiness, nextDraftAfter,
  type DraftReadiness, type DraftReviewRow, type DraftSkipReason,
} from "../../draft-review";

type Decision = "publish" | "archive";
type ReadyFilter = "all" | "ready" | "editor";
interface DecisionResult {
  done: number;
  skipped: { id: string; reason: DraftSkipReason }[];
  warning: string | null;
  error?: { message?: string } | string;
}
interface Row {
  draft: DraftReviewRow;
  readiness: DraftReadiness;
}

/** Reasons that cover most archived drafts, offered as a starting point. The box stays editable. */
const ARCHIVE_PRESETS = [
  "The offer is not on the source page any more.",
  "The source is not the restaurant's own and could not be confirmed.",
  "The offer has ended.",
  "Radar already lists this offer.",
];

/** The source note with its quoted words marked, since those are what the reviewer checks. */
function QuotedNote({ text }: { text: string }) {
  const parts = text.split(/("[^"]+")/g);
  return <>{parts.map((part, index) => (part.startsWith("\"") && part.endsWith("\"") && part.length > 2 ? <mark key={index}>{part}</mark> : part))}</>;
}

function endedBefore(value: string | null, now: number): boolean {
  if (!value) return false;
  const time = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value.replace(" ", "T"));
  return !Number.isNaN(time) && time < now;
}

/** "Halifax, NS B3J" — the parts that are known, never a placeholder. */
export function draftPlace(draft: DraftReviewRow): string {
  const parts = [draft.city, draft.region, draft.postal].filter(Boolean);
  return parts.join(", ") || (draft.country ? countryName(draft.country) : "No place recorded");
}

const sourceLabel = (readiness: DraftReadiness) =>
  readiness.source === "own" ? "Restaurant's own site" : readiness.source === "directory" ? "Third-party source" : "No source";

interface DraftFilters {
  geo: GeoFilterValue;
  ready: ReadyFilter;
  query: string;
}

/** The drafts the list shows for these filters, in the server's order (tracked markets, then oldest). */
function filterDrafts(rows: Row[], filters: DraftFilters): Row[] {
  const needle = filters.query.trim().toLowerCase();
  return rows.filter(({ draft, readiness }) => {
    if (!matchesGeo({ country: draft.country, region: draft.region, city: draft.city, postal: draft.postal }, filters.geo)) return false;
    if (filters.ready === "ready" && readiness.blockers.length) return false;
    if (filters.ready === "editor" && !readiness.blockers.length) return false;
    if (needle && !`${draft.restaurant} ${draft.title} ${draft.address || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
}

const withReadiness = (drafts: DraftReviewRow[]): Row[] => drafts.map((draft) => ({ draft, readiness: draftReadiness(draft) }));

/**
 * Draft review: a list of every draft on the left and one draft's full detail on the right.
 *
 * There are no batch actions. A reviewer selects a draft, reads its fields against the words its
 * source used (app/draft-review.ts), and publishes, archives or edits that one; the next draft in
 * the same filtered list is then selected, so working down a city's drafts never jumps back to the
 * top. The filters, the selection and the list's scroll position are kept per workspace
 * (useTabState), so a look at another section comes back to the same place.
 */
export default function DraftReview({
  drafts,
  now,
  canPublish,
  canVerify,
  canEdit,
  onEdit,
  onChanged,
}: {
  drafts: DraftReviewRow[];
  now: number;
  canPublish: boolean;
  canVerify: boolean;
  canEdit: boolean;
  onEdit: (draft: DraftReviewRow) => Promise<void> | void;
  /** Reloads the workspace and hands back the fresh drafts, so the next selection is made from them. */
  onChanged: () => Promise<DraftReviewRow[] | null>;
}) {
  const { tabState } = useWorkspace();
  // A deep link (/admin/drafts?city=Halifax) wins over whatever filter was kept from earlier, once,
  // on arrival. Written into the store before useTabState reads it, so there is no first render
  // with the old filter and no effect to correct it.
  useState(() => {
    const linked = typeof window === "undefined" ? EMPTY_GEO : geoFromSearch(window.location.search);
    if (geoIsSet(linked)) tabState.set("drafts.geo", linked);
  });
  const [geo, setGeo] = useTabState<GeoFilterValue>("drafts.geo", EMPTY_GEO);
  const [ready, setReady] = useTabState<ReadyFilter>("drafts.ready", "all");
  const [query, setQuery] = useTabState("drafts.query", "");
  const [selectedId, setSelectedId] = useTabState<string | null>("drafts.selected", null);
  const [archiving, setArchiving] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<Decision | "">("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => withReadiness(drafts), [drafts]);
  const filters = { geo, ready, query };
  const visible = filterDrafts(rows, filters);
  const readyCount = rows.filter(({ readiness }) => !readiness.blockers.length).length;
  // A kept selection that the filters now hide falls back to the first draft shown, without
  // forgetting it: clearing the filter brings the same draft back.
  const position = Math.max(0, visible.findIndex(({ draft }) => draft.id === selectedId));
  const current = visible[position] || null;
  // The list shows the page the selected draft is on, so the selection, its Previous and Next, and
  // the move to the next draft after a decision carry the page along. Turning a page selects its
  // first draft.
  const paged = pageRows(visible, Math.floor(position / LIST_PAGE_SIZE) + 1);

  // The list's scroll position, kept the same way as the filters but without a render per scroll.
  useLayoutEffect(() => {
    const list = listRef.current;
    const kept = tabState.get("drafts.scroll");
    if (list && typeof kept === "number") list.scrollTop = kept;
  }, [tabState]);
  // The selected row stays in view as the selection moves on after each decision.
  useLayoutEffect(() => {
    if (!current || !listRef.current) return;
    listRef.current.querySelector<HTMLElement>(`[data-draft="${CSS.escape(current.draft.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [current]);

  function select(id: string, reveal = false) {
    setSelectedId(id);
    setArchiving(false);
    setReason("");
    setMessage(null);
    // On a phone the detail sits under the list, so picking a draft would otherwise change nothing
    // the reviewer can see.
    if (reveal && window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }

  async function decide(decision: Decision) {
    if (!current || busy) return;
    const { draft } = current;
    const before = visible.map(({ draft: row }) => row.id);
    setBusy(decision);
    setMessage(null);
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: decision === "publish" ? "publish_drafts" : "archive_drafts",
          // One draft per request: the server refuses more (ONE_DRAFT_AT_A_TIME).
          items: [{ id: draft.id, schedule: draft.schedule || "" }],
          reason: decision === "archive" ? reason.trim() : undefined,
        }),
      });
      const result = (await response.json()) as DecisionResult;
      if (!response.ok) throw new Error(typeof result.error === "object" ? result.error?.message : result.error || "That did not go through.");
      const name = `${draft.restaurant} (${draft.title})`;
      if (!result.done) {
        // Nothing was written: say why and stay on this draft, so it can be fixed in the editor.
        const skipped = result.skipped[0];
        setMessage({ kind: "error", text: `${name} was not ${decision === "publish" ? "published" : "archived"}: ${skipped ? DRAFT_SKIP_TEXT[skipped.reason] || skipped.reason : result.warning || "it is no longer a draft"}.` });
        await onChanged();
        return;
      }
      const fresh = await onChanged();
      const after = fresh ? filterDrafts(withReadiness(fresh), filters).map(({ draft: row }) => row.id) : before.filter((id) => id !== draft.id);
      const next = nextDraftAfter(before, draft.id, after);
      setSelectedId(next);
      setArchiving(false);
      setReason("");
      setMessage({
        kind: "ok",
        text: `${decision === "publish" ? "Verified and published" : "Archived"} ${name}.${result.warning ? ` ${result.warning}` : ""}${next ? " The next draft is selected." : ""}`,
      });
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "That did not go through." });
    } finally {
      setBusy("");
    }
  }

  const blockers = current?.readiness.blockers || [];
  const publishBlocked = !canPublish || !canVerify
    ? "Publishing a draft verifies it too, and your role does not include both."
    : blockers.length ? `Fix this in the editor first: ${blockers.map((blocker) => DRAFT_BLOCKER_TEXT[blocker]).join("; ")}.` : null;
  const archiveBlocked = !canPublish ? "Your role does not include changing a deal's status." : null;
  const editBlocked = !canEdit ? "Your role does not include editing deals." : null;
  const filtered = geoIsSet(geo) || ready !== "all" || Boolean(query.trim());

  if (!drafts.length) {
    return (
      <section className="portal-card sw-drafts" aria-labelledby="draft-review-title">
        <h2 id="draft-review-title" className="sr-only">Draft review</h2>
        <StatePanel kind="empty" title="No drafts are waiting">
          Every draft has been published or archived. New ones arrive from the daily research and from converted suggestions.
        </StatePanel>
      </section>
    );
  }

  return (
    <section className="portal-card sw-drafts" aria-labelledby="draft-review-title">
      <header className="sw-panel-head">
        <div>
          <h2 id="draft-review-title">{drafts.length} draft{drafts.length === 1 ? "" : "s"} waiting for a decision</h2>
          <p>
            {readyCount} can publish from here; the rest need a fix in the editor first. Select a draft, open its source,
            compare the marked words with the listing, then publish it or archive it with a reason.
          </p>
        </div>
      </header>
      <GeoFilter places={drafts.map((draft) => ({ country: draft.country, region: draft.region, city: draft.city, postal: draft.postal }))} value={geo} onChange={setGeo} label="Filter drafts by place" />
      <div className="sw-drafts-tools">
        <label className="portal-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search drafts by restaurant or offer" placeholder="Search restaurant or offer" />
        </label>
        <label>
          <span className="sr-only">Readiness</span>
          <select value={ready} onChange={(event) => setReady(event.target.value as ReadyFilter)}>
            <option value="all">Every draft</option>
            <option value="ready">Ready to publish</option>
            <option value="editor">Needs the editor</option>
          </select>
        </label>
        <span className="sw-count" aria-live="polite">{visible.length} of {drafts.length} shown</span>
      </div>
      {message && <p className={`sw-review-msg ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</p>}
      {!visible.length ? (
        <StatePanel
          kind="empty"
          title="No draft matches these filters"
          action={filtered ? <button type="button" className="sw-link" onClick={() => { setGeo(EMPTY_GEO); setReady("all"); setQuery(""); }}>Clear filters</button> : undefined}
        >
          {ready === "ready" ? "None of the drafts here can publish without a fix. Show every draft to work on them in the editor." : "Try a wider place or clear the search."}
        </StatePanel>
      ) : (
        <div className="sw-drafts-split">
          <div className="sw-list-column">
            <div
              className="sw-drafts-list"
              ref={listRef}
              role="list"
              aria-label="Drafts"
              onScroll={(event) => tabState.set("drafts.scroll", event.currentTarget.scrollTop)}
            >
              {paged.rows.map(({ draft, readiness }) => {
                const chosen = current?.draft.id === draft.id;
                return (
                  <div role="listitem" key={draft.id}>
                    <button
                      type="button"
                      data-draft={draft.id}
                      className={chosen ? "chosen" : undefined}
                      aria-current={chosen ? "true" : undefined}
                      onClick={() => select(draft.id, true)}
                    >
                      <span className="sw-drafts-row-head">
                        <span aria-hidden="true">{draft.emoji}</span>
                        <b>{draft.restaurant}</b>
                        {readiness.blockers.length
                          ? <span className="status draft">Needs editor</span>
                          : <span className="status on">Ready</span>}
                      </span>
                      <span>{draft.title}</span>
                      <small>{draftPlace(draft)}{draft.covered ? "" : " · market not tracked"}</small>
                      <small className={`sw-source ${readiness.source}`}>
                        {sourceLabel(readiness)}{draft.internal_notes ? `: ${draft.internal_notes.slice(0, 90)}${draft.internal_notes.length > 90 ? "…" : ""}` : ""}
                      </small>
                    </button>
                  </div>
                );
              })}
            </div>
            <Pager paged={paged} noun="draft" onPage={(page) => select(visible[(page - 1) * LIST_PAGE_SIZE].draft.id)} />
          </div>
          {current && (
            <DraftDetail
              ref={detailRef}
              row={current}
              now={now}
              position={position}
              total={visible.length}
              onPrevious={position > 0 ? () => select(visible[position - 1].draft.id) : undefined}
              onNext={position < visible.length - 1 ? () => select(visible[position + 1].draft.id) : undefined}
            >
              <div className="review-actions sw-drafts-actions">
                <GatedButton type="button" className="primary" blocked={publishBlocked} disabled={Boolean(busy)} onClick={() => decide("publish")}>
                  <Check /> {busy === "publish" ? "Publishing…" : "Verify & publish"}
                </GatedButton>
                <GatedButton type="button" blocked={archiveBlocked} disabled={Boolean(busy)} aria-expanded={archiving} onClick={() => setArchiving((open) => !open)}>
                  <Archive /> Archive…
                </GatedButton>
                <GatedButton type="button" blocked={editBlocked} disabled={Boolean(busy)} onClick={() => onEdit(current.draft)}>
                  <Pencil /> Edit
                </GatedButton>
              </div>
              {archiving && (
                <form className="draft-review-confirm" onSubmit={(event) => { event.preventDefault(); if (reason.trim()) decide("archive"); }}>
                  <label className="typed-confirmation wide">
                    Why is this draft being archived? The reason is kept in the audit log.
                    <input value={reason} maxLength={500} required placeholder="The offer is not on the restaurant's page" onChange={(event) => setReason(event.target.value)} />
                  </label>
                  <div className="sw-chips" aria-label="Common reasons">
                    {ARCHIVE_PRESETS.map((preset) => (
                      <button key={preset} type="button" className={reason === preset ? "active" : undefined} onClick={() => setReason(preset)}>{preset}</button>
                    ))}
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => { setArchiving(false); setReason(""); }}>Cancel</button>
                    <button type="submit" className="destructive" disabled={Boolean(busy) || !reason.trim()}>
                      <Archive /> {busy === "archive" ? "Archiving…" : "Archive this draft"}
                    </button>
                  </div>
                </form>
              )}
            </DraftDetail>
          )}
        </div>
      )}
    </section>
  );
}

/** One draft in full: its fields beside what the source said, and where it sits in the list. */
function DraftDetail({
  ref,
  row: { draft, readiness },
  now,
  position,
  total,
  onPrevious,
  onNext,
  children,
}: {
  ref: Ref<HTMLDivElement>;
  row: Row;
  now: number;
  position: number;
  total: number;
  onPrevious?: () => void;
  onNext?: () => void;
  children: ReactNode;
}) {
  const label = `${draft.restaurant}, ${draft.title}`;
  const scheduleRead = readiness.hasSchedule
    ? "Hours already set in the editor"
    : readiness.windows.length ? `Saves as ${describeWindows(readiness.windows)}` : null;
  return (
    <article className="sw-drafts-detail draft-review-body" ref={ref} aria-label={`Draft: ${label}`}>
      <div className="sw-drafts-nav">
        <button type="button" disabled={!onPrevious} onClick={onPrevious}><ArrowLeft /> Previous</button>
        <span>Draft {position + 1} of {total}</span>
        <button type="button" disabled={!onNext} onClick={onNext}>Next <ArrowRight /></button>
      </div>
      <header>
        <span aria-hidden="true">{draft.emoji}</span>
        <div>
          <h3>{draft.restaurant}</h3>
          <small>{draftPlace(draft)}{draft.address ? ` · ${draft.address}` : ""}{draft.covered ? "" : " · market not tracked"}</small>
        </div>
        {readiness.blockers.length ? (
          <span className="status draft">{readiness.blockers.map((blocker) => DRAFT_BLOCKER_TEXT[blocker]).join(" · ")}</span>
        ) : (
          <span className="status on">Ready</span>
        )}
      </header>
      <div className="draft-review-columns">
        <dl>
          <div><dt>Title</dt><dd>{draft.title}</dd></div>
          <div><dt>Price</dt><dd>{draft.price || "(empty)"}</dd></div>
          <div>
            <dt>Schedule</dt>
            <dd>
              {draft.schedule || "(empty)"}
              {scheduleRead && <small>{scheduleRead}</small>}
            </dd>
          </div>
          {draft.description && <div><dt>Description</dt><dd>{draft.description}</dd></div>}
          {draft.terms && <div><dt>Terms</dt><dd>{draft.terms}</dd></div>}
          {draft.restrictions && <div><dt>Restrictions</dt><dd>{draft.restrictions}</dd></div>}
          {draft.expires_at && (
            <div>
              <dt>Ends</dt>
              <dd>{draft.expires_at.slice(0, 10)}{endedBefore(draft.expires_at, now) && <small className="warning-text">This end date has passed.</small>}</dd>
            </div>
          )}
          {Number(draft.locations) > 1 && <div><dt>Branches</dt><dd>{draft.locations}; publishing here confirms only the one above</dd></div>}
          {draft.created_at && <div><dt>Drafted</dt><dd>{draft.created_at.slice(0, 10)}</dd></div>}
        </dl>
        <blockquote>
          <span className="kicker">THE SOURCE SAYS</span>
          <p>{draft.internal_notes ? <QuotedNote text={draft.internal_notes} /> : "No note was left with this draft."}</p>
          {draft.research_note && draft.research_note !== draft.internal_notes && <p className="draft-review-research">Research note: {draft.research_note}</p>}
          {draft.source_url ? (
            <a href={draft.source_url} target="_blank" rel="noopener noreferrer" className={`review-source ${readiness.source}`}>
              <Link2 /> Open the source ({sourceLabel(readiness)})<span className="sr-only">: {label}</span>
            </a>
          ) : (
            <span className="review-source none">No source URL. Add one in the editor before this can publish.</span>
          )}
        </blockquote>
      </div>
      {readiness.drinkIssues.length > 0 && (
        <ul className="drink-rule-issues" aria-label="Drink-advertising rules">
          {readiness.drinkIssues.map((issue) => (
            <li key={`${issue.code}-${issue.jurisdiction}`} className={issue.severity}>
              <b>{issue.severity === "block" ? "Can't publish" : "Check"}</b> {issue.message}
            </li>
          ))}
        </ul>
      )}
      {children}
    </article>
  );
}
