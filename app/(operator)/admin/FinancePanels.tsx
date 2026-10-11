"use client";
import { useCallback, useState } from "react";
import { BadgeCheck, Megaphone, MessageSquare, RefreshCw, UserMinus } from "lucide-react";
import TrendChart from "../TrendChart";
import { CANCEL_REASON_LABELS, money, percent, SAVE_OFFER_LABELS, TRIAL_DAYS_LABEL } from "./format";
import type { ActionErrorBody, AdminActionPayload } from "./types";
import { PanelHeader, StatePanel } from "./ui";
import { usePagedRows, useTabState, useWorkspace } from "./workspace";
import { Pager } from "../ListScope";

// The money panels: revenue, subscription movement, the affiliate program, why people cancel,
// the subscription switches, retention and comped accounts.
//
// They used to sit in the Growth tab, which answers to view_analytics; the figures answer to
// manage_finance (buildGrowthMetrics in app/api/admin/route.ts sends `metrics` only with it). They
// are named exports so the Admin tab can lay them out, and each reads the workspace itself, so a
// panel is placed with no props. Each says plainly when the viewer cannot see it rather than
// rendering a row of zeros that look like real figures.

/** What an owner-approval action came back as: done, waiting for an owner, or refused. */
export type OwnerActionResult = "done" | "pending" | false;

/**
 * POSTs an owner-approval action (OWNER_APPROVAL_ACTIONS in app/permissions.ts: delete_sponsorship,
 * setting, ...) with the `confirmed: true` its confirmation dialog stands for.
 *
 * The workspace's own `action` cannot tell "done" from "queued": both are a 2xx and both reload.
 * An owner's request runs at once (200); anyone else's is stored for an owner and answers 202
 * `{pending:true, warning}`. Reporting that as "Changes saved." would tell somebody a sponsorship
 * was deleted that is still running, so this reads the status and says which happened.
 */
export function useOwnerApprovalAction() {
  const { load, setBusy, setNotice, setFieldErrors } = useWorkspace();
  return useCallback(
    async (payload: AdminActionPayload, busyKey: string): Promise<OwnerActionResult> => {
      setBusy(busyKey);
      setNotice("");
      setFieldErrors({});
      try {
        const response = await fetch("/api/admin", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, confirmed: true }),
        });
        const result = (await response.json()) as ActionErrorBody & { pending?: boolean; warning?: string | null };
        if (!response.ok) {
          const body = typeof result?.error === "object" ? result.error : undefined;
          setFieldErrors(body?.fields || {});
          throw new Error(body?.message || (typeof result?.error === "string" ? result.error : "") || "Action failed.");
        }
        await load();
        if (response.status === 202 || result.pending) {
          setNotice(result.warning || "Sent to an owner for approval. Nothing has changed yet.");
          return "pending";
        }
        setNotice(result.warning ? `Done. ${result.warning}` : "Done.");
        return "done";
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : "Action failed.");
        return false;
      } finally {
        setBusy("");
      }
    },
    [load, setBusy, setNotice, setFieldErrors],
  );
}

/** Shown in place of a money panel to anyone without manage_finance, or before the figures load. */
function FinanceGate({ title }: { title: string }) {
  const { data, canManageFinance } = useWorkspace();
  if (!canManageFinance)
    return (
      <section className="portal-card">
        <PanelHeader title={title} />
        <StatePanel kind="empty" title="Needs the finance permission">
          These figures are shown to staff with manage_finance. Ask an owner if your job needs them.
        </StatePanel>
      </section>
    );
  if (!data.metrics)
    return (
      <section className="portal-card">
        <PanelHeader title={title} />
        <StatePanel kind="error" title="The finance figures did not load">Reload the workspace to try again.</StatePanel>
      </section>
    );
  return null;
}

