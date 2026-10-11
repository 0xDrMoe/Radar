"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Banknote, Check, Copy, CreditCard, ExternalLink, HelpCircle, LayoutDashboard,
  Link2, Megaphone, ReceiptText, Send, Smartphone, Users, Wallet,
} from "lucide-react";
import RadarMark from "../../RadarMark";
import RadarScan from "../../RadarScan";
import { ListCount, listCountLabel, ListEmpty, ListToolbar, selectRows, ShowAllRow } from "../ListScope";
import TrendChart from "../TrendChart";

// The affiliate portal: one client component behind seven real routes.
//
// One component because every section reads the same GET /api/affiliate payload, and seven
// routes because these are pages people bookmark, link each other to, and come back to from
// Stripe — `/affiliate/settings?connect=done` is a URL Stripe itself redirects to, so it has to
// exist as a URL. The section is a prop from the route's own page.tsx rather than component
// state, which is what keeps the two in step.
//
// NOTHING HERE DECIDES ANYTHING ABOUT MONEY. Every figure on screen was computed by the server
// from the ledger, every payout blocker arrived as a code the server worked out, and the only
// value this file ever sends about a payout is which currency to pay out in. There is no amount
// field, no balance arithmetic, and no "mark as paid" — a payout exists when Stripe has moved
// money, and this component can only ask for one.

export type AffiliateSection = "dashboard" | "link" | "referrals" | "earnings" | "payouts" | "settings" | "help";

