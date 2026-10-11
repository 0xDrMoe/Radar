import { publicDealPredicate } from "./deal-lifecycle";
import { slugify } from "./slug";

// The city guides: /en/cities, one hub per city (/en/cities/ottawa-on) and the topic pages under
// it (/en/cities/ottawa-on/happy-hour, /wings, /monday ...).
//
// Why these pages exist. Every deal already has a page, but nobody searches for "Finnigan's Cove
// 50c wings"; they search for "happy hour Ottawa" and "wing night Ottawa". The home page cannot
// answer those: a city on it is a client-side filter over one URL, canonical to the bare home page,
// with the list drawn in the browser. A topic page is a real address whose server HTML names every
// deal in it, so a crawler - and a reader who never runs the script - sees the answer.
//
// Why only cities and topics with enough in them. A page for a city with two listings, or for
// "tacos" with one, is the thin page a search engine learns to ignore (Google's doorway and scaled
// content policies), and it would say Radar is bigger than it is. A city is a guide only with at
// least MIN_CITY_RESTAURANTS restaurants in it, and a topic only with MIN_RESTAURANTS; anything less
// is not a page at all: 404, and not in the sitemap. The catalogue decides which pages exist, so a
// city or a topic appears the day it has enough in it, with no code change.
//
// It started as Ottawa alone, at /en/ottawa. Those addresses now redirect here (LEGACY_CITY).

/** A city with enough in it to be a guide. */
export interface GuideCity {
  /** As the branches spell it: "Ottawa". */
  name: string;
  /** "ottawa-on": the name and the province or state, so Vancouver BC and Vancouver WA never meet. */
  slug: string;
  /** "ON", or "" when no branch recorded one. */
  region: string;
  country: string;
  restaurants: number;
  deals: number;
}

/** The fewest restaurants a city needs to be a guide. */
export const MIN_CITY_RESTAURANTS = 5;

/** The city guides' index, and each guide's address under it. Without the locale; they are English only. */
export const GUIDES_PATH = "/cities" as const;
export const cityPath = (city: Pick<GuideCity, "slug">, topic?: string): `/${string}` => `${GUIDES_PATH}/${city.slug}${topic ? `/${topic}` : ""}`;

/** The slug a city's guide lives at: "ottawa-on". */
export function citySlug(name: string, region: string | null | undefined): string {
  const code = String(region || "").trim().toLowerCase();
  return [slugify(name), code ? slugify(code) : ""].filter(Boolean).join("-");
}

/** Where the home page's search opens on this city, for "see what is on right now". */
export const cityHomeQuery = (city: Pick<GuideCity, "name">): `/${string}` => `/?city=${encodeURIComponent(city.name)}`;

/** The one city the guide began with, for the redirects from its old addresses (app/[locale]/ottawa). */
export const LEGACY_CITY = { name: "Ottawa", region: "ON", country: "CA" } as const;

export const MIN_RESTAURANTS = 3;

/** One deal as a city page lists it. Branches of the same offer are folded into `locations`. */
export interface CityDeal {
  id: string;
  slug: string | null;
  restaurant: string;
  title: string;
  category: string;
  cuisine: string;
  price: string;
  schedule: string;
  address: string;
  verifiedAt: string | null;
  verified: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  days: string[];
  locations: number;
  /** Everything the topic matchers read: title, price, description. Lower-cased. */
  text: string;
}

export interface Topic {
  slug: string;
  /** "happy hours": the plural noun phrase the title, headings and links are built from. */
  label: string;
  match: (deal: CityDeal) => boolean;
}

const DAYS = [
  ["monday", "Mon"], ["tuesday", "Tue"], ["wednesday", "Wed"], ["thursday", "Thu"],
  ["friday", "Fri"], ["saturday", "Sat"], ["sunday", "Sun"],
] as const;

const word = (pattern: RegExp) => (deal: CityDeal) => pattern.test(deal.text);
const cuisine = (...names: string[]) => (deal: CityDeal) => names.includes(deal.cuisine);
const either = (...tests: ((deal: CityDeal) => boolean)[]) => (deal: CityDeal) => tests.some((match) => match(deal));

export const TOPICS: readonly Topic[] = [
  { slug: "happy-hour", label: "happy hours", match: (d) => d.category === "Happy hour" },
  { slug: "food-deals", label: "food deals", match: (d) => d.category === "Food deal" },
  { slug: "wings", label: "wing deals", match: word(/\bwings?\b/) },
  { slug: "pizza", label: "pizza deals", match: word(/\bpizzas?\b/) },
  { slug: "burgers", label: "burger deals", match: word(/\bburgers?\b/) },
  { slug: "tacos", label: "taco deals", match: word(/\btacos?\b/) },
  { slug: "oysters", label: "oyster deals", match: word(/\boysters?\b|\bshuck/) },
  // The dishes and cuisines people search a city for ("cheap sushi Ottawa", "Mexican food deals").
  // A cuisine topic reads the listing's cuisine as well as the offer's words: a taqueria's
  // "$3 Tuesdays" says nothing about Mexican food, and is still the answer.
  { slug: "sushi", label: "sushi deals", match: either(cuisine("Sushi"), word(/\bsushi\b|\bmaki\b|\bsashimi\b/)) },
  { slug: "nachos", label: "nacho deals", match: word(/\bnachos?\b/) },
  { slug: "steak", label: "steak deals", match: either(cuisine("Steakhouse"), word(/\bsteaks?\b|\bstriploin\b|\bsirloin\b|\bribeye\b/)) },
  { slug: "brunch", label: "brunch deals", match: either(cuisine("Breakfast & Brunch"), word(/\bbrunch\b/)) },
  { slug: "mexican", label: "Mexican food deals", match: cuisine("Mexican") },
  { slug: "italian", label: "Italian food deals", match: cuisine("Italian") },
  ...DAYS.map(([slug, short]): Topic => ({
    slug,
    label: `deals on ${slug[0].toUpperCase()}${slug.slice(1)}s`,
    match: (d) => d.days.includes(short),
  })),
];