export function RevenuePanel() {
  const { data } = useWorkspace();
  const metrics = data.metrics;
  const visible = useFinanceVisible();
  // The revenue trend arrives split by currency, which a single sparkline cannot honestly draw -
  // one line summing CAD and USD would be a made-up number. Charting the invoice count instead
  // keeps the shape (when money arrives, and how often) without inventing an exchange rate; the
  // amounts stay beside it as per-currency totals.
  const invoiceTrend = Object.values(
    (metrics?.revenue.trend || []).reduce<Record<string, { day: string; count: number }>>((byDay, row) => {
      (byDay[row.day] ||= { day: row.day, count: 0 }).count += row.invoices;
      return byDay;
    }, {}),
  );
  if (!metrics || !visible) return <FinanceGate title="Revenue" />;
  return (
    <section className="portal-card">
      <PanelHeader title="Revenue">
        Money actually collected, taken from paid Stripe invoices rather than from a headcount — the users table cannot tell a monthly subscriber from an annual one. Split by currency, because a single total across several is wrong in all of them. App Store purchases are billed by Apple and never appear here.
      </PanelHeader>
      <div className="quality-grid">
        {metrics.revenue.byCurrency.map((row) => (
          <article key={`rev-${row.currency}`}>
            <b>{money(row.total, row.currency)}</b>
            <span>{row.currency.toUpperCase()} collected · {row.invoices} invoice{row.invoices === 1 ? "" : "s"}</span>
          </article>
        ))}
        {metrics.revenue.byCurrency.map((row) => (
          <article key={`rev30-${row.currency}`}>
            <b>{money(row.last30, row.currency)}</b>
            <span>{row.currency.toUpperCase()} last 30 days</span>
          </article>
        ))}
      </div>
      {!metrics.revenue.byCurrency.length && (
        <StatePanel kind="empty" title="No paid invoices recorded yet">
          The first paid Stripe invoice appears here as soon as the webhook records it.
        </StatePanel>
      )}
      {invoiceTrend.length > 0 && (
        <div className="trend-charts">
          <TrendChart label="Invoices paid" rows={invoiceTrend} />
        </div>
      )}
    </section>
  );
}

/** True when the money figures are both allowed and loaded. A hook so every panel asks the same way. */
function useFinanceVisible() {
  const { data, canManageFinance } = useWorkspace();
  return canManageFinance && Boolean(data.metrics);
}

export function SubscriptionMovementPanel() {
  const { data } = useWorkspace();
  const metrics = data.metrics;
  const visible = useFinanceVisible();
  if (!metrics || !visible) return <FinanceGate title="Subscription movement" />;
  const paying = data.growth?.users.pro_paying || 0;
  const { started30, canceled30 } = metrics.subscriptions.totals;
  return (
    <section className="portal-card">
      <PanelHeader title="Subscription movement">
        Starts and cancellations as they arrive from Stripe. These begin the day the webhook started recording them — earlier subscriptions cannot be backfilled, so a thin early chart means missing history rather than a quiet month.
      </PanelHeader>
      <div className="quality-grid">
        <article><b>{started30}</b><span>Started (30 days)</span></article>
        <article><b>{canceled30}</b><span>Canceled (30 days)</span></article>
        <article><b>{started30 - canceled30}</b><span>Net adds (30 days)</span></article>
        <article><b>{percent(canceled30, paying + canceled30)}</b><span>Churn (30 days)</span></article>
      </div>
      <div className="trend-charts">
        <TrendChart label="Subscriptions started" rows={metrics.subscriptions.started} />
        <TrendChart label="Subscriptions canceled" rows={metrics.subscriptions.canceled} />
      </div>
    </section>
  );
}