// Amounts arrive as integer minor units in the currency the subscription was billed in, exactly
// as Stripe reported them. Formatting is the only place they are ever divided.
function money(minorUnits: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

/** A basis-point rate as a percentage, without a trailing ".00" on a whole number. */
function percent(bps: number) {
  return `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
}

function day(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

interface Balance {
  currency: string;
  pending: number;
  approved: number;
  inPayout: number;
  paid: number;
  reversed: number;
  available: number;
  lifetime: number;
  minimum: number;
  blocker: string | null;
}

interface LedgerRow {
  id: number;
  created_at: string;
  currency: string;
  gross_amount: number;
  rate_bps: number;
  commission_amount: number;
  status: string;
  campaign: string | null;
  approved_at: string | null;
  paid_at: string | null;
  payout_id: number | null;
}

interface PayoutRow {
  id: number;
  amount: number;
  currency: string;
  status: string;
  commission_count: number;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
  stripe_transfer_id: string | null;
}

interface CampaignRow { campaign: string; visits: number; subscriptions: number; earned: number; currency: string | null }

interface AffiliateData {
  affiliate: {
    handle: string;
    displayName: string | null;
    status: string;
    rateBps: number;
    yearlyRateBps: number;
    joinedAt: string;
    referralUrl: string;
  } | null;
  application?: { id: number; status: string; requested_handle: string; rejection_reason: string | null; created_at: string; reviewed_at: string | null } | null;
  site?: string;
  connect?: { accountId: string | null; payoutsEnabled: boolean; requirementsDue: number; available: boolean };
  stats?: { clicks: number; signups: number; conversions: number; conversionRate: number | null };
  balances?: Balance[];
  payouts?: PayoutRow[];
  ledger?: LedgerRow[];
  campaigns?: CampaignRow[];
  daily?: Array<{ day: string; count: number }>;
  program: { holdDays: number; minimums: Record<string, number>; defaultRateBps: number; defaultYearlyRateBps: number };
}

interface ApiErrorBody { error?: { message?: string } | string }

function errorMessage(result: ApiErrorBody, fallback: string) {
  return (typeof result?.error === "object" ? result.error?.message : result?.error) || fallback;
}

// Why a payout cannot be requested, in the words the affiliate needs — and always the one thing
// to do next, never a list of everything that is not true yet. The server decides which blocker
// applies; this only spells it out.
function blockerText(balance: Balance, connectAvailable: boolean) {
  if (!connectAvailable) return "Payouts are not switched on yet. Your earnings keep accruing in the meantime.";
  switch (balance.blocker) {
    case "no_connect_account": return "Set up your payout account to collect this.";
    case "connect_incomplete": return "Stripe still needs a few details before it can pay you.";
    case "payout_in_flight": return "A payout is already on its way.";
    case "nothing_available": return "Nothing has cleared the holding period yet.";
    case "below_minimum": return `${money(balance.minimum, balance.currency)} is the smallest payout — keep going.`;
    default: return "";
  }
}

const COMMISSION_LABEL: Record<string, string> = {
  pending: "Holding",
  approved: "Ready",
  paid: "Paid",
  void: "Reversed",
  rejected: "Declined",
};

const PAYOUT_LABEL: Record<string, string> = {
  pending: "Starting",
  processing: "On its way",
  paid: "Paid",
  failed: "Failed",
  canceled: "Canceled",
};

// Statuses that mean the money is fine, so the pill can be green. Everything else reads as the
// default, which is the muted tone — a reversal is not an error to shout about, but it is not a
// success either.
const GOOD_STATUSES = new Set(["approved", "paid", "processing"]);

// Where Stripe will ask for a bank account. Kept to the countries Stripe Connect Express
// supports and the API's own allow-list accepts — an affiliate picking anything else would get
// Stripe's error rather than an answer.
const COUNTRIES: Array<[string, string]> = [
  ["CA", "Canada"], ["US", "United States"], ["GB", "United Kingdom"], ["IE", "Ireland"],
  ["AU", "Australia"], ["NZ", "New Zealand"], ["FR", "France"], ["DE", "Germany"],
  ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"], ["BE", "Belgium"],
  ["AT", "Austria"], ["PT", "Portugal"], ["SE", "Sweden"], ["DK", "Denmark"],
  ["NO", "Norway"], ["FI", "Finland"], ["CH", "Switzerland"], ["PL", "Poland"], ["MX", "Mexico"],
];

const NAV: Array<{ section: AffiliateSection; href: string; label: string; icon: React.ReactNode }> = [
  { section: "dashboard", href: "/affiliate", label: "Dashboard", icon: <LayoutDashboard /> },
  { section: "link", href: "/affiliate/link", label: "Your link", icon: <Link2 /> },
  { section: "referrals", href: "/affiliate/referrals", label: "Referrals", icon: <Users /> },
  { section: "earnings", href: "/affiliate/earnings", label: "Earnings", icon: <ReceiptText /> },
  { section: "payouts", href: "/affiliate/payouts", label: "Payouts", icon: <Banknote /> },
  { section: "settings", href: "/affiliate/settings", label: "Payout settings", icon: <CreditCard /> },
  { section: "help", href: "/affiliate/help", label: "How it works", icon: <HelpCircle /> },
];

function StatusPill({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <span className={`status${GOOD_STATUSES.has(status) ? " on" : ""}`}>{labels[status] || status}</span>;
}

/**
 * The one thing an affiliate can do that quietly costs them money.
 *
 * A referral who installs the iPhone app and subscribes there pays Apple, not Radar. No Stripe
 * invoice exists, so no commission is recorded — not as a policy, but because there is no payment
 * for a share to be a share of. An affiliate telling people to "get it on the App Store" is
 * working for nothing without any error to warn them, which is why this sits on the dashboard and
 * beside the link rather than only in the help page nobody opens.
 *
 * Written as an ordinary note rather than a warning banner: it is how the thing works, not
 * something going wrong.
 */
function AppStoreNote({ where }: { where: "dashboard" | "link" }) {
  return (
    <p className="affiliate-note">
      <Smartphone />
      <span>
        <b>Subscriptions bought inside the iPhone app do not earn commission.</b> Apple takes those
        payments, so Radar never sees one to share.{" "}
        {where === "link"
          ? "Your link already points at the website — just avoid sending people to the App Store to subscribe."
          : "Send referrals to the website to subscribe; the app signs in with the same account afterwards."}
      </span>
    </p>
  );
}

/** A link and a button that copies it. Used for the plain referral link and campaign links. */
function CopyLink({ value, onFail }: { value: string; onFail: (message: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="creator-link">
      <code>{value || "…"}</code>
      <button
        type="button"
        disabled={!value}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch { onFail("Copying failed — select the link and copy it manually."); }
        }}
      >
        {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
      </button>
    </div>
  );
}

export default function AffiliatePortalClient({ section }: { section: AffiliateSection }) {
  const [data, setData] = useState<AffiliateData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [country, setCountry] = useState("CA"),
    [campaignLabel, setCampaignLabel] = useState(""),
    [ledgerQuery, setLedgerQuery] = useState(""),
    [showAllLedger, setShowAllLedger] = useState(false);

  async function load() {
    try {
      const response = await fetch("/api/affiliate");
      const result = await response.json() as AffiliateData & ApiErrorBody;
      if (!response.ok) throw new Error(errorMessage(result, "The affiliate portal is unavailable."));
      setData(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The affiliate portal is unavailable.");
    }
  }

  /** POST one action, then re-read everything. Returns the body so callers can follow a link. */
  async function send(payload: Record<string, unknown>, success: string, options: { silent?: boolean } = {}) {
    setBusy(true);
    if (!options.silent) setNotice("");
    try {
      const response = await fetch("/api/affiliate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json() as ApiErrorBody & { url?: string; amount?: number; currency?: string };
      if (!response.ok) throw new Error(errorMessage(result, "That could not be done right now."));
      await load();
      if (success) setNotice(success);
      return result;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "That could not be done right now.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    // Data fetch on mount: setState happens after the awaited fetch resolves, not synchronously
    // in the effect body — a standard, legitimate data-loading effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // Stripe sends the affiliate back here when onboarding ends. `done` is not a promise that
    // anything was completed — someone can close the form halfway and still be returned — so it
    // re-reads the account from Stripe rather than assuming, and reports what Stripe actually
    // said. The query string is dropped first so a refresh does not re-run it.
    const connect = new URLSearchParams(window.location.search).get("connect");
    if (connect === "done" || connect === "refresh") {
      history.replaceState(null, "", window.location.pathname);
      send({ action: "connect_sync" }, "", { silent: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stripe's hosted onboarding, in this tab. The link is single-use and expires in minutes, so it
  // is minted at the moment of the click and followed immediately rather than rendered as an
  // anchor somebody might open tomorrow.
  async function openStripe(action: "connect_start" | "connect_dashboard") {
    const result = await send(action === "connect_start" ? { action, country } : { action }, "");
    if (result?.url) window.location.href = result.url;
  }

  const affiliate = data?.affiliate || null;
  const connect = data?.connect;
  const balances = data?.balances || [];
  const ledger = useMemo(() => data?.ledger || [], [data?.ledger]);
  const payouts = data?.payouts || [];
  const campaigns = data?.campaigns || [];
  // Empty unless the portal is being served from its own subdomain, where a link to the rest of
  // Radar has to name the host. Empty means every link below is relative, which is what makes the
  // same component work on radar.cheap and on localhost.
  const site = (data?.site || "").replace(/\/+$/, "");

  // Normalized as you type rather than validated on submit, so the box always shows the label
  // that will actually be recorded — the tracker only accepts this shape, and a link built from
  // "Spring Push!" that silently records nothing is worse than one that shows you "spring-push".
  const campaignSlug = campaignLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const referralUrl = affiliate?.referralUrl || "";
  const campaignUrl = referralUrl && campaignSlug ? `${referralUrl}&camp=${campaignSlug}` : referralUrl;

  const ledgerSelection = useMemo(
    () => selectRows(
      ledger,
      (row) => `${row.currency} ${row.status} ${row.campaign || ""} ${row.created_at}`,
      { query: ledgerQuery, showAll: showAllLedger },
    ),
    [ledger, ledgerQuery, showAllLedger],
  );

  if (error) {
    return (
      <div className="portal-loading portal-error">
        <Megaphone />
        <h1>The portal took a detour.</h1>
        <p>{error}</p>
        <button onClick={load}>Try again</button>
        <a href={`${site}/dashboard`}>Back to Radar</a>
      </div>
    );
  }
  if (!data) {
    return <div className="portal-loading"><div className="portal-loading-body"><RadarScan /><p>Opening the affiliate portal…</p></div></div>;
  }

  // Signed in, but not an affiliate. Three different situations behind one shell — never applied,
  // waiting on a decision, or turned down — and each gets its own answer rather than a generic
  // "no access" the reader has to interpret.
  if (!affiliate) {
    const application = data.application;
    return (
      <main className="portal affiliate-portal">
        <aside>
          <a className="brand" href={site}><RadarMark />Radar<i>.</i></a>
          <div className="workspace-label">AFFILIATE PROGRAM</div>
          <a className="backlink" href={`${site}/dashboard`}>← Back to Radar</a>
        </aside>
        <section className="portal-main">
          <header>
            <div>
              <span className="kicker">AFFILIATE PROGRAM</span>
              <h1>Earn on every subscription you send</h1>
              <p>Share Radar, and take a cut of what the people you bring in pay for Radar Pro.</p>
            </div>
          </header>
          <section className="portal-card affiliate-invite">
            {application?.status === "pending" ? (
              <>
                <h2>Your application is with us</h2>
                <p>
                  You applied on {day(application.created_at)} asking for <code>{application.requested_handle}</code>.
                  We read every one by hand, so it takes a few days. Nothing else is needed from you.
                </p>
              </>
            ) : application?.status === "rejected" ? (
              <>
                <h2>We could not take this one on</h2>
                <p>{application.rejection_reason || "Your application was not accepted this time."}</p>
                <p>You are welcome to apply again once your channel has grown.</p>
                <a className="primary" href={`${site}/for-creators`}>Apply again <ExternalLink /></a>
              </>
            ) : (
              <>
                <h2>You are not in the program yet</h2>
                <p>
                  Affiliates get a link, {percent(data.program.defaultRateBps)} of what the people they refer pay for
                  Radar Pro monthly and {percent(data.program.defaultYearlyRateBps)} of what they pay yearly, and payouts
                  straight to their own bank through Stripe. Commissions clear after {data.program.holdDays} days.
                  Subscriptions bought inside the iPhone app do not earn a commission — referrals need to subscribe on
                  the website.
                </p>
                <a className="primary" href={`${site}/for-creators`}>Apply to join <ExternalLink /></a>
              </>
            )}
          </section>
        </section>
      </main>
    );
  }

  const stats = data.stats || { clicks: 0, signups: 0, conversions: 0, conversionRate: null };
  const connectAvailable = Boolean(connect?.available);
  const needsConnect = connectAvailable && !connect?.accountId;
  const connectIncomplete = connectAvailable && Boolean(connect?.accountId) && (!connect?.payoutsEnabled || (connect?.requirementsDue || 0) > 0);
  const nothingYet = stats.clicks === 0 && ledger.length === 0;

  const balanceCards = (
    <div className="affiliate-balances">
      {balances.length === 0 ? (
        <article className="affiliate-balance empty">
          <span className="kicker">AVAILABLE</span>
          <b>{money(0, "cad")}</b>
          <small>Nothing earned yet. Your first commission appears here the day a referral pays for Radar Pro.</small>
        </article>
      ) : balances.map((balance) => (
        <article key={balance.currency} className="affiliate-balance">
          <span className="kicker">AVAILABLE — {balance.currency.toUpperCase()}</span>
          <b>{money(balance.available, balance.currency)}</b>
          <dl>
            <div><dt>Holding</dt><dd>{money(balance.pending, balance.currency)}</dd></div>
            {balance.inPayout > 0 && <div><dt>In a payout</dt><dd>{money(balance.inPayout, balance.currency)}</dd></div>}
            <div><dt>Paid out</dt><dd>{money(balance.paid, balance.currency)}</dd></div>
            {balance.reversed > 0 && <div><dt>Reversed</dt><dd>{money(balance.reversed, balance.currency)}</dd></div>}
          </dl>
          {balance.blocker ? (
            <p className="affiliate-blocker">{blockerText(balance, connectAvailable)}</p>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm(`Send ${money(balance.available, balance.currency)} to your bank account through Stripe?`)) return;
                await send({ action: "request_payout", currency: balance.currency }, "Payout started. Stripe takes it from here.");
              }}
            >
              <Send /> Request {money(balance.available, balance.currency)}
            </button>
          )}
        </article>
      ))}
    </div>
  );

  return (
    <main className="portal affiliate-portal">
      <aside>
        <a className="brand" href={site}><RadarMark />Radar<i>.</i></a>
        <div className="workspace-label">AFFILIATE PORTAL</div>
        <nav>
          {NAV.map((item) => (
            <Link prefetch={false} key={item.section} href={item.href} className={item.section === section ? "active" : undefined}>
              {item.icon}{item.label}
            </Link>
          ))}
        </nav>
        <a className="backlink" href={`${site}/dashboard`}>← Personal dashboard</a>
        {affiliate.status === "active" && <a className="backlink" href={`${site}/creator`}>Creator workspace</a>}
      </aside>

      <section className="portal-main">
        <header>
          <div>
            <span className="kicker">{affiliate.handle.toUpperCase()}</span>
            <h1>{NAV.find((item) => item.section === section)?.label}</h1>
            <p>
              {affiliate.displayName || affiliate.handle} · {percent(affiliate.rateBps)} monthly · {percent(affiliate.yearlyRateBps)} yearly
              {affiliate.status !== "active" && " · account paused"}
            </p>
          </div>
        </header>

        {notice && <div className="admin-notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}

        {affiliate.status !== "active" && (
          <div className="affiliate-banner warn">
            This affiliate account is paused, so no new commissions are being recorded and payouts are on hold.
            Anything already earned stays yours.
          </div>
        )}

        {/* One banner, on every page, until the thing that stops money arriving is dealt with. It
            sits above the section rather than only on Settings because the affiliate will be
            looking at their balance, not at their payout setup, when they wonder why. */}
        {(needsConnect || connectIncomplete) && section !== "settings" && (
          <div className="affiliate-banner">
            {needsConnect
              ? "You have not set up a payout account yet, so nothing can be sent to you."
              : "Stripe needs a few more details before it can pay you."}
            <Link prefetch={false} href="/affiliate/settings">Finish setup →</Link>
          </div>
        )}

        {section === "dashboard" && (
          <>
            <div className="portal-stats affiliate-stats">
              <article><Link2 /><div><b>{stats.clicks.toLocaleString()}</b><span>Link clicks</span></div></article>
              <article><Users /><div><b>{stats.signups.toLocaleString()}</b><span>Accounts created</span></div></article>
              <article><Wallet /><div><b>{stats.conversions.toLocaleString()}</b><span>On Radar Pro</span></div></article>
              <article>
                <ReceiptText />
                <div>
                  {/* A rate with nothing in the denominator is unknown, not zero — an em dash says
                      so, where "0%" would tell an affiliate nobody converted when in fact nobody
                      has arrived yet. */}
                  <b>{stats.conversionRate === null ? "—" : `${stats.conversionRate.toFixed(1)}%`}</b>
                  <span>Clicks to subscribers</span>
                </div>
              </article>
            </div>

            {balanceCards}

            <AppStoreNote where="dashboard" />

            {nothingYet ? (
              <section className="portal-card affiliate-first-steps">
                <div className="portal-card-head"><div><span className="kicker">GETTING STARTED</span><h2>Three things, then you are done</h2></div></div>
                <ol>
                  <li><b>Copy your link.</b> It is on <Link prefetch={false} href="/affiliate/link">Your link</Link>, and it works anywhere you can put a URL.</li>
                  <li><b>Set up payouts.</b> Stripe collects your bank details, not Radar — <Link prefetch={false} href="/affiliate/settings">start that here</Link>.</li>
                  <li><b>Share it.</b> Anyone who signs up after following your link is yours for as long as they keep paying.</li>
                </ol>
              </section>
            ) : (
              <>
                {(data.daily || []).length > 0 && (
                  <section className="portal-card">
                    <div className="portal-card-head"><div><span className="kicker">LAST 30 DAYS</span><h2>Clicks on your link</h2></div></div>
                    <div className="trend-charts"><TrendChart label="Clicks" rows={data.daily || []} /></div>
                  </section>
                )}
                <section className="portal-card">
                  <div className="portal-card-head">
                    <div><span className="kicker">RECENT</span><h2>Latest commissions</h2></div>
                    <Link prefetch={false} href="/affiliate/earnings">All earnings →</Link>
                  </div>
                  {ledger.length === 0 ? (
                    <ListEmpty>No commissions yet. One is recorded each time a referral is billed for Radar Pro.</ListEmpty>
                  ) : (
                    <div className="inventory-table affiliate-ledger-table">
                      <div className="table-head"><div>When</div><div>Commission</div><div>Rate</div><div>Status</div></div>
                      {ledger.slice(0, 5).map((row) => (
                        <article key={row.id}>
                          <div><b>{day(row.created_at)}</b><small>{row.campaign || "No campaign"}</small></div>
                          <div><b>{money(row.commission_amount, row.currency)}</b><small>of {money(row.gross_amount, row.currency)}</small></div>
                          <div><b>{percent(row.rate_bps)}</b></div>
                          <div><StatusPill status={row.status} labels={COMMISSION_LABEL} /></div>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}

        {section === "link" && (
          <>
            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">YOUR LINK</span><h2>Share this anywhere</h2></div></div>
              <CopyLink value={referralUrl} onFail={setNotice} />
              <AppStoreNote where="link" />
              <p className="list-count-line">
                Anyone who creates a Radar account after following this link is attributed to you, once, permanently.
                Attribution is written at sign-up and never rewritten, so a later click on someone else&rsquo;s link cannot take them from you —
                and yours cannot take someone who was already here.
              </p>
            </section>

            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">CAMPAIGNS</span><h2>Label a link to see what worked</h2></div></div>
              <div className="campaign-builder">
                <label className="workspace-field">
                  <span>Campaign label</span>
                  <input
                    value={campaignLabel}
                    onChange={(event) => setCampaignLabel(event.target.value)}
                    placeholder="spring video, newsletter, pinned post…"
                    maxLength={60}
                  />
                </label>
              </div>
              <CopyLink value={campaignUrl} onFail={setNotice} />
              <p className="list-count-line">
                Optional. The label rides along with the click and shows up on your Referrals page, so two posts
                in the same week can be told apart. It changes nothing about what you earn.
              </p>
            </section>
          </>
        )}

        {section === "referrals" && (
          <>
            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">THE FUNNEL</span><h2>What your link is doing</h2></div></div>
              <div className="affiliate-funnel">
                <div><b>{stats.clicks.toLocaleString()}</b><span>Clicked your link</span></div>
                <div>
                  <b>{stats.signups.toLocaleString()}</b>
                  <span>Created an account</span>
                  {stats.clicks > 0 && <em>{Math.round((stats.signups / stats.clicks) * 100)}% of clicks</em>}
                </div>
                <div>
                  <b>{stats.conversions.toLocaleString()}</b>
                  <span>Paying for Radar Pro</span>
                  {stats.signups > 0 && <em>{Math.round((stats.conversions / stats.signups) * 100)}% of accounts</em>}
                </div>
              </div>
              {/* Said plainly rather than left for someone to notice. An affiliate asking "who
                  signed up?" deserves the reason they cannot be told, not an empty table. */}
              <p className="list-count-line">
                Radar does not tell you who these people are. You are owed a commission, not a subscriber list —
                the names and email addresses of people who sign up stay theirs.
              </p>
            </section>

            {(data.daily || []).length > 0 && (
              <section className="portal-card">
                <div className="portal-card-head"><div><span className="kicker">LAST 30 DAYS</span><h2>Clicks, day by day</h2></div></div>
                <div className="trend-charts"><TrendChart label="Clicks" rows={data.daily || []} /></div>
                <p className="list-count-line">
                  A total says the link works. The shape says which post did it and how long it kept sending people,
                  which is the part worth acting on when deciding what to make next.
                </p>
              </section>
            )}

            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">BY CAMPAIGN</span><h2>Which label brought them</h2></div></div>
              {campaigns.length === 0 ? (
                <ListEmpty>
                  No campaign labels used yet. Add one to any link on <Link prefetch={false} href="/affiliate/link">Your link</Link> and
                  the clicks it brings will be listed here.
                </ListEmpty>
              ) : (
                <div className="inventory-table creator-campaign-table">
                  <div className="table-head"><div>Campaign</div><div>Clicks</div><div>Subscriptions</div></div>
                  {campaigns.map((row) => (
                    <article key={row.campaign}>
                      <div><b>{row.campaign}</b></div>
                      <div><b>{Number(row.visits).toLocaleString()}</b></div>
                      <div>
                        <b>{Number(row.subscriptions).toLocaleString()}</b>
                        {Number(row.earned) > 0 && <small>{money(Number(row.earned), row.currency || "cad")} earned</small>}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {section === "earnings" && (
          <>
            {balanceCards}
            <section className="portal-card">
              <div className="portal-card-head">
                <div><span className="kicker">LEDGER</span><h2>Every commission</h2></div>
                <span className="creator-rate">{percent(affiliate.rateBps)} monthly · {percent(affiliate.yearlyRateBps)} yearly</span>
              </div>
              {ledger.length === 0 ? (
                <ListEmpty>
                  Nothing here yet. A row is written each time someone you referred is billed for Radar Pro —
                  including every renewal, for as long as they stay.
                </ListEmpty>
              ) : (
                <>
                  <ListToolbar
                    query={ledgerQuery}
                    onQuery={setLedgerQuery}
                    placeholder="Search by status, campaign or date"
                    label="Search commissions"
                  />
                  <div className="inventory-table affiliate-ledger-table">
                    <div className="table-head"><div>When</div><div>Commission</div><div>Rate</div><div>Status</div></div>
                    {ledgerSelection.visible.map((row) => (
                      <article key={row.id}>
                        <div><b>{day(row.created_at)}</b><small>{row.campaign || "No campaign"}</small></div>
                        <div><b>{money(row.commission_amount, row.currency)}</b><small>of {money(row.gross_amount, row.currency)}</small></div>
                        <div>
                          <b>{percent(row.rate_bps)}</b>
                          <small>{row.rate_bps < affiliate.rateBps ? "yearly" : "monthly"}</small>
                        </div>
                        <div className="status-stack">
                          <StatusPill status={row.status} labels={COMMISSION_LABEL} />
                          <small>
                            {row.status === "paid" ? `Paid ${day(row.paid_at)}`
                              : row.status === "approved" ? (row.payout_id ? "In a payout" : "Ready to pay out")
                              : row.status === "pending" ? `Clears ${data.program.holdDays} days after billing`
                              : row.status === "void" ? "Refunded or charged back"
                              : "Declined by Radar"}
                          </small>
                        </div>
                      </article>
                    ))}
                  </div>
                  <ListCount>{listCountLabel(ledgerSelection, ledger.length, "commission", showAllLedger)}</ListCount>
                  <ShowAllRow
                    selection={ledgerSelection}
                    total={ledger.length}
                    noun="commission"
                    showAll={showAllLedger}
                    onShowAll={() => setShowAllLedger(true)}
                  />
                </>
              )}
            </section>
          </>
        )}

        {section === "payouts" && (
          <>
            {balanceCards}
            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">HISTORY</span><h2>Money sent to you</h2></div></div>
              {payouts.length === 0 ? (
                <ListEmpty>
                  No payouts yet. When a balance clears the holding period and passes the minimum, you can send it
                  to your bank from here.
                </ListEmpty>
              ) : (
                <div className="inventory-table affiliate-payout-table">
                  <div className="table-head"><div>Requested</div><div>Amount</div><div>Covers</div><div>Status</div></div>
                  {payouts.map((row) => (
                    <article key={row.id}>
                      <div><b>{day(row.created_at)}</b>{row.stripe_transfer_id && <small>{row.stripe_transfer_id}</small>}</div>
                      <div><b>{money(row.amount, row.currency)}</b></div>
                      <div><b>{row.commission_count}</b><small>commission{row.commission_count === 1 ? "" : "s"}</small></div>
                      <div className="status-stack">
                        <StatusPill status={row.status} labels={PAYOUT_LABEL} />
                        <small>
                          {row.status === "paid" ? `Arrived ${day(row.paid_at)}`
                            : row.status === "failed" ? (row.failure_reason || "Stripe could not complete it")
                            : row.status === "canceled" ? "Returned to your balance"
                            : "With Stripe"}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <p className="list-count-line">
                Radar sends the money to your Stripe account; Stripe pays it into your bank on its own schedule,
                usually within a few business days. A failed payout puts every commission in it straight back into
                your available balance — nothing is lost.
              </p>
            </section>
          </>
        )}

        {section === "settings" && (
          <>
            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">PAYOUT ACCOUNT</span><h2>Where your money goes</h2></div></div>
              {!connectAvailable ? (
                <p>
                  Payouts are not switched on yet. Your commissions are still being recorded and nothing expires —
                  you will be able to set this up before the first payout is due.
                </p>
              ) : !connect?.accountId ? (
                <>
                  <p>
                    Radar pays affiliates through Stripe. Stripe collects your identity and bank details directly and
                    holds them — Radar never sees or stores an account number.
                  </p>
                  <label className="workspace-field">
                    <span>Country of your bank account</span>
                    <select value={country} onChange={(event) => setCountry(event.target.value)}>
                      {COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                    </select>
                  </label>
                  <p className="list-count-line">This cannot be changed later, so pick the country your bank account is actually in.</p>
                  <button type="button" className="primary" disabled={busy} onClick={() => openStripe("connect_start")}>
                    <CreditCard /> Set up payouts with Stripe
                  </button>
                </>
              ) : (
                <>
                  <div className="affiliate-connect-state">
                    <StatusPill status={connect.payoutsEnabled && !connect.requirementsDue ? "paid" : "pending"} labels={{ paid: "Ready", pending: "Not finished" }} />
                    <p>
                      {connect.payoutsEnabled && !connect.requirementsDue
                        ? "Stripe is happy to pay this account."
                        : connect.requirementsDue
                          ? `Stripe still wants ${connect.requirementsDue} more detail${connect.requirementsDue === 1 ? "" : "s"} before it will release money.`
                          : "Stripe has not enabled payouts on this account yet."}
                    </p>
                  </div>
                  <div className="affiliate-actions">
                    {(!connect.payoutsEnabled || connect.requirementsDue > 0) && (
                      <button type="button" className="primary" disabled={busy} onClick={() => openStripe("connect_start")}>
                        <CreditCard /> Finish setup with Stripe
                      </button>
                    )}
                    <button type="button" disabled={busy} onClick={() => openStripe("connect_dashboard")}>
                      <ExternalLink /> Manage bank details
                    </button>
                    <button type="button" disabled={busy} onClick={() => send({ action: "connect_sync" }, "Checked with Stripe.")}>
                      Re-check with Stripe
                    </button>
                  </div>
                  <p className="list-count-line">
                    Your bank details live at Stripe and are changed there. Radar stores only the account&rsquo;s id.
                  </p>
                </>
              )}
            </section>

            <section className="portal-card">
              <div className="portal-card-head"><div><span className="kicker">YOUR ACCOUNT</span><h2>Program details</h2></div></div>
              <dl className="affiliate-facts">
                <div><dt>Handle</dt><dd><code>{affiliate.handle}</code></dd></div>
                <div><dt>Monthly plan</dt><dd>{percent(affiliate.rateBps)} of every payment</dd></div>
                <div><dt>Yearly plan</dt><dd>{percent(affiliate.yearlyRateBps)} of every payment</dd></div>
                <div><dt>Status</dt><dd>{affiliate.status === "active" ? "Active" : "Paused"}</dd></div>
                <div><dt>Joined</dt><dd>{day(affiliate.joinedAt)}</dd></div>
                <div><dt>Holding period</dt><dd>{data.program.holdDays} days</dd></div>
                <div>
                  <dt>Minimum payout</dt>
                  <dd>{Object.entries(data.program.minimums).map(([code, amount]) => money(amount, code)).join(" · ")}</dd>
                </div>
              </dl>
              <p className="list-count-line">
                Your handle and rate are set by Radar. If either needs to change, email{" "}
                <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a>.
              </p>
            </section>
          </>
        )}

        {section === "help" && (
          <section className="portal-card affiliate-help">
            <div className="portal-card-head"><div><span className="kicker">HOW IT WORKS</span><h2>The whole thing, in order</h2></div></div>
            <h3>What counts</h3>
            <p>
              Someone follows your link, creates a Radar account, and later pays for Radar Pro on the website.
              You earn a share of what they pay — not once, but on every payment they make for as long as they
              stay subscribed.
            </p>
            <p>
              The share depends on which plan they choose. On <b>monthly</b> you earn {percent(affiliate.rateBps)} —
              about a dollar out of every five. On <b>yearly</b> you earn {percent(affiliate.yearlyRateBps)} — about
              five dollars out of every fifty. Yearly is the smaller share of a bigger number: one yearly sale is
              worth roughly five months of monthly commission, and it lands the day it happens instead of arriving
              a month at a time.
            </p>
            <h3>App Store purchases do not count</h3>
            <p>
              If someone subscribes inside the Radar iPhone app, Apple takes the payment and Radar never sees a
              card — so there is no payment for a commission to be a share of, and none is recorded. This is not
              a rule Radar chose; it is how Apple&rsquo;s in-app purchases work.
            </p>
            <p>
              It matters more than it sounds, because a referral who installs the app and subscribes there earns
              you nothing even though they came from your link. <b>Send people to the website to subscribe.</b>
              Your link already goes there, so the thing to avoid is telling people to &ldquo;get it on the App
              Store&rdquo; instead. Once they have subscribed on the web, the app signs in with the same account
              and works exactly the same.
            </p>
            <h3>How you get credited</h3>
            <p>
              Attribution is written when the account is created and never rewritten. Someone who signed up through
              your link stays yours even if they later click somebody else&rsquo;s; someone who already had an account
              before clicking your link is not attributed to anyone. Referring yourself does not count.
            </p>
            <h3>When it clears</h3>
            <p>
              A commission is recorded the moment the payment succeeds, and sits in <b>Holding</b> for
              {" "}{data.program.holdDays} days. That window is for refunds and chargebacks: if the payment comes back,
              the commission is reversed instead of being paid out. After it, the commission becomes <b>Ready</b>.
            </p>
            <h3>Getting paid</h3>
            <p>
              Once your ready balance passes the minimum
              {" "}({Object.entries(data.program.minimums).map(([code, amount]) => money(amount, code)).join(" · ")}),
              request a payout and Radar transfers it to your Stripe account. Stripe pays it into your bank.
              Balances are kept per currency and never added together, because there is no exchange rate anyone agreed to.
            </p>
            <h3>If something goes wrong</h3>
            <p>
              A failed transfer returns every commission it covered to your available balance. A reversed payment
              reverses only that commission. Nothing that has already been paid to you is ever clawed back from a
              future payout without being shown here first.
            </p>
            <h3>Questions</h3>
            {/* The company mailbox, not an address at radar.cheap: that domain publishes no MX
                record, so anything sent to it bounces. Same address as every other contact line. */}
            <p>Email <a href="mailto:support@cedartechsolutions.ca">support@cedartechsolutions.ca</a> and a person will answer.</p>
          </section>
        )}
      </section>
    </main>
  );
}