export function topicBySlug(slug: string): Topic | undefined {
  return TOPICS.find((topic) => topic.slug === slug);
}

/** How many distinct restaurants a list of deals is spread over. */
export const restaurantCount = (deals: readonly CityDeal[]) => new Set(deals.map((deal) => deal.restaurant.toLowerCase())).size;

/** A weekday page is only worth having in a city with this many restaurants; in a smaller one it lists the hub again. */
export const MIN_WEEKDAY_CITY_RESTAURANTS = 10;

/** A topic holding this share of the hub's deals or more is the hub under another name, and not a page of its own. */
export const MAX_TOPIC_SHARE = 0.8;

const isWeekday = (topic: Topic) => DAYS.some(([slug]) => slug === topic.slug);

/**
 * The topics with enough in them to be a page, each with the deals that make it up. Enough means
 * MIN_RESTAURANTS restaurants, and less than MAX_TOPIC_SHARE of the city's deals; a weekday also
 * needs a city deep enough that its Monday is not just its whole list again. Across many cities
 * those near-copies are what search engines treat as doorway pages.
 */
export function publishedTopics(deals: readonly CityDeal[]): { topic: Topic; deals: CityDeal[] }[] {
  const deepCity = restaurantCount(deals) >= MIN_WEEKDAY_CITY_RESTAURANTS;
  return TOPICS.filter((topic) => deepCity || !isWeekday(topic))
    .map((topic) => ({ topic, deals: deals.filter(topic.match) }))
    .filter(({ deals: matched }) => restaurantCount(matched) >= MIN_RESTAURANTS && matched.length < deals.length * MAX_TOPIC_SHARE);
}

/**
 * What folds two rows into one guide entry: the same offer, by name, at the same restaurant. A
 * deal page uses it to find the entry it was folded into, when another branch's row leads it.
 */
export function cityDealKey(restaurant: string, title: string): string {
  return `${restaurant.trim().toLowerCase()}\u0000${title.trim().toLowerCase()}`;
}

/**
 * Where a deal sits in the guide: its entry, and the published topics that entry is listed under.
 * Null when the deal is not in the guide at all (another city, a national promotion, a closed
 * branch), so a deal page only links to topic pages that exist and actually list it.
 */
export function guidePlacement(deals: readonly CityDeal[], deal: { id: string; restaurant: string; title: string }) {
  const key = cityDealKey(deal.restaurant, deal.title);
  const entry = deals.find((candidate) => candidate.id === deal.id)
    ?? deals.find((candidate) => cityDealKey(candidate.restaurant, candidate.title) === key);
  if (!entry) return null;
  return { entry, topics: publishedTopics(deals).filter(({ topic }) => topic.match(entry)).map(({ topic }) => topic) };
}

interface Row {
  id: string;
  slug: string | null;
  restaurant: string;
  title: string;
  category: string;
  cuisine: string;
  price: string;
  schedule: string;
  address: string;
  verification_status: string | null;
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  description: string | null;
}

const IN_CITY = `l.city = ? AND COALESCE(l.region, '') = ? AND l.country = ? AND l.status = 'operating'`;

/** Where a city's deals are looked up: the three columns a branch is placed by. */
export type CityKey = Pick<GuideCity, "name" | "region" | "country">;

/**
 * Every public deal that runs at an operating branch in the city, one entry per restaurant and
 * offer. A deal is in the city when its own branch is, or when it lists a branch there
 * (deal_locations) - a chain's offer carries its home branch on the row and the rest beside it.
 * National chain promotions are left out: they run everywhere, and say nothing about this city.
 */
