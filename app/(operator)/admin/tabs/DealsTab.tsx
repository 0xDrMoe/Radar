"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  BadgeCheck,
  Building2,
  ChevronDown,
  Eye,
  MoreHorizontal,
  Pause,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { DialogFocus } from "../../DialogFocus";
import { GatedButton } from "../GatedButton";
import { listCountLabel, Pager, pageRows, selectRows } from "../../ListScope";
import { filterInventory, parseEditorItems, parseEditorLocations, parseEditorWindows } from "../format";
import {
  ENDED_STATUSES, dealGeoPlace, dealPlaceLabel, inventoryLink, isEndedStatus, placeless, searchTermForDealId,
} from "../deal-inventory";
import type { AdminData, AdminDeal } from "../types";
import { EMPTY_GEO, GeoFilter, PanelHeader, StatePanel, geoFromSearch, geoIsSet, matchesGeo, type GeoFilterValue } from "../ui";
import { useListScope, useTabState, useWorkspace } from "../workspace";

type DealsTabProps = { tab: string };
/** location_scope comes back on every deals row (SELECT d.*), though AdminDeal does not name it. */
type InventoryDeal = AdminDeal & { location_scope?: string | null };

// Stable empty-list identity so the memo below never allocates a fresh array on the
// pre-load render, which would defeat its own referential caching.
const NO_DEALS: InventoryDeal[] = [];

/**
 * The deal inventory and "Ended & archived" share this component. It is keyed by the tab and the
 * deep link, so arriving from another section with ?deal= or ?city= starts it over and reads the
 * link, even when the previous tab was the other one of the two.
 */
export default function DealsTab({ tab }: DealsTabProps) {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return <DealInventory key={`${tab}${search}`} tab={tab} search={search} />;
}

