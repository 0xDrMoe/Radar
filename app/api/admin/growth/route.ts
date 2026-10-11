import { env } from "cloudflare:workers";
import { hasPermission, type AppUser } from "../../../auth";
import { apiError, readJson } from "../../../api-utils";
import { requireStaff, writeAudit } from "../../../admin-guard";
import { publicDealPredicate } from "../../../deal-lifecycle";
import { isSearchVerdict, searchSignals } from "../../../search-signals";

// The Growth section's date-ranged figures, read when the section is opened rather than with the
// whole workspace.
//
// Everything here takes a range of 7, 30 or 90 days. Carrying all three in GET /api/admin would
// triple the reads every staff page load pays for, for a section only analytics readers open; so
// the main payload keeps the few all-time counts other sections share, and this route answers the
// rest on demand, one part at a time:
//
//   ?part=overview  engagement trends, most-saved deals, deal performance, quiet inventory,
//                   visits and launch signals
//   ?part=search    search demand, filtered by market and to zero-result terms, with the
//                   abuse signals (app/search-signals.ts) and any verdict staff recorded
//
// Cost: the Worker has a tight per-request CPU allowance. Every figure is aggregated in SQL,
// every list has a LIMIT, and every date filter sits on an indexed column (product_events
// (type,created_at); pageviews_daily's day-leading key; favorites and email_leads by
// drizzle/0074). The Worker only shapes a few hundred rows.
//
// Who: view_analytics, the grant the Growth section answers to (sections.ts canOpenTab). Every
// figure here is an anonymous count - no row names a person - so nothing is split further.
//
// POST records a member of staff's verdict on a search term the page flagged as possible abuse
// (search_term_flags, drizzle/0071). Same grant: looking at the search list and deciding what a
// term is belongs to whoever reads it. Audited like every other workspace write.

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];

/** Rows per list. The client searches and filters within these; past them, narrow the range. */
const DEAL_ROWS = 300;
const QUIET_ROWS = 300;
const TERM_ROWS = 100;

const canReadGrowth = (user: AppUser) => hasPermission(user, "view_analytics");

function parseRange(value: string | null): Range {
  const n = Number(value);
  return (RANGES as readonly number[]).includes(n) ? (n as Range) : 30;
}

export async function GET(request: Request) {
  const guard = await requireStaff(request, { allow: canReadGrowth });
  if (guard.response) return guard.response;
  const params = new URL(request.url).searchParams;
  const range = parseRange(params.get("range"));
  const part = params.get("part") || "overview";
  if (part === "overview") return Response.json({ range, ...(await readOverview(range)) });
  if (part === "search") {
    const market = (params.get("market") || "").trim().slice(0, 80);
    const zeroOnly = params.get("zero") === "1";
    return Response.json({ range, market, zeroOnly, ...(await readSearch(range, market, zeroOnly)) });
  }
  return apiError(400, "UNKNOWN_PART", "Ask for part=overview or part=search.");
}

/** SQLite modifiers for "the last N days" and "the N days before that", bound rather than spliced. */
function windows(range: Range) {
  return { current: `-${range} days`, previous: `-${range * 2} days` };
}

