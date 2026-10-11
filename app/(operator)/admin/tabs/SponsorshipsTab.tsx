"use client";
import { useMemo, useState } from "react";
import { BadgeCheck, ExternalLink, Megaphone, Pencil, Search, X } from "lucide-react";
import { useOwnerApprovalAction } from "../FinancePanels";
import type { AdminSponsorship } from "../types";
import { PanelHeader, StatePanel } from "../ui";
import { Pager, pageRows } from "../../ListScope";
import { useListScope, useTabState, useWorkspace } from "../workspace";

// Paid placements: which deal, in which market, for how long, and how it performed.
//
// Moved out of the Growth tab, which answers to view_analytics, into its own section for
// manage_sponsorships - the grant the server checks on every sponsorship read and write. The
// builder creates a sponsorship and edits one; deleting is an owner-approval action, confirmed in
// a dialog, and from anyone but an owner it only asks (HTTP 202), which the row then says.

const STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "ended", label: "Ended" },
];

type Form = {
  dealId: string;
  market: string;
  status: string;
  startsAt: string;
  endsAt: string;
  impressionLimit: string;
  frequencyCap: string;
  contractReference: string;
  invoiceReference: string;
};

const EMPTY_FORM: Form = {
  dealId: "", market: "", status: "draft", startsAt: "", endsAt: "",
  impressionLimit: "", frequencyCap: "1", contractReference: "", invoiceReference: "",
};

/** A stored row as the builder's fields. Dates are bare YYYY-MM-DD, which is what the inputs take. */
function formFrom(s: AdminSponsorship): Form {
  return {
    dealId: s.deal_id,
    market: s.market,
    status: s.status,
    startsAt: (s.starts_at || "").slice(0, 10),
    endsAt: (s.ends_at || "").slice(0, 10),
    impressionLimit: s.impression_limit == null ? "" : String(s.impression_limit),
    frequencyCap: String(s.frequency_cap || 1),
    contractReference: s.contract_reference || "",
    invoiceReference: s.invoice_reference || "",
  };
}

// starts_at and ends_at are bare dates from the date inputs, which new Date() reads as midnight
// UTC. Formatted in the viewer's zone, west of Greenwich that is the evening before, so every
// campaign showed as starting and ending a day early. Formatted in UTC it is the date that was picked.
const sponsorshipDate = (value: string) => new Date(value).toLocaleDateString(undefined, { timeZone: "UTC" });

