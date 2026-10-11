"use client";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Banknote,
  Check,
  HeartHandshake,
  Users,
  X,
} from "lucide-react";
import { DialogFocus } from "../../DialogFocus";
import { ListCount, ListEmpty, Pager, pageRows } from "../../ListScope";
import { STATUS_LABEL, linkLabel, shortDate, useCampaignList } from "../campaign-records";
import { money } from "../format";
import type { AdminAffiliateBalance, AdminCreatorRosterRow } from "../types";
import { PanelHeader, StatePanel } from "../ui";
import { useListScope, useTabState, useWorkspace } from "../workspace";

// The affiliate program: applications, the roster, what each affiliate is owed, and paying it.
//
// All of it is money, so all of it is manage_finance's: GET /api/admin sends none of these rows
// without that grant and POST refuses every affiliate action without it. The tab checks the same
// grant before drawing anything, so a stale link never shows a console that would only fail.
//
// An affiliate's labeled links are campaign records (/api/admin/campaigns) with their handle on
// them. The detail below reads those records; it never keeps its own copy, and a campaign never
// keeps a copy of the affiliate's name or rate.

/** A question that needs a written answer before it can be sent, in place of window.prompt. */
type ReasonDialog = {
  title: string;
  body: string;
  label: string;
  confirmLabel: string;
  busyKey: string;
  run: (reason: string) => Promise<unknown>;
};

