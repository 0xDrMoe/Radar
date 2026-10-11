"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Copy, Link2, Megaphone, Pencil, Plus, Trash2, X } from "lucide-react";
import RadarMark from "../../RadarMark";
import RadarScan from "../../RadarScan";
import { ListCount, ListEmpty, listCountLabel, ListToolbar, selectRows, ShowAllRow } from "../ListScope";
import TrendChart from "../TrendChart";

const EARNING_STATUS: Record<string, string> = { pending: "Owed", paid: "Paid", void: "Reversed" };

// Amounts arrive as integer minor units in the invoice's own currency, exactly as Stripe
// reported them. Formatting is the only place they are ever divided.
function money(minorUnits: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(minorUnits / 100);
  } catch {
    // An unrecognised currency code must still render a number rather than throwing the page away.
    return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

interface CreatorSubmission {
  id: number;
  restaurant: string;
  deal: string;
  postal: string;
  schedule: string;
  price: string | null;
  description: string | null;
  address: string | null;
  restaurant_website: string | null;
  source: string | null;
  restrictions: string | null;
  starts_at: string | null;
  expires_at: string | null;
  status: string;
  rejection_reason: string | null;
  reference: string | null;
  created_at: string;
  deal_id: string | null;
  deal_status: string | null;
  deal_active: number | null;
  deal_city: string | null;
  views: number;
  offers: number;
}

// A rate with nothing in the denominator is unknown, not zero - an em dash says so, where "0%"
// would tell a creator nobody converted when in fact nobody has arrived yet.
function rate(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

interface CreatorData {
  profile: { handle: string; displayName: string | null; name: string };
  submissions: CreatorSubmission[];
  stats: {
    visits: number;
    visits30: number;
    signups: number;
    paths: Array<{ path: string; hits: number }>;
    linkViews: number;
    linkOffers: number;
    proSignups: number;
    visitTrend: Array<{ day: string; count: number }>;
    audienceDeals: Array<{ deal_id: string; title: string; restaurant: string; city: string; views: number; offers: number }>;
  };
  earnings: {
    rateBps: number;
    byCurrency: Array<{ currency: string; pending: number; paid: number; voided: number; subscriptions: number }>;
    recent: Array<{
      created_at: string;
      currency: string;
      gross_amount: number;
      rate_bps: number;
      commission_amount: number;
      status: string;
      paid_at: string | null;
    }>;
  };
  campaigns: Array<{ campaign: string; visits: number; subscriptions: number; earned: number; currency: string | null }>;
  picks: { max: number; noteMax: number; items: CreatorPick[] };
}

interface CreatorPick {
  deal_id: string;
  note: string | null;
  position: number;
  created_at: string;
  title: string | null;
  restaurant: string | null;
  city: string | null;
  emoji: string | null;
  slug: string | null;
  status: string | null;
  active: number | null;
  deleted_at: string | null;
  /** Whether readers can currently see this pick. Decided by the server, not recomputed here. */
  live: boolean;
}

/** One row of the deal search that backs the picker, in /api/deals's compact shape. */
interface PickCandidate { id: string; slug: string | null; restaurant: string; title: string; city: string; emoji: string | null }

interface ApiErrorBody { error?: { message?: string; fields?: Record<string, string> } | string }

function errorMessage(result: ApiErrorBody, fallback: string) {
  return (typeof result?.error === "object" ? result.error.message : result?.error) || fallback;
}

// What actually happened to a submission, in the words a creator would use — and never more
// certainty than the data supports. "Approved" and "Live" are different facts: staff can accept a
// submission days before the deal it produced is finished and published, and saying "Live" for
// both would have creators looking for a page that is not there yet.
function outcome(s: CreatorSubmission): { label: string; tone: "good" | "bad" | "warn" | "pending" } {
  if (s.status === "withdrawn") return { label: "Withdrawn", tone: "warn" };
  if (s.status === "rejected") return { label: "Not accepted", tone: "bad" };
  if (s.status === "approved") {
    if (s.deal_id && s.deal_active) return { label: "Live on Radar", tone: "good" };
    if (s.deal_id) return { label: "Accepted — not live yet", tone: "warn" };
    return { label: "Accepted", tone: "good" };
  }
  return { label: "Awaiting review", tone: "pending" };
}

const BLANK: Partial<CreatorSubmission> = { restaurant: "", deal: "", postal: "", schedule: "", source: "" };

export default function CreatorWorkspaceClient() {
  const [data, setData] = useState<CreatorData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [fieldErrors, setFieldErrors] = useState<Record<string, string>>({}),
    [editor, setEditor] = useState<Partial<CreatorSubmission> | null>(null),
    [copied, setCopied] = useState(false),
    [campaignLabel, setCampaignLabel] = useState(""),
    [campaignCopied, setCampaignCopied] = useState(false),
    [query, setQuery] = useState(""),
    [showAll, setShowAll] = useState(false),
    [pickQuery, setPickQuery] = useState(""),
    [pickResults, setPickResults] = useState<PickCandidate[] | null>(null),
    [pickSearching, setPickSearching] = useState(false),
    // Which pick's note is open for editing, and what is in the box. One at a time: a list where
    // every row is a live text field is a list where it is never clear what has been saved.
    [noteFor, setNoteFor] = useState<string | null>(null),
    [noteDraft, setNoteDraft] = useState(""),
    [origin, setOrigin] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/creator");
      const result = await response.json() as CreatorData & ApiErrorBody;
      if (!response.ok) throw new Error(errorMessage(result, "The creator workspace is unavailable."));
      setData(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The creator workspace is unavailable.");
    }
  }
  useEffect(() => {
    // Data fetch on mount: setState happens after the awaited fetch resolves, not synchronously
    // in the effect body — a standard, legitimate data-loading effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    setOrigin(location.origin);
  }, []);

  async function send(payload: Record<string, unknown>, success: string) {
    setBusy(true);
    setNotice("");
    setFieldErrors({});
    try {
      const response = await fetch("/api/creator", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as ApiErrorBody;
      if (!response.ok) {
        if (typeof result?.error === "object" && result.error.fields) setFieldErrors(result.error.fields);
        throw new Error(errorMessage(result, "That change could not be saved."));
      }
      await load();
      setNotice(success);
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "That change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  // The picker searches the public catalog rather than a creator-only endpoint, because the
  // set a creator can pick from is exactly the set a reader can see. One search, one definition
  // of what is on the site, and nothing to keep in step.
  async function searchDeals(term: string) {
    const q = term.trim();
    if (!q) { setPickResults(null); return; }
    setPickSearching(true);
    try {
      const response = await fetch(`/api/deals?view=compact&limit=8&q=${encodeURIComponent(q)}`);
      const body = await response.json() as { results?: PickCandidate[] };
      setPickResults(body.results || []);
    } catch {
      setPickResults([]);
    } finally {
      setPickSearching(false);
    }
  }

  async function addPick(dealId: string) {
    if (await send({ action: "save_pick", dealId }, "Added to your picks.")) {
      setPickResults(null);
      setPickQuery("");
    }
  }

  // Sent as the whole order rather than a swap, so the list cannot end up half-reordered by a
  // request that did not arrive. See reorder_picks in app/api/creator/route.ts.
  async function movePick(dealId: string, direction: -1 | 1) {
    const items = data?.picks.items || [];
    const from = items.findIndex((pick) => pick.deal_id === dealId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= items.length) return;
    const order = items.map((pick) => pick.deal_id);
    [order[from], order[to]] = [order[to], order[from]];
    await send({ action: "reorder_picks", dealIds: order }, "Order saved.");
  }

  const link = data && origin ? `${origin}/?c=${data.profile.handle}` : "";
  // Normalized as you type rather than validated on submit, so the box always shows the label
  // that will actually be recorded — the tracker only accepts this shape, and a link built from
  // "Happy Hour!" that silently records nothing is worse than one that shows you "happy-hour".
  const campaignSlug = campaignLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  const campaignLink = link && campaignSlug ? `${link}&camp=${campaignSlug}` : link;
  const submissionList = useMemo(
    () => selectRows(data?.submissions || [], (s) => `${s.restaurant} ${s.deal} ${s.postal} ${s.status} ${s.reference || ""}`, { query, showAll }),
    [data?.submissions, query, showAll],
  );

  if (error) return <div className="portal-loading portal-error"><Megaphone /><h1>Workspace took a detour.</h1><p>{error}</p><button onClick={load}>Try again</button><Link prefetch={false} href="/dashboard">Back to dashboard</Link></div>;
  if (!data) return <div className="portal-loading"><div className="portal-loading-body"><RadarScan /><p>Opening the creator workspace…</p></div></div>;

  return (
    <main className="portal">
      <aside>
        <Link prefetch={false} className="brand" href="/"><RadarMark />Radar<i>.</i></Link>
        <div className="workspace-label">CREATOR WORKSPACE</div>
        <Link prefetch={false} className="backlink" href="/dashboard">← Personal dashboard</Link>
      </aside>
      <section className="portal-main">
        <header>
          <div>
            <span className="kicker">YOUR WORK</span>
            <h1>{data.profile.displayName || data.profile.name}</h1>
            <p>Submit deals for the Radar team to review, and see what your link is bringing in.</p>
          </div>
        </header>
        {notice && <div className="admin-notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}

        <section className="portal-card">
          <div className="portal-card-head">
            <div><span className="kicker">YOUR LINK</span><h2>Share this anywhere</h2></div>
          </div>
          <div className="creator-link">
            <code>{link || "…"}</code>
            <button
              type="button"
              disabled={!link}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch { setNotice("Copying failed — select the link and copy it manually."); }
              }}
            >
              {copied ? <><Check /> Copied</> : <><Copy /> Copy</>}
            </button>
          </div>
          {/* Repeated here, beside the link itself, because this is where it gets copied into a post. */}
          <p className="list-count-line">Every post that shares this link has to say you are a paid Radar partner, for example &ldquo;#ad&rdquo; or &ldquo;Paid partner of Radar&rdquo;, where people see it before they tap. See the <Link prefetch={false} href="/en/for-creators">creator terms</Link>.</p>
          <div className="creator-stats">
            <div><b>{data.stats.visits.toLocaleString()}</b><small>Visits, all time</small></div>
            <div><b>{data.stats.visits30.toLocaleString()}</b><small>Visits, last 30 days</small></div>
            <div>
              <b>{data.stats.signups.toLocaleString()}</b>
              <small>Accounts created</small>
              {data.stats.visits > 0 && <em>{rate(data.stats.signups, data.stats.visits)} of visits</em>}
            </div>
            <div>
              <b>{data.stats.proSignups.toLocaleString()}</b>
              <small>Now on Radar Pro</small>
              {/* The number the share is actually a share of. Signups move day to day and are
                  the encouraging figure; this is the one that pays. */}
              {data.stats.signups > 0 && <em>{rate(data.stats.proSignups, data.stats.signups)} of accounts</em>}
            </div>
            <div><b>{data.stats.linkViews.toLocaleString()}</b><small>Deals opened</small></div>
            <div>
              <b>{data.stats.linkOffers.toLocaleString()}</b>
              <small>Went to the restaurant</small>
              {/* The rate is the point of the pair, and it is the number worth arguing about in a
                  payout conversation — so it is spelled out rather than left to be worked out. */}
              {data.stats.linkViews > 0 && <em>{Math.round((data.stats.linkOffers / data.stats.linkViews) * 100)}% of opened deals</em>}
            </div>
          </div>
          {/* Where the link put people, taken straight from the recorded visit path. */}
          {data.stats.paths.length > 0 && (
            <div className="inventory-table creator-paths">
              {data.stats.paths.map((p) => (
                <article key={p.path}><div><Link2 /> <b>{p.path}</b></div><div><b>{p.hits.toLocaleString()}</b><small>visits</small></div></article>
              ))}
            </div>
          )}
          {/* A total says the link works. The shape says which post did it and how long a video
              keeps sending people, which is the part worth acting on when deciding what to make
              next - a spike that decays in two days and one that holds for three weeks are very
              different results behind the same number. */}
          {data.stats.visitTrend.length > 0 && (
            <div className="trend-charts">
              <TrendChart label="Visits" rows={data.stats.visitTrend} />
            </div>
          )}
          {!data.stats.visits && <p className="list-count-line">No visits through your link yet. Accounts are only counted when someone signs up after following it.</p>}
        </section>

        {/* A creator's taste, which is the thing their audience actually follows them for and the
            one thing every other panel here measures rather than captures. A pick shows up twice:
            as a rail on the home page for anyone who arrives through their link, and as a byline
            on the deal's own page for everybody. */}
        <section className="portal-card">
          <div className="portal-card-head">
            <div>
              <span className="kicker">YOUR PICKS</span>
              <h2>Deals you stand behind</h2>
              <p>
                These show up as &ldquo;Picks by {data.profile.displayName || data.profile.name}&rdquo; for anyone who opens Radar through your link, and your name appears on the deal&apos;s own page.
                The line you write is the reason someone taps it &mdash; say what you would say in a video, not what the listing already says.
              </p>
            </div>
            <span className="status on">{data.picks.items.length} of {data.picks.max}</span>
          </div>

          {data.picks.items.length > 0 && (
            <div className="inventory-table creator-picks-admin">
              {data.picks.items.map((pick, index) => (
                <article key={pick.deal_id} className={pick.live ? "" : "inactive"}>
                  <div>
                    <b>{pick.emoji || "\u{1F37D}\u{FE0F}"} {pick.restaurant || pick.deal_id}</b>
                    <small>{pick.title || "No longer listed"}{pick.city ? ` \u00b7 ${pick.city}` : ""}</small>
                    {/* The creator's own line, shown as it will read on the site rather than in a
                        text box, so what is on screen is what readers get. */}
                    {noteFor === pick.deal_id ? (
                      <span className="pick-note-editor">
                        <textarea
                          rows={2}
                          maxLength={data.picks.noteMax}
                          value={noteDraft}
                          placeholder="Why this one?"
                          onChange={(event) => setNoteDraft(event.target.value.slice(0, data.picks.noteMax))}
                        />
                        <em>{data.picks.noteMax - noteDraft.length} left</em>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={async () => { if (await send({ action: "save_pick", dealId: pick.deal_id, note: noteDraft }, "Note saved.")) setNoteFor(null); }}
                        >
                          Save
                        </button>
                        <button onClick={() => setNoteFor(null)}>Cancel</button>
                      </span>
                    ) : (
                      <span className="pick-note">
                        {pick.note ? <q>{pick.note}</q> : <em>No line yet</em>}
                        <button
                          className="linklike"
                          onClick={() => { setNoteFor(pick.deal_id); setNoteDraft(pick.note || ""); }}
                        >
                          <Pencil /> {pick.note ? "Edit" : "Add a line"}
                        </button>
                      </span>
                    )}
                    {/* Said plainly rather than by quietly dropping the row: a creator whose pick
                        was pulled needs to know it is not on the site any more. */}
                    {!pick.live && <small className="pick-offline">Not showing &mdash; this deal is no longer listed on Radar.</small>}
                  </div>
                  <div className="pick-actions">
                    <button aria-label="Move up" disabled={index === 0 || busy} onClick={() => movePick(pick.deal_id, -1)}>&uarr;</button>
                    <button aria-label="Move down" disabled={index === data.picks.items.length - 1 || busy} onClick={() => movePick(pick.deal_id, 1)}>&darr;</button>
                    <button aria-label="Remove pick" disabled={busy} onClick={() => send({ action: "remove_pick", dealId: pick.deal_id }, "Removed from your picks.")}><Trash2 /></button>
                  </div>
                </article>
              ))}
            </div>
          )}

          {data.picks.items.length >= data.picks.max ? (
            <p className="list-count-line">That is all {data.picks.max}. Remove one to feature something else &mdash; a list that holds everything recommends nothing.</p>
          ) : (
            <div className="pick-search">
              <label className="filter-search">
                <input
                  value={pickQuery}
                  onChange={(event) => setPickQuery(event.target.value)}
                  onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); searchDeals(pickQuery); } }}
                  placeholder="Search live deals by restaurant, dish or city"
                  aria-label="Search live deals to feature"
                />
              </label>
              <button disabled={!pickQuery.trim() || pickSearching} onClick={() => searchDeals(pickQuery)}>
                {pickSearching ? "Searching\u2026" : "Search"}
              </button>
            </div>
          )}

          {pickResults && (
            pickResults.length ? (
              <div className="inventory-table">
                {pickResults.map((candidate) => {
                  const already = data.picks.items.some((pick) => pick.deal_id === candidate.id);
                  return (
                    <article key={candidate.id}>
                      <div>
                        <b>{candidate.emoji || "\u{1F37D}\u{FE0F}"} {candidate.restaurant}</b>
                        <small>{candidate.title} &middot; {candidate.city}</small>
                      </div>
                      <div>
                        <button disabled={already || busy} onClick={() => addPick(candidate.id)}>
                          {already ? <><Check /> Featured</> : <><Plus /> Feature</>}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="list-count-line">Nothing live matched that. Only deals currently on the site can be featured.</p>
            )
          )}

          {!data.picks.items.length && !pickResults && (
            <p className="list-count-line">Nothing featured yet. Search above, or feature one of the deals your audience already opened.</p>
          )}
        </section>

        {/* What their audience opened once it arrived - any deal, not only the ones they sent in.
            This is the editorial signal: it says which food their followers actually came for,
            which is a better basis for what to post next than a guess. */}
        {data.stats.audienceDeals.length > 0 && (
          <section className="portal-card">
            <div className="portal-card-head">
              <div>
                <span className="kicker">YOUR AUDIENCE</span>
                <h2>What they opened</h2>
                <p>Deals people opened after following your link, ranked by how often. &ldquo;Went to the restaurant&rdquo; means they left Radar for the restaurant&apos;s own page, which is the closest thing we record to someone actually going to claim it.</p>
              </div>
            </div>
            <div className="inventory-table creator-audience-table">
              {data.stats.audienceDeals.map((deal) => (
                <article key={deal.deal_id}>
                  <div>
                    <b>{deal.title}</b>
                    <small>{deal.restaurant} &middot; {deal.city}</small>
                  </div>
                  <div>
                    <b>{deal.views.toLocaleString()}</b>
                    <small>opened</small>
                  </div>
                  <div>
                    <b>{deal.offers.toLocaleString()}</b>
                    <small>went to the restaurant</small>
                  </div>
                  {/* The shortest path from "my audience liked this" to "I am putting my name on
                      it". The evidence and the action in one row, rather than making somebody
                      copy a restaurant name into the search box two panels up. */}
                  <div>
                    <button
                      disabled={busy || data.picks.items.some((pick) => pick.deal_id === deal.deal_id) || data.picks.items.length >= data.picks.max}
                      onClick={() => addPick(deal.deal_id)}
                    >
                      {data.picks.items.some((pick) => pick.deal_id === deal.deal_id) ? <><Check /> Featured</> : <><Plus /> Feature</>}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        {/* One link per post, so "which video worked" has an answer. The label is part of the
            URL rather than something registered up front — nothing has to be created here before
            a link can be used, and a label first seen on a real visit simply starts appearing. */}
        <section className="portal-card">
          <div className="portal-card-head">
            <div><span className="kicker">LINK PER POST</span><h2>Track a single video</h2></div>
          </div>
          <label className="typed-confirmation campaign-builder">
            Label for this post
            <input
              value={campaignLabel}
              onChange={(event) => { setCampaignLabel(event.target.value); setCampaignCopied(false); }}
              placeholder="happy hour video"
              autoComplete="off"
              spellCheck={false}
              maxLength={60}
            />
            <small>Use a different label per post. Letters, numbers and hyphens; anything else becomes a hyphen.</small>
          </label>
          <div className="creator-link">
            <code>{campaignLink || "…"}</code>
            <button
              type="button"
              disabled={!campaignLink}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(campaignLink);
                  setCampaignCopied(true);
                  setTimeout(() => setCampaignCopied(false), 2000);
                } catch { setNotice("Copying failed — select the link and copy it manually."); }
              }}
            >
              {campaignCopied ? <><Check /> Copied</> : <><Copy /> Copy</>}
            </button>
          </div>
          {data.campaigns.length > 0 && (
            <div className="inventory-table creator-campaign-table">
              {data.campaigns.map((row) => (
                <article key={row.campaign}>
                  <div><b>{row.campaign}</b><small>label</small></div>
                  <div><b>{row.visits.toLocaleString()}</b><small>visits</small></div>
                  <div>
                    <b>{row.subscriptions.toLocaleString()}</b>
                    <small>{row.earned && row.currency ? `${money(row.earned, row.currency)} earned` : "subscriptions"}</small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="portal-card">
          <div className="portal-card-head">
            <div>
              <span className="kicker">EARNINGS</span>
              <h2>Radar Pro</h2>
            </div>
            <span className="creator-rate">{(data.earnings.rateBps / 100).toFixed(data.earnings.rateBps % 100 ? 2 : 0)}% of every payment</span>
          </div>
          {/* Grouped by currency rather than summed. Radar Pro is quoted in several, and one
              total across them would be a number with no meaning behind it. */}
          {data.earnings.byCurrency.length > 0 ? (
            <div className="creator-stats">
              {data.earnings.byCurrency.map((row) => (
                <div key={row.currency}>
                  <b>{money(row.pending, row.currency)}</b>
                  <small>Owed, {row.currency.toUpperCase()}</small>
                  <em>{money(row.paid, row.currency)} paid out · {row.subscriptions.toLocaleString()} invoices</em>
                </div>
              ))}
            </div>
          ) : (
            <p className="list-count-line">Nothing yet. Earnings appear here when someone subscribes to Radar Pro through your link, and again every time they renew.</p>
          )}
          {data.earnings.recent.length > 0 && (
            <div className="inventory-table creator-earnings-table">
              {data.earnings.recent.map((row, index) => (
                <article key={`${row.created_at}-${index}`}>
                  <div>
                    <b>{money(row.commission_amount, row.currency)}</b>
                    <small>{row.created_at.slice(0, 10)} · your share of {money(row.gross_amount, row.currency)}</small>
                  </div>
                  <div><b>{(row.rate_bps / 100).toFixed(row.rate_bps % 100 ? 2 : 0)}%</b><small>rate</small></div>
                  <div><b>{EARNING_STATUS[row.status] || row.status}</b><small>{row.paid_at ? `paid ${row.paid_at.slice(0, 10)}` : " "}</small></div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="portal-card">
          <div className="portal-card-head">
            <div><span className="kicker">SUBMISSIONS</span><h2>Deals you have sent in</h2></div>
            <button onClick={() => { setFieldErrors({}); setEditor({ ...BLANK }); }}><Plus /> New submission</button>
          </div>
          <ListToolbar query={query} onQuery={setQuery} placeholder="Search by restaurant, deal, area, or reference" label="Search submissions" />
          <ListCount>{listCountLabel(submissionList, data.submissions.length, "submission", showAll)}</ListCount>
          <div className="inventory-table creator-submission-table">
            {submissionList.visible.map((s) => {
              const state = outcome(s);
              return (
                <article key={s.id}>
                  <div>
                    <b>{s.deal}</b>
                    <small>{s.restaurant} · {s.postal}{s.reference ? ` · ${s.reference}` : ""}</small>
                  </div>
                  <div><b>{s.price || "—"}</b><small>{s.schedule}</small></div>
                  <div className="submission-activity">
                    {s.deal_id
                      ? <><b>{s.views.toLocaleString()}</b><small>opened · {s.offers.toLocaleString()} went to the restaurant</small></>
                      : <small>Not published yet</small>}
                  </div>
                  <div>
                    <span className={`status ${state.tone === "good" ? "on" : ""}`}>{state.label}</span>
                    {s.status === "rejected" && s.rejection_reason && <small>{s.rejection_reason}</small>}
                    {s.deal_id && s.deal_active ? <small><Link prefetch={false} href={`/deals/${s.deal_id}`}>View on Radar</Link></small> : null}
                  </div>
                  <div className="row-actions">
                    {s.status === "pending" ? (
                      <>
                        <button onClick={() => { setFieldErrors({}); setEditor(s); }}><Pencil /> Edit</button>
                        <button disabled={busy} onClick={() => send({ action: "withdraw_submission", id: s.id }, "Submission withdrawn.")}><Trash2 /> Withdraw</button>
                      </>
                    ) : (
                      <small>Reviewed</small>
                    )}
                  </div>
                </article>
              );
            })}
            {!submissionList.visible.length && (
              <ListEmpty>{data.submissions.length ? "No submission matches that search." : "Nothing submitted yet. Send in your first deal and the Radar team will review it."}</ListEmpty>
            )}
          </div>
          <ShowAllRow selection={submissionList} total={data.submissions.length} noun="submission" showAll={showAll} onShowAll={() => setShowAll(true)} />
        </section>
      </section>

      {editor && (
        // Backdrop click-to-dismiss is a mouse-only convenience; the close button below remains
        // the fully keyboard-accessible way to dismiss this dialog.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="overlay" onMouseDown={() => setEditor(null)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="creator-submission-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="close" aria-label="Close" onClick={() => setEditor(null)}><X /></button>
            <span className="kicker">{editor.id ? "EDIT SUBMISSION" : "NEW SUBMISSION"}</span>
            <h2 id="creator-submission-title">{editor.id ? editor.deal : "Send a deal in for review"}</h2>
            <form
              className="preferences"
              onSubmit={async (event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                const text = (key: string) => String(values.get(key) || "");
                if (await send({
                  action: "save_submission",
                  id: editor.id,
                  restaurant: text("restaurant"),
                  deal: text("deal"),
                  postal: text("postal"),
                  schedule: text("schedule"),
                  price: text("price"),
                  description: text("description"),
                  address: text("address"),
                  restaurantWebsite: text("restaurantWebsite"),
                  source: text("source"),
                  restrictions: text("restrictions"),
                  expiresAt: text("expiresAt") || null,
                }, editor.id ? "Submission updated." : "Submission sent for review.")) setEditor(null);
              }}
            >
              <label>Restaurant<input name="restaurant" defaultValue={editor.restaurant || ""} required />{fieldErrors.restaurant && <small className="field-error">{fieldErrors.restaurant}</small>}</label>
              <label>The deal<input name="deal" defaultValue={editor.deal || ""} required placeholder="Half-price wings" />{fieldErrors.deal && <small className="field-error">{fieldErrors.deal}</small>}</label>
              <label>Postal or ZIP<input name="postal" defaultValue={editor.postal || ""} required />{fieldErrors.postal && <small className="field-error">{fieldErrors.postal}</small>}</label>
              <label>When it runs<input name="schedule" defaultValue={editor.schedule || ""} required placeholder="Tuesdays, 4–7pm" />{fieldErrors.schedule && <small className="field-error">{fieldErrors.schedule}</small>}</label>
              <label>Price or savings<input name="price" defaultValue={editor.price || ""} placeholder="$12" /></label>
              <label>Address<input name="address" defaultValue={editor.address || ""} /></label>
              <label className="wide">
                Proof link
                <input name="source" type="url" defaultValue={editor.source || ""} required placeholder="https://restaurant.example/menu" />
                <small>The restaurant’s own page showing this offer. A reviewer checks it before anything is published.</small>
                {fieldErrors.source && <small className="field-error">{fieldErrors.source}</small>}
              </label>
              <label>Restaurant website<input name="restaurantWebsite" type="url" defaultValue={editor.restaurant_website || ""} /></label>
              <label>Ends on<input name="expiresAt" type="date" defaultValue={(editor.expires_at || "").slice(0, 10)} />{fieldErrors.expiresAt && <small className="field-error">{fieldErrors.expiresAt}</small>}</label>
              <label className="wide">Description<textarea name="description" defaultValue={editor.description || ""} /></label>
              <label className="wide">Restrictions<textarea name="restrictions" defaultValue={editor.restrictions || ""} placeholder="Dine-in only, one per table…" /></label>
              <button className="primary" disabled={busy}>{editor.id ? "Save changes" : "Send for review"}</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