export default function SponsorshipsTab() {
  const { data, busy, action, openTab, setConfirmDialog, canManageSponsorships, fieldErrors } = useWorkspace();
  const ownerAction = useOwnerApprovalAction();
  const [form, setForm] = useTabState<Form>("sponsorships.form", EMPTY_FORM);
  // The id being edited, or "" while the builder creates a new one.
  const [editingId, setEditingId] = useTabState("sponsorships.editingId", "");
  const [dealQuery, setDealQuery] = useTabState("sponsorships.dealQuery", "");
  // Deletions this person asked for that an owner has not decided yet, by sponsorship id.
  const [awaitingOwner, setAwaitingOwner] = useState<Record<string, boolean>>({});
  const set = (key: keyof Form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const sponsorships = data.sponsorships || [];
  const { pageFor, setPageFor } = useListScope();
  const sponsorshipPage = pageRows(sponsorships, pageFor("sponsorships"));
  const deals = data.deals;
  const dealById = useMemo(() => new Map(deals.map((deal) => [deal.id, deal])), [deals]);
  // Matches restaurant/title/city against the search box — the deal catalog (100+ live deals) is
  // too long to scan as a flat, unfiltered <select>. The already-chosen deal is kept in the list
  // even once it no longer matches, so refining the search after picking one can't silently blank
  // the selection out from under the admin.
  const filteredDeals = useMemo(() => {
    const needle = dealQuery.trim().toLowerCase();
    if (!needle) return deals;
    return deals.filter((d) => d.id === form.dealId || `${d.restaurant} ${d.title} ${d.city}`.toLowerCase().includes(needle));
  }, [deals, dealQuery, form.dealId]);
  // Requests for an owner's approval are listed for their asker (and for owners); the ones about
  // sponsorships are shown here so a pending deletion is visible where it was asked for.
  const pendingDeletes = (data.approvals || []).filter((approval) => approval.action === "delete_sponsorship" && approval.status === "pending");

  if (!canManageSponsorships)
    return (
      <StatePanel kind="empty" title="Sponsorships need the manage_sponsorships permission">
        Paid placements are sold and run by staff with that grant. Ask an owner if your job needs it.
      </StatePanel>
    );

  const label = (s: AdminSponsorship) => {
    const deal = dealById.get(s.deal_id);
    return deal ? `${deal.restaurant} — ${deal.title}` : s.deal_id;
  };
  const busyKey = editingId ? `update_sponsorship-${editingId}` : "create_sponsorship";
  const invalidDates = Boolean(form.startsAt && form.endsAt && form.endsAt <= form.startsAt);
  const ready = Boolean(form.dealId && form.market && form.startsAt && form.endsAt) && !invalidDates;

  function resetForm() {
    setForm(EMPTY_FORM);
    setEditingId("");
    setDealQuery("");
  }
  function startEdit(s: AdminSponsorship) {
    setForm(formFrom(s));
    setEditingId(s.id);
    setDealQuery("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save() {
    const fields = {
      market: form.market,
      status: form.status,
      startsAt: form.startsAt,
      endsAt: form.endsAt,
      impressionLimit: form.impressionLimit,
      frequencyCap: form.frequencyCap,
      contractReference: form.contractReference,
      invoiceReference: form.invoiceReference,
    };
    const result = editingId
      ? await action({ action: "update_sponsorship", id: editingId, ...fields }, busyKey)
      : await action({ action: "create_sponsorship", dealId: form.dealId, ...fields }, busyKey);
    if (result) resetForm();
  }
  // update_sponsorship writes the impression limit, contract and invoice references as sent (an
  // empty one clears it), so changing only the status still sends the rest of the row: sending the
  // status alone used to wipe a sponsorship's contract and invoice references.
  function changeStatus(s: AdminSponsorship, status: string) {
    const current = formFrom(s);
    action({
      action: "update_sponsorship",
      id: s.id,
      status,
      market: current.market,
      startsAt: current.startsAt,
      endsAt: current.endsAt,
      impressionLimit: current.impressionLimit,
      frequencyCap: current.frequencyCap,
      contractReference: current.contractReference,
      invoiceReference: current.invoiceReference,
    });
  }
  function deleteSponsorship(s: AdminSponsorship) {
    // A sponsorship is a paid placement and deleting one cannot be undone, so it asks first. The
    // trigger is a bare X in a row of other controls - the easiest thing on this screen to hit by
    // accident. Only an owner's deletion runs at once; anyone else's waits for an owner.
    setConfirmDialog({
      title: "Delete this sponsorship?",
      body: `${label(s)} in ${s.market} will be removed along with its click and impression history. This cannot be undone. Unless you are an owner, this asks an owner to approve it, and nothing is removed until they do.`,
      confirmLabel: "Delete sponsorship",
      busyKey: `delete_sponsorship-${s.id}`,
      run: async () => {
        const result = await ownerAction({ action: "delete_sponsorship", id: s.id }, `delete_sponsorship-${s.id}`);
        if (result === "pending") setAwaitingOwner((current) => ({ ...current, [s.id]: true }));
        if (result === "done" && editingId === s.id) resetForm();
      },
    });
  }

  return (
    <>
      <section className="portal-card">
        <PanelHeader title={editingId ? "Edit sponsorship" : "New sponsorship"}>
          A deal&apos;s &ldquo;Sponsored&rdquo; badge and placement boost follow whichever of its sponsorships is currently <b>active</b>. Clicks count a visit to the deal&apos;s page; impressions aren&apos;t tracked yet, so click-through reads &ldquo;not available&rdquo; until they are — a 0% would wrongly imply the placement got views and converted none.
        </PanelHeader>
        <div className="campaign-builder">
          {editingId ? (
            <p className="sw-sp-wide sw-sp-deal">
              Deal: <b>{label(sponsorships.find((s) => s.id === editingId) || ({ deal_id: form.dealId } as AdminSponsorship))}</b>
              <small> The deal cannot change; create a new sponsorship for a different one.</small>
            </p>
          ) : (
            <>
              <label className="sw-sp-wide">Search deals
                <div className="portal-search">
                  <Search aria-hidden="true"/>
                  <input value={dealQuery} onChange={(e) => setDealQuery(e.target.value)} placeholder="Search by restaurant, deal title, or city…" aria-label="Search deals to sponsor"/>
                </div>
              </label>
              <label className="sw-sp-wide">
                Deal {dealQuery.trim() ? `(${filteredDeals.length} match${filteredDeals.length === 1 ? "" : "es"})` : `(${filteredDeals.length} total)`}
                <select value={form.dealId} onChange={(e) => set("dealId")(e.target.value)} aria-invalid={Boolean(fieldErrors.dealId)}>
                  <option value="">Choose a deal…</option>
                  {filteredDeals.map((d) => (
                    <option key={d.id} value={d.id}>{d.restaurant} — {d.title}{d.city ? ` (${d.city})` : ""}</option>
                  ))}
                </select>
                {dealQuery.trim() && !filteredDeals.length && <small className="sw-sp-hint">No deals match &ldquo;{dealQuery.trim()}&rdquo;.</small>}
              </label>
            </>
          )}
          <label>Market
            <select value={form.market} onChange={(e) => set("market")(e.target.value)} aria-invalid={Boolean(fieldErrors.market)}>
              <option value="">Choose a market…</option>
              {/* An edited sponsorship keeps a market no longer on the coverage list selectable. */}
              {form.market && !(data.coverage || []).some((m) => m.market === form.market) && <option value={form.market}>{form.market}</option>}
              {(data.coverage || []).map((m) => <option key={m.market} value={m.market}>{m.market}</option>)}
            </select>
          </label>
          <label>Status
            <select value={form.status} onChange={(e) => set("status")(e.target.value)}>
              {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </label>
          <label>Starts<input type="date" value={form.startsAt} onChange={(e) => set("startsAt")(e.target.value)} aria-invalid={Boolean(fieldErrors.startsAt)}/></label>
          <label>Ends
            <input type="date" value={form.endsAt} onChange={(e) => set("endsAt")(e.target.value)} aria-invalid={invalidDates || Boolean(fieldErrors.endsAt)}/>
            {(invalidDates || fieldErrors.endsAt) && <small className="sw-sp-hint">{fieldErrors.endsAt || "Must be after the start date"}</small>}
          </label>
          <label>Impression limit<input value={form.impressionLimit} onChange={(e) => set("impressionLimit")(e.target.value.replace(/\D/g, ""))} placeholder="Unlimited" inputMode="numeric"/></label>
          <label>Frequency cap / visitor<input value={form.frequencyCap} onChange={(e) => set("frequencyCap")(e.target.value.replace(/\D/g, ""))} inputMode="numeric"/></label>
          <label>Contract reference<input value={form.contractReference} onChange={(e) => set("contractReference")(e.target.value)} placeholder="Optional" maxLength={200}/></label>
          <label>Invoice reference<input value={form.invoiceReference} onChange={(e) => set("invoiceReference")(e.target.value)} placeholder="Optional" maxLength={200}/></label>
          <div className="editor-actions sw-sp-wide">
            <button type="button" className="primary" disabled={!ready || busy === busyKey} onClick={save}>
              <Megaphone aria-hidden="true"/> {editingId ? (busy === busyKey ? "Saving…" : "Save changes") : busy === busyKey ? "Creating…" : "Create sponsorship"}
            </button>
            {(editingId || form.dealId || dealQuery) && <button type="button" onClick={resetForm}>{editingId ? "Cancel editing" : "Clear"}</button>}
          </div>
        </div>
      </section>

      <section className="portal-card">
        <PanelHeader title="Sponsorships">
          {sponsorships.length ? `${sponsorships.length} sponsorship${sponsorships.length === 1 ? "" : "s"}, latest start first (up to 100).` : "Every sponsorship, latest start first."}
        </PanelHeader>
        {pendingDeletes.length > 0 && (
          <div className="sw-sp-notice" role="status">
            <b>{pendingDeletes.length} deletion{pendingDeletes.length === 1 ? "" : "s"} waiting for an owner</b>
            <ul>{pendingDeletes.map((approval) => <li key={approval.id}>{approval.summary}</li>)}</ul>
            <p>Until an owner approves, these sponsorships keep running.</p>
          </div>
        )}
        {!sponsorships.length ? (
          <StatePanel kind="empty" title="No sponsorships yet">
            Create one above to sell a boosted, badged placement for a deal.
          </StatePanel>
        ) : (
          <div className="audit-list">
            {sponsorshipPage.rows.map((s) => {
              const deal = dealById.get(s.deal_id);
              const ctr = s.impressions ? `${((s.clicks / s.impressions) * 100).toFixed(1)}% click-through` : "click-through not available yet";
              return (
                <article key={s.id} className={editingId === s.id ? "sw-sp-editing" : undefined}>
                  <BadgeCheck aria-hidden="true"/>
                  <div>
                    <b>{label(s)}</b>
                    <small>
                      {s.market} · {sponsorshipDate(s.starts_at)}–{sponsorshipDate(s.ends_at)} · {s.clicks} click{s.clicks === 1 ? "" : "s"} · {ctr}
                      {s.impression_limit ? ` · limit ${s.impression_limit}` : ""}
                      {s.contract_reference ? ` · contract ${s.contract_reference}` : ""}
                      {s.invoice_reference ? ` · invoice ${s.invoice_reference}` : ""}
                    </small>
                    {awaitingOwner[s.id] && <small className="sw-sp-pending">Deletion requested — waiting for an owner&apos;s approval. It is still running.</small>}
                  </div>
                  <span className="sw-sp-actions">
                    <select aria-label={`Status of the ${deal ? deal.restaurant : s.deal_id} sponsorship`} value={s.status} onChange={(e) => changeStatus(s, e.target.value)} disabled={busy === `update_sponsorship-${s.id}`}>
                      {STATUSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                    <button type="button" className="iconbtn" aria-label={`Open the ${deal ? deal.restaurant : s.deal_id} deal in Deal inventory`} title="Open the deal" onClick={() => openTab("deals", `?deal=${encodeURIComponent(s.deal_id)}`)}><ExternalLink/></button>
                    <button type="button" className="iconbtn" aria-label={`Edit the ${deal ? deal.restaurant : s.deal_id} sponsorship`} title="Edit" onClick={() => startEdit(s)}><Pencil/></button>
                    <button type="button" className="iconbtn" aria-label={`Delete the ${deal ? deal.restaurant : s.deal_id} sponsorship`} title="Delete" disabled={busy === `delete_sponsorship-${s.id}` || awaitingOwner[s.id]} onClick={() => deleteSponsorship(s)}><X/></button>
                  </span>
                </article>
              );
            })}
          </div>
        )}
        <Pager paged={sponsorshipPage} noun="sponsorship" onPage={setPageFor("sponsorships")} />
      </section>
    </>
  );
}
