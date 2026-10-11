// Photos as a visitor receives them: through the Worker's own fetch handler, the built bundle in
// dist/server, rather than the route on its own. Needs `npm run build` first.
//
// tests/photo-route.test.mjs calls app/api/photo directly, and there the reply declares its
// Content-Length. Production sent every photo GET chunked with no length all the same (only HEAD,
// which has no body, showed one), because between the route and the visitor sit the framework,
// which passes every route handler's body through a stream of its own, and worker/index.ts, which
// builds one more Response around that. A route-level test cannot see either.
//
// Node cannot see it directly either: it has no FixedLengthStream, and its Response keeps whatever
// Content-Length header it is given, so the header alone says nothing about the wire. What decides
// the wire in workerd is the body. Bytes, or the readable side of a FixedLengthStream, go out with
// their length; any other stream goes out chunked, whatever the headers say. So the stand-in below
// marks the streams it makes, and wireLength() gives the answer workerd would. Checked against real
// workerd before this was written: the same GET went from chunked to Content-Length: 27520.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";

const ALIAS = `data:text/javascript,${encodeURIComponent(`
export const env = new Proxy({}, { get: (_target, key) => globalThis.__TEST_ENV__?.[key] });
export const waitUntil = (promise) => { if (promise && typeof promise.catch === "function") promise.catch(() => {}); };
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: ALIAS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

// workerd's FixedLengthStream, as much of it as matters here: an identity transform that promises a
// length, and errors if the bytes through it come to anything else.
const promised = new WeakMap();
class FixedLengthStream extends TransformStream {
  constructor(length) {
    let seen = 0;
    super({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        if (seen > length) controller.error(new TypeError("body longer than its declared length"));
        else controller.enqueue(chunk);
      },
      flush(controller) {
        if (seen !== length) controller.error(new TypeError("body shorter than its declared length"));
      },
    });
    promised.set(this.readable, length);
  }
}
globalThis.FixedLengthStream = FixedLengthStream;

// The Content-Length workerd would put on the wire for this response, or null for chunked.
function wireLength(response) {
  if (!response.body) return response.headers.has("content-length") ? Number(response.headers.get("content-length")) : null;
  return promised.has(response.body) ? promised.get(response.body) : null;
}

// Fetch as the restaurant-photo route sees it, captured by the framework when the bundle loads, so
// it is installed first and answers through whatever the current test put in `sites`.
let sites = () => new Response(null, { status: 404 });
const fetched = [];
globalThis.fetch = async (input) => {
  const url = typeof input === "string" ? input : input.url;
  fetched.push(url);
  return sites(url);
};

// The colo cache, keyed by URL like the real one.
function fakeCaches() {
  const store = new Map();
  globalThis.caches = {
    default: {
      async match(request) {
        const hit = store.get(typeof request === "string" ? request : request.url);
        return hit ? hit.clone() : undefined;
      },
      async put(request, response) {
        store.set(typeof request === "string" ? request : request.url, response);
      },
    },
  };
  return store;
}

const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
const CTX = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); }, passThroughOnException() {} };

function call(env, href, init = {}) {
  globalThis.__TEST_ENV__ = env;
  return worker.fetch(new Request(href, { headers: { "user-agent": "Mozilla/5.0 (test)", accept: "image/avif,image/webp,*/*" }, ...init }), env, CTX);
}

const KEY = "restaurants/union613-ottawa-restaurant/1789690910554-871a7548.png";
const SIZE = 741_846;

// R2 as the binding hands an object back.
function photos({ size = SIZE, type = "image/png" } = {}) {
  const bytes = new Uint8Array(size).map((_, i) => i % 251);
  return {
    async get(key) {
      if (key !== KEY) return null;
      return {
        size,
        httpEtag: '"f023a1486239965233de7682e4091c0c"',
        writeHttpMetadata(headers) { headers.set("content-type", type); },
        get body() { return new Response(bytes).body; },
        async arrayBuffer() { return bytes.buffer.slice(0); },
      };
    },
  };
}

// D1 answering the restaurant-photo route's one question: is this URL one restaurant's own site.
function ownership({ bySite = 1 } = {}) {
  const asked = [];
  return {
    asked,
    prepare: (sql) => ({
      bind: (...args) => ({
        first: async () => {
          asked.push({ sql, args });
          return { by_site: bySite, source_rows: 0, by_source: 0 };
        },
      }),
    }),
  };
}

