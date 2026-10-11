// "Similar offers" on a deal page: other restaurants, running the same kind of deal.
//
// The list used to rank the deal's own restaurant first, so on Montana's Wing Monday it was Taco
// Tuesday, rib Wednesday and the Thursday platter - the same restaurant's week, which the page
// already shows under "Also at this location", and nothing a reader deciding between places could
// use. Its heading had to be chosen by looking at what came back, because the query could not say
// in advance whether it had found anyone else.
//
// Now the restaurant itself is excluded, the list is kept to places near the deal, and each other
// restaurant appears once, by its most similar deal. Similarity is scored in three steps:
//
//   4  the title names the same thing - wings and wings, tacos and tacos
//   2  the same cuisine
//   1  the same category (happy hour, food deal, tonight)
//
// A deal sharing none of the three is not similar and is left out, however close it is.
//
// The dish words are a fixed list rather than every word in the title. Titles are mostly days,
// discounts and filler - "Half-Price Wings Tuesday" is one word of dish and three of noise - and
// matching on "half" or "tuesday" would call every Tuesday special similar to every other. The
// list was drawn from the words that actually recur in live deal titles.

// Each group is one thing a deal can be about. A stem matches at the start of a word, so "wing"
// takes "wings" and "wing night" but not "bowling", and "rib" takes "ribs" but not "Caribbean".
// The public-deal rule is publicDealPredicate (app/deal-lifecycle.ts), written out because this file
// is loaded on its own by its tests; tests/similar-deals.test.mjs holds the two to each other. A deal
// scheduled for later is not public: linking it led to a 404 and named it before its launch.
const DISHES: string[][] = [
  ["wing", "aile"],
  ["taco"],
  ["rib"],
  ["burger"],
  ["pizza"],
  ["pasta", "spaghetti"],
  ["oyster", "huître", "huitre", "shuck"],
  ["sushi"],
  ["steak"],
  ["fish"],
  ["nacho"],
  ["poutine"],
  ["happy hour", "aperitivo", "apero", "apéro", "5 à 7", "5 a 7"],
  ["cocktail", "beer", "bière", "biere", "pint", "wine", "sangria", "margarita", "tequila", "pitcher", "whisk"],
  ["student", "étudiant", "etudiant"],
  ["kid", "enfant"],
  ["late night"],
];

// A title as the matcher reads it: lower case, with hyphens, slashes and brackets turned into
// spaces so "Half-Price Wings", "wings/beer" and "(wings)" all put a space before the dish. The
// SQL below applies the same three replacements, so the deal and its candidates are read alike.
const WORD_BREAKS = /[-/(]/g;
const SQL_TEXT = "(' '||lower(replace(replace(replace(d.title,'-',' '),'/',' '),'(',' ')))";

export function dishStems(title: string): string[] {
  const text = ` ${title.toLowerCase().replace(WORD_BREAKS, " ")}`;
  return DISHES.filter((group) => group.some((stem) => text.includes(` ${stem}`))).flat();
}

export interface SimilarDealSource {
  id: string;
  title: string;
  restaurant: string;
  restaurant_id: string | null;
  city: string;
  cuisine: string | null;
  category: string | null;
  // The deal's own branch, from restaurant_locations. Null falls back to the city name alone.
  latitude: number | null;
  longitude: number | null;
}

export const SIMILAR_LIMIT = 6;

// How far "near" reaches. The list was scoped to the deal's own city by name, and Gatineau is
// five places: a Gatineau wing night could list at most four others, while a dozen Ottawa ones sat
// a bridge away - and the Gatineau feed already mixes the two. 25 km takes in the metro both
// sides of the river without reaching Kingston or Montréal. Measured as a box rather than a
// circle, which is all a similarity list needs and lets SQLite compare plain columns.
export const SIMILAR_REACH_KM = 25;

export function similarDealsQuery(deal: SimilarDealSource) {
  const stems = dishStems(deal.title);
  const dish = stems.length ? `CASE WHEN ${stems.map(() => `${SQL_TEXT} LIKE ?`).join(" OR ")} THEN 4 ELSE 0 END` : "0";
  const located = deal.latitude != null && deal.longitude != null;
  const latSpan = SIMILAR_REACH_KM / 111;
  const lngSpan = located ? SIMILAR_REACH_KM / (111 * Math.cos((Number(deal.latitude) * Math.PI) / 180)) : 0;
  // Two ways of being the same restaurant, because not every deal row is linked to one: the
  // restaurant id where both have it, and the name as written on the deal either way. A deal with
  // no restaurant id is compared by name alone rather than dropped, which is what `restaurant_id<>?`
  // on its own would do - a comparison against NULL is never true.
  //
  // Nearby is the deal's own city, or any branch inside the box. Among equally similar deals the
  // same city comes first, so a Gatineau page still leads with Gatineau when it has the match.
  const sql = `SELECT id,slug,restaurant,title,price,schedule,cuisine,emoji FROM (
      SELECT *,ROW_NUMBER() OVER (PARTITION BY COALESCE(restaurant_id,lower(restaurant)) ORDER BY score DESC,local DESC,verified_at DESC) pick FROM (
        SELECT d.id,d.slug,d.restaurant,d.restaurant_id,d.title,d.price,d.schedule,d.cuisine,d.emoji,d.verified_at,
          ${dish} + CASE WHEN d.cuisine=? THEN 2 ELSE 0 END + CASE WHEN d.category=? THEN 1 ELSE 0 END score,
          d.city=? local
        FROM deals d LEFT JOIN restaurant_locations l ON l.id=d.location_id
        WHERE d.id<>?
          AND (d.city=? OR (l.latitude BETWEEN ? AND ? AND l.longitude BETWEEN ? AND ?))
          AND (d.restaurant_id IS NULL OR ? IS NULL OR d.restaurant_id<>?)
          AND lower(d.restaurant)<>lower(?)
          AND d.active=1 AND d.status='live' AND d.deleted_at IS NULL AND (d.publish_at IS NULL OR datetime(d.publish_at)<=datetime('now'))
      ) WHERE score>0
    ) WHERE pick=1 ORDER BY score DESC,local DESC,verified_at DESC LIMIT ${SIMILAR_LIMIT}`;
  const params = [
    ...stems.map((stem) => `% ${stem}%`),
    deal.cuisine,
    deal.category,
    deal.city,
    deal.id,
    deal.city,
    located ? Number(deal.latitude) - latSpan : null,
    located ? Number(deal.latitude) + latSpan : null,
    located ? Number(deal.longitude) - lngSpan : null,
    located ? Number(deal.longitude) + lngSpan : null,
    deal.restaurant_id,
    deal.restaurant_id,
    deal.restaurant,
  ];
  return { sql, params };
}
