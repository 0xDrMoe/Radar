// Exercises the real route rather than reading its source, which is worth the setup here: the
// whole point of the size cap is what the worker does or does not pull over the network, and that
// is a behavior, not a string. The route's one non-standard import is `cloudflare:workers`, so
// it is aliased to a data: module the same way scripts/prerender-deals.mjs aliases it, and the
// globals the route reaches for — fetch, caches — are stubs that record what was asked of them.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const ALIAS = `data:text/javascript,${encodeURIComponent("export const env = globalThis.__TEST_ENV__;\n")}`;
globalThis.__TEST_ENV__ = { DB: null };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: ALIAS, shortCircuit: true };
    // App code imports its own modules without a file extension, which the bundler resolves and
    // bare Node does not. Only the harness needs to know that, so the app keeps its own idiom.
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        return nextResolve(specifier, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../app/api/restaurant-photo/route.ts");
const { imageSize } = await import("../app/photo-candidates.ts");

const MAX_PHOTO_BYTES = 750 * 1024;
const SITE = "https://example-restaurant.test/";
const ask = (site = SITE) => new Request(`https://radar.cheap/api/restaurant-photo?url=${encodeURIComponent(site)}`);

// Records which bodies were actually pulled and which were canceled, which is the assertion that
// matters for the cap: a photo rejected on its declared size must never be read.
//
// The queuing strategy is the load-bearing part. A ReadableStream built with the default strategy
// pulls once as soon as it is constructed, before anyone reads it, so the flag would record every
// photo as downloaded and the test would be measuring stream setup rather than the route. At a
// high-water mark of 0 the source is pulled only when something actually asks for a chunk.
function photo(bytes, { declared = bytes, type = "image/jpeg", status = 200, body = null, encoding = null } = {}) {
  const state = { downloaded: false, canceled: false };
  const make = () => {
    const stream = new ReadableStream(
      {
        pull(controller) {
          state.downloaded = true;
          controller.enqueue(body ? body.slice() : new Uint8Array(bytes));
          controller.close();
        },
        cancel() {
          state.canceled = true;
        },
      },
      new CountQueuingStrategy({ highWaterMark: 0 }),
    );
    const headers = { "content-type": type };
    if (declared !== null) headers["content-length"] = String(declared);
    if (encoding) headers["content-encoding"] = encoding;
    return new Response(stream, { status, headers });
  };
  return { make, state };
}

// A byte-accurate PNG header at the requested size, so the size gate has something real to read.
function realPhoto(width, height, { padTo = 40 * 1024 } = {}) {
  const bytes = new Uint8Array(Math.max(padTo, 24));
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return photo(bytes.length, { type: "image/png", body: bytes });
}

function install({ html, photos = {}, known = true, sharedWith = 1 }) {
  const cacheStore = new Map();
  const requested = [];
  globalThis.caches = {
    default: {
      async match(request) {
        const hit = cacheStore.get(request.url);
        return hit ? hit.clone() : undefined;
      },
      async put(request, response) {
        cacheStore.set(request.url, response);
      },
    },
  };
  // Mirrors the shape the route's one query returns: whether the URL is ours at all, and how many
  // restaurants claim it.
  globalThis.__TEST_ENV__.CF_VERSION = { id: "test-version" };
  globalThis.__TEST_ENV__.DB = {
    prepare: () => ({
      bind: () => ({
        first: async () => ({ by_site: known ? sharedWith : 0, source_rows: known ? sharedWith : 0, by_source: 0 }),
      }),
    }),
  };
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    requested.push(url);
    if (url === SITE) {
      const page = new Response(html, { status: 200, headers: { "content-type": "text/html" } });
      // A real fetch reports the post-redirect URL here, and the route resolves relative image
      // paths against it.
      Object.defineProperty(page, "url", { value: SITE });
      return page;
    }
    const entry = photos[url];
    if (!entry) return new Response(null, { status: 404 });
    return entry.make();
  };
  return { cacheStore, requested };
}

const page = (...srcs) => `<html><head>${srcs
  .filter((src) => src.startsWith("og:"))
  .map((src) => `<meta property="og:image" content="${src.slice(3)}">`)
  .join("")}</head><body>${srcs
  .filter((src) => !src.startsWith("og:"))
  .map((src) => `<img src="${src}" alt="">`)
  .join("")}</body></html>`;

