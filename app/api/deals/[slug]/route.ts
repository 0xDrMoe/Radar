import { env } from "cloudflare:workers";
import { publicDealPredicate } from "../../../deal-lifecycle";
import { underReviewSql } from "../../../accuracy-reports";
import { apiError } from "../../../api-utils";
import { referencesAlcohol } from "../../../alcohol";
import { categoryLabel, cuisineLabel } from "../../../i18n/staticEnums";
import { expiryTimeZone } from "../../../verification";
import { isSupportedLocale, type SupportedLocale } from "../../../i18n/dealLabels";
import { normalizedPostal, validPostal } from "../../../api-utils";
import { regionCode } from "../../../geocode";
import { regionForZip } from "../../../zip-regions";

/**
 * How many locations one response carries. The list used to have no limit at all, and a national
 * promotion is every branch of its brand: opening McDonald's in the app fetched 10,482 rows - about
 * two megabytes over cellular, and twenty thousand D1 rows read - to draw one map. The same cap as
 * the web deal page, and `location_total` says how many there really are.
 */
const LOCATION_LIST_MAX = 250;

// One deal, for clients that cannot read D1 directly.
//
// The web deal page is a server component that queries the database itself, so this is the first
// time a single deal has needed an API at all. The mobile app is the caller: it opens a deal from
// a list, from a push notification, or from a shared link, and none of those go through a search.
//
// Deliberately serves the same public predicate the list endpoint does, rather than looking a deal
// up by id and trusting the caller to have found a live one. A draft or paused deal is not public,
// and "you can see it if you already know its id" is exactly how a deal that was pulled stays
// visible after it should not be.
//
// The slug lookup matches the web page's: slug, then id, then an alias, so a URL that worked
// before a rename still resolves to the deal it named.

interface DealDetail {
  id: string;
  slug: string | null;
  restaurant: string;
  canonical_restaurant: string | null;
  title: string;
  description: string | null;
  category: string;
  cuisine: string;
  schedule: string;
  price: string;
  price_tier: number | null;
  terms: string | null;
  restrictions: string | null;
  city: string;
  address: string;
  postal_prefix: string;
  emoji: string;
  source_url: string;
  sponsored: number;
  verification_status: string;
  verified_at: string | null;
  /** 1 while a reader's report that the deal has ended or is wrong waits on staff. */
  under_review: number;
  created_at: string;
  expires_at: string | null;
  restaurant_website: string | null;
  restaurant_photo_url: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  is_chain: number | null;
  restaurant_id: string | null;
  location_id: string | null;
  location_scope: string | null;
  country: string | null;
  redemption: string | null;
  redemption_note: string | null;
  promo_code: string | null;
  photo_url: string | null;
  restaurant_logo_url: string | null;
  restaurant_country: string | null;
  restaurant_footprint: string | null;
  restaurant_locator_url: string | null;
}