export function AffiliateProgramPanel() {
  const { data } = useWorkspace();
  const metrics = data.metrics;
  const visible = useFinanceVisible();
  if (!metrics || !visible) return <FinanceGate title="Affiliate program" />;
  const totals = metrics.affiliate.totals;
  return (
    <section className="portal-card">
      <PanelHeader title="Affiliate program">
        Creators, what their links brought, and what the program owes. <b>Referred subscribers</b> is the number the commission is a share of — referred signups are interesting, referred signups that went on to pay are the deal working.
      </PanelHeader>
      <div className="quality-grid">
        <article><b>{totals.active_creators}</b><span>Active creators</span></article>
        <article><b>{totals.pending_applications}</b><span>Applications waiting</span></article>
        <article><b>{totals.campaigns}</b><span>Labeled campaigns</span></article>
        <article><b>{totals.referred_users}</b><span>Referred signups</span></article>
        <article><b>{totals.referred_pro}</b><span>Referred subscribers</span></article>
        <article><b>{percent(totals.referred_pro, totals.referred_users)}</b><span>Referred signup to Pro</span></article>
      </div>
      <div className="audit-list">
        {metrics.affiliate.commissions.map((row) => (
          <article key={`comm-${row.currency}`}>
            <Megaphone />
            <div>
              <b>{money(row.pending, row.currency)} owed · {money(row.paid, row.currency)} paid</b>
              <small>
                {row.invoices} invoice{row.invoices === 1 ? "" : "s"} · {money(row.gross, row.currency)} gross
                {row.voided > 0 && ` · ${money(row.voided, row.currency)} voided`}
              </small>
            </div>
            <time>{row.currency.toUpperCase()}</time>
          </article>
        ))}
      </div>
      {!metrics.affiliate.commissions.length && (
        <StatePanel kind="empty" title="No commissions accrued yet">
          A row appears the first time someone who arrived on a creator&apos;s link pays an invoice.
        </StatePanel>
      )}
    </section>
  );
}

export function CancellationReasonsPanel() {
  const { data } = useWorkspace();
  const metrics = data.metrics;
  const visible = useFinanceVisible();
  const [notePage, setNotePage] = usePagedRows("finance.churnNotes", metrics?.churn.notes ?? []);
  if (!metrics || !visible) return <FinanceGate title="Why people cancel" />;
  return (
    <section className="portal-card">
      <PanelHeader title="Why people cancel">
        Answered on the way to the billing portal, so the reason is captured at the moment somebody decides to leave. These record an <b>intent</b> to cancel — the portal is Stripe&apos;s and some change their mind in it.
      </PanelHeader>
      <div className="audit-list">
        {metrics.churn.reasons.map((row) => (
          <article key={`churn-${row.reason}`}>
            <UserMinus />
            <div>
              <b>{CANCEL_REASON_LABELS[row.reason] || row.reason}</b>
              <small>
                last {row.last_seen.slice(0, 10)}
                {/* A reason given while the card was already failing is usually a billing
                    problem wearing a cancellation's clothes, and counting it as "too
                    expensive" would point at the wrong fix. */}
                {row.while_failing > 0 && ` · ${row.while_failing} while a payment was failing`}
              </small>
            </div>
            <time>{row.total}</time>
          </article>
        ))}
      </div>
      {!metrics.churn.reasons.length && (
        <StatePanel kind="empty" title="Nobody has canceled yet">The reason someone gives on the way out is recorded here.</StatePanel>
      )}
      {metrics.churn.notes.length > 0 && (
        <div className="audit-list">
          {notePage.rows.map((note) => (
            <article key={`note-${note.created_at}-${note.detail.slice(0, 12)}`}>
              <MessageSquare />
              <div>
                <b>{note.detail}</b>
                <small>{CANCEL_REASON_LABELS[note.reason] || note.reason}</small>
              </div>
              <time>{note.created_at.slice(0, 10)}</time>
            </article>
          ))}
        </div>
      )}
      <Pager paged={notePage} noun="note" onPage={setNotePage} />
    </section>
  );
}

/**
 * The operator switches (app/settings.ts; today, free trials). Readable by everyone in the
 * workspace, changed with manage_users, and every change is an owner-approval action: it is
 * confirmed in a dialog, and anyone but an owner only asks.
 */