// The ordinary case, unchanged by the cap: a reasonable og:image is served as-is.
test("a photo within the cap is served", async () => {
  const small = photo(40 * 1024);
  install({ html: page("og:https://cdn.test/hero.jpg"), photos: { "https://cdn.test/hero.jpg": small } });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  // Declared, because worker/index.ts can only keep a length on the wire that the route states.
  assert.equal(response.headers.get("content-length"), String(40 * 1024));
  assert.equal((await response.arrayBuffer()).byteLength, 40 * 1024);
  assert.equal(small.state.downloaded, true);
});

// The reason for the cap. One restaurant's og:image is 10.9 MB; the worker has a tight CPU ceiling
// and the visitor has a phone. Rejecting it on the declared length means those bytes never cross
// the worker at all — checking after the download would defeat the purpose.
test("an oversized photo is rejected without being downloaded", async () => {
  const huge = photo(11 * 1024 * 1024);
  install({ html: page("og:https://cdn.test/huge.jpg"), photos: { "https://cdn.test/huge.jpg": huge } });
  const response = await GET(ask());
  assert.equal(response.status, 404);
  assert.equal(huge.state.downloaded, false, "the body of an over-cap photo must never be read");
  // And not simply abandoned either: an unread response body holds its connection open behind it.
  assert.equal(huge.state.canceled, true, "the rejected body must be canceled");
});

// content-length is a claim, not a measurement, and some servers omit it or get it wrong. The
// byte-length check is the one that cannot be fooled.
test("a photo that lies about its size is still rejected", async () => {
  const liar = photo(2 * 1024 * 1024, { declared: 1024 });
  install({ html: page("og:https://cdn.test/liar.jpg"), photos: { "https://cdn.test/liar.jpg": liar } });
  const response = await GET(ask());
  assert.equal(response.status, 404);
  assert.equal(liar.state.downloaded, true, "this one can only be caught by reading it");
});

test("a photo with no declared length is measured after download", async () => {
  const unknown = photo(20 * 1024, { declared: null });
  install({ html: page("og:https://cdn.test/nolen.jpg"), photos: { "https://cdn.test/nolen.jpg": unknown } });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 20 * 1024);
});

// The cut-short photo that app/api/photo was serving, arriving here from someone else's server
// instead: fewer bytes than the server said it was sending. Served, it would be the top of a
// picture over grey, cached for a day by the colo and the edge.
test("a photo that arrives shorter than its declared length is not served or cached", async () => {
  const short = photo(20 * 1024, { declared: 40 * 1024 });
  const { cacheStore } = install({ html: page("og:https://cdn.test/cut.jpg"), photos: { "https://cdn.test/cut.jpg": short } });
  const response = await GET(ask());
  assert.equal(response.status, 404);
  const cached = [...cacheStore.values()][0];
  assert.equal(cached.status, 404, "only the decline may be cached, never the short photo");
});

// A compressed response declares its compressed length and is read decompressed, so the two
// legitimately differ and the comparison must not throw a good photo away.
test("a compressed photo is not held to its compressed length", async () => {
  const gzipped = photo(20 * 1024, { declared: 9 * 1024, encoding: "gzip" });
  install({ html: page("og:https://cdn.test/gz.jpg"), photos: { "https://cdn.test/gz.jpg": gzipped } });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 20 * 1024);
});

// The cap alone would cost these restaurants their photo entirely. Most sites that publish a
// gigantic hero also carry a normal-sized photo further down the same page, so an over-cap
// og:image demotes to the next candidate rather than falling straight to the emoji.
test("an oversized og:image falls through to the next image on the page", async () => {
  const huge = photo(5 * 1024 * 1024);
  const usable = photo(90 * 1024);
  const { requested } = install({
    html: page("og:https://cdn.test/huge.jpg", "https://cdn.test/room.jpg"),
    photos: { "https://cdn.test/huge.jpg": huge, "https://cdn.test/room.jpg": usable },
  });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  assert.equal((await response.arrayBuffer()).byteLength, 90 * 1024);
  assert.equal(huge.state.downloaded, false);
  assert.deepEqual(requested, [SITE, "https://cdn.test/huge.jpg", "https://cdn.test/room.jpg"]);
});