/** The region codes a national chain trades in, from restaurants.footprint ({"TN": 214, ...}). */
function footprintRegions(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const regions = Object.entries(parsed as Record<string, unknown>).filter(([, n]) => Number(n) > 0).map(([region]) => region.toUpperCase());
    return regions.length ? regions.sort() : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!slug) return apiError(404, "DEAL_NOT_FOUND", "That deal could not be found.");
  const rawLocale = new URL(request.url).searchParams.get("locale") || "en";
  const locale: SupportedLocale = isSupportedLocale(rawLocale) ? rawLocale : "en";

  // d.created_at is the app's "Listed" date. A deal nobody has checked is dated by when it was
  // added, never as a check, which is how the website dates it (listedLabel in app/verification.ts,
  // created_at || verified_at). Without the column the app could only fall back to verified_at,
  // which for an unchecked deal is whenever the row was last stamped rather than when it arrived.
  //
  // The three ways an address can name a deal - its slug, its id, an alias of a folded duplicate -
  // are each looked up by their own index and joined to the deal by its key. Written as
  // `WHERE (d.slug=? OR d.id=? OR d.id=(SELECT ...)) AND <public>`, SQLite chose the status index
  // for `d.status='live'` and tested the three against every live deal: 437 rows read a call on
  // production, for a query that names one row. CROSS JOIN keeps the candidates on the outside.
  const deal = await env.DB.prepare(
    `SELECT d.id,d.slug,d.restaurant,d.title,d.description,d.category,d.cuisine,d.schedule,d.price,d.price_tier,
            d.terms,d.restrictions,d.city,d.address,d.postal_prefix,d.emoji,d.source_url,d.sponsored,
            d.verification_status,d.verified_at,d.created_at,d.expires_at,${underReviewSql("d")} under_review,
            d.restaurant_id,d.location_id,d.location_scope,d.redemption,d.redemption_note,d.promo_code,d.photo_url,
            r.name canonical_restaurant,r.website restaurant_website,r.photo_url restaurant_photo_url,r.logo_url restaurant_logo_url,r.is_chain,
            r.country restaurant_country,r.footprint restaurant_footprint,r.locator_url restaurant_locator_url,
            l.timezone,l.latitude,l.longitude,l.country
       FROM (SELECT id FROM deals WHERE slug=?
             UNION ALL SELECT ?
             UNION ALL SELECT canonical_deal_id FROM deal_aliases WHERE alias_id=?) c
       CROSS JOIN deals d ON d.id=c.id
       LEFT JOIN restaurants r ON r.id=d.restaurant_id
       LEFT JOIN restaurant_locations l ON l.id=d.location_id
      WHERE ${publicDealPredicate}
      LIMIT 1`,
  ).bind(slug, slug, slug).first<DealDetail>();

  // The predicate is in the WHERE clause rather than checked afterwards, so "no such deal" and
  // "that deal is not public" are the same 404 and neither can be used to discover which drafts
  // exist or when one was pulled.
  if (!deal) return apiError(404, "DEAL_NOT_FOUND", "That deal could not be found.");

  // The same 404 for a deal this caller may not see, for the same reason the predicate is in the
  // WHERE clause above. This is the deep-link half of the age control: the list endpoint already
  // withholds alcohol deals, so a filtered client cannot navigate to one — but it could still be
  // handed a slug by a push notification, a shared link, or a favorite saved before the filter
  // was turned on, and every one of those arrives here instead.
  if (new URL(request.url).searchParams.get("hideAlcohol") === "true" && referencesAlcohol(deal)) {
    return apiError(404, "DEAL_NOT_FOUND", "That deal could not be found.");
  }

  // Narrowed to one state or province when the caller says which: `region` directly, or a postal or
  // ZIP code, resolved the way the web deal page resolves one - postal_cache first, then the ZIP's
  // own prefix. Unscoped, a brand-wide deal lists its branches in state order and the rest by
  // eligibility then city, with the deal's own branch first either way.
  const search = new URL(request.url).searchParams;
  const rawPostal = normalizedPostal(search.get("postal") || search.get("zip"));
  let region = regionCode(search.get("region")) || null;
  if (!region && rawPostal && validPostal(rawPostal)) {
    const cached = await env.DB.prepare("SELECT region FROM postal_cache WHERE normalized_postal=? AND status='resolved'")
      .bind(rawPostal).first<{ region: string }>();
    region = cached ? regionCode(cached.region) : regionForZip(rawPostal);
  }
  const brandWide = deal.location_scope === "brand" && Boolean(deal.restaurant_id);
  const COLUMNS = "l.id,l.address,l.city,l.region,l.postal_prefix,l.full_postal,l.phone,l.latitude,l.longitude,l.timezone";
  const listFor = (scope: string | null) => brandWide
    ? scope
      ? env.DB.prepare(`SELECT ${COLUMNS},'confirmed' eligibility,NULL eligibility_verified_at FROM restaurant_locations l WHERE l.restaurant_id=? AND l.region=? AND l.status='operating' ORDER BY l.city,l.address LIMIT ?`).bind(deal.restaurant_id, scope, LOCATION_LIST_MAX)
      : env.DB.prepare(`SELECT ${COLUMNS},'confirmed' eligibility,NULL eligibility_verified_at FROM restaurant_locations l WHERE l.restaurant_id=? AND l.status='operating' ORDER BY l.region,l.city,l.address LIMIT ?`).bind(deal.restaurant_id, LOCATION_LIST_MAX)
    : env.DB.prepare(
      `SELECT ${COLUMNS},dl.eligibility,dl.verified_at eligibility_verified_at
         FROM deal_locations dl JOIN restaurant_locations l ON l.id=dl.location_id
        WHERE dl.deal_id=? AND l.status='operating'${scope ? " AND l.region=?" : ""}
        ORDER BY CASE WHEN l.id=? THEN 0 ELSE 1 END,CASE dl.eligibility WHEN 'confirmed' THEN 0 ELSE 1 END,l.city,l.address
        LIMIT ?`,
    ).bind(...(scope ? [deal.id, scope, deal.location_id, LOCATION_LIST_MAX] : [deal.id, deal.location_id, LOCATION_LIST_MAX]));
  // Counted only where counting is cheap: a brand's branches in one state, from the region index, or
  // a per-branch deal's own links. A national brand's total would read every branch it has, so an
  // unscoped brand-wide list reports how many it carries and says whether that is all of them.
  const countFor = (scope: string | null) => brandWide
    ? scope
      ? env.DB.prepare("SELECT COUNT(*) n FROM restaurant_locations WHERE restaurant_id=? AND region=? AND status='operating'").bind(deal.restaurant_id, scope).first<{ n: number }>()
      : Promise.resolve(null)
    : env.DB.prepare(`SELECT COUNT(*) n FROM deal_locations dl JOIN restaurant_locations l ON l.id=dl.location_id WHERE dl.deal_id=? AND l.status='operating'${scope ? " AND l.region=?" : ""}`)
        .bind(...(scope ? [deal.id, scope] : [deal.id])).first<{ n: number }>();

  // A 'national' deal has no branches on Radar to list (drizzle/0050): its brand's store finder
  // stands in for the list, and its footprint says whether the chain trades in the reader's state.
  const national = deal.location_scope === "national";
  const regions = national ? footprintRegions(deal.restaurant_footprint) : null;
  const [scoped, scopedCount, items, translation] = await Promise.all([
    national ? Promise.resolve({ results: [] as Record<string, unknown>[] }) : listFor(region).all<Record<string, unknown>>(),
    national ? Promise.resolve(null) : countFor(region),
    env.DB.prepare("SELECT id,name,original_price,discounted_price FROM deal_items WHERE deal_id=? ORDER BY sort_order,id").bind(deal.id).all(),
    locale === "en"
      ? Promise.resolve(null)
      : env.DB.prepare("SELECT title,description,schedule,price,terms,restrictions FROM deal_translations WHERE deal_id=? AND locale=?")
          .bind(deal.id, locale).first<Record<string, string | null>>(),
  ]);

  // A state with none of this offer's locations falls back to the whole list rather than an empty
  // one, the same bargain the web page makes.
  const emptyScope = !national && Boolean(region) && scoped.results.length === 0;
  let rows = scoped.results;
  let counted = scopedCount?.n ?? null;
  if (emptyScope) {
    const [all, allCount] = await Promise.all([listFor(null).all<Record<string, unknown>>(), countFor(null)]);
    rows = all.results;
    counted = allCount?.n ?? null;
  }
  // The deal's own branch leads an unscoped brand list, which is otherwise in state order.
  if (brandWide && (!region || emptyScope) && deal.location_id && !rows.some((row) => row.id === deal.location_id)) {
    const own = await env.DB.prepare(`SELECT ${COLUMNS},'confirmed' eligibility,NULL eligibility_verified_at FROM restaurant_locations l WHERE l.id=? AND l.status='operating'`)
      .bind(deal.location_id).first<Record<string, unknown>>();
    if (own) rows = [own, ...rows].slice(0, LOCATION_LIST_MAX);
  }
  // A brand-wide deal is confirmed at every branch as of its own verification. Read straight from
  // restaurant_locations, its branches carry no date, and a client would show "Confirmed" with
  // nothing after it.
  if (brandWide) rows = rows.map((row) => row.eligibility_verified_at ? row : { ...row, eligibility_verified_at: deal.verified_at });

  // Per field, not per row — the same fallback the list endpoint uses, so a partly translated deal
  // shows translated copy where it exists and the English original everywhere else, never a blank.
  const { restaurant_footprint: unusedFootprint, ...rest } = deal;
  return Response.json({
    deal: {
      ...rest,
      // A national deal has no branch to take a country from; its brand row has one.
      country: rest.country ?? rest.restaurant_country,
      footprint_regions: regions,
      title: translation?.title || rest.title,
      description: translation?.description ?? rest.description,
      schedule: translation?.schedule || rest.schedule,
      price: translation?.price || rest.price,
      terms: translation?.terms ?? rest.terms,
      restrictions: translation?.restrictions ?? rest.restrictions,
      category_label: categoryLabel(rest.category, locale),
      cuisine_label: cuisineLabel(rest.cuisine, locale),
      expiry_timezone: expiryTimeZone(rest),
      // "Re-checking" while a reader's report waits on staff (app/accuracy-reports.ts), the word the
      // list already gives this deal. Otherwise left to the client, which ages the stored status the
      // way the website's deal page does.
      ...(rest.under_review ? { effective_verification_status: "stale" } : {}),
    },
    locations: rows,
    // Null when the list is a brand's, unscoped, and was not counted; `locations_complete` then says
    // whether the list is all of them.
    location_total: counted,
    locations_complete: rows.length < LOCATION_LIST_MAX,
    location_region: region && !emptyScope ? region : null,
    // National only: whether the chain trades in the region asked about - false for Del Taco and a
    // Tennessee ZIP - or null when nobody asked or nobody counted.
    in_region: national && region && regions ? regions.includes(region.toUpperCase()) : null,
    items: items.results,
  }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=300" } });
}
