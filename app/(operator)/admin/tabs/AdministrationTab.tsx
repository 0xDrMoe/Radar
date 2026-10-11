"use client";
import { useState } from "react";
import { Crown, KeyRound, ShieldAlert } from "lucide-react";
import { DialogFocus } from "../../DialogFocus";
import { formatRole } from "../../../permissions";
import type { AdminOwnerApproval } from "../types";
import { Pager, pageRows } from "../../ListScope";
import { useListScope, useWorkspace } from "../workspace";
import { PanelHeader, StaffTime, StatePanel } from "../ui";
import { RolesGrid } from "../RolesGrid";
import { FinancePanels } from "../FinancePanels";

// THE ADMIN SECTION.
// The workspace's controls over itself, in one place: requests waiting for an owner, the role
// presets, and the money figures and switches that used to be scattered across Growth and Users.
// Each panel says who it is for, because "admin" here covers three different bars - owner only,
// owner and admin, and finance - and the server enforces each one separately.

const ACTION_LABELS: Record<string, string> = {
  bulk_lifecycle: "Change every deal in a market",
  delete_sponsorship: "Delete a sponsorship",
  affiliate_payout: "Pay an affiliate",
  setting: "Change an operator switch",
};

const STATUS_LABELS: Record<AdminOwnerApproval["status"], string> = {
  pending: "Waiting for an owner",
  approved: "Approved and run",
  declined: "Declined",
  canceled: "Withdrawn",
  failed: "Approved, but it could not run",
};

function Audience({ who }: { who: "owner" | "admin" | "finance" }) {
  const text = who === "owner" ? "Owner only" : who === "admin" ? "Owners and admins" : "Finance managers and above";
  return <span className={`sw-audience sw-audience-${who}`}>{who === "owner" ? <Crown aria-hidden="true" /> : <KeyRound aria-hidden="true" />}{text}</span>;
}