// Only when nothing on the page fits does the route decline — and declining is a 404, because
// that is what app/CardMedia.tsx turns into the deal's emoji.
test("a page whose images are all too heavy falls back to the emoji", async () => {
  const { cacheStore } = install({
    html: page("og:https://cdn.test/a.jpg", "https://cdn.test/b.jpg"),
    photos: {
      "https://cdn.test/a.jpg": photo(3 * 1024 * 1024),
      "https://cdn.test/b.jpg": photo(MAX_PHOTO_BYTES + 1),
    },
  });
  const response = await GET(ask());
  assert.equal(response.status, 404);
  // Cached, so a page full of giants is not re-fetched and re-measured on every request - by the
  // colo, and by the browser from the first answer on, since every card and page for this
  // restaurant would otherwise ask again.
  const cached = [...cacheStore.values()][0];
  assert.equal(cached.status, 404);
  assert.equal(cached.headers.get("cache-control"), "public, max-age=604800");
  assert.equal(response.headers.get("cache-control"), "public, max-age=604800");
});

// Throwing is how a site that cannot be reached at all answers - no DNS, a broken certificate, a
// reset connection. It used to be the one "no" that was never stored, so the site was searched
// again on every view. Kept for a day rather than a week, since this one may be passing.
test("a site that cannot be reached is a day's no, and the colo keeps it", async () => {
  const { cacheStore } = install({ html: page() });
  const requested = [];
  globalThis.fetch = async (input) => {
    requested.push(typeof input === "string" ? input : input.url);
    throw new TypeError("fetch failed");
  };
  const response = await GET(ask());
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
  assert.equal([...cacheStore.values()][0]?.status, 404);
  assert.equal((await GET(ask())).status, 404);
  assert.deepEqual(requested, [SITE], "the second request is answered from the colo");
});

// A browser cannot be told to forget, so a "no" earned by a site that was only unwell for a moment -
// overloaded, rate-limiting, briefly down - is kept for the day an unreachable site gets, not the
// week a real "nothing usable here" gets. A refusal that is not passing (a 403) keeps its week.
test("a site that answers 5xx or 429 is a day's no, and a 403 is still a week's", async () => {
  for (const [status, seconds] of [[503, 86400], [500, 86400], [429, 86400], [403, 604800], [404, 604800]]) {
    const { cacheStore } = install({ html: page() });
    globalThis.fetch = async () => new Response("unwell", { status, headers: { "content-type": "text/html" } });
    const response = await GET(ask());
    assert.equal(response.status, 404, `site answered ${status}`);
    assert.equal(response.headers.get("cache-control"), `public, max-age=${seconds}`, `site answered ${status}`);
    assert.equal([...cacheStore.values()][0]?.headers.get("cache-control"), `public, max-age=${seconds}`, `site answered ${status}`);
  }
});

// The same for the photo itself: a page whose only candidate was refused with a 503 may have it
// next time.
test("a candidate refused with a passing status makes the no a day's", async () => {
  const unwell = photo(40 * 1024, { status: 503 });
  install({ html: page("og:https://cdn.test/hero.jpg"), photos: { "https://cdn.test/hero.jpg": unwell } });
  const response = await GET(ask());
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
  assert.equal(unwell.state.downloaded, false);
});

// A stored "no" is answered as it was stored, lifetime and all.
test("a cached no photo is served without searching again", async () => {
  const { requested } = install({ html: page("og:https://cdn.test/a.jpg"), photos: { "https://cdn.test/a.jpg": photo(3 * 1024 * 1024) } });
  assert.equal((await GET(ask())).status, 404);
  const before = requested.length;
  const again = await GET(ask());
  assert.equal(again.status, 404);
  assert.equal(again.headers.get("cache-control"), "public, max-age=604800");
  assert.equal(requested.length, before);
});

