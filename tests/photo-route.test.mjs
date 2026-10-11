// Exercises app/api/photo against a stand-in R2 bucket. What matters here is a behavior rather than
// a string: whether a 200 carrying a year of immutable caching can ever hold less than the whole
// photo. On production 16 of 18 fetches did, each one a clean-looking 200, because the route
// streamed R2's body with no Content-Length and a chunked body that stops early still ends
// normally. Browsers kept the top of the photo over grey for the year the header promised.
//
// `cloudflare:workers` is aliased to a data: module the way tests/restaurant-photo.test.mjs does it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

const ALIAS = `data:text/javascript,${encodeURIComponent("export const env = globalThis.__TEST_ENV__;\n")}`;
globalThis.__TEST_ENV__ = {};
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: ALIAS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const { GET } = await import("../app/api/photo/[...key]/route.ts");

const KEY = "restaurants/union613-ottawa-restaurant/1789690910554-871a7548.png";
const ask = (key = KEY) => GET(new Request(`https://radar.cheap/api/photo/${key}`), { params: Promise.resolve({ key: key.split("/") }) });

// An R2 object as the binding hands it back. `size` is what R2 recorded at upload; `read` is how
// many bytes a read of it actually yields, which is where a cut-short transfer shows up. Touching
// `body` is recorded, because streaming it is the thing that went wrong.
function install({ size = 741_846, read = size, fail = false, type = "image/png", missing = false } = {}) {
  const state = { bodyTouched: false, asked: [] };
  const bytes = new Uint8Array(read).map((_, i) => i % 251);
  globalThis.__TEST_ENV__.PHOTOS = {
    async get(key) {
      state.asked.push(key);
      if (missing) return null;
      return {
        size,
        httpEtag: '"f023a1486239965233de7682e4091c0c"',
        writeHttpMetadata(headers) {
          headers.set("content-type", type);
        },
        get body() {
          state.bodyTouched = true;
          return new Response(bytes).body;
        },
        async arrayBuffer() {
          if (fail) throw new Error("Network connection lost.");
          return bytes.buffer.slice(0);
        },
      };
    },
  };
  return state;
}

test("a whole photo is sent with its length declared and cached for a year", async () => {
  install();
  const response = await ask();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-length"), "741846");
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("etag"), '"f023a1486239965233de7682e4091c0c"');
  assert.match(response.headers.get("cache-control"), /max-age=31536000, immutable/);
  assert.equal((await response.arrayBuffer()).byteLength, 741_846);
});

// A Content-Length header written by hand onto a streamed body is ignored by the Workers runtime;
// only a fixed-length body gets one. So R2's stream must not be what the route hands back.
test("the photo is sent as bytes, never as R2's stream", async () => {
  const state = install();
  await (await ask()).arrayBuffer();
  assert.equal(state.bodyTouched, false, "object.body must not be streamed into the response");
});

// The measured failure, one step earlier: a read that yields fewer bytes than R2 holds. It must not
// leave with a 200, and above all not with the immutable header.
test("a read that comes up short is refused and marked uncacheable", async () => {
  install({ size: 741_846, read: 266_240 });
  const response = await ask();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.doesNotMatch(response.headers.get("cache-control"), /immutable|max-age/);
  assert.equal((await response.arrayBuffer()).byteLength, 0);
});

test("a read that fails partway is refused and marked uncacheable", async () => {
  install({ fail: true });
  const response = await ask();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("a key with no object is a 404 the browser keeps for a day", async () => {
  install({ missing: true });
  const response = await ask();
  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), "public, max-age=86400");
});

// The deals snapshot lives in the same bucket under internal/, with no extension. The route only
// answers image keys, which is what keeps that object private.
test("a key that is not a photo is refused before R2 is asked", async () => {
  const state = install();
  assert.equal((await ask("internal/deals-snapshot/v9/current")).status, 400);
  assert.deepEqual(state.asked, []);
});

// Rewritten in place by scripts/resize-r2-photos.mjs, a ".png" key holds WebP. The browser goes by
// Content-Type, so the one R2 stored is the one that must be sent.
test("the stored content type is sent, whatever the key's extension", async () => {
  install({ size: 60_000, type: "image/webp" });
  const response = await ask();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
});
