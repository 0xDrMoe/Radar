"use client";
import { useRef, useState, type Ref } from "react";
import { Check, Link2, Search, X } from "lucide-react";
import { GatedButton } from "../GatedButton";
import { nextDraftAfter } from "../../../draft-review";
import {
  SUBMITTER_LABEL, possibleDuplicates, submitterKind, submitterSeesReason, type SubmitterKind,
} from "../deal-inventory";
import { SUGGESTION_REJECTION_REASONS, customReasonProblem, resolveRejectionReason, type SuggestionRejectionCode } from "../../../suggestion-review";
import { sqlDate } from "../format";
import type { AdminSuggestion } from "../types";
import { EMPTY_GEO, GeoFilter, PanelHeader, StatePanel, matchesGeo, type GeoFilterValue } from "../ui";
import { LIST_PAGE_SIZE, Pager, pageRows } from "../../ListScope";
import { useListScope, useTabState, useWorkspace } from "../workspace";

/**
 * A suggestions row as /api/admin returns it (SELECT * FROM suggestions). AdminSuggestion names
 * only the first columns; the rest arrived with the creator workspace and the fuller public form.
 */
type Suggestion = AdminSuggestion & {
  created_at?: string | null;
  updated_at?: string | null;
  user_id?: string | null;
  relationship?: string | null;
  source?: string | null;
  restaurant_website?: string | null;
  address?: string | null;
  title?: string | null;
  description?: string | null;
  price?: string | null;
  eligible_days?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  starts_at?: string | null;
  expires_at?: string | null;
  restrictions?: string | null;
  reference?: string | null;
  rejection_reason?: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting for review",
  needs_information: "Needs information",
  approved: "Converted to a draft",
  rejected: "Rejected",
  withdrawn: "Withdrawn by the submitter",
};

/** A Canadian postal code starts with a letter, a US ZIP with a digit: enough to file it by country. */
const countryOfPostal = (postal: string | null | undefined) => {
  const value = (postal || "").trim();
  return /^[A-Za-z]\d[A-Za-z]/.test(value) ? "CA" : /^\d{5}/.test(value) ? "US" : null;
};
const placeOf = (row: Suggestion) => ({ country: countryOfPostal(row.postal), postal: row.postal });
const day = (value: string | null | undefined) => (value ? sqlDate(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "");

function days(value: string | null | undefined): string {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string").join(", ") : "";
  } catch {
    return "";
  }
}

/** When the offer runs, from whichever of the structured fields and the free text were filled in. */
function scheduleOf(row: Suggestion): string {
  const window = [days(row.eligible_days), row.start_time && row.end_time ? `${row.start_time}–${row.end_time}` : ""].filter(Boolean).join(" ");
  return [row.schedule, window && window !== row.schedule ? `(${window})` : ""].filter(Boolean).join(" ");
}

type StatusFilter = "open" | "all" | "pending" | "approved" | "rejected" | "withdrawn";
const isOpen = (status: string) => status === "pending" || status === "needs_information";

/**
 * The suggestions queue: deals sent in by the public, signed-in readers and creators.
 *
 * Nothing is decided from the list. Selecting a card opens everything that was sent, with any deal
 * already in the inventory under the same restaurant name, and only then offers Convert or Reject.
 * A rejection needs one of the standard reasons (app/suggestion-review.ts) or a written one that
 * says something; the screen shows the exact sentence that will be stored, and whether the person
 * who sent it can read it.
 */
