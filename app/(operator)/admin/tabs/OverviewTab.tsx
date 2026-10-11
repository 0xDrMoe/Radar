"use client";
import { useMemo } from "react";
import {
  ArrowRight,
  Check,
  Link2,
  Plus,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { GatedButton } from "../GatedButton";
import DrinkRuleAlerts from "../DrinkRuleAlerts";
import StaffReminders from "../StaffReminders";
import DailyActivityChart from "../DailyActivityChart";
import { PanelHeader, StatePanel } from "../ui";
import { Pager, pageRows } from "../../ListScope";
import { parseSqlTimestamp } from "../../../verification";
import { STALE_AFTER_DAYS, type ReviewQueueItem, type ReviewReason } from "../../../review-queue";
import { useTabState, useWorkspace } from "../workspace";

// The overview is the page staff land on, so it carries only what someone acts on or keeps an eye
// on: one line of catalog counts, the work waiting for them, and the activity charts their role may
// read. Every panel is shown only when the role is allowed its data. The server already sends empty
// arrays and zeros for what a role cannot read (app/api/admin/route.ts), and an empty chart drawn
// anyway would claim "nothing happened" when the truth is "you cannot see this".
//
// Which services are configured (Mapbox, Resend, the email pilot) used to sit here; that is the
// developer's business now and lives in the Developer tab. Market coverage has its own tab.

const DAY_MS = 86_400_000;
/** Rows per page in each review group: three groups share the landing page, so fewer than a full list. */
const GROUP_PAGE_SIZE = 10;

/** The review queue's three groups, in the order the server ranks them, with why each deal is there. */
const REVIEW_GROUPS: { reason: ReviewReason; title: string; why: string }[] = [
  {
    reason: "live_unchecked",
    title: "Live, never checked",
    why: "People can see these now and nobody has compared them with their source yet. The most saved and clicked come first.",
  },
  {
    reason: "live_stale",
    title: "Live, check overdue",
    why: `Last checked more than ${STALE_AFTER_DAYS} days ago, so the site shows them as "Re-checking" instead of "Verified". The most used come first.`,
  },
  {
    reason: "draft",
    title: "Drafts to review",
    why: "Not on the site yet. Drafts in a market Radar covers come first, then those sourced from the restaurant's own website, then the oldest.",
  },
];

function daysSince(value: string | null, now: number): number | null {
  if (!value) return null;
  const time = parseSqlTimestamp(value).getTime();
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / DAY_MS));
}

const plural = (count: number, one: string, many: string) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

/** Why this deal is in the queue, in one sentence, from what the server ranked it on. */
export function reviewItemReason(item: ReviewQueueItem, now: number): string {
  const checked = daysSince(item.lastCheckedAt, now);
  const listed = daysSince(item.createdAt, now);
  if (item.reason === "live_unchecked") {
    return listed === null ? "Live and never checked against its source." : `Live for ${plural(listed, "day", "days")} and never checked against its source.`;
  }
  if (item.reason === "live_stale") {
    return checked === null ? "Live; its last check is more than 30 days old." : `Live; last checked ${plural(checked, "day", "days")} ago.`;
  }
  const where = item.covered ? "Draft in a market Radar covers" : "Draft outside the markets Radar covers";
  const source = item.source === "own" ? "sourced from the restaurant's own website" : item.source === "directory" ? "sourced from a third-party site" : "with no source yet";
  return `${where}, ${source}${listed === null ? "" : `, waiting ${plural(listed, "day", "days")}`}.`;
}