export default function AdministrationTab() {
  const { data, isOwner, isAdminPlus, canManageFinance, action, busy, currentUser } = useWorkspace();
  const [deciding, setDeciding] = useState<{ approval: AdminOwnerApproval; decision: "approve" | "decline" } | null>(null);
  const [note, setNote] = useState("");
  const approvals = data.approvals || [];
  const pending = approvals.filter((approval) => approval.status === "pending");
  const decided = approvals.filter((approval) => approval.status !== "pending");
  const { pageFor, setPageFor } = useListScope();
  const pendingPage = pageRows(pending, pageFor("approvals.pending"));
  const decidedPage = pageRows(decided, pageFor("approvals.decided"));

  async function decide() {
    if (!deciding) return;
    const ok = await action(
      { action: "decide_owner_approval", id: deciding.approval.id, decision: deciding.decision, notes: note, confirmed: true },
      `approval-${deciding.approval.id}`,
    );
    if (ok) {
      setDeciding(null);
      setNote("");
    }
  }

  return (
    <>
      <section className="portal-card sw-admin">
        <PanelHeader title="Owner approvals" actions={<Audience who="owner" />}>
          Pausing or archiving a whole market, deleting a sponsorship, paying an affiliate and changing an operator switch need an owner.
          {isOwner ? " Anyone else who asks lands here; approving runs it exactly as it was asked, under your name." : " When you ask for one, it waits here until an owner decides."}
        </PanelHeader>
        {!pending.length ? (
          <StatePanel kind="empty" title={isOwner ? "Nothing is waiting for you." : "You have no requests waiting."}>
            Requests appear here as soon as someone asks for one of these actions.
          </StatePanel>
        ) : (
          <>
            <ul className="sw-approvals">
              {pendingPage.rows.map((approval) => (
                <li key={approval.id}>
                  <div>
                    <span className="status">{ACTION_LABELS[approval.action] || approval.action}</span>
                    <b>{approval.summary}</b>
                    <small>
                      Asked by {approval.requester_name || approval.requester_email || "a member of staff"} ({formatRole(approval.requested_role)}) · <StaffTime value={approval.created_at} />
                    </small>
                    {approval.reason && <p>“{approval.reason}”</p>}
                  </div>
                  <div className="sw-approval-actions">
                    {isOwner && (
                      <>
                        <button className="primary" disabled={busy === `approval-${approval.id}`} onClick={() => { setNote(""); setDeciding({ approval, decision: "approve" }); }}>
                          Approve<span className="sr-only">: {approval.summary}</span>
                        </button>
                        <button disabled={busy === `approval-${approval.id}`} onClick={() => { setNote(""); setDeciding({ approval, decision: "decline" }); }}>
                          Decline<span className="sr-only">: {approval.summary}</span>
                        </button>
                    </>
                  )}
                  {approval.requested_by === currentUser.id && (
                    <button disabled={busy === `approval-${approval.id}`} onClick={() => action({ action: "cancel_owner_approval", id: approval.id }, `approval-${approval.id}`)}>
                      Withdraw<span className="sr-only">: {approval.summary}</span>
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <Pager paged={pendingPage} noun="request" onPage={setPageFor("approvals.pending")} />
          </>
        )}
        {decided.length > 0 && (
          <details className="sw-approval-history">
            <summary>Decided recently ({decided.length})</summary>
            <ul className="sw-approvals">
              {decidedPage.rows.map((approval) => (
                <li key={approval.id}>
                  <div>
                    <span className={`status ${approval.status === "approved" ? "on" : ""}`}>{STATUS_LABELS[approval.status] || approval.status}</span>
                    <b>{approval.summary}</b>
                    <small>
                      Asked by {approval.requester_name || approval.requester_email || "staff"} · {approval.decided_at ? <>decided <StaffTime value={approval.decided_at} /></> : ""}{approval.decider_name ? ` by ${approval.decider_name}` : ""}
                    </small>
                    {approval.decision_note && <p>Note: {approval.decision_note}</p>}
                    {approval.result && approval.status !== "canceled" && <p>Result: {approval.result}</p>}
                  </div>
                </li>
              ))}
            </ul>
            <Pager paged={decidedPage} noun="decision" onPage={setPageFor("approvals.decided")} />
          </details>
        )}
      </section>

      {/* Owners and admins read the presets; only an owner can change them (set_role_permission). */}
      {isAdminPlus ? <RolesGrid /> : null}

      {canManageFinance ? (
        <section className="sw-admin-finance">
          <PanelHeader title="Revenue and subscriptions" actions={<Audience who="finance" />}>
            Revenue, subscription movement, the affiliate program, why people cancel, plan switches, retention and comped accounts.
          </PanelHeader>
          <FinancePanels />
        </section>
      ) : null}

      {!isAdminPlus && !canManageFinance && (
        <StatePanel kind="empty" title="Only the approvals above are yours here.">Role presets are for owners and admins, and money figures for finance managers.</StatePanel>
      )}

      {deciding && (
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- backdrop click-to-dismiss is a mouse convenience; Cancel and Escape (DialogFocus) are the keyboard ways out
        <div className="overlay" onMouseDown={() => setDeciding(null)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks that start inside the dialog */}
          <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="approval-dialog-title" onMouseDown={(event) => event.stopPropagation()}>
            <DialogFocus onClose={() => setDeciding(null)} />
            <span className="kicker">{deciding.decision === "approve" ? "RUNS IMMEDIATELY" : "DECLINE REQUEST"}</span>
            <h2 id="approval-dialog-title">{deciding.decision === "approve" ? "Approve and run this now?" : "Decline this request?"}</h2>
            <p><ShieldAlert aria-hidden="true" /> {deciding.approval.summary}</p>
            <label className="sw-field">
              <span>{deciding.decision === "approve" ? "Note (optional)" : "Why (the person who asked will see this)"}</span>
              <textarea value={note} maxLength={500} rows={3} onChange={(event) => setNote(event.target.value)} />
            </label>
            <div className="editor-actions">
              <button onClick={() => setDeciding(null)}>Cancel</button>
              <button
                className={deciding.decision === "approve" ? "destructive" : "primary"}
                disabled={busy === `approval-${deciding.approval.id}` || (deciding.decision === "decline" && !note.trim())}
                onClick={decide}
              >
                {deciding.decision === "approve" ? "Approve and run" : "Decline"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