// A byte-accurate PNG header at the given size, so the proxy's thumbnail gate has something to read.
function png(width, height, size = 48 * 1024) {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

const SITE = "https://barleymow.test/";
const ask = (site = SITE) => `https://radar.cheap/api/restaurant-photo?url=${encodeURIComponent(site)}`;

test("a photo GET through the Worker goes out with its length, not chunked", async () => {
  const response = await call({ PHOTOS: photos() }, `https://radar.cheap/api/photo/${KEY}?v=2`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), String(SIZE));
  assert.equal(wireLength(response), SIZE, "the body must be one the runtime can send with a Content-Length");
  assert.match(response.headers.get("cache-control"), /max-age=31536000, immutable/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", "still under the security headers");
  assert.equal((await response.arrayBuffer()).byteLength, SIZE);
});

// An image is never a document anything runs in, whatever it turns out to contain. The page policy
// allows inline script, so an image served under it would run any script a browser found in it.
test("an image goes out under a policy that runs nothing", async () => {
  const response = await call({ PHOTOS: photos() }, `https://radar.cheap/api/photo/${KEY}`);
  assert.equal(response.status, 200);
  const policy = response.headers.get("content-security-policy");
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /sandbox/);
  assert.doesNotMatch(policy, /script-src/);
});

test("a HEAD for a photo carries the same length and no body", async () => {
  const response = await call({ PHOTOS: photos() }, `https://radar.cheap/api/photo/${KEY}?v=2`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(wireLength(response), SIZE);
});

// The Node prerender and every other Node test load the same bundle, and none of them has the
// runtime's stream. There the body is passed on as it is.
test("without FixedLengthStream the photo still arrives whole", async () => {
  delete globalThis.FixedLengthStream;
  try {
    const response = await call({ PHOTOS: photos({ size: 60_000, type: "image/webp" }) }, `https://radar.cheap/api/photo/${KEY}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.equal((await response.arrayBuffer()).byteLength, 60_000);
  } finally {
    globalThis.FixedLengthStream = FixedLengthStream;
  }
});

test("a photo found by the restaurant-photo proxy goes out with its length too", async () => {
  fakeCaches();
  const image = png(1200, 800);
  sites = (url) => {
    if (url === SITE) {
      const page = new Response(`<html><head><meta property="og:image" content="https://cdn.barleymow.test/room.png"></head></html>`, { headers: { "content-type": "text/html" } });
      Object.defineProperty(page, "url", { value: SITE });
      return page;
    }
    if (url === "https://cdn.barleymow.test/room.png") return new Response(image.slice(), { headers: { "content-type": "image/png", "content-length": String(image.byteLength) } });
    return new Response(null, { status: 404 });
  };
  const response = await call({ DB: ownership(), CF_VERSION: { id: "v1" } }, ask());
  assert.equal(response.status, 200);
  assert.equal(wireLength(response), image.byteLength);
  assert.equal((await response.arrayBuffer()).byteLength, image.byteLength);
});

// Some restaurant sites refuse the fetch, so the answer is always no. It used to leave with no
// Cache-Control, and a browser asked again on every card and page that drew the restaurant.
test("the proxy's 'no photo' is kept by the browser, and asking again costs no search and no D1 read", async () => {
  fakeCaches();
  sites = (url) => new Response("Access Denied", { status: url === SITE ? 403 : 404 });
  const db = ownership();
  const env = { DB: db, CF_VERSION: { id: "v1" } };
  fetched.length = 0;
  const first = await call(env, ask());
  assert.equal(first.status, 404);
  assert.equal(first.headers.get("cache-control"), "public, max-age=604800");
  assert.equal(first.headers.get("x-content-type-options"), "nosniff");
  const searches = fetched.length;
  const reads = db.asked.length;
  assert.equal(searches, 1);

  const second = await call(env, ask());
  assert.equal(second.status, 404);
  assert.equal(second.headers.get("cache-control"), "public, max-age=604800");
  assert.equal(fetched.length, searches, "the site is not searched again");
  assert.equal(db.asked.length, reads, "a known answer needs no ownership check");
});

// Pages are streamed on purpose, and an asset-layer file is passed on as the asset layer sent it.
test("a page is never held to a declared length", async () => {
  const html = "<html><body>baked at deploy</body></html>";
  const assets = {
    async fetch(request) {
      if (new URL(request.url).pathname !== "/en/deals/barley-mow-wings") return new Response("Not found", { status: 404 });
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "content-length": String(html.length) } });
    },
  };
  const response = await call({ ASSETS: assets }, "https://radar.cheap/en/deals/barley-mow-wings", { headers: { accept: "text/html" } });
  assert.equal(response.status, 200);
  assert.equal(promised.has(response.body), false);
  assert.equal(await response.text(), html);
});

// Every API answer that does not choose a cache policy is somebody's own, or an error, and is kept
// by nothing between the Worker and the reader.
test("an API answer that sets no caching policy is sent as no-store", async () => {
  const response = await call({}, "https://radar.cheap/api/restaurant-photo");
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  // One that chose a policy keeps it.
  const photo = await call({ PHOTOS: photos() }, `https://radar.cheap/api/photo/${KEY}`);
  assert.match(photo.headers.get("cache-control"), /immutable/);
});