// Exactly at the ceiling is inside it; one byte over is not.
test("the cap is inclusive at the boundary", async () => {
  install({
    html: page("og:https://cdn.test/edge.jpg"),
    photos: { "https://cdn.test/edge.jpg": photo(MAX_PHOTO_BYTES) },
  });
  assert.equal((await GET(ask())).status, 200);

  install({
    html: page("og:https://cdn.test/edge.jpg"),
    photos: { "https://cdn.test/edge.jpg": photo(MAX_PHOTO_BYTES + 1) },
  });
  assert.equal((await GET(ask())).status, 404);
});

// Each candidate is a subrequest against someone else's server, and a photo gallery can carry
// dozens of images. Trying them all would turn one card into a crawl.
test("only a handful of candidates are tried", async () => {
  const many = Array.from({ length: 12 }, (_, i) => `https://cdn.test/g${i}.jpg`);
  const photos = Object.fromEntries(many.map((url) => [url, photo(2 * 1024 * 1024)]));
  const { requested } = install({ html: page(...many), photos });
  const response = await GET(ask());
  assert.equal(response.status, 404);
  const imageFetches = requested.filter((url) => url !== SITE);
  assert.ok(imageFetches.length <= 4, `tried ${imageFetches.length} candidates`);
});

// The cap must not become a way in: this route still only proxies URLs that belong to a
// restaurant already in our own data, and it decides that before it fetches anything.
test("an unknown site is refused before anything is fetched", async () => {
  const { requested, cacheStore } = install({ html: page("og:https://cdn.test/hero.jpg"), photos: {}, known: false });
  const response = await GET(ask("https://not-ours.test/"));
  assert.equal(response.status, 404);
  assert.deepEqual(requested, []);
  // The browser may keep the answer for a day, but the colo stores nothing for a URL the visitor
  // chose: every made-up one would be a new entry.
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
  assert.equal(cacheStore.size, 0);
});

// A URL listed against several restaurants is an aggregator's page, not a restaurant's website.
// One such page can be the "website" of dozens of restaurants; its og:image is the aggregator's
// banner, and serving it would paint one picture across every one of those cards.
test("an aggregator page shared by many restaurants is declined", async () => {
  const { requested } = install({
    html: page("og:https://cdn.test/banner.jpg"),
    photos: { "https://cdn.test/banner.jpg": realPhoto(1200, 630) },
    sharedWith: 19,
  });
  assert.equal((await GET(ask())).status, 404);
  assert.deepEqual(requested, [], "a shared site must not be fetched at all");
});

test("a site belonging to exactly one restaurant is still served", async () => {
  install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": realPhoto(1200, 630) },
    sharedWith: 1,
  });
  assert.equal((await GET(ask())).status, 200);
});

// The public cache-control on a served photo is honored by Cloudflare's own edge cache, which
// answers ahead of the worker — so this header, not the Cache API key below, decides how long a
// decision made by the rules above can outlive them. A month of it is how production kept serving a
// 2.1 MB image after the size ceiling shipped.
test("a served photo is not cached for longer than the rules that chose it", async () => {
  const { cacheStore } = install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": realPhoto(1200, 630) },
  });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("cache-control"))?.[1]);
  assert.ok(maxAge > 0, "a photo should still be cached");
  assert.ok(maxAge <= 86400, `max-age=${maxAge} outlives the rules that chose the photo`);
  const stored = [...cacheStore.values()][0];
  assert.equal(stored.headers.get("cache-control"), response.headers.get("cache-control"));
});

// The cache entry is keyed by deploy. Photos are held for a day and declines for up to a week, so
// a change to what counts as an acceptable photo would otherwise not reach anyone already holding
// an entry — which is what happened when the size ceiling first shipped: the colo kept serving a
// 2.1 MB image it had cached before the rule existed.
test("cache entries are scoped to the deployed version", async () => {
  const { cacheStore } = install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": realPhoto(1200, 630) },
  });
  assert.equal((await GET(ask())).status, 200);
  const keys = [...cacheStore.keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].includes("test-version"), `cache key ${keys[0]} must carry the deploy version`);
});