async function readOverview(range: Range) {
  const { current, previous } = windows(range);
  // pageviews_daily is keyed by UTC date, so "the last 7 days" is today and the six before it.
  const viewSince = `-${range - 1} days`;
  const [
    dealDaily,
    savesDaily,
    searchDaily,
    totals,
    mostSaved,
    deals,
    quiet,
    visitDaily,
    visitSources,
    visitCountries,
    leadSources,
    leadDaily,
    leadAreas,
    pilotWaitlist,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT date(created_at) day,
              COALESCE(SUM(json_extract(properties,'$.kind')='view'),0) views,
              COALESCE(SUM(json_extract(properties,'$.kind')='offer'),0) offers
         FROM product_events WHERE type='deal_click' AND created_at>=datetime('now',?)
        GROUP BY day ORDER BY day`,
    ).bind(current).all<{ day: string; views: number; offers: number }>(),
    env.DB.prepare(
      "SELECT date(created_at) day,COUNT(*) count FROM favorites WHERE created_at>=datetime('now',?) GROUP BY day ORDER BY day",
    ).bind(current).all<{ day: string; count: number }>(),
    env.DB.prepare(
      `SELECT date(created_at) day,COUNT(*) count FROM product_events
        WHERE type='search' AND created_at>=datetime('now',?) GROUP BY day ORDER BY day`,
    ).bind(current).all<{ day: string; count: number }>(),
    // This range against the one before it, so a trend reads as "up" or "down" and not only as a
    // shape. One statement: each subquery is an indexed range read.
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM favorites WHERE created_at>=datetime('now',?)) saves,
        (SELECT COUNT(*) FROM favorites WHERE created_at>=datetime('now',?) AND created_at<datetime('now',?)) saves_prev,
        (SELECT COUNT(*) FROM product_events WHERE type='deal_click' AND created_at>=datetime('now',?) AND json_extract(properties,'$.kind')='view') views,
        (SELECT COUNT(*) FROM product_events WHERE type='deal_click' AND created_at>=datetime('now',?) AND created_at<datetime('now',?) AND json_extract(properties,'$.kind')='view') views_prev,
        (SELECT COUNT(*) FROM product_events WHERE type='deal_click' AND created_at>=datetime('now',?) AND json_extract(properties,'$.kind')='offer') offers,
        (SELECT COUNT(*) FROM product_events WHERE type='deal_click' AND created_at>=datetime('now',?) AND created_at<datetime('now',?) AND json_extract(properties,'$.kind')='offer') offers_prev,
        (SELECT COUNT(*) FROM product_events WHERE type='search' AND created_at>=datetime('now',?)) searches,
        (SELECT COUNT(*) FROM product_events WHERE type='search' AND created_at>=datetime('now',?) AND created_at<datetime('now',?)) searches_prev,
        (SELECT COUNT(DISTINCT entity_id) FROM product_events WHERE type='deal_click' AND created_at>=datetime('now',?)) deals_touched`,
    ).bind(current, previous, current, current, previous, current, current, previous, current, current, previous, current, current)
      .first<GrowthTotals>(),
    // Most-saved, ranked by saves inside the range and then all-time, with the range before it
    // beside each so a deal losing its audience shows. Joined to the branch for the place: a
    // brand-wide or national offer has no single city and is never shown as having one.
    env.DB.prepare(
      `SELECT f.deal_id,d.title,d.restaurant,d.city,d.status,d.location_scope,l.region,COALESCE(l.country,r.country) country,
              COUNT(*) saves,
              COALESCE(SUM(f.created_at>=datetime('now',?)),0) saves_range,
              COALESCE(SUM(f.created_at>=datetime('now',?) AND f.created_at<datetime('now',?)),0) saves_prev
         FROM favorites f JOIN deals d ON d.id=f.deal_id AND d.deleted_at IS NULL
         LEFT JOIN restaurants r ON r.id=d.restaurant_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
        GROUP BY f.deal_id ORDER BY saves_range DESC,saves DESC LIMIT 15`,
    ).bind(current, previous, current).all<MostSavedRow>(),
    // Views and offers per deal in the range. Kept apart because together they are a
    // click-through rate; summed into one "clicks" number, the useful half disappears. Joined to
    // deals so a click on something since deleted drops out rather than showing as a nameless row.
    env.DB.prepare(
      `SELECT pe.entity_id deal_id,d.title,d.restaurant,d.city,d.status,d.location_scope,
              COALESCE(SUM(json_extract(pe.properties,'$.kind')='view'),0) views,
              COALESCE(SUM(json_extract(pe.properties,'$.kind')='offer'),0) offers
         FROM product_events pe JOIN deals d ON d.id=pe.entity_id AND d.deleted_at IS NULL
        WHERE pe.type='deal_click' AND pe.created_at>=datetime('now',?)
        GROUP BY pe.entity_id ORDER BY views DESC,offers DESC LIMIT ${DEAL_ROWS}`,
    ).bind(current).all<DealPerformanceRow>(),
    // Quiet inventory: deals the public can see (publicDealPredicate, the site's own rule) that
    // nobody opened in the range. Oldest first - a deal up for months with no views says more than
    // one added yesterday. last_opened says whether it was ever opened at all. Both subqueries use
    // the (entity_id,type) index, one deal at a time, over a catalog of a few hundred live deals.
    env.DB.prepare(
      `SELECT d.id,d.title,d.restaurant,d.city,d.location_scope,d.verification_status,d.created_at,l.region,COALESCE(l.country,r.country) country,
              (SELECT MAX(pe.created_at) FROM product_events pe WHERE pe.entity_id=d.id AND pe.type='deal_click') last_opened
         FROM deals d LEFT JOIN restaurants r ON r.id=d.restaurant_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
        WHERE ${publicDealPredicate}
          AND NOT EXISTS (SELECT 1 FROM product_events pe WHERE pe.entity_id=d.id AND pe.type='deal_click' AND pe.created_at>=datetime('now',?))
        ORDER BY d.created_at LIMIT ${QUIET_ROWS}`,
    ).bind(current).all<QuietRow>(),
    // Page views by day and kind, so the client can leave out the home page and other
    // non-content pages without asking again. At most 90 days x 5 kinds rows.
    env.DB.prepare(
      "SELECT day,kind,SUM(views) views FROM pageviews_daily WHERE day>=date('now',?) GROUP BY day,kind ORDER BY day",
    ).bind(viewSince).all<{ day: string; kind: string; views: number }>(),
    env.DB.prepare(
      "SELECT kind,source label,SUM(views) views FROM pageviews_daily WHERE day>=date('now',?) GROUP BY kind,source ORDER BY views DESC LIMIT 100",
    ).bind(viewSince).all<{ kind: string; label: string; views: number }>(),
    env.DB.prepare(
      "SELECT kind,country label,SUM(views) views FROM pageviews_daily WHERE day>=date('now',?) GROUP BY kind,country ORDER BY views DESC LIMIT 200",
    ).bind(viewSince).all<{ kind: string; label: string; views: number }>(),
    // Launch signals. email_leads is two lists (app/api/email/capture): `homepage` - a visitor
    // with no account asking to hear about deals near a postal code - and `ios-waitlist` - anyone
    // asking to be told when the iPhone app ships. A lead "converted" once an account exists with
    // the same address; leads never link to a user id, so it is a same-email match.
    env.DB.prepare(
      `SELECT source,COUNT(*) total,
              COALESCE(SUM(confirmed_at IS NOT NULL),0) confirmed,
              COALESCE(SUM(created_at>=datetime('now',?)),0) in_range,
              COALESCE(SUM(EXISTS(SELECT 1 FROM users u WHERE u.email=l.email)),0) converted
         FROM email_leads l GROUP BY source ORDER BY total DESC LIMIT 10`,
    ).bind(current).all<LeadSourceRow>(),
    env.DB.prepare(
      "SELECT date(created_at) day,source,COUNT(*) count FROM email_leads WHERE created_at>=datetime('now',?) GROUP BY day,source ORDER BY day",
    ).bind(current).all<{ day: string; source: string; count: number }>(),
    // Where homepage leads are asking from: the first three characters of the postal code they
    // left (a Canadian FSA, or a US ZIP's sectional center). Demand in places Radar may not cover.
    env.DB.prepare(
      `SELECT substr(postal,1,3) area,COUNT(*) count FROM email_leads
        WHERE source='homepage' AND postal IS NOT NULL AND postal<>''
        GROUP BY area ORDER BY count DESC LIMIT 12`,
    ).all<{ area: string; count: number }>(),
    // Signed-in accounts waiting for a place in the deal-alert pilot (email_consents). Counted
    // here so launch demand is read in one place; the people themselves are on the Mailing list
    // tab, for whoever runs it. Only an account whose latest consent row says waitlisted counts.
    env.DB.prepare(
      `SELECT COUNT(*) waiting FROM email_consents c
        WHERE c.status='waitlisted' AND c.id=(SELECT id FROM email_consents WHERE user_id=c.user_id ORDER BY id DESC LIMIT 1)`,
    ).first<{ waiting: number }>(),
  ]);

  return {
    totals: totals || EMPTY_TOTALS,
    trends: {
      saves: savesDaily.results || [],
      views: (dealDaily.results || []).map(({ day, views }) => ({ day, count: views })),
      offers: (dealDaily.results || []).map(({ day, offers }) => ({ day, count: offers })),
      searches: searchDaily.results || [],
    },
    mostSaved: mostSaved.results || [],
    deals: deals.results || [],
    quiet: quiet.results || [],
    visits: {
      daily: visitDaily.results || [],
      sources: visitSources.results || [],
      countries: visitCountries.results || [],
    },
    leads: {
      sources: leadSources.results || [],
      daily: leadDaily.results || [],
      areas: leadAreas.results || [],
      pilotWaitlist: pilotWaitlist?.waiting || 0,
    },
  };
}

