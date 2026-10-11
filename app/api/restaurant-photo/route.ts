import { env } from "cloudflare:workers";
import { isPayloadTooLarge, readStreamCapped } from "../../body-limits";
import { BROWSER_UA, MAX_PHOTO_BYTES, PHOTO_TYPES, isTooSmall, photoCandidates } from "../../photo-candidates";

// Live fallback for a restaurant whose photo has not been fetched ahead of time. The preferred
// path is restaurants.photo_url, filled by scripts/fetch-restaurant-photos.mjs and served from our
// own R2 by /api/photo — app/CardMedia.tsx uses that whenever it is set and only falls back here
// when it is not.
//
// That ordering exists because this route cannot reach every site: some restaurant sites refuse
// the fetch of their own page from here, and those are better served by a photo stored ahead of
// time.

// Two questions in one round trip.
//
// Is it ours? Only URLs already in our own data are proxied, so this route can't be used as an open
// image proxy for arbitrary third-party URLs.
//
// Is it only ours? A URL that several restaurants share is not any one restaurant's website — it is
// the aggregator page their deals were sourced from. Such a page can be listed for dozens of
// restaurants, so fetching "the restaurant's photo" from one returns the aggregator's own banner and
// paints the same picture onto every one of those cards. The emoji is the better answer, and it is
// per-deal.
// Three counts and no FROM clause. An earlier version asked the same thing over
// `deals LEFT JOIN restaurants WHERE r.website=?1 OR d.source_url=?1` — an OR spanning both sides
// of a join, which no index can serve, so every request that matched nothing scanned the whole
// deals table. That join was redundant as well as expensive: the counts below already say whether
// the URL is ours. With drizzle/0036 in place each one is an index lookup.
async function siteBelongsToOneRestaurant(website: string) {
  const row = await env.DB.prepare(
    "SELECT (SELECT COUNT(*) FROM restaurants WHERE website=?1) AS by_site," +
      "(SELECT COUNT(*) FROM deals WHERE source_url=?1) AS source_rows," +
      "(SELECT COUNT(DISTINCT restaurant_id) FROM deals WHERE source_url=?1 AND restaurant_id IS NOT NULL) AS by_source",
  )
    .bind(website)
    .first<{ by_site: number; source_rows: number; by_source: number }>();
  if (!row) return false;
  const bySite = row.by_site ?? 0;
  // Ours at all: named by a restaurant, or by a deal — including one not yet attached to a
  // restaurant, which the previous join also accepted.
  if (bySite === 0 && (row.source_rows ?? 0) === 0) return false;
  // Ours alone: a page several restaurants name is an aggregator listing, not anyone's own site.
  return Math.max(bySite, row.by_source ?? 0) <= 1;
}