// A cached photo is served without re-fetching the restaurant's site.
test("a cached photo is served without touching the origin", async () => {
  const small = photo(30 * 1024);
  const { requested } = install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": small },
  });
  assert.equal((await GET(ask())).status, 200);
  const before = requested.length;
  const second = await GET(ask());
  assert.equal(second.status, 200);
  assert.equal(requested.length, before, "the second request must not re-fetch");
  assert.equal((await second.arrayBuffer()).byteLength, 30 * 1024, "the cached photo must come back whole");
});

// A hit is read in full before it is sent, so a cached copy that cannot be read is a miss rather
// than a reply that breaks off partway.
test("a cached photo that cannot be read is fetched afresh", async () => {
  const { cacheStore, requested } = install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": photo(30 * 1024) },
  });
  assert.equal((await GET(ask())).status, 200);
  const [key] = [...cacheStore.keys()];
  const broken = new ReadableStream({ pull(controller) { controller.error(new Error("Network connection lost.")); } });
  cacheStore.set(key, new Response(broken, { status: 200, headers: { "content-type": "image/jpeg" } }));
  const before = requested.length;
  const again = await GET(ask());
  assert.equal(again.status, 200);
  assert.equal((await again.arrayBuffer()).byteLength, 30 * 1024);
  assert.ok(requested.length > before, "an unreadable hit must fall through to a fresh search");
});

// SVG is still refused regardless of size — it is markup, and this route hands what it gets
// straight to an <img> on our own origin.
test("svg is refused even when it is small", async () => {
  install({
    html: page("og:https://cdn.test/room.jpg"),
    photos: { "https://cdn.test/room.jpg": photo(900, { type: "image/svg+xml" }) },
  });
  assert.equal((await GET(ask())).status, 404);
});

// A venue's social share image is very often its own logo — Boston Pizza's is
// seo-logo-1200x630.png, shared by all 13 of its locations, and La Cage's is logo-cage.jpeg. A
// board of identical brand marks reads worse than a board of emoji, so these are not candidates.
test("a brand logo is not treated as a photo", async () => {
  const { requested } = install({
    html: page("og:https://cdn.test/seo-logo-1200x630.png", "https://cdn.test/room.jpg"),
    photos: {
      "https://cdn.test/seo-logo-1200x630.png": photo(60 * 1024),
      "https://cdn.test/room.jpg": realPhoto(1200, 800),
    },
  });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  assert.ok(!requested.includes("https://cdn.test/seo-logo-1200x630.png"), "the logo must not even be fetched");
});

test("a badge is not treated as a photo either", async () => {
  const { requested } = install({
    html: page("og:https://cdn.test/ADACP-Badge.png"),
    photos: { "https://cdn.test/ADACP-Badge.png": photo(291 * 1024) },
  });
  assert.equal((await GET(ask())).status, 404);
  assert.deepEqual(requested, [SITE]);
});

// Only the filename is tested, so a real photograph is not thrown away for a word buried in a long
// CDN path.
test("a photo is kept when the hint is only in the path, not the filename", async () => {
  install({
    html: page("og:https://cdn.test/logos-and-assets/2026/patio-at-dusk.jpg"),
    photos: { "https://cdn.test/logos-and-assets/2026/patio-at-dusk.jpg": realPhoto(1200, 800) },
  });
  assert.equal((await GET(ask())).status, 200);
});

// Several of these sites offer a 196x196 Yext location thumbnail before anything larger. Stretched
// across a card at object-fit: cover it looks worse than the emoji it replaced.
test("a thumbnail is passed over for a real photo further down", async () => {
  install({
    html: page("og:https://cdn.test/thumb.jpg", "https://cdn.test/room.jpg"),
    photos: {
      "https://cdn.test/thumb.jpg": realPhoto(196, 196),
      "https://cdn.test/room.jpg": realPhoto(1200, 800),
    },
  });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  const size = imageSize(await response.arrayBuffer());
  assert.deepEqual(size, { width: 1200, height: 800 });
});

// The rule is about size, not shape. Kelsey's, Montana's, Swiss Chalet, Harvey's and East Side
// Mario's all publish a square 450x450 photograph of the restaurant, and an earlier width-based
// threshold threw every one of them away.
test("a square photograph is kept", async () => {
  install({
    html: page("og:https://cdn.test/square.jpg"),
    photos: { "https://cdn.test/square.jpg": realPhoto(450, 450) },
  });
  assert.equal((await GET(ask())).status, 200);
});