async function readSearch(range: Range, market: string, zeroOnly: boolean) {
  const { current } = windows(range);
  // One filter, written once and bound in the same order everywhere it is used.
  const where = `type='search' AND created_at>=datetime('now',?)${market ? " AND market=?" : ""}`;
  const binds = market ? [current, market] : [current];
  const [totals, terms, peaks, markets] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) total,
              COALESCE(SUM(json_extract(properties,'$.matches')=0),0) misses,
              COUNT(DISTINCT json_extract(properties,'$.term')) distinct_terms
         FROM product_events WHERE ${where}`,
    ).bind(...binds).first<{ total: number; misses: number; distinct_terms: number }>(),
    // Unanswered searches are the sourcing list: each is somebody asking for food the catalog does
    // not carry. Zero-result only keeps the terms that came back empty at least once, most-missed
    // first.
    env.DB.prepare(
      `SELECT json_extract(properties,'$.term') term,COUNT(*) searches,
              COALESCE(SUM(json_extract(properties,'$.matches')=0),0) misses,
              MAX(created_at) last_seen
         FROM product_events WHERE ${where} AND json_extract(properties,'$.term') IS NOT NULL
        GROUP BY term ${zeroOnly ? "HAVING misses>0 ORDER BY misses DESC,searches DESC" : "ORDER BY searches DESC"} LIMIT ${TERM_ROWS}`,
    ).bind(...binds).all<{ term: string; searches: number; misses: number; last_seen: string }>(),
    // The busiest single day each term had, for the burst signal. Only terms with a day big enough
    // to count as a burst come back.
    env.DB.prepare(
      `SELECT term,MAX(n) peak_day FROM (
         SELECT json_extract(properties,'$.term') term,date(created_at) day,COUNT(*) n
           FROM product_events WHERE ${where} GROUP BY term,day
       ) GROUP BY term HAVING MAX(n)>=10 ORDER BY peak_day DESC LIMIT ${TERM_ROWS}`,
    ).bind(...binds).all<{ term: string; peak_day: number }>(),
    env.DB.prepare(
      `SELECT market,COUNT(*) searches FROM product_events
        WHERE type='search' AND created_at>=datetime('now',?) AND market IS NOT NULL AND market<>''
        GROUP BY market ORDER BY searches DESC LIMIT 40`,
    ).bind(current).all<{ market: string; searches: number }>(),
  ]);
  const termRows = terms.results || [];
  // Recorded verdicts for exactly the terms on screen, matched in SQL against a bound JSON list.
  const verdicts = termRows.length
    ? await env.DB.prepare(
        `SELECT f.term,f.verdict,f.note,f.updated_at,COALESCE(u.name,'A member of staff') decided_by
           FROM search_term_flags f LEFT JOIN users u ON u.id=f.flagged_by
          WHERE f.term IN (SELECT value FROM json_each(?))`,
      ).bind(JSON.stringify(termRows.map((row) => row.term))).all<{ term: string; verdict: string; note: string | null; updated_at: string; decided_by: string }>()
    : { results: [] };
  const peakBy = new Map((peaks.results || []).map((row) => [row.term, row.peak_day]));
  const verdictBy = new Map((verdicts.results || []).map((row) => [row.term, row]));
  return {
    totals: totals || { total: 0, misses: 0, distinct_terms: 0 },
    terms: termRows.map((row) => {
      const peakDay = peakBy.get(row.term) || 0;
      const verdict = verdictBy.get(row.term);
      return {
        ...row,
        peak_day: peakDay,
        signals: searchSignals(row.term, { searches: row.searches, peakDay, rangeDays: range }),
        verdict: verdict ? { verdict: verdict.verdict, note: verdict.note, updated_at: verdict.updated_at, decided_by: verdict.decided_by } : null,
      };
    }),
    markets: markets.results || [],
  };
}

interface VerdictBody {
  action?: unknown;
  term?: unknown;
  verdict?: unknown;
  note?: unknown;
}

export async function POST(request: Request) {
  const guard = await requireStaff(request, { allow: canReadGrowth, write: true });
  if (guard.response) return guard.response;
  let body: VerdictBody;
  try {
    body = await readJson<VerdictBody>(request, 4_000);
  } catch {
    return apiError(400, "INVALID_REQUEST", "The request could not be read.");
  }
  if (body.action !== "search_verdict") return apiError(400, "UNKNOWN_ACTION", "Unknown action.");
  // Kept exactly as recorded (only trimmed): the verdict has to match the stored term to apply.
  const term = String(body.term ?? "").trim().slice(0, 200);
  if (!term) return apiError(422, "TERM_REQUIRED", "Choose the search term this verdict is about.", { term: "Required" });
  if (!isSearchVerdict(body.verdict))
    return apiError(422, "INVALID_VERDICT", "Choose confirmed abuse or not abuse.", { verdict: "Choose confirmed abuse or not abuse" });
  const note = String(body.note ?? "").trim().slice(0, 500) || null;
  const previous = await env.DB.prepare("SELECT verdict FROM search_term_flags WHERE term=?").bind(term).first<{ verdict: string }>();
  await env.DB.prepare(
    `INSERT INTO search_term_flags(term,verdict,note,flagged_by) VALUES(?,?,?,?)
     ON CONFLICT(term) DO UPDATE SET verdict=excluded.verdict,note=excluded.note,flagged_by=excluded.flagged_by,updated_at=CURRENT_TIMESTAMP`,
  ).bind(term, body.verdict, note, guard.user.userId).run();
  await writeAudit(guard.user, {
    action: "search_term_verdict",
    targetType: "search_term",
    targetId: term,
    reason: note,
    details: { verdict: body.verdict, previous: previous?.verdict || null },
  });
  return Response.json({ ok: true, term, verdict: body.verdict });
}

interface GrowthTotals {
  saves: number;
  saves_prev: number;
  views: number;
  views_prev: number;
  offers: number;
  offers_prev: number;
  searches: number;
  searches_prev: number;
  deals_touched: number;
}
const EMPTY_TOTALS: GrowthTotals = { saves: 0, saves_prev: 0, views: 0, views_prev: 0, offers: 0, offers_prev: 0, searches: 0, searches_prev: 0, deals_touched: 0 };

interface MostSavedRow {
  deal_id: string;
  title: string;
  restaurant: string;
  city: string | null;
  status: string;
  location_scope: string | null;
  region: string | null;
  country: string | null;
  saves: number;
  saves_range: number;
  saves_prev: number;
}

interface DealPerformanceRow {
  deal_id: string;
  title: string;
  restaurant: string;
  city: string | null;
  status: string;
  location_scope: string | null;
  views: number;
  offers: number;
}

interface QuietRow {
  id: string;
  title: string;
  restaurant: string;
  city: string | null;
  location_scope: string | null;
  verification_status: string | null;
  created_at: string;
  region: string | null;
  country: string | null;
  last_opened: string | null;
}

interface LeadSourceRow {
  source: string;
  total: number;
  confirmed: number;
  in_range: number;
  converted: number;
}