// A status that means "not now" rather than "no": a server that is overloaded, down for a moment, or
// asking to be called less often. The answer it gives is remembered like a site that could not be
// reached at all (RETRY_SECONDS), not for the week a real "nothing usable here" earns - a browser
// cannot be told to forget, so a site that was unwell for a minute would otherwise show its emoji to
// everyone who asked during that minute for a week.
function isPassing(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

// Only the start of a page is read. og:image sits in <head> and the useful <img> tags come early,
// while the page is someone else's to make as large as they like: read whole, a site that answered
// with an endless body would hold the Worker until it ran out of memory.
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

// Throws for a passing status, which the caller answers the way it answers a fetch that threw.
async function findPhotoCandidates(pageUrl: string) {
  const pageResponse = await fetch(pageUrl, { headers: { "user-agent": BROWSER_UA, accept: "text/html" } });
  if (!pageResponse.ok) {
    await pageResponse.body?.cancel();
    if (isPassing(pageResponse.status)) throw new Error(`the site answered ${pageResponse.status}`);
    return [];
  }
  const html = new TextDecoder().decode(await readStreamCapped(pageResponse.body, MAX_PAGE_BYTES, "truncate"));
  return photoCandidates(html, pageResponse.url);
}

// Returns null for anything this route will not serve — not a JPEG, PNG or WebP, or over the size
// ceiling — leaving the caller to try the next candidate. Every rejected body is canceled rather
// than abandoned: an unread response body holds its stream open behind it. A candidate refused
// with a passing status is noted, so that if nothing else works the "no" is only kept for a day.
//
// The type is an allowlist, compared after normalizing, and it is the normalized type that goes
// back out, never the upstream header. These bytes are served from radar.cheap, so whatever type
// they carry decides what a browser does with them when someone opens the URL directly. A check
// that only looked for "image/" and "svg" let `image/SVG+xml` through (browsers lowercase it and
// run the SVG's scripts on our origin) and `image/png, text/html` (browsers take the last type).
// scripts/fetch-restaurant-photos.mjs applies the same rule before it stores anything.
async function fetchWithinBudget(photoUrl: string, note: { passing: boolean }) {
  const response = await fetch(photoUrl, { headers: { "user-agent": BROWSER_UA } });
  const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!response.ok || !PHOTO_TYPES.has(contentType)) {
    if (!response.ok && isPassing(response.status)) note.passing = true;
    await response.body?.cancel();
    return null;
  }
  // The declared length first, so a 10 MB photo is refused without ever being pulled through the
  // worker. A missing header reads as 0 here and simply falls through to the real check below,
  // which is the one that cannot be fooled.
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_PHOTO_BYTES) {
    await response.body?.cancel();
    return null;
  }
  // Read through the cap rather than whole, so a body that declared nothing, or declared less than
  // it sends, is stopped at the ceiling instead of after it.
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readStreamCapped(response.body, MAX_PHOTO_BYTES);
  } catch (error) {
    if (isPayloadTooLarge(error)) return null;
    throw error;
  }
  // A body that disagrees with the length its own server declared was cut short somewhere, and a
  // short photo is the top of a picture over grey. Served, it would be cached here and at the edge
  // for a day. Only compared when the body arrived as sent: a compressed response declares its
  // compressed length and is handed over decompressed.
  const encoding = (response.headers.get("content-encoding") || "identity").trim().toLowerCase();
  if (declared > 0 && encoding === "identity" && bytes.byteLength !== declared) return null;
  // A thumbnail stretched across a card looks worse than the emoji it replaced, and several of
  // these sites offer a 196x196 location thumbnail before anything larger.
  if (isTooSmall(bytes)) return null;
  return { bytes, contentType };
}

// "No photo", said so that it is asked once rather than on every view.
//
// app/CardMedia.tsx asks this route about every restaurant with no stored photo or logo, and for
// some sites the answer is always no: the site refuses the fetch, or offers nothing usable. The
// 404 used to go out with no Cache-Control, so a browser asked again on every card and every page
// it drew, each a Worker request for a foregone answer, and a site that could not be reached at
// all (the fetch threw) was searched afresh every time.
//
// Now every "no" carries its own lifetime, for the colo's copy and the browser's alike. A week when
// the site was searched and had nothing to offer: that changes when the site does, and a staff edit
// that gives the restaurant a photo or a logo stops the card asking here at all. A day when the site
// could not be reached or answered with a passing status (isPassing: 5xx, 429 and the like), which
// may clear by itself, or is not one this route proxies, which a staff edit to a restaurant's
// website can change.
const NO_PHOTO_SECONDS = 7 * 86_400;
const RETRY_SECONDS = 86_400;