export async function cityDeals(db: D1Database, city: CityKey): Promise<CityDeal[]> {
  const where = [city.name, city.region || "", city.country];
  const [dealRows, scheduleRows] = await Promise.all([
    db.prepare(
      `SELECT d.id, d.slug, d.restaurant, d.title, d.category, d.cuisine, d.price, d.schedule, d.address,
              d.verification_status, d.verified_at, d.created_at, d.updated_at, d.description
         FROM deals d
        WHERE ${publicDealPredicate}
          AND COALESCE(d.location_scope, '') <> 'national'
          AND (d.location_id IN (SELECT l.id FROM restaurant_locations l WHERE ${IN_CITY})
               OR d.id IN (SELECT dl.deal_id FROM deal_locations dl JOIN restaurant_locations l ON l.id = dl.location_id WHERE ${IN_CITY}))
        ORDER BY d.restaurant, d.title, d.id`,
    ).bind(...where, ...where).all<Row>(),
    db.prepare(
      `SELECT s.deal_id, s.days FROM deal_schedules s
         JOIN deals d ON d.id = s.deal_id
        WHERE ${publicDealPredicate}
          AND (d.location_id IN (SELECT l.id FROM restaurant_locations l WHERE ${IN_CITY})
               OR d.id IN (SELECT dl.deal_id FROM deal_locations dl JOIN restaurant_locations l ON l.id = dl.location_id WHERE ${IN_CITY}))`,
    ).bind(...where, ...where).all<{ deal_id: string; days: string }>(),
  ]);

  const daysOf = new Map<string, Set<string>>();
  for (const { deal_id, days } of scheduleRows.results || []) {
    let parsed: unknown = [];
    try { parsed = JSON.parse(days); } catch { /* an unreadable list names no day */ }
    if (!Array.isArray(parsed)) continue;
    const set = daysOf.get(deal_id) || new Set<string>();
    for (const day of parsed) if (typeof day === "string") set.add(day);
    daysOf.set(deal_id, set);
  }

  const folded = new Map<string, CityDeal>();
  for (const row of dealRows.results || []) {
    const key = cityDealKey(row.restaurant, row.title);
    const existing = folded.get(key);
    if (existing) {
      existing.locations += 1;
      for (const day of daysOf.get(row.id) || []) if (!existing.days.includes(day)) existing.days.push(day);
      continue;
    }
    folded.set(key, {
      id: row.id,
      slug: row.slug,
      restaurant: row.restaurant,
      title: row.title,
      category: row.category,
      cuisine: row.cuisine,
      price: row.price,
      schedule: row.schedule,
      address: row.address,
      verifiedAt: row.verified_at,
      verified: row.verification_status === "verified",
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      days: [...(daysOf.get(row.id) || [])],
      locations: 1,
      text: `${row.title} ${row.price} ${row.description || ""}`.toLowerCase(),
    });
  }
  return [...folded.values()];
}

/**
 * Every city with enough in it to be a guide, the deepest first. The same placement rule as
 * cityDeals - a deal counts where its own branch is and where it lists a branch, never when it is a
 * national promotion - counted in one pass over the catalogue rather than one query per city.
 * Restaurants are counted by name, the way restaurantCount does, so a chain's branches are one.
 */
export async function guideCities(db: D1Database): Promise<GuideCity[]> {
  const { results } = await db.prepare(
    `WITH placed AS (
       SELECT d.id, d.restaurant, d.location_id AS location_id FROM deals d
        WHERE ${publicDealPredicate} AND COALESCE(d.location_scope, '') <> 'national' AND d.location_id IS NOT NULL
       UNION
       SELECT d.id, d.restaurant, dl.location_id FROM deals d JOIN deal_locations dl ON dl.deal_id = d.id
        WHERE ${publicDealPredicate} AND COALESCE(d.location_scope, '') <> 'national'
     )
     SELECT l.city AS name, COALESCE(l.region, '') AS region, l.country AS country,
            COUNT(DISTINCT LOWER(p.restaurant)) AS restaurants, COUNT(DISTINCT p.id) AS deals
       FROM placed p JOIN restaurant_locations l ON l.id = p.location_id
      WHERE l.status = 'operating' AND TRIM(COALESCE(l.city, '')) <> '' AND l.country IS NOT NULL
      GROUP BY l.city, COALESCE(l.region, ''), l.country
     HAVING restaurants >= ?
      ORDER BY restaurants DESC, l.city`,
  ).bind(MIN_CITY_RESTAURANTS).all<Omit<GuideCity, "slug">>();
  return (results || []).map((row) => ({ ...row, slug: citySlug(row.name, row.region) }));
}

/** The guide a slug names, or undefined when no city with enough in it has that slug. */
export async function guideCityBySlug(db: D1Database, slug: string): Promise<GuideCity | undefined> {
  return (await guideCities(db)).find((city) => city.slug === slug);
}

/** "Oct 1, 2026" from a D1 timestamp, or null when there is none. */
export function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(/[Zz]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The newest check among the deals, which is what "last checked" can honestly claim. */
export function lastChecked(deals: readonly CityDeal[]): string | null {
  const dates = deals.filter((deal) => deal.verified && deal.verifiedAt).map((deal) => deal.verifiedAt as string).sort();
  return shortDate(dates[dates.length - 1]);
}

/** The newest change among the deals, for the sitemap's lastmod. */
export function lastChanged(deals: readonly CityDeal[]): string | undefined {
  const dates = deals.map((deal) => deal.updatedAt).filter((value): value is string => Boolean(value)).sort();
  const newest = dates[dates.length - 1];
  return newest ? new Date(`${newest.replace(" ", "T")}Z`).toISOString() : undefined;
}