// A tall portrait shot is equally fine.
test("a portrait photograph is kept", async () => {
  install({
    html: page("og:https://cdn.test/tall.jpg"),
    photos: { "https://cdn.test/tall.jpg": realPhoto(377, 656) },
  });
  assert.equal((await GET(ask())).status, 200);
});

test("a page offering only thumbnails falls back to the emoji", async () => {
  install({
    html: page("og:https://cdn.test/a.jpg", "https://cdn.test/b.jpg"),
    photos: {
      "https://cdn.test/a.jpg": realPhoto(238, 80),
      "https://cdn.test/b.jpg": realPhoto(196, 196),
    },
  });
  assert.equal((await GET(ask())).status, 404);
});

// The gate rejects what it can measure and is too small. An image whose header it cannot read is
// kept, so an unusual but perfectly good format is never discarded for being unrecognized.
test("an image with an unreadable header is kept", async () => {
  install({
    html: page("og:https://cdn.test/odd.jpg"),
    photos: { "https://cdn.test/odd.jpg": photo(50 * 1024) },
  });
  assert.equal((await GET(ask())).status, 200);
});

// The type is what a browser goes by when someone opens this route's URL directly, and the bytes
// are served from radar.cheap. A check for "image/" that skipped anything containing a lowercase
// "svg" let both of these through, and either one runs script on the site.
test("an SVG declared in capitals is refused", async () => {
  install({
    html: page("og:https://cdn.test/room.jpg"),
    photos: { "https://cdn.test/room.jpg": photo(900, { type: "image/SVG+xml" }) },
  });
  assert.equal((await GET(ask())).status, 404);
});

test("a type list that ends in markup is refused", async () => {
  install({
    html: page("og:https://cdn.test/room.jpg"),
    photos: { "https://cdn.test/room.jpg": photo(900, { type: "image/png, text/html" }) },
  });
  assert.equal((await GET(ask())).status, 404);
});

test("only JPEG, PNG and WebP are served", async () => {
  install({
    html: page("og:https://cdn.test/room.gif"),
    photos: { "https://cdn.test/room.gif": photo(40 * 1024, { type: "image/gif" }) },
  });
  assert.equal((await GET(ask())).status, 404);
});

test("the photo goes out under its normalized type, not the upstream header", async () => {
  install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": photo(40 * 1024, { type: "Image/JPEG; charset=binary" }) },
  });
  const response = await GET(ask());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
});

// The cache answers for the site, so padding the query string cannot send the route back out to it.
test("extra query parameters share the one cache entry", async () => {
  const { cacheStore, requested } = install({
    html: page("og:https://cdn.test/hero.jpg"),
    photos: { "https://cdn.test/hero.jpg": photo(30 * 1024) },
  });
  assert.equal((await GET(ask())).status, 200);
  const before = requested.length;
  const padded = new Request(`${ask().url}&x=${Math.random()}`);
  assert.equal((await GET(padded)).status, 200);
  assert.equal(requested.length, before, "a padded URL must be answered from the cache");
  assert.equal(cacheStore.size, 1);
});

// A site that answers with an endless page holds the Worker only as far as the cap.
test("only the start of a page is read", async () => {
  install({ html: "", photos: { "https://cdn.test/hero.jpg": photo(30 * 1024) } });
  const routed = globalThis.fetch;
  let served = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url !== SITE) return routed(input);
    const head = new TextEncoder().encode(page("og:https://cdn.test/hero.jpg"));
    const filler = new Uint8Array(64 * 1024).fill(0x20);
    let first = true;
    const stream = new ReadableStream({
      pull(controller) {
        const chunk = first ? head : filler;
        first = false;
        served += chunk.byteLength;
        controller.enqueue(chunk);
      },
    }, new CountQueuingStrategy({ highWaterMark: 0 }));
    const response = new Response(stream, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(response, "url", { value: SITE });
    return response;
  };
  const response = await GET(ask());
  assert.equal(response.status, 200, "the og:image near the top is still found");
  assert.ok(served <= 4 * 1024 * 1024 + 64 * 1024, `read ${served} bytes of an endless page`);
});