function noPhoto(seconds: number) {
  return new Response(null, { status: 404, headers: { "cache-control": `public, max-age=${seconds}` } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const website = url.searchParams.get("url")?.trim();
  if (!website) return new Response(null, { status: 400 });
  let parsedTarget: URL;
  try {
    parsedTarget = new URL(website);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (parsedTarget.protocol !== "http:" && parsedTarget.protocol !== "https:") return new Response(null, { status: 400 });

  const cache = (caches as unknown as { default: Cache }).default;
  // Keyed by deploy, the way worker/index.ts keys its page cache. Photos are cached for a day and
  // declines for up to a week, so without this a change to what counts as an acceptable photo would
  // not reach anyone already holding an entry — which is exactly what happened when the size ceiling
  // first shipped: the colo went on serving a 2.1 MB image it had cached before the rule existed,
  // and the aggregator banner this route now refuses.
  const version = (env as unknown as { CF_VERSION?: { id: string } }).CF_VERSION?.id || "dev";
  // Keyed on the one parameter that decides the answer, not the whole query string: otherwise
  // `&x=1`, `&x=2`, ... would each miss the cache and each send this route back out to the site.
  const cacheKey = new Request(`${url.origin}/__photo-cache/${version}${url.pathname}?url=${encodeURIComponent(website)}`, { method: "GET" });
  // Looked up ahead of the ownership check, so a known answer costs no D1 read. That opens nothing:
  // only this route writes under /__photo-cache/ (worker/index.ts refuses the prefix to visitors),
  // and it writes only below, for a site that has already passed the check under this deploy.
  //
  // Read in full and sent as bytes, the way app/api/photo sends R2's, with the length declared, so a
  // copy cut off in transit reads as a failed download rather than a finished picture (worker/index.ts
  // keeps that length on the wire). A hit that cannot be read is treated as a miss.
  const cached = await cache.match(cacheKey);
  if (cached) {
    try {
      const bytes = await cached.arrayBuffer();
      const headers = new Headers(cached.headers);
      headers.set("content-length", String(bytes.byteLength));
      // A stored "no" has no body, and is sent with none rather than as an empty stream.
      return new Response(bytes.byteLength ? bytes : null, { status: cached.status, headers });
    } catch {
      // Fall through to a fresh search.
    }
  }

  // Not proxied: a URL that is not in our data, or one several restaurants share. Answered from D1
  // on each request the browser makes, and not stored in the colo, since the URL is the visitor's to
  // choose and every one would be a new entry.
  if (!(await siteBelongsToOneRestaurant(website))) return noPhoto(RETRY_SECONDS);

  // A 404 is not a failure here: app/CardMedia.tsx renders the deal's emoji whenever this route
  // declines, so "no photo we are willing to serve" and "no photo at all" land on the same
  // deliberate fallback. Stored, so a page whose images are all too heavy is not re-fetched and
  // re-measured on every request; a failed write only means the next request searches again.
  const decline = async (seconds: number) => {
    await cache.put(cacheKey, noPhoto(seconds)).catch(() => {});
    return noPhoto(seconds);
  };

  try {
    const note = { passing: false };
    for (const candidate of await findPhotoCandidates(website)) {
      const photo = await fetchWithinBudget(candidate, note);
      if (!photo) continue;
      // A day, not a month. This header is public, so Cloudflare's own edge cache honors it and
      // serves the response ahead of the worker — which means it outlives any change to the rules
      // above, and the version-scoped key below cannot reach it. A month of that is how production
      // went on serving a 2.1 MB image for abrielle.ca after the size ceiling shipped, and an
      // aggregator's banner after this route learned to refuse it. The cost of a day is one fetch
      // per restaurant per day on a path that is now only the fallback: restaurants.photo_url,
      // filled ahead of time, is what most cards use.
      const imageHeaders = {
        "content-type": photo.contentType,
        "content-length": String(photo.bytes.byteLength),
        "cache-control": "public, max-age=86400",
      };
      // A failed write costs the next request a search, not this one its photo.
      await cache.put(cacheKey, new Response(photo.bytes, { status: 200, headers: imageHeaders })).catch(() => {});
      return new Response(photo.bytes, { status: 200, headers: imageHeaders });
    }
    return decline(note.passing ? RETRY_SECONDS : NO_PHOTO_SECONDS);
  } catch {
    return decline(RETRY_SECONDS);
  }
}