export default function SuggestionsTab() {
  const { data, busy, action, fieldErrors, canModerateSuggestions } = useWorkspace();
  const suggestions = (data.suggestions || []) as Suggestion[];
  const [status, setStatus] = useTabState<StatusFilter>("suggestions.status", "open");
  const [kind, setKind] = useTabState<SubmitterKind | "all">("suggestions.kind", "all");
  const [geo, setGeo] = useTabState<GeoFilterValue>("suggestions.geo", EMPTY_GEO);
  const [query, setQuery] = useTabState("suggestions.query", "");
  const [selectedId, setSelectedId] = useTabState<number | null>("suggestions.selected", null);
  const detailRef = useRef<HTMLElement>(null);

  const needle = query.trim().toLowerCase();
  const matches = (rows: Suggestion[]) => rows.filter((row) => {
    if (status === "open" ? !isOpen(row.status) : status !== "all" && row.status !== status) return false;
    if (kind !== "all" && submitterKind(row) !== kind) return false;
    if (!matchesGeo(placeOf(row), geo)) return false;
    if (needle && !`${row.restaurant} ${row.deal} ${row.title || ""} ${row.postal} ${row.address || ""} ${row.reference || ""}`.toLowerCase().includes(needle)) return false;
    return true;
  });
  const visible = matches(suggestions);
  const openCount = suggestions.filter((row) => isOpen(row.status)).length;
  const filtered = status !== "open" || kind !== "all" || Boolean(needle) || Boolean(geo.country || geo.postal);
  const { pageFor, setPageFor } = useListScope();
  const suggestionReset = [status, kind, needle, geo.country, geo.region, geo.city, geo.postal].join("|");
  const suggestionPage = pageRows(visible, pageFor("suggestions", suggestionReset));
  const setSuggestionPage = setPageFor("suggestions", suggestionReset);
  // A kept selection the filters now hide falls back to the first card shown, without being forgotten.
  const current = visible.find((row) => row.id === selectedId) || suggestionPage.rows[0] || null;

  function select(id: number) {
    setSelectedId(id);
    if (window.matchMedia("(max-width: 900px)").matches) {
      requestAnimationFrame(() => detailRef.current?.scrollIntoView({ block: "start", behavior: "smooth" }));
    }
  }
  /** After a decision, the next card in the same list, as draft review does. */
  function moveOn(id: number, fresh: Suggestion[] | undefined) {
    const before = visible.map((row) => String(row.id));
    const after = fresh ? matches(fresh).map((row) => String(row.id)) : before;
    if (after.includes(String(id))) return;
    const next = nextDraftAfter(before, String(id), after);
    setSelectedId(next ? Number(next) : null);
    // Follow the next card onto its own page, so the one selected is always one that is shown.
    if (next) setSuggestionPage(Math.floor(after.indexOf(next) / LIST_PAGE_SIZE) + 1);
  }

  if (!suggestions.length) {
    return (
      <section className="portal-card">
        <StatePanel kind="empty" title="No suggestions have been sent in">
          Suggestions arrive from the public form, signed-in readers and creators&apos; workspaces. They will appear here to be reviewed.
        </StatePanel>
      </section>
    );
  }

  return (
    <section className="portal-card sw-suggestions">
      <PanelHeader title={`${openCount} suggestion${openCount === 1 ? "" : "s"} waiting for review`}>
        Select a suggestion to see everything that was sent and any deal Radar already lists for that restaurant. Convert it to a
        draft if its source holds up, or reject it with a reason. Every decision is recorded in the audit log.
      </PanelHeader>
      <div className="sw-drafts-tools">
        <label className="portal-search">
          <Search aria-hidden="true" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search suggestions" placeholder="Restaurant, offer, postal code or reference" />
        </label>
        <label>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}>
            <option value="open">Waiting for review</option>
            <option value="approved">Converted</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
            <option value="all">Every status</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Sent by</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as SubmitterKind | "all")}>
            <option value="all">Anyone</option>
            <option value="creator">Creators</option>
            <option value="account">Signed-in accounts</option>
            <option value="public">Public form</option>
          </select>
        </label>
        <span className="sw-count" aria-live="polite">{visible.length} of {suggestions.length} shown</span>
      </div>
      <GeoFilter places={suggestions.map(placeOf)} value={geo} onChange={setGeo} label="Filter suggestions by place" />
      {!visible.length ? (
        <StatePanel
          kind="empty"
          title={status === "open" && !filtered ? "Nothing is waiting for review" : "No suggestion matches these filters"}
          action={filtered ? <button type="button" className="sw-link" onClick={() => { setStatus("open"); setKind("all"); setGeo(EMPTY_GEO); setQuery(""); }}>Clear filters</button> : undefined}
        >
          {status === "open" && !filtered ? "Every suggestion has been converted or rejected. Choose another status to look back at them." : "Try another status, submitter type or place."}
        </StatePanel>
      ) : (
        <div className="sw-drafts-split">
          <div className="sw-list-column">
          <div className="sw-drafts-list sw-suggestion-list" role="list" aria-label="Suggestions">
            {suggestionPage.rows.map((row) => {
              const chosen = current?.id === row.id;
              const submitter = submitterKind(row);
              return (
                <div role="listitem" key={row.id}>
                  <button type="button" className={chosen ? "chosen" : undefined} aria-current={chosen ? "true" : undefined} onClick={() => select(row.id)}>
                    <span className="sw-drafts-row-head">
                      <b>{row.restaurant}</b>
                      <span className={`status ${row.status === "approved" ? "on" : row.status === "rejected" ? "off" : ""}`}>{STATUS_LABEL[row.status] || row.status}</span>
                    </span>
                    <span>{row.title || row.deal}</span>
                    <small>{scheduleOf(row) || "No schedule given"}</small>
                    <small>{[row.address, row.postal].filter(Boolean).join(" · ") || "No place given"}</small>
                    <small>{SUBMITTER_LABEL[submitter]}{row.created_at ? ` · sent ${day(row.created_at)}` : ""}</small>
                    {row.status === "rejected" && row.rejection_reason && <small className="sw-reason">Reason: {row.rejection_reason}</small>}
                  </button>
                </div>
              );
            })}
          </div>
            <Pager paged={suggestionPage} noun="suggestion" onPage={setSuggestionPage} />
          </div>
          {current && (
            <SuggestionDetail
              key={current.id}
              ref={detailRef}
              row={current}
              deals={data.deals}
              busy={busy}
              reasonError={fieldErrors.reason}
              canModerate={canModerateSuggestions}
              onConvert={async () => {
                const result = await action({ action: "convert_suggestion", id: current.id }, `suggestion-${current.id}`);
                if (result) moveOn(current.id, result.data?.suggestions as Suggestion[] | undefined);
              }}
              onReject={async (reasonCode, reason) => {
                // reasonCode is not among AdminActionPayload's named fields (types.ts), so the body is
                // built first and passed whole; the server reads it (resolveRejectionReason).
                const payload = { action: "suggestion", id: current.id, status: "rejected", reasonCode, reason };
                const result = await action(payload, `suggestion-${current.id}`);
                if (result) moveOn(current.id, result.data?.suggestions as Suggestion[] | undefined);
                return Boolean(result);
              }}
            />
          )}
        </div>
      )}
    </section>
  );
}

