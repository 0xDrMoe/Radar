import { guideCities, type GuideCity } from "./city-pages";
import { publicDealPredicate } from "./deal-lifecycle";

// What the home page's server HTML says about the catalogue, for a reader who never runs its script.
//
// Why. Everything else on the home page that names a deal is drawn in the browser from /api/deals,
// which robots.txt keeps crawlers out of. Google renders the page, finds that fetch blocked, and
// sees a page about restaurant deals that links to none: the page with the most authority on the
// site passed none of it to a deal or a city guide. This is the part of the home page that is in
// the HTML itself: the deals most recently checked against their source, and the city guides.
//
// Why "most recently checked" rather than the first page of the results below. Those depend on the
// reader (their country, their place, their filters) and are worked out in the browser; the server
// copy is one page for everyone, baked at deploy (scripts/prerender-deals.mjs). The deals whose
// checks are newest are the same for everyone, are the ones Radar can most stand behind, and say
// what Radar is for: when each was last checked, which no stale deal directory does.

/** One deal as the home page's server list shows it. */
export interface RecentCheck {
  id: string;
  slug: string | null;
  restaurant: string;
  title: string;
  /** "Ottawa, ON", or "" for a chain's brand-wide or national offer, which runs in many cities. */
  place: string;
  verifiedAt: string;
}

export interface HomeListings {
  recentChecks: RecentCheck[];
  guides: GuideCity[];
  stats: CatalogStats;
}

/**
 * The size of the public catalogue, for the hero's "1,000+ deals · 500+ restaurants · 60+ cities".
 *
 * Counted over every public deal rather than the cards the list below draws: the list is one card
 * per place (a bar with five nightly specials is one card), and its count was being read as the
 * number of deals. Restaurants are places - a branch where an offer runs - and cities are the
 * cities those places are in, the way the city guides count them (app/city-pages.ts), so the
 * figures agree with what a reader finds by following them. A deal past its own end date is left
 * out even while the cleanup cron has yet to retire it.
 */
export interface CatalogStats {
  deals: number;
  restaurants: number;
  cities: number;
}

export async function catalogStats(db: D1Database): Promise<CatalogStats> {
  const current = `${publicDealPredicate} AND (d.expires_at IS NULL OR datetime(d.expires_at) > datetime('now'))`;
  const row = await db.prepare(
    `WITH placed AS (
       SELECT d.location_id AS location_id FROM deals d
        WHERE ${current} AND COALESCE(d.location_scope, '') <> 'national' AND d.location_id IS NOT NULL
       UNION
       SELECT dl.location_id FROM deals d JOIN deal_locations dl ON dl.deal_id = d.id
        WHERE ${current} AND COALESCE(d.location_scope, '') <> 'national'
     )
     SELECT (SELECT COUNT(*) FROM deals d WHERE ${current}) AS deals,
            COUNT(DISTINCT l.id) AS restaurants,
            COUNT(DISTINCT LOWER(TRIM(l.city)) || '|' || COALESCE(l.region, '') || '|' || l.country) AS cities
       FROM placed p JOIN restaurant_locations l ON l.id = p.location_id
      WHERE l.status = 'operating' AND TRIM(COALESCE(l.city, '')) <> '' AND l.country IS NOT NULL`,
  ).first<CatalogStats>();
  return { deals: Number(row?.deals || 0), restaurants: Number(row?.restaurants || 0), cities: Number(row?.cities || 0) };
}

/**
 * A count as the hero states it: rounded down, so the claim stays true as deals come and go
 * between the reads. 1,060 is "1,000+", 557 is "500+", 64 is "60+"; under ten it is exact.
 * `plus` says whether the figure was rounded, and so whether it takes a "+".
 */
export function roundedDown(count: number): { value: number; plus: boolean } {
  const n = Math.max(0, Math.floor(count));
  if (n < 10) return { value: n, plus: false };
  const step = n < 100 ? 10 : 100;
  return { value: Math.floor(n / step) * step, plus: true };
}

/** How many deals the list shows. One per restaurant, so a chain with ten offers cannot fill it. */
export const RECENT_CHECKS = 12;

// Read this many rows to find RECENT_CHECKS restaurants: a restaurant checked in one sitting can
// carry a dozen rows with the same timestamp.
const SCAN = 80;

type Row = {
  id: string;
  slug: string | null;
  restaurant: string;
  title: string;
  verified_at: string;
  location_scope: string | null;
  city: string | null;
  region: string | null;
};

export async function recentChecks(db: D1Database): Promise<RecentCheck[]> {
  const { results } = await db.prepare(
    `SELECT d.id, d.slug, d.restaurant, d.title, d.verified_at, d.location_scope,
            COALESCE(l.city, d.city) AS city, l.region AS region
       FROM deals d LEFT JOIN restaurant_locations l ON l.id = d.location_id
      WHERE ${publicDealPredicate}
        AND d.verification_status = 'verified' AND d.verified_at IS NOT NULL
        AND (d.expires_at IS NULL OR datetime(d.expires_at) > datetime('now'))
      ORDER BY datetime(d.verified_at) DESC, d.id
      LIMIT ?`,
  ).bind(SCAN).all<Row>();
  const seen = new Set<string>();
  const picked: RecentCheck[] = [];
  for (const row of results || []) {
    const key = row.restaurant.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    // A chain's offer runs at many branches, so naming the one the row happens to carry would be
    // wrong for most of them (the share cards follow the same rule).
    const chainWide = row.location_scope === "brand" || row.location_scope === "national";
    picked.push({
      id: row.id,
      slug: row.slug,
      restaurant: row.restaurant,
      title: row.title,
      place: chainWide ? "" : [row.city, row.region].filter(Boolean).join(", "),
      verifiedAt: row.verified_at,
    });
    if (picked.length === RECENT_CHECKS) break;
  }
  return picked;
}

// Held for ten minutes per isolate. The baked home page reads this once per deploy, but a reader
// with a session cookie is rendered on every visit (app/RootShell.tsx), and guideCities and
// catalogStats read the whole public catalogue. None of them changes faster than staff check deals.
const TTL_MS = 10 * 60_000;
let memo: { at: number; db: D1Database; value: Promise<HomeListings> } | null = null;

export function homeListings(db: D1Database, now = Date.now()): Promise<HomeListings> {
  if (memo && memo.db === db && now - memo.at < TTL_MS) return memo.value;
  const value = Promise.all([recentChecks(db), guideCities(db), catalogStats(db)])
    .then(([checks, guides, stats]) => ({ recentChecks: checks, guides, stats }));
  memo = { at: now, db, value };
  // A failed read is not kept: the next render tries again rather than serving the failure for ten minutes.
  value.catch(() => { if (memo?.value === value) memo = null; });
  return value;
}