export default function AffiliatesTab() {
  const {
    data, busy, setBusy, action, load, setNotice, setConfirmDialog, openTab,
    pendingCreatorApplications, canManageUsers, canManageFinance, canManageCampaigns,
  } = useWorkspace();
  const { pageFor, setPageFor } = useListScope();
  const payoutPage = pageRows(data?.creatorPayouts || [], pageFor("affiliates.payouts"));
  const commissionPage = pageRows(data?.creatorCommissions || [], pageFor("affiliates.commissions"));
  const [selectedHandle, setSelectedHandle] = useTabState("affiliates.selected", "");
  const [reasonDialog, setReasonDialog] = useState<ReasonDialog | null>(null);
  // Campaign records are only fetched for someone who can open this tab at all.
  const { state: campaignList, reload: reloadCampaigns } = useCampaignList(canManageFinance);

  // A deep link from a campaign (/admin/affiliates?affiliate=<handle>) opens that affiliate.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("affiliate");
    if (wanted) setSelectedHandle(wanted.toLowerCase().slice(0, 32));
  }, [setSelectedHandle]);

  // The headline figure is whatever currency is owed most, not a sum: adding CAD to USD would
  // produce a number that is wrong in both. The per-row amounts below are the real detail.
  const owedTotal = useMemo(() => {
    const totals = new Map<string, number>();
    for (const row of data?.creatorCommissions || []) {
      if (row.status !== "pending") continue;
      totals.set(row.currency, (totals.get(row.currency) || 0) + row.commission_amount);
    }
    const [currency, amount] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] || ["cad", 0];
    return { currency, amount };
  }, [data?.creatorCommissions]);
  // The two headline figures on the Affiliates tab, read off the balances the server rolled up.
  // Per currency and never summed across them, for the same reason every other affiliate figure
  // in this codebase is: adding CAD to USD invents an exchange rate nobody agreed to. The
  // largest currency leads and the tables below carry the rest.
  const affiliateTotals = useMemo(() => {
    const owed = new Map<string, number>(), paid = new Map<string, number>();
    for (const row of data?.affiliateBalances || []) {
      // Owed is everything not yet sent — what has cleared the hold and what is still in it.
      owed.set(row.currency, (owed.get(row.currency) || 0) + row.available + row.holding);
      paid.set(row.currency, (paid.get(row.currency) || 0) + row.paid);
    }
    const largest = (totals: Map<string, number>) => {
      const [currency, amount] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] || ["cad", 0];
      return { currency, amount };
    };
    return { owed: largest(owed), paid: largest(paid) };
  }, [data.affiliateBalances]);

  // Payouts already waiting for an owner, so the button does not invite a second request for the
  // same money. Matched on the summary the server writes ("Pay <handle> what they are owed in
  // <CUR> ..."), which is built from the records, not from anything this screen sent.
  const waitingForOwner = useMemo(() => {
    const waiting = new Set<string>();
    for (const approval of data.approvals || []) {
      if (approval.action !== "affiliate_payout" || approval.status !== "pending") continue;
      const match = /^Pay (\S+) what they are owed in ([A-Z]{3})/.exec(approval.summary);
      if (match) waiting.add(`${match[1]}-${match[2].toLowerCase()}`);
    }
    return waiting;
  }, [data.approvals]);

  if (!canManageFinance)
    return (
      <StatePanel kind="error" title="Affiliates are for finance managers">
        Applications, commissions and payouts need the manage finance permission. Ask an owner if your work needs it.
      </StatePanel>
    );

  /**
   * Paying is an owner-approval action: it is sent with `confirmed: true` after the dialog, and
   * for anyone but an owner the server queues it and answers 202. That answer is shown as what it
   * is - a request waiting for an owner - and never as money sent.
   */
  async function requestPayout(row: AdminAffiliateBalance) {
    const key = `affiliate_payout-${row.handle}-${row.currency}`;
    setBusy(key);
    setNotice("");
    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "affiliate_payout", handle: row.handle, currency: row.currency, confirmed: true }),
      });
      const result = await response.json().catch(() => ({})) as { warning?: string; error?: { message?: string } };
      if (response.status === 202) {
        await load();
        setNotice(result.warning || "Sent to an owner for approval. It runs when an owner approves it.");
        return;
      }
      if (!response.ok) {
        setNotice(result.error?.message || "The payout could not be sent.");
        return;
      }
      await load();
      setNotice(`Payout to ${row.handle} sent to Stripe. It shows as paid once Stripe reports the transfer landed.`);
    } catch {
      setNotice("The payout request did not reach Radar. Nothing was sent; try again.");
    } finally {
      setBusy("");
    }
  }

  const roster = data.creatorRoster || [];
  const selected = selectedHandle ? roster.find((creator) => creator.handle === selectedHandle) : undefined;
  const applicationPage = pageRows(pendingCreatorApplications, pageFor("affiliates.applications"));
  const rosterPage = pageRows(roster, pageFor("affiliates.roster"));
  const picks = roster.flatMap((creator) => creator.picks.map((pick) => ({ creator, pick })));
  const pickPage = pageRows(picks, pageFor("affiliates.picks"));
  const balancePage = pageRows(data.affiliateBalances || [], pageFor("affiliates.balances"));

  return (
    <>
      {/* The overview strip. Four figures that answer "is the program alive and does
          anybody need paying", above the panels that do something about it. Rendered whatever
          the numbers are — a console that disappears when it has no data reads as a console
          that was never built. */}
      <div className="portal-stats affiliate-stats">
        <article><Users /><div><b>{roster.length}</b><span>Affiliates</span></div></article>
        <article><HeartHandshake /><div><b>{pendingCreatorApplications.length}</b><span>Applications waiting</span></div></article>
        <article><Banknote /><div><b>{money(affiliateTotals.owed.amount, affiliateTotals.owed.currency)}</b><span>Owed, not yet paid</span></div></article>
        <article><Check /><div><b>{money(affiliateTotals.paid.amount, affiliateTotals.paid.currency)}</b><span>Paid out to date</span></div></article>
      </div>
      {/* Applications sit above the roster because they are the only thing in this tab that is
          a queue: everything below is a list you look things up in, this is work waiting. */}
      <section className="portal-card">
        <div className="portal-card-head">
          <div><span className="kicker">CREATOR APPLICATIONS</span><h2>Waiting for review</h2></div>
        </div>
        {pendingCreatorApplications.length === 0 && (
          <ListEmpty>
            Nothing waiting. Applications arrive from <code>/for-creators</code> and appear here
            the moment somebody applies.
          </ListEmpty>
        )}
        <div className="queue-list">
          {applicationPage.rows.map((application) => (
            <article key={application.id}>
              <div>
                <span className="status">{application.status}</span>
                <h3>{application.requested_handle}</h3>
                <p><a href={application.channel_url} target="_blank" rel="noreferrer noopener">{application.channel_url}</a></p>
                {application.audience && <p>{application.audience}</p>}
                {application.pitch && <p className="muted-note">{application.pitch}</p>}
                <small>{application.email} · applied {application.created_at.slice(0, 10)}</small>
              </div>
              <div>
                {/* Approving takes the requested handle as-is. Anything else — a different
                    handle, a different rate — goes through the Creator link dialog after,
                    which is the one place handle rules already live. */}
                <button
                  className="primary"
                  disabled={busy === `creator_application-${application.id}`}
                  onClick={() => action({ action: "creator_application", id: application.id, decision: "approve", handle: application.requested_handle })}
                >
                  Approve as {application.requested_handle}
                </button>
                <button
                  disabled={busy === `creator_application-${application.id}`}
                  onClick={() => setReasonDialog({
                    title: `Reject ${application.requested_handle}’s application`,
                    body: `${application.email} is emailed this reason. Say what would need to change for a new application to succeed.`,
                    label: "Reason (sent to the applicant)",
                    confirmLabel: "Reject application",
                    busyKey: `creator_application-${application.id}`,
                    run: (reason) => action({ action: "creator_application", id: application.id, decision: "reject", reason }),
                  })}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
        <Pager paged={applicationPage} noun="application" onPage={setPageFor("affiliates.applications")} />
      </section>
      {/* The roster answers "how is this person doing" without leaving the tab. The payouts
          list below is the same money seen the other way round — by invoice, for settling. */}
      <section className="portal-card">
        <div className="portal-card-head">
          <div><span className="kicker">CREATORS</span><h2>Your roster</h2></div>
        </div>
        {roster.length === 0 && (
          <ListEmpty>
            No affiliates yet. Approving an application above creates the profile, mints the
            handle and turns on their link — there is nothing else to set up.
          </ListEmpty>
        )}
        <div className="inventory-table creator-roster-table">
          {rosterPage.rows.map((creator) => (
            <article key={creator.user_id} className={creator.handle === selectedHandle ? "sw-aff-selected" : ""}>
              <div>
                <b>
                  <button type="button" className="sw-link" aria-expanded={creator.handle === selectedHandle} onClick={() => setSelectedHandle(creator.handle === selectedHandle ? "" : creator.handle)}>
                    {creator.handle}
                  </button>
                  {creator.status === "paused" && <span className="role-badge paused"> paused</span>}
                </b>
                <small>{creator.display_name || "—"} · {(creator.commission_rate_bps / 100).toFixed(creator.commission_rate_bps % 100 ? 2 : 0)}%</small>
              </div>
              <div><b>{creator.visits.toLocaleString()}</b><small>visits · {creator.visits30.toLocaleString()} in 30d</small></div>
              <div><b>{creator.signups.toLocaleString()}</b><small>accounts</small></div>
              <div>
                {creator.money.length
                  ? creator.money.map((row) => (
                      <span key={row.currency} className="roster-money">
                        <b>{money(row.owed, row.currency)}</b>
                        <small>owed · {money(row.paid, row.currency)} paid · {row.invoices} invoices</small>
                      </span>
                    ))
                  : <><b>—</b><small>no subscriptions yet</small></>}
              </div>
            </article>
          ))}
        </div>
        <Pager paged={rosterPage} noun="affiliate" onPage={setPageFor("affiliates.roster")} />
        {selectedHandle && !selected && roster.length > 0 && (
          <StatePanel kind="empty" title={`No affiliate uses @${selectedHandle}`} action={<button type="button" onClick={() => setSelectedHandle("")}>Close</button>}>
            The handle may have changed. Pick an affiliate from the roster above.
          </StatePanel>
        )}
        {selected && (
          <AffiliateDetail
            creator={selected}
            campaigns={campaignList}
            onRetry={reloadCampaigns}
            onClose={() => setSelectedHandle("")}
            onOpenCampaign={(id) => openTab("campaigns", id ? `?campaign=${encodeURIComponent(id)}` : "")}
            canManageCampaigns={canManageCampaigns}
          />
        )}
        {/* Third-party copy that Radar publishes under its own domain: a creator's note runs
            on the deal's page and in the rail on the home page, credited by name. Staff can
            read every one of them here and take one down; nobody can write one from here, so
            a byline always means what it says. Taking one down is manage_users' (creator_pick). */}
        {picks.length > 0 && (
          <>
            <ListCount>Featured picks</ListCount>
            <div className="inventory-table creator-picks-table">
              {pickPage.rows.map(({ creator, pick }) => (
                <article key={`${creator.handle}-${pick.deal_id}`} className={pick.live ? "" : "inactive"}>
                  <div>
                    <b>{pick.restaurant || pick.deal_id}</b>
                    <small>{creator.handle} &middot; {pick.title || "deal no longer listed"}</small>
                  </div>
                  <div className="pick-note-cell">
                    {pick.note ? <q>{pick.note}</q> : <small>no line written</small>}
                  </div>
                  <div>
                    <b>{pick.live ? "Showing" : "Hidden"}</b>
                    <small>{pick.created_at.slice(0, 10)}</small>
                  </div>
                  <div className="row-actions">
                    {canManageUsers && (
                      <button
                        disabled={busy === `pick-${creator.handle}-${pick.deal_id}`}
                        onClick={() => action({ action: "creator_pick", handle: creator.handle, dealId: pick.deal_id, reason: `Removed ${creator.handle}'s pick of ${pick.restaurant || pick.deal_id}` }, `pick-${creator.handle}-${pick.deal_id}`)}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
            <Pager paged={pickPage} noun="pick" onPage={setPageFor("affiliates.picks")} />
          </>
        )}
      </section>
      {/* WHAT EACH AFFILIATE IS OWED, AND THE BUTTON THAT ACTUALLY PAYS IT.
          There is no "mark as paid" here any more. The button below creates a Stripe transfer to
          the affiliate's connected account through the same engine the portal's own payout
          button uses, and a row only ever says "paid" once Stripe reports the transfer landed.
          Where an affiliate cannot be paid, the reason takes the button's place rather than the
          button failing when pressed. */}
      <section className="portal-card">
        <div className="portal-card-head">
          <div><span className="kicker">AFFILIATE BALANCES</span><h2>Who is owed what</h2></div>
          <span className="creator-rate">{money(owedTotal.amount, owedTotal.currency)} in hold</span>
        </div>
        {(data.affiliateBalances || []).length === 0 && (
          <ListEmpty>
            Nobody is owed anything yet. A row appears here the first time someone an affiliate
            referred is billed for Radar Pro.
          </ListEmpty>
        )}
        <div className="inventory-table affiliate-console-table">
          {(data.affiliateBalances || []).length > 0 && <div className="table-head"><div>Affiliate</div><div>Ready to pay</div><div>Still holding</div><div>Action</div></div>}
          {balancePage.rows.map((row) => {
            const key = `affiliate_payout-${row.handle}-${row.currency}`;
            const blocked = !row.has_account
              ? "No Stripe account"
              : !row.payouts_enabled || (row.requirements_due || 0) > 0
                ? "Stripe setup unfinished"
                : row.available <= 0 ? "Nothing ready yet" : "";
            return (
              <article key={`${row.handle}-${row.currency}`}>
                <div><b>{row.handle}</b><small>{row.currency.toUpperCase()} · {money(row.paid, row.currency)} paid to date</small></div>
                <div><b>{money(row.available, row.currency)}</b></div>
                <div><b>{money(row.holding, row.currency)}</b><small>in the holding period</small></div>
                <div className="row-actions">
                  {blocked
                    ? <small>{blocked}</small>
                    : waitingForOwner.has(`${row.handle}-${row.currency}`)
                      ? <small>Waiting for an owner’s approval</small>
                      : (
                        <button
                          disabled={busy === key}
                          onClick={() => setConfirmDialog({
                            title: `Pay ${row.handle} ${money(row.available, row.currency)}?`,
                            body: `This sends ${money(row.available, row.currency)} to ${row.handle}’s Stripe account and moves real money. The amount is whatever the ledger says is ready when it runs. Unless you are an owner, it is sent to an owner for approval first.`,
                            confirmLabel: `Pay ${money(row.available, row.currency)}`,
                            busyKey: key,
                            run: () => requestPayout(row),
                          })}
                        >
                          Pay {money(row.available, row.currency)}<span className="sr-only"> to {row.handle}</span>
                        </button>
                      )}
                </div>
              </article>
            );
          })}
        </div>
        <Pager paged={balancePage} noun="balance" onPage={setPageFor("affiliates.balances")} />
      </section>
      <section className="portal-card">
        <div className="portal-card-head">
          <div><span className="kicker">PAYOUTS</span><h2>Money that has left</h2></div>
        </div>
        {(data.creatorPayouts || []).length === 0 && (
          <ListEmpty>
            No money has gone out yet. Every payout here carries the Stripe transfer behind it,
            so a row means a transfer really happened.
          </ListEmpty>
        )}
        <div className="inventory-table affiliate-console-table">
          {(data.creatorPayouts || []).length > 0 && <div className="table-head"><div>Affiliate</div><div>Amount</div><div>Stripe</div><div>Status</div></div>}
          {payoutPage.rows.map((row) => (
            <article key={row.id}>
              <div><b>{row.handle}</b><small>{row.created_at.slice(0, 10)} · {row.commission_count} commission{row.commission_count === 1 ? "" : "s"}</small></div>
              <div><b>{money(row.amount, row.currency)}</b></div>
              <div><b>{row.stripe_transfer_id || "—"}</b><small>{row.stripe_account_id}</small></div>
              <div className="status-stack">
                <span className={`status${row.status === "paid" || row.status === "processing" ? " on" : ""}`}>{row.status}</span>
                <small>{row.failure_reason || (row.paid_at ? `paid ${row.paid_at.slice(0, 10)}` : "with Stripe")}</small>
              </div>
            </article>
          ))}
        </div>
        <Pager paged={payoutPage} noun="payout" onPage={setPageFor("affiliates.payouts")} />
      </section>
      <section className="portal-card">
        <div className="portal-card-head">
          <div><span className="kicker">CREATOR COMMISSIONS</span><h2>The ledger</h2></div>
        </div>
        {(data.creatorCommissions || []).length === 0 && (
          <ListEmpty>
            The ledger is empty. One row is written per paid invoice, the moment Stripe reports
            the payment.
          </ListEmpty>
        )}
        <div className="inventory-table creator-earnings-table">
          {commissionPage.rows.map((row) => (
            <article key={row.id}>
              <div>
                <b>{money(row.commission_amount, row.currency)}</b>
                <small>{row.handle} · {row.created_at.slice(0, 10)} · {(row.rate_bps / 100).toFixed(row.rate_bps % 100 ? 2 : 0)}% of {money(row.gross_amount, row.currency)}</small>
              </div>
              <div>
                <b>{row.status}</b>
                <small>{row.rejection_reason || (row.paid_at ? `paid ${row.paid_at.slice(0, 10)}` : row.payout_id ? `in payout #${row.payout_id}` : " ")}</small>
              </div>
              <div className="row-actions">
                {/* A row a payout is carrying, or one already paid, is not editable here — the
                    payout owns it. Reversing the payout is what hands it back. */}
                {row.status === "pending" && !row.payout_id && (
                  <button disabled={busy === `creator_commission-${row.id}`} onClick={() => action({ action: "creator_commission", id: row.id, status: "approved" })}>Release hold</button>
                )}
                {(row.status === "pending" || row.status === "approved") && !row.payout_id && (
                  <button
                    disabled={busy === `creator_commission-${row.id}`}
                    onClick={() => setReasonDialog({
                      title: `Refuse ${money(row.commission_amount, row.currency)} for ${row.handle}?`,
                      body: "The affiliate sees this reason beside the commission in their portal.",
                      label: "Why is this commission being refused?",
                      confirmLabel: "Refuse commission",
                      busyKey: `creator_commission-${row.id}`,
                      run: (reason) => action({ action: "creator_commission", id: row.id, status: "rejected", reason }),
                    })}
                  >
                    Refuse
                  </button>
                )}
                {(row.status === "pending" || row.status === "approved") && !row.payout_id && (
                  <button
                    disabled={busy === `creator_commission-${row.id}`}
                    onClick={() => setConfirmDialog({
                      title: `Void ${money(row.commission_amount, row.currency)} for ${row.handle}?`,
                      body: "Void a commission when the payment behind it came back. It stops counting toward what this affiliate is owed.",
                      confirmLabel: "Void commission",
                      busyKey: `creator_commission-${row.id}`,
                      run: () => action({ action: "creator_commission", id: row.id, status: "void" }),
                    })}
                  >
                    Void
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
        <Pager paged={commissionPage} noun="commission" onPage={setPageFor("affiliates.commissions")} />
      </section>
      {reasonDialog && (
        <ReasonDialogView dialog={reasonDialog} busy={busy === reasonDialog.busyKey} onClose={() => setReasonDialog(null)} />
      )}
    </>
  );
}

function ReasonDialogView({ dialog, busy, onClose }: { dialog: ReasonDialog; busy: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const missing = !reason.trim();
  async function submit() {
    setTouched(true);
    if (missing) return;
    const result = await dialog.run(reason.trim());
    // The shell's action answers false when the server refused; the dialog stays open so the
    // reason is not lost, and the refusal is in the workspace notice.
    if (result !== false) onClose();
  }
  return (
    // Backdrop click-to-dismiss is a mouse convenience; Cancel, the close button and Escape
    // (DialogFocus) are the keyboard ways out.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="overlay" onMouseDown={onClose}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
      <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reason-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
        <DialogFocus onClose={onClose} />
        <button className="close" aria-label="Cancel" onClick={onClose}><X /></button>
        <span className="kicker">A REASON IS REQUIRED</span>
        <h2 id="reason-dialog-title">{dialog.title}</h2>
        <p>{dialog.body}</p>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="typed-confirmation">
            {dialog.label}
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={4}
              aria-invalid={touched && missing}
              aria-describedby={touched && missing ? "reason-dialog-error" : undefined}
            />
            {touched && missing && <small className="field-error" id="reason-dialog-error">Write a reason before sending.</small>}
          </label>
          <div className="editor-actions">
            <button type="button" onClick={onClose}>Cancel</button>
            <button type="submit" className="destructive" disabled={busy}>{busy ? "Sending…" : dialog.confirmLabel}</button>
          </div>
        </form>
      </section>
    </div>
  );
}

/**
 * One affiliate up close: their figures, and their labeled links as campaign records. The records
 * come from /api/admin/campaigns, filtered to this handle. A label with traffic but no record is
 * listed as untracked, so nothing an affiliate is doing is invisible here.
 */
function AffiliateDetail({ creator, campaigns, onRetry, onClose, onOpenCampaign, canManageCampaigns }: {
  creator: AdminCreatorRosterRow;
  campaigns: ReturnType<typeof useCampaignList>["state"];
  onRetry: () => void;
  onClose: () => void;
  onOpenCampaign: (id: string) => void;
  canManageCampaigns: boolean;
}) {
  const records = campaigns.status === "ready" ? campaigns.data.campaigns.filter((row) => row.creator_handle === creator.handle) : [];
  const trackedLabels = new Set(records.map((row) => row.campaign || ""));
  const untracked = creator.campaigns.filter((row) => !trackedLabels.has(row.campaign || ""));
  const hasLinks = records.length + untracked.length > 0;
  // What a label has earned comes from the commission ledger (the roster), not the campaign record.
  const earnedFor = (label: string | null) => {
    const stats = creator.campaigns.find((row) => row.campaign === label);
    return stats?.earned && stats.currency ? money(stats.earned, stats.currency) : "";
  };
  return (
    <div className="sw-aff-detail">
      <PanelHeader
        title={`@${creator.handle}`}
        actions={<button type="button" onClick={onClose}>Close</button>}
      >
        {creator.display_name || "No display name"} · {(creator.commission_rate_bps / 100).toFixed(creator.commission_rate_bps % 100 ? 2 : 0)}% commission · {creator.status}
      </PanelHeader>
      <div className="portal-stats sw-camp-stats">
        <article><div><b>{creator.visits.toLocaleString()}</b><span>Visits, all time</span></div></article>
        <article><div><b>{creator.visits30.toLocaleString()}</b><span>Visits, last 30 days</span></div></article>
        <article><div><b>{creator.signups.toLocaleString()}</b><span>Accounts referred</span></div></article>
        <article><div><b>{creator.picks.length}</b><span>Featured picks</span></div></article>
      </div>
      <h3 className="sw-camp-subhead">Campaigns</h3>
      {campaigns.status === "loading" && <StatePanel kind="loading" title="Loading this affiliate’s campaigns…" />}
      {campaigns.status === "error" && (
        <StatePanel kind="error" title="Campaigns could not be loaded" action={<button type="button" onClick={onRetry}>Try again</button>}>{campaigns.error}</StatePanel>
      )}
      {campaigns.status === "ready" && !hasLinks && (
        <StatePanel kind="empty" title="No labeled links yet">
          When @{creator.handle} shares a link with a label (?c={creator.handle}&amp;camp=…), it appears here.
          {canManageCampaigns ? " You can also create one in Campaigns with this handle." : ""}
        </StatePanel>
      )}
      {campaigns.status === "ready" && hasLinks && (
        <ul className="sw-camp-list">
          {records.map((row) => (
            <li key={row.id}><button type="button" className="sw-camp-row" onClick={() => onOpenCampaign(row.id)}>
              <span className="sw-camp-main"><b>{row.name}</b><small>{linkLabel(row)} · {row.owner_name || "No owner"}</small></span>
              <span className="sw-camp-meta"><span className={`status${row.status === "active" ? " on" : ""}`}>{STATUS_LABEL[row.status] || row.status}</span><small>{row.starts_at ? `from ${shortDate(row.starts_at)}` : "no start date"}</small></span>
              <span className="sw-camp-num"><b>{row.visits.toLocaleString()}</b><small>visits ({campaigns.data.windowDays}d)</small></span>
              <span className="sw-camp-num">
                <b>{(row.signups || 0).toLocaleString()}</b>
                <small>
                  sign-ups{earnedFor(row.campaign) ? ` · ${earnedFor(row.campaign)} earned` : ""} <ArrowRight aria-hidden="true" size={12} />
                </small>
              </span>
            </button></li>
          ))}
          {untracked.map((row) => (
            <li key={row.campaign} className="sw-camp-row sw-camp-row-static">
              <span className="sw-camp-main"><b>{row.campaign}</b><small>Untracked label · no campaign record</small></span>
              <span className="sw-camp-num"><b>{row.visits.toLocaleString()}</b><small>visits, all time</small></span>
              <span className="sw-camp-num">
                <b>{row.subscriptions.toLocaleString()}</b>
                <small>{row.earned && row.currency ? `subscriptions · ${money(row.earned, row.currency)} earned` : "subscriptions"}</small>
              </span>
              <span className="sw-camp-actions">
                {canManageCampaigns && <button type="button" onClick={() => onOpenCampaign("")}>Track in Campaigns</button>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