export function SubscriptionSwitchesPanel() {
  const { data, busy, canManageUsers, setConfirmDialog } = useWorkspace();
  const ownerAction = useOwnerApprovalAction();
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const definitions = data.settingDefinitions || [];
  function flip(key: string, label: string, on: boolean) {
    setConfirmDialog({
      // A switch flips back the same way, so the dialog's default "cannot be undone" would be untrue.
      kicker: "TAKES EFFECT IMMEDIATELY",
      title: `${on ? "Turn off" : "Turn on"} “${label}”?`,
      body: on
        ? `${label} stops for new subscribers immediately. Anything already running finishes the way it was sold. Unless you are an owner, this is sent to an owner to approve.`
        : `${label} starts for new subscribers immediately. Unless you are an owner, this is sent to an owner to approve.`,
      confirmLabel: on ? "Turn off" : "Turn on",
      busyKey: `setting-${key}`,
      run: async () => {
        const result = await ownerAction({ action: "setting", key, granted: !on, reason: `${on ? "Disabled" : "Enabled"} ${label}` }, `setting-${key}`);
        if (result === "pending") setPending((current) => ({ ...current, [key]: true }));
      },
    });
  }
  return (
    <section className="portal-card">
      <PanelHeader title="Subscription switches">
        Take effect immediately, with no deploy, and every change is in the audit log. Turning free trials off does not end a trial already running — Stripe owns that subscription, and it finishes the way it was sold.
      </PanelHeader>
      {!definitions.length ? (
        <StatePanel kind="empty" title="No switches defined">Switches are defined in app/settings.ts.</StatePanel>
      ) : (
        <div className="appearance-settings">
          {definitions.map((definition) => {
            const on = Boolean(data.settings?.[definition.key]);
            return (
              <div className="appearance-row" key={definition.key}>
                <span>
                  {definition.label}
                  {definition.key === "trials_enabled" && <small className="setting-note"> {TRIAL_DAYS_LABEL}</small>}
                  {pending[definition.key] && <small className="setting-note"> · change waiting for an owner&apos;s approval</small>}
                </span>
                <span className="sw-switch-state">
                  <span className={on ? "status on" : "tag"}>{on ? "On" : "Off"}</span>
                  <button
                    type="button"
                    disabled={!canManageUsers || busy === `setting-${definition.key}`}
                    title={canManageUsers ? undefined : "Changing a switch needs the manage_users permission."}
                    onClick={() => flip(definition.key, definition.label, on)}
                  >
                    {on ? "Turn off" : "Turn on"}
                  </button>
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function RetentionPanel() {
  const { data } = useWorkspace();
  const metrics = data.metrics;
  const visible = useFinanceVisible();
  if (!metrics || !visible) return <FinanceGate title="Retention" />;
  const totals = metrics.lifecycle.totals;
  return (
    <section className="portal-card">
      <PanelHeader title="Retention">
        What was offered on the way out and whether it worked, plus the kinds of &ldquo;on Pro but not currently paying&rdquo;. A pause is the one to watch: people who pause come back, people who cancel mostly do not.
      </PanelHeader>
      <div className="quality-grid">
        <article><b>{totals.paused}</b><span>Paused right now</span></article>
        <article><b>{totals.trialing}</b><span>On a free trial</span></article>
        <article><b>{totals.trials_started}</b><span>Trials ever started</span></article>
        <article><b>{totals.in_grace}</b><span>Inside payment grace</span></article>
        <article><b>{totals.winbacks_sent}</b><span>Win-backs sent</span></article>
      </div>
      <div className="audit-list">
        {metrics.lifecycle.saveOffers.map((row) => (
          <article key={`offer-${row.reason}-${row.offer}`}>
            <RefreshCw />
            <div>
              <b>{SAVE_OFFER_LABELS[row.offer] || row.offer} &rarr; {CANCEL_REASON_LABELS[row.reason] || row.reason}</b>
              <small>{row.accepted} of {row.offered} taken</small>
            </div>
            <time>{percent(row.accepted, row.offered)}</time>
          </article>
        ))}
      </div>
      {!metrics.lifecycle.saveOffers.length && (
        <StatePanel kind="empty" title="No save offers made yet">An offer is recorded whenever somebody answers the cancellation survey.</StatePanel>
      )}
    </section>
  );
}

export function CompedAccountsPanel() {
  const { data, busy, action, canManageFinance } = useWorkspace();
  const metrics = data.metrics;
  const visible = useFinanceVisible();
  // The comp form. Addressed by email because whoever is doing this is reading a support message,
  // not an internal id.
  const [compEmail, setCompEmail] = useTabState("finance.compEmail", "");
  const [compReason, setCompReason] = useTabState("finance.compReason", "");
  const [compExpiry, setCompExpiry] = useTabState("finance.compExpiry", "");
  const [grantPage, setGrantPage] = usePagedRows("finance.grants", metrics?.grants ?? []);
  if (!metrics || !visible) return <FinanceGate title="Comped accounts" />;
  return (
    <section className="portal-card">
      <PanelHeader title="Comped accounts">
        Pro without a Stripe subscription behind it: a comped month after a bad experience, or access held open while a refund is sorted out. Every grant needs a reason and lands in the audit log. Revoking never drops someone who also has a real subscription.
      </PanelHeader>
      <div className="editor-grid comp-form">
        <label>Account email
          <input value={compEmail} onChange={(event) => setCompEmail(event.target.value)} placeholder="someone@example.com" type="email"/>
        </label>
        <label>Expires (optional)
          <input value={compExpiry} onChange={(event) => setCompExpiry(event.target.value)} placeholder="YYYY-MM-DD"/>
        </label>
        <label className="wide">Reason
          <textarea value={compReason} onChange={(event) => setCompReason(event.target.value)} maxLength={500} rows={2}/>
        </label>
        <div className="editor-actions">
          <button
            type="button"
            className="primary"
            disabled={!canManageFinance || !compEmail.trim() || !compReason.trim() || busy === "plan_grant"}
            onClick={async () => {
              if (await action({ action: "plan_grant", email: compEmail.trim(), reason: compReason, expiresAt: compExpiry.trim() || undefined, granted: true }, "plan_grant")) {
                setCompEmail(""); setCompReason(""); setCompExpiry("");
              }
            }}
          >
            Give Pro
          </button>
        </div>
      </div>
      <div className="audit-list">
        {grantPage.rows.map((grant) => (
          <article key={grant.id}>
            <BadgeCheck />
            <div>
              <b>{grant.email}</b>
              <small>
                {grant.reason}
                {grant.expires_at ? ` · until ${grant.expires_at}` : " · no expiry"}
              </small>
            </div>
            <button
              type="button"
              disabled={!canManageFinance || busy === "plan_grant"}
              onClick={() => action({ action: "plan_grant", id: grant.user_id, granted: false, reason: `Revoking comp: ${grant.reason}` }, "plan_grant")}
            >
              Revoke
            </button>
          </article>
        ))}
      </div>
      <Pager paged={grantPage} noun="comped account" onPage={setGrantPage} />
      {!metrics.grants.length && (
        <StatePanel kind="empty" title="No comped accounts">Nobody has Pro from a grant right now.</StatePanel>
      )}
    </section>
  );
}

/** Every money panel in the order the Growth tab used to show them, for a page that wants them all. */
export function FinancePanels() {
  return (
    <>
      <RevenuePanel />
      <SubscriptionMovementPanel />
      <AffiliateProgramPanel />
      <CancellationReasonsPanel />
      <SubscriptionSwitchesPanel />
      <RetentionPanel />
      <CompedAccountsPanel />
    </>
  );
}