export default function OverviewTab() {
  const {
    data, now, busy, action, openTab, openEditor, setInventoryQuery, permissions, canCreateDeals, canVerifyDeals,
  } = useWorkspace();
  const canWorkDeals = ["create_deals", "publish_deals", "verify_deals"].some((permission) => permissions.has(permission));
  const canViewAnalytics = permissions.has("view_analytics");
  // The same gates the server reads the trends behind; see the trends block in app/api/admin/route.ts.
  const canSeeSignups = permissions.has("manage_users") || canViewAnalytics;
  const quality = data?.dealTotals || null;
  // The queue arrives ranked from the server, across the whole catalog: the loaded deal list stops
  // at 500 rows and carries none of the attention signals the order is built on.
  const [reviewFilter, setReviewFilter] = useTabState<ReviewReason | "all">("overview.reviewFilter", "all");
  // One page number per group. A page emptied by checks falls back to the last page left (pageRows clamps).
  const [reviewPage, setReviewPage] = useTabState<Partial<Record<ReviewReason, number>>>("overview.reviewPage", {});
  const reviewByReason = useMemo(() => {
    const groups: Record<ReviewReason, ReviewQueueItem[]> = { live_unchecked: [], live_stale: [], draft: [] };
    for (const item of data?.reviewQueue?.items ?? []) groups[item.reason].push(item);
    return groups;
  }, [data]);
  const reviewCounts = data?.reviewQueue?.counts ?? { live_unchecked: 0, live_stale: 0, draft: 0 };
  const reviewTotal = reviewCounts.live_unchecked + reviewCounts.live_stale + reviewCounts.draft;

  /**
   * Opens a deal from any list on this page. The deep link (/admin/deals?deal=<id>) is what the
   * Deal inventory reads, and survives a reload or a copied URL. A deal already in the 500 loaded
   * rows opens in the editor straight away; past them, the inventory search, which asks the full
   * table, is pointed at it.
   */
  function openDeal(id: string, title: string) {
    openTab("deals", `?deal=${encodeURIComponent(id)}`);
    const loaded = data?.deals.find((deal) => deal.id === id);
    if (loaded) openEditor(loaded);
    else setInventoryQuery(title);
  }

  // The shell renders its own loading state until the workspace arrives, so a payload without the
  // counts is a failed read, not one still on its way.
  if (!quality) return <StatePanel kind="error" title="The overview could not be read">Reload the page to try again.</StatePanel>;

  // One compact line instead of the old grid of nine cards: the lifecycle counts add up to every
  // deal, and each opens the inventory at that status. "Stale" and "needs verification" moved into
  // the review queue below, which is where somebody acts on them.
  const lifecycle: { label: string; value: number; tab: string; status: string }[] = [
    { label: "Live", value: quality.live, tab: "deals", status: "live" },
    { label: "Drafts", value: quality.draft, tab: canWorkDeals ? "drafts" : "deals", status: "draft" },
    { label: "Scheduled", value: quality.scheduled, tab: "deals", status: "scheduled" },
    { label: "Paused", value: quality.paused, tab: "deals", status: "paused" },
    { label: "Ended", value: quality.expired, tab: "ended", status: "expired" },
    { label: "Archived", value: quality.archived, tab: "ended", status: "archived" },
  ];
  const votes = data.trends?.dealFeedback ?? { helpful: 0, not_helpful: 0 };
  const voteTotal = votes.helpful + votes.not_helpful;
  const visibleGroups = REVIEW_GROUPS.filter((group) => reviewFilter === "all" || group.reason === reviewFilter);

  return (
    <div className="sw-overview">
      <section className="sw-ov-snapshot" aria-labelledby="overview-snapshot-title">
        <h2 id="overview-snapshot-title" className="sr-only">Catalog right now</h2>
        <ul>
          {lifecycle.map((item) => (
            <li key={item.status}>
              <button type="button" onClick={() => openTab(item.tab, `?status=${item.status}`)}>
                <b>{item.value.toLocaleString()}</b> {item.label}
              </button>
            </li>
          ))}
        </ul>
        <p>
          {plural(quality.total, "deal", "deals")} in all.{" "}
          {quality.expiring > 0
            ? `${plural(quality.expiring, "deal ends", "deals end")} in the next 7 days.`
            : "None ends in the next 7 days."}
        </p>
      </section>

      <DrinkRuleAlerts alerts={data.drinkRuleAlerts || []} onOpen={(alert) => openDeal(alert.id, alert.title)} />
      <StaffReminders
        reminders={data.staffReminders || []}
        now={now}
        busy={busy}
        canVerify={canVerifyDeals}
        onOpen={(reminder) => openDeal(reminder.deal_id, reminder.title)}
        onVerify={(dealId) => action({ action: "verify", id: dealId })}
        onResolve={(id) => action({ action: "resolve_staff_reminder", id })}
      />

      {/* The queue is read only for roles that work on deals; anyone else gets nothing from the server, so no empty panel either. */}
      {canWorkDeals && (
        <section className="portal-card quality-actions sw-ov-review" aria-label="Review queue">
          <PanelHeader
            title="Review queue"
            actions={(
              <GatedButton
                className="primary"
                blocked={!canCreateDeals ? "Your role does not include creating or editing deals." : null}
                onClick={() => {
                  openEditor({ status: "draft", category: "Happy hour", emoji: "🍽️", sponsored: 0 });
                  openTab("deals");
                }}
              >
                <Plus /> Add draft
              </GatedButton>
            )}
          >
            Deals to check against their source next, in the order it matters most: live deals people use before
            drafts nobody can see yet. &ldquo;Still right&rdquo; records a check after you have read the source;
            anything that changed is fixed in the deal itself.
          </PanelHeader>
          <div className="review-filters" role="group" aria-label="Show in the review queue">
            {([
              ["all", "Everything", reviewTotal],
              ...REVIEW_GROUPS.map((group) => [group.reason, group.title, reviewCounts[group.reason]] as const),
            ] as const).map(([value, label, count]) => (
              <button key={value} type="button" aria-pressed={reviewFilter === value} onClick={() => setReviewFilter(value)}>
                {label} <b>{count}</b>
              </button>
            ))}
          </div>
          {reviewTotal === 0 ? (
            <StatePanel kind="empty" title="Nothing waiting for review">
              Every live deal was checked in the last {STALE_AFTER_DAYS} days and no draft is waiting. New drafts and
              deals whose check ages past {STALE_AFTER_DAYS} days appear here on their own.
            </StatePanel>
          ) : (
            visibleGroups.map((group) => {
              const items = reviewByReason[group.reason];
              const count = reviewCounts[group.reason];
              const paged = pageRows(items, reviewPage[group.reason] ?? 1, GROUP_PAGE_SIZE);
              return (
                <section key={group.reason} className="sw-ov-group" aria-labelledby={`review-group-${group.reason}`}>
                  <h3 id={`review-group-${group.reason}`}>{group.title} <span>{count}</span></h3>
                  <p>{group.why}</p>
                  {!count ? (
                    <StatePanel kind="empty" title="None right now">Nothing in the queue is in this group.</StatePanel>
                  ) : (
                    <div className="quality-list review-list">
                      {paged.rows.map((item) => {
                        const signals = item.saves || item.clicks
                          ? `${plural(item.saves, "save", "saves")} · ${plural(item.clicks, "click", "clicks")} in 30 days`
                          : "No saves or clicks in 30 days";
                        const sourceLabel = item.source === "own" ? "Restaurant's own site" : item.source === "directory" ? "Third-party source" : "No source";
                        const label = `${item.restaurant}, ${item.title}`;
                        return (
                          <article key={item.id}>
                            <span aria-hidden="true">{item.emoji}</span>
                            <div>
                              <b>{item.restaurant}</b>
                              <small>{item.title}{item.city ? ` · ${item.city}` : ""}</small>
                              <small className="sw-ov-why">{reviewItemReason(item, now)}</small>
                              {item.reason !== "draft" && <small>{signals}</small>}
                              <div className="review-actions">
                                {item.sourceUrl ? (
                                  <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className={`review-source ${item.source}`}>
                                    <Link2 /> {sourceLabel}<span className="sr-only"> (opens in a new tab)</span>
                                  </a>
                                ) : (
                                  <span className="review-source none">{sourceLabel}</span>
                                )}
                                {item.reason !== "draft" && (
                                  <GatedButton
                                    type="button"
                                    blocked={!canVerifyDeals ? "Your role does not include verifying deals." : !item.sourceUrl ? "Add a source URL before this deal can be verified." : null}
                                    disabled={busy === `verify-${item.id}`}
                                    title="You read the source and the deal matches it. Records the check and renews its Verified label for 30 days."
                                    onClick={() => action({ action: "verify", id: item.id })}
                                  >
                                    <Check /> Still right<span className="sr-only">: {label}</span>
                                  </GatedButton>
                                )}
                                <button type="button" onClick={() => openDeal(item.id, item.title)}>
                                  <ArrowRight /> Open<span className="sr-only"> {label}</span>
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  <Pager paged={paged} noun="deal" onPage={(page) => setReviewPage((current) => ({ ...current, [group.reason]: page }))} />
                  {items.length < count && paged.page === paged.pageCount && (
                    <small className="review-note">
                      The {items.length} worth checking first of {count}. Clearing these brings the next ones up.
                    </small>
                  )}
                </section>
              );
            })
          )}
        </section>
      )}

      <section className="portal-card sw-ov-activity" aria-label="Activity in the last 30 days">
        <PanelHeader title="Last 30 days">
          Day-by-day activity, in UTC days. You see the charts your role is allowed to read.
        </PanelHeader>
        <div className="sw-ov-charts">
          <DailyActivityChart
            title="Deals added"
            description="New deals created in the catalog, as drafts or live, by any route."
            rows={data.trends?.deals ?? []}
            now={now}
            unit={["deal", "deals"]}
          />
          {canSeeSignups && (
            <DailyActivityChart
              title="Signups"
              description="New Radar accounts."
              rows={data.trends?.signups ?? []}
              now={now}
              unit={["signup", "signups"]}
            />
          )}
          {canViewAnalytics && (
            <DailyActivityChart
              title="Tracked site activity"
              description="Searches, deal opens, saves, clicks and other events the site records."
              rows={data.trends?.visits ?? []}
              now={now}
              unit={["event", "events"]}
            />
          )}
          <figure className="sw-ov-chart">
            <figcaption>
              <h3>Was this deal helpful?</h3>
              <p>Thumbs up or down from deal pages, all time.</p>
            </figcaption>
            {voteTotal === 0 ? (
              <p className="sw-ov-chart-none">No votes yet.</p>
            ) : (
              <>
                <div className="sw-ov-chart-figures">
                  <b>{Math.round((votes.helpful / voteTotal) * 100)}%</b>
                  <span>found it helpful, from {plural(voteTotal, "vote", "votes")}</span>
                </div>
                {/* Two parts of one whole: a single bar split in proportion, each part named in words. */}
                <div className="sw-ov-votes" aria-hidden="true">
                  <span className="up" style={{ flexGrow: votes.helpful }} />
                  <span className="down" style={{ flexGrow: votes.not_helpful }} />
                </div>
                <p className="sw-ov-votes-legend">
                  <span><ThumbsUp aria-hidden="true" /> {votes.helpful.toLocaleString()} helpful</span>
                  <span><ThumbsDown aria-hidden="true" /> {votes.not_helpful.toLocaleString()} not helpful</span>
                </p>
              </>
            )}
          </figure>
        </div>
        {!canSeeSignups && (
          <small className="review-note">Signups and site activity need the analytics or user-management permission.</small>
        )}
      </section>
    </div>
  );
}