function DealInventory({ tab, search }: DealsTabProps & { search: string }) {
  const {
    data, now, busy, action, load, setNotice, openEditor, setPreview, tabState,
    inventoryQuery: query, setInventoryQuery: setQuery,
    canCreateDeals, canPublishDeals, canVerifyDeals, canManageSponsorships,
  } = useWorkspace();
  const ended = tab === "ended";
  // A deep link's filters win over what was kept from earlier: written into the store before
  // useTabState reads it, so the first render already shows the linked deal or place. A link to
  // one deal clears the other filters, which could otherwise hide it.
  const [link] = useState(() => {
    const linked = inventoryLink(search);
    const place = geoFromSearch(search);
    if (linked.deal) {
      for (const key of [ended ? "ended.status" : "deals.statusFilter", `${tab}.adminCuisine`, `${tab}.verificationFilter`]) tabState.delete(key);
      tabState.set(`${tab}.geo`, place);
    } else if (geoIsSet(place)) tabState.set(`${tab}.geo`, place);
    if (linked.status) tabState.set(ended ? "ended.status" : "deals.statusFilter", ended && !isEndedStatus(linked.status) ? "All ended" : linked.status);
    return linked;
  });
  const { pageFor, setPageFor } = useListScope();
  const [geo, setGeo] = useTabState<GeoFilterValue>(`${tab}.geo`, EMPTY_GEO),
    [statusFilter, setStatusFilter] = useTabState("deals.statusFilter", "All statuses"),
    [endedStatus, setEndedStatus] = useTabState("ended.status", "All ended"),
    [adminCuisine, setAdminCuisine] = useTabState(`${tab}.adminCuisine`, "All cuisines"),
    [verificationFilter, setVerificationFilter] = useTabState(`${tab}.verificationFilter`, "All verification"),
    [marketDialog, setMarketDialog] = useState<string | null>(null),
    [openMoreId, setOpenMoreId] = useState<string | null>(null),
    [moreMenuUp, setMoreMenuUp] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openMoreId) return;
    function onOutside(e: MouseEvent) {
      if (!(e.target as Element)?.closest?.(".row-more")) setOpenMoreId(null);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, [openMoreId]);
  // Flip the menu to open upward instead of down whenever it would otherwise run past the
  // bottom of the viewport (e.g. a row near the fold) — measured after it mounts, since the
  // menu's own height depends on which actions are visible for that deal.
  useLayoutEffect(() => {
    if (!openMoreId || !moreMenuRef.current) { setMoreMenuUp(false); return; }
    const rect = moreMenuRef.current.getBoundingClientRect();
    setMoreMenuUp(rect.bottom > window.innerHeight);
  }, [openMoreId]);
  const allDeals = (data?.deals || NO_DEALS) as InventoryDeal[];
  // A linked deal past the 500 loaded rows is found through the server search: its id starts with
  // the restaurant's name, so that word goes in the search box and the row is picked out by id.
  // Only when the box is empty — the sidebar search already fills it with the restaurant's name.
  const [linkTerm] = useState(() =>
    !link.deal || query.trim() || allDeals.some((deal) => deal.id === link.deal) ? "" : searchTermForDealId(link.deal));
  useEffect(() => {
    // The shell's search box, filled once on arrival; the debounced search below does the rest.
    if (linkTerm) setQuery(linkTerm);
  }, [linkTerm, setQuery]);
  const needle = query.trim().toLowerCase();
  const staleBefore = now - 30 * 86400000;
  // The default deals query the initial load runs caps at 500 rows, so a keyword search only
  // ever reached whatever happened to be on that page. Once there's a query, ask the server
  // (debounced) to search the full table instead; searchResults replaces the loaded page until
  // the query is cleared, at which point we fall back to it again.
  // Kept with the words it answered, so "the linked deal is not here" is only said about a search
  // that has actually come back for the current words.
  const [searchAnswer, setSearchAnswer] = useTabState<{ q: string; deals: InventoryDeal[] } | null>("deals.searchResults", null);
  const searchResults = searchAnswer?.deals ?? null;
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  useEffect(() => {
    const q = query.trim();
    // Nothing to clear here: dealList below already ignores a stale searchResults array once the
    // query is empty, so there's no need to synchronously reset state from this effect.
    if (!q) return;
    const effectiveStatus = ended ? (endedStatus !== "All ended" ? endedStatus : "") : statusFilter !== "All statuses" ? statusFilter : "";
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ deal_q: q });
      if (effectiveStatus) params.set("deal_status", effectiveStatus);
      if (geo.city) params.set("deal_city", geo.city);
      if (geo.region) params.set("deal_region", geo.region);
      if (geo.country) params.set("deal_country", geo.country);
      if (geo.postal) params.set("deal_postal", geo.postal);
      if (adminCuisine !== "All cuisines") params.set("deal_cuisine", adminCuisine);
      setSearching(true);
      try {
        const response = await fetch(`/api/admin?${params}`);
        if (!response.ok) throw new Error();
        const json = (await response.json()) as AdminData;
        setSearchAnswer({ q, deals: json.deals as InventoryDeal[] });
        setSearchFailed(false);
      } catch {
        // A transient network hiccup on the debounced search shouldn't blank the list —
        // leave whatever's currently shown in place, and say the search did not run.
        setSearchFailed(true);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, ended, statusFilter, endedStatus, geo, adminCuisine, data, setSearchAnswer]);
  const dealList = query.trim() ? (searchResults ?? allDeals) : allDeals;
  // The compiler's checker can't reproduce this memo — it bails identically on every
  // formulation of it — but the deps below are exactly the values filterInventory reads, and
  // React Compiler isn't in this build's pipeline, so this manual memo is what actually keeps
  // a 500-row filter off every keystroke in the inventory search box.
  // searchResults already came back keyword-scoped from the server (which also matches address
  // and search_terms, fields filterInventory's own needle check can't see), so the needle passed
  // here is blanked in that case — re-applying the narrower client-side text match would silently
  // drop rows the server correctly found. Place and the ended statuses are applied here rather
  // than in filterInventory, which knows only a city.
  const rows = useMemo(
    () => (filterInventory(dealList, {
      city: "All cities",
      tab: "deals",
      statusFilter: ended ? "All statuses" : statusFilter,
      adminCuisine,
      verificationFilter,
      needle: needle && searchResults ? "" : needle,
      staleBefore,
    }) as InventoryDeal[]).filter((deal) =>
      matchesGeo(dealGeoPlace(deal), geo)
      && (!ended || (endedStatus === "All ended" ? isEndedStatus(deal.status) : deal.status === endedStatus))),
    [dealList, ended, statusFilter, endedStatus, adminCuisine, verificationFilter, needle, staleBefore, searchResults, geo],
  );
  const linked = link.deal ? rows.find((deal) => deal.id === link.deal) || dealList.find((deal) => deal.id === link.deal) : undefined;
  // The inventory is the one tab where browsing really is the task, and it already had a search
  // box and four filters. It still gets the same bound as the rest, so an operator arriving on it
  // is not handed 500 rows before they have asked anything — but any of those controls counts
  // as asking, which is the normal way this tab is used. A linked deal is shown first, whatever
  // the filters, so the link always lands on it.
  const filtered = Boolean(needle) || geoIsSet(geo) || (ended ? endedStatus !== "All ended" : statusFilter !== "All statuses") || adminCuisine !== "All cuisines" || verificationFilter !== "All verification";
  const ordered = linked ? [linked, ...rows.filter((deal) => deal.id !== linked.id)] : rows;
  const dealRows = selectRows(ordered, () => "", { query: "", filtered, showAll: true });
  // Back to page 1 whenever what the list is showing changes, including a linked deal, which is
  // always first.
  const dealReset = [needle, statusFilter, endedStatus, adminCuisine, verificationFilter, geo.country, geo.region, geo.city, geo.postal, linked?.id || ""].join("|");
  const dealPage = pageRows(dealRows.matched, pageFor(tab, dealReset));
  // Bring the linked row into view and focus it once it is on screen, which may be after the
  // server search answers.
  const linkedRowRef = useRef<HTMLElement | null>(null);
  const linkShown = useRef(false);
  useEffect(() => {
    if (!linked || linkShown.current || !linkedRowRef.current) return;
    linkShown.current = true;
    linkedRowRef.current.scrollIntoView({ block: "center" });
    linkedRowRef.current.focus({ preventScroll: true });
  }, [linked]);
  const quality = data?.dealTotals || null;
  const canPublishFlow = canCreateDeals && canPublishDeals;
  const cuisines = useMemo(() => ["All cuisines", ...Array.from(new Set<string>(allDeals.map((d) => d.cuisine))).sort()], [allDeals]);
  const places = useMemo(() => allDeals.map(dealGeoPlace), [allDeals]);
  // publish_at and expires_at go back exactly as the row holds them: this path never passes through
  // the editor's inputs, so there is no local time in it to convert.
  async function publishDeal(dealLike: Partial<AdminDeal>) {
    const saveResult = await action({
      action: "save_deal",
      id: dealLike.id,
      deal: {
        ...dealLike,
        sponsored: !!dealLike.sponsored,
        schedule_windows: parseEditorWindows(dealLike).map((w) => ({ days: w.days, start_time: w.start, end_time: w.end })),
        locations: parseEditorLocations(dealLike).map((l) => ({ id: l.id, address: l.address, city: l.city, postal: l.postal })),
        items: parseEditorItems(dealLike).map((it) => ({ name: it.name, original_price: it.original, discounted_price: it.discounted })),
      },
    });
    if (!saveResult) return false;
    const id = dealLike.id || saveResult.id;
    const publishResult = await action({ action: "lifecycle", id, status: "live" });
    return !!publishResult;
  }
  // Closing a row's "More" menu unmounts the item that had focus; hand focus back to the trigger
  // so a keyboard user is not dropped at the top of the page.
  function closeRowMenu(from: HTMLElement) {
    const trigger = from.closest(".row-more")?.querySelector<HTMLElement>(".row-more-trigger");
    setOpenMoreId(null);
    trigger?.focus();
  }
  function clearFilters() {
    setQuery("");
    setGeo(EMPTY_GEO);
    if (ended) setEndedStatus("All ended");
    else setStatusFilter("All statuses");
    setAdminCuisine("All cuisines");
    setVerificationFilter("All verification");
  }
  const lifecycleBlocked = !canPublishDeals ? "Your role does not include changing a deal's status." : null;
  return (
    <>
      <section className="portal-card sw-inventory">
        {ended ? (
          <PanelHeader title="Deals the public no longer sees">
            Expired deals ended on their own when their end date passed. Archived deals were retired by staff, and paused
            deals were taken down for now. None of them appear in search, alerts or the map. Check here before re-adding an
            offer, and to bring one back: edit its dates or details, then move it to drafts so it is checked again in Draft
            review, or publish a paused deal straight away.
          </PanelHeader>
        ) : (
          <PanelHeader title="Every deal Radar holds">
            Search, filter by place and status, and manage one deal at a time: edit, preview, verify, sponsor, publish or pause.
            The first 500 deals are loaded; a search asks the server for the rest.
          </PanelHeader>
        )}
        {!ended && quality && (
          <div className="quality-grid deal-status-strip">
            {(
              [
                ["All statuses", "All statuses", quality.total],
                ["Live", "live", quality.live],
                ["Draft", "draft", quality.draft],
                ["Scheduled", "scheduled", quality.scheduled],
                ["Paused", "paused", quality.paused],
                ["Expired", "expired", quality.expired],
                ["Archived", "archived", quality.archived],
              ] as const
            ).map(([label, value, count]) => (
              <button
                key={value}
                type="button"
                className={`quality-tile ${statusFilter === value ? "active" : ""}`}
                title={`Show ${label.toLowerCase()} deals`}
                aria-pressed={statusFilter === value}
                onClick={() => setStatusFilter(value)}
              >
                <b>{count}</b>
                <span>{label}</span>
              </button>
            ))}
          </div>
        )}
        <GeoFilter places={places} value={geo} onChange={setGeo} label={ended ? "Filter ended deals by place" : "Filter deals by place"} />
        <div className="inventory-tools">
          <label className="portal-search">
            <Search />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label={ended ? "Search ended and archived deals" : "Search inventory"}
              placeholder={ended ? "Search ended deals" : "Search inventory"}
            />
          </label>
          <label className="city-select">
            <Archive />
            {ended ? (
              <select aria-label="Filter by why the deal is not public" value={endedStatus} onChange={(e) => setEndedStatus(e.target.value)}>
                <option value="All ended">Expired, archived and paused</option>
                {ENDED_STATUSES.map((s) => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)} only</option>)}
              </select>
            ) : (
              <select aria-label="Filter by lifecycle status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {["All statuses", "draft", "scheduled", "live", "paused", "expired", "archived"].map((s) => <option key={s}>{s}</option>)}
              </select>
            )}
            <ChevronDown />
          </label>
          <label className="city-select">
            <Building2 />
            <select aria-label="Filter by cuisine" value={adminCuisine} onChange={(e) => setAdminCuisine(e.target.value)}>
              {cuisines.map((c) => <option key={c}>{c}</option>)}
            </select>
            <ChevronDown />
          </label>
          <label className="city-select">
            <BadgeCheck />
            <select aria-label="Filter by verification" value={verificationFilter} onChange={(e) => setVerificationFilter(e.target.value)}>
              {["All verification", "verified", "needs_review", "Stale", "Sponsored"].map((v) => <option key={v}>{v}</option>)}
            </select>
            <ChevronDown />
          </label>
          {!ended && (
            <button
              className="primary add-deal"
              disabled={!canCreateDeals}
              onClick={() => openEditor({ status: "draft", category: "Happy hour", emoji: "🍽️", sponsored: 0 })}
            >
              <Plus />
              Add draft
            </button>
          )}
          {/* Market-wide changes exist only for the ONE city the filter is set to, behind a typed
              phrase and an owner's approval (bulk_lifecycle). There is no every-market form. */}
          {!ended && geo.city && (
            <GatedButton
              type="button"
              className="tool-button"
              blocked={lifecycleBlocked}
              onClick={() => setMarketDialog(geo.city)}
            >
              <Pause /> Pause {geo.city}…
            </GatedButton>
          )}
          <span aria-live="polite">
            {searching ? "Searching…" : listCountLabel(dealRows, ordered.length, "result", true)}
          </span>
        </div>
        {searchFailed && (
          <StatePanel kind="error" title="The search did not reach the server">
            The list shows the loaded deals only. Change the search to try again.
          </StatePanel>
        )}
        {link.deal && !linked && !searching && (!linkTerm || searchAnswer?.q === query.trim()) && (
          <StatePanel kind="empty" title="The linked deal is not here">
            No deal with the id {link.deal} was found{ended ? " among ended and archived deals" : ""}. It may have been deleted, or the link may be mistyped.
          </StatePanel>
        )}
        {!ordered.length ? (
          <StatePanel
            kind="empty"
            title={filtered ? "No deal matches these filters" : ended ? "No deals have ended" : "No deals yet"}
            action={filtered ? <button type="button" className="sw-link" onClick={clearFilters}>Clear filters</button> : undefined}
          >
            {filtered
              ? "Try a wider place, another status, or clear the search."
              : ended ? "Deals appear here when their end date passes or when staff archive or pause them." : "Add a draft, or convert a suggestion, to start the inventory."}
          </StatePanel>
        ) : (
          /* ARIA table roles, so a screen reader can tie each cell to its column and move by row.
             The markup stays divs because the same rows restack into cards under 700px. */
          <div className="inventory-table deal-inventory-table" role="table" aria-label={ended ? "Ended and archived deals" : "Deals"} aria-rowcount={dealPage.rows.length + 1}>
            <div className="table-head" role="row">
              <span role="columnheader">Restaurant</span>
              <span role="columnheader">Place</span>
              <span role="columnheader">Status</span>
              <span role="columnheader">Actions</span>
            </div>
            {dealPage.rows.map((d) => {
              const place = dealPlaceLabel(d);
              const isLinked = d.id === link.deal;
              return (
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- a static table row, not a focusable grid row; <article> stays because the stacked mobile layout styles it
                <article role="row"
                  className={`${!d.active ? "inactive" : ""}${isLinked ? " sw-linked" : ""}`}
                  key={d.id}
                  id={`deal-${d.id}`}
                  ref={isLinked ? (node) => { linkedRowRef.current = node; } : undefined}
                  tabIndex={isLinked ? -1 : undefined}
                  aria-label={isLinked ? `Linked deal: ${d.restaurant}, ${d.title}` : undefined}
                >
                  {/* data-label carries the column name for the <700px stacked layout, where
                      the shared header row is hidden (see refinements.css). */}
                  <div className="restaurant-cell" data-label="Restaurant" role="cell">
                    <i>{d.emoji}</i>
                    <span>
                      <b>{d.restaurant}</b>
                      <small>
                        {d.title} · {d.cuisine}{d.price_tier ? ` · ${"$".repeat(d.price_tier)}` : ""}
                      </small>
                    </span>
                  </div>
                  <div data-label="Place" role="cell">
                    <b className={placeless(d) ? "sw-placeless" : undefined}>{place.primary}</b>
                    <small>{place.secondary}</small>
                  </div>
                  <div className="status-stack" data-label="Status" role="cell">
                    <span className={`status ${d.status === "live" ? "on" : ""}`}>
                      {d.status || (d.active ? "live" : "paused")}
                    </span>
                    {ended && d.status === "expired" && d.expires_at && <small>Ended {d.expires_at.slice(0, 10)}</small>}
                    {!!d.sponsored && <span className="sponsor-status">Sponsored</span>}
                  </div>
                  <div className="row-actions" role="cell">
                    <GatedButton
                      blocked={!canCreateDeals ? "Your role does not include creating or editing deals." : null}
                      onClick={() => openEditor(d)}
                    >
                      <Pencil /> Edit<span className="sr-only"> {d.restaurant}: {d.title}</span>
                    </GatedButton>
                    <button onClick={() => setPreview(d)}>
                      <Eye /> Preview<span className="sr-only"> {d.restaurant}: {d.title}</span>
                    </button>
                    {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- catches Escape bubbling from the trigger and menu buttons inside; the wrapper itself is never focused */}
                    <div
                      className="row-more"
                      onKeyDown={(e) => {
                        if (e.key === "Escape" && openMoreId === d.id) closeRowMenu(e.currentTarget);
                      }}
                    >
                      <button
                        type="button"
                        className="row-more-trigger"
                        aria-expanded={openMoreId === d.id}
                        aria-controls={`row-more-${d.id}`}
                        onClick={() => setOpenMoreId(openMoreId === d.id ? null : d.id)}
                      >
                        <MoreHorizontal />
                        More<span className="sr-only"> actions for {d.restaurant}: {d.title}</span>
                      </button>
                      {openMoreId === d.id && (
                        <div id={`row-more-${d.id}`} ref={moreMenuRef} className={`row-more-menu${moreMenuUp ? " up" : ""}`}>
                          <GatedButton
                            blocked={!canVerifyDeals ? "Your role does not include verifying deals." : !d.source_url ? "Add a source URL before this deal can be verified." : null}
                            disabled={busy === `verify-${d.id}`}
                            onClick={(e) => { closeRowMenu(e.currentTarget); action({ action: "verify", id: d.id }); }}
                          >
                            <RefreshCw /> Verify
                          </GatedButton>
                          <GatedButton
                            blocked={!canManageSponsorships ? "Your role does not include managing sponsorships." : null}
                            disabled={busy === `sponsorship-${d.id}`}
                            onClick={(e) => {
                              closeRowMenu(e.currentTarget);
                              action({ action: "sponsorship", id: d.id, sponsored: !d.sponsored });
                            }}
                          >
                            {d.sponsored ? "Unsponsor" : "Sponsor"}
                          </GatedButton>
                          {["live", "paused", "draft", "scheduled"].includes(d.status) && (
                            <GatedButton
                              blocked={(d.status === "live" ? !canPublishDeals : !canPublishFlow) ? "Your role does not include publishing deals." : null}
                              disabled={busy === `lifecycle-${d.id}` || busy === `save_deal-${d.id}`}
                              onClick={(e) => {
                                closeRowMenu(e.currentTarget);
                                if (d.status === "live") action({ action: "lifecycle", id: d.id, status: "paused" });
                                else publishDeal(d);
                              }}
                            >
                              {d.status === "live" ? "Pause" : "Publish"}
                            </GatedButton>
                          )}
                          {/* An ended deal comes back through Draft review, where it is checked
                              against its source again, rather than straight to live. */}
                          {(d.status === "expired" || d.status === "archived") && (
                            <GatedButton
                              blocked={lifecycleBlocked}
                              disabled={busy === `lifecycle-${d.id}`}
                              onClick={(e) => { closeRowMenu(e.currentTarget); action({ action: "lifecycle", id: d.id, status: "draft" }); }}
                            >
                              <RotateCcw /> Move to drafts
                            </GatedButton>
                          )}
                          {d.status === "expired" && (
                            <GatedButton
                              blocked={lifecycleBlocked}
                              disabled={busy === `lifecycle-${d.id}`}
                              onClick={(e) => { closeRowMenu(e.currentTarget); action({ action: "lifecycle", id: d.id, status: "archived" }); }}
                            >
                              <Archive /> Archive
                            </GatedButton>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <Pager paged={dealPage} noun="deal" onPage={setPageFor(tab, dealReset)} />
      </section>
      {marketDialog && (
        <MarketPauseDialog
          city={marketDialog}
          loaded={allDeals.filter((deal) => !placeless(deal) && deal.city === marketDialog && deal.status !== "paused").length}
          onClose={() => setMarketDialog(null)}
          onDone={async (text) => { setMarketDialog(null); setNotice(text); await load(); }}
        />
      )}
    </>
  );
}

/**
 * Pausing every deal in one market: the one market-wide change left (bulk_lifecycle). The typed
 * phrase is the server's (`PAUSED <city>`), the request says it was confirmed, and anyone but an
 * owner gets a request queued for an owner (HTTP 202) — which is said as such, never as done.
 */
function MarketPauseDialog({ city, loaded, onClose, onDone }: { city: string; loaded: number; onClose: () => void; onDone: (notice: string) => Promise<void> }) {
  const [phrase, setPhrase] = useState("");
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const expected = `PAUSED ${city}`;
  async function send() {
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "bulk_lifecycle", id: city, city, status: "paused", confirmation: phrase, confirmed: true, reason: reason.trim() }),
      });
      const result = (await response.json()) as { pending?: boolean; warning?: string | null; error?: { message?: string } | string };
      if (!response.ok) throw new Error(typeof result.error === "object" ? result.error?.message : result.error || "The request did not go through.");
      await onDone(response.status === 202 || result.pending
        ? `Nothing in ${city} is paused yet. ${result.warning || "Sent to an owner for approval."}`
        : `Every deal in ${city} is paused.${result.warning ? ` ${result.warning}` : ""}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request did not go through.");
      setSending(false);
    }
  }
  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss is a mouse convenience; the close button and Escape (DialogFocus) are the keyboard dismissals
    <div className="overlay" onMouseDown={onClose}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- stops the backdrop's dismiss; not an interaction of its own */}
      <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="market-pause-title" onMouseDown={(event) => event.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <button className="close" aria-label="Close market pause" onClick={onClose}><X /></button>
        <span className="kicker">ONE MARKET · OWNER APPROVAL</span>
        <h2 id="market-pause-title">Pause every deal in {city}?</h2>
        <p>
          Every deal listed in {city} that is not already paused ({loaded} of the loaded deals, and any past the first 500)
          leaves search, alerts and the map until someone publishes it again. Brand-wide and national offers are not affected.
          Unless you are an owner, this is sent to an owner, and nothing changes until they approve it.
        </p>
        <label className="typed-confirmation">
          Why? The owner reads this before deciding.
          <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} placeholder="Health inspection closures across the market" />
        </label>
        <label className="typed-confirmation">
          Type <b>{expected}</b> to confirm
          <input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
        </label>
        {error && <p className="sw-review-msg error" role="alert">{error}</p>}
        <div className="editor-actions">
          <button onClick={onClose}>Cancel</button>
          <button className="destructive" disabled={phrase !== expected || !reason.trim() || sending} onClick={send}>
            {sending ? "Sending…" : `Pause ${city}`}
          </button>
        </div>
      </section>
    </div>
  );
}