function SuggestionDetail({
  ref, row, deals, busy, reasonError, canModerate, onConvert, onReject,
}: {
  ref: Ref<HTMLElement>;
  row: Suggestion;
  deals: { id: string; restaurant: string; title: string; city: string; status: string }[];
  busy: string;
  reasonError?: string;
  canModerate: boolean;
  onConvert: () => Promise<void>;
  onReject: (reasonCode: SuggestionRejectionCode, reason: string) => Promise<boolean>;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [code, setCode] = useState<SuggestionRejectionCode | "">("");
  const [note, setNote] = useState("");
  const submitter = submitterKind(row);
  const duplicates = possibleDuplicates(row.restaurant, deals);
  const working = busy === `suggestion-${row.id}`;
  const withdrawn = row.status === "withdrawn";
  const decided = code ? resolveRejectionReason(code, note) : null;
  const problem = code === "other" ? customReasonProblem(note) : null;
  const moderateBlocked = !canModerate ? "Your role does not include moderating suggestions." : withdrawn ? "The submitter withdrew this suggestion." : null;
  const fields: [string, string | null | undefined][] = [
    ["Offer", row.title || row.deal],
    ["Description", row.description],
    ["Price", row.price],
    ["Schedule", scheduleOf(row)],
    ["Starts", row.starts_at],
    ["Ends", row.expires_at],
    ["Restrictions", row.restrictions],
    ["Address", row.address],
    ["Postal code", row.postal],
    ["Sent by", `${SUBMITTER_LABEL[submitter]}${row.relationship && row.relationship !== "creator" ? ` (says they are: ${row.relationship})` : ""}`],
    ["Contact", row.email],
    ["Sent", row.created_at ? day(row.created_at) : null],
    ["Reference", row.reference],
    ["Status", STATUS_LABEL[row.status] || row.status],
  ];
  return (
    <article className="sw-drafts-detail" ref={ref} aria-label={`Suggestion: ${row.restaurant}`}>
      <header className="sw-panel-head">
        <div>
          <h3>{row.restaurant}</h3>
          <p>{row.title || row.deal}</p>
        </div>
      </header>
      <dl className="sw-fields">
        {fields.filter(([, value]) => value).map(([label, value]) => (
          <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <div className="review-actions">
        {row.source ? (
          <a className="review-source" href={row.source} target="_blank" rel="noopener noreferrer"><Link2 /> Open the source they gave</a>
        ) : <span className="review-source none">No source given</span>}
        {row.restaurant_website && (
          <a className="review-source own" href={row.restaurant_website} target="_blank" rel="noopener noreferrer"><Link2 /> Restaurant&apos;s website</a>
        )}
      </div>
      {row.status === "rejected" && row.rejection_reason && (
        <p className="sw-reason"><b>Rejected because:</b> {row.rejection_reason}</p>
      )}
      <section className="sw-duplicates" aria-label="Possible duplicates">
        <h4>Already in Radar?</h4>
        {duplicates.length ? (
          <>
            <p>{duplicates.length === 1 ? "A deal is" : `${duplicates.length} deals are`} already listed for a restaurant with this name. Check it is not the same offer before converting.</p>
            <ul>
              {duplicates.map((deal) => (
                <li key={deal.id}>
                  <a href={`/admin/deals?deal=${encodeURIComponent(deal.id)}`} target="_blank" rel="noopener noreferrer">{deal.title}</a>
                  <small> · {deal.city} · {deal.status}</small>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>No loaded deal has this restaurant&apos;s name. Only the first 500 deals are checked, so search the inventory if in doubt.</p>
        )}
      </section>
      <div className="review-actions sw-drafts-actions">
        <GatedButton
          type="button"
          className="primary"
          blocked={moderateBlocked || (row.status === "approved" ? "Already converted to a draft." : null)}
          disabled={working}
          onClick={onConvert}
        >
          <Check /> {working && !rejecting ? "Converting…" : duplicates.length ? "Convert anyway" : "Convert to draft"}
        </GatedButton>
        <GatedButton
          type="button"
          blocked={moderateBlocked || (row.status === "rejected" ? "Already rejected." : null)}
          disabled={working}
          aria-expanded={rejecting}
          onClick={() => setRejecting((open) => !open)}
        >
          <X /> Reject…
        </GatedButton>
      </div>
      {rejecting && (
        <form
          className="draft-review-confirm sw-reject"
          onSubmit={async (event) => {
            event.preventDefault();
            if (!code || (decided && !decided.ok)) return;
            if (await onReject(code, note.trim())) { setRejecting(false); setCode(""); setNote(""); }
          }}
        >
          <fieldset>
            <legend>Why is this being rejected?</legend>
            {SUGGESTION_REJECTION_REASONS.map((reason) => (
              <label key={reason.code}>
                <input type="radio" name={`reason-${row.id}`} value={reason.code} checked={code === reason.code} onChange={() => setCode(reason.code)} />
                <span><b>{reason.label}</b>{reason.text && <small>{reason.text}</small>}</span>
              </label>
            ))}
          </fieldset>
          {code && (
            <label className="typed-confirmation wide">
              {code === "other" ? "Write the reason, in a full sentence the person who sent it can act on" : "Add a note after the reason (optional)"}
              <textarea
                value={note}
                maxLength={500}
                rows={3}
                aria-invalid={Boolean(problem || reasonError)}
                aria-describedby={`reason-problem-${row.id}`}
                onChange={(event) => setNote(event.target.value)}
              />
              <small id={`reason-problem-${row.id}`} className={problem || reasonError ? "warning-text" : undefined}>
                {problem || reasonError || ""}
              </small>
            </label>
          )}
          {decided?.ok && (
            <div className="sw-reason-preview">
              <span className="kicker">STORED AS</span>
              <p>{decided.text}</p>
              <small>
                {submitterSeesReason(submitter)
                  ? "The submitter will see this reason in their creator workspace."
                  : "This submitter has no Radar workspace that shows it, and Radar sends no email about suggestions. The reason is kept on the suggestion and in the audit log."}
              </small>
            </div>
          )}
          <div className="row-actions">
            <button type="button" onClick={() => { setRejecting(false); setCode(""); setNote(""); }}>Cancel</button>
            <button type="submit" className="destructive" disabled={working || !decided?.ok}>
              {working ? "Rejecting…" : "Reject with this reason"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
