import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The render watchdog's own pieces, run rather than read. worker/render-watchdog.ts imports
// nothing, so it can be loaded here on its own; the Worker entry around it cannot, and its wiring is
// exercised against the build in tests/worker-reliability.test.mjs.
//
// Each load is a fresh module instance, so the isolate-wide "timed out recently" record starts
// clean for every test that loads its own copy — the same thing a new isolate gets.
const load = async () => {
  const source = await readFile(new URL("../worker/render-watchdog.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(`${compiled}\n// ${Math.random()}`).toString("base64")}`);
};

const never = () => new Promise(() => {});

test("a render that never answers loses to the deadline, and on time", async () => {
  const watchdog = await load();
  const started = Date.now();
  const outcome = await watchdog.withinDeadline(never(), 50);
  const elapsed = Date.now() - started;
  assert.equal(outcome, watchdog.RENDER_TIMED_OUT);
  assert.ok(elapsed >= 45 && elapsed < 1_000, `took ${elapsed} ms`);
});

test("a render that answers in time is passed through untouched", async () => {
  const watchdog = await load();
  const response = new Response("page", { status: 200 });
  assert.equal(await watchdog.withinDeadline(Promise.resolve(response), 1_000), response);
  // And a render that fails before the deadline still fails, rather than being turned into a 503.
  await assert.rejects(watchdog.withinDeadline(Promise.reject(new Error("boom")), 1_000), /boom/);
});

test("a render that answers after the deadline has its body released", async () => {
  const watchdog = await load();
  let canceled = false;
  const body = new ReadableStream({ cancel() { canceled = true; } });
  let finish;
  const late = new Promise((resolve) => { finish = resolve; });
  assert.equal(await watchdog.withinDeadline(late, 10), watchdog.RENDER_TIMED_OUT);
  finish(new Response(body));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(canceled, "nobody will read the late response, so its stream must not be left open");
});

// The failure this exists for does not clear by itself: every later render on a wedged isolate
// awaits the same stuck load. So after one miss the isolate stops holding each visitor for the full
// deadline, and a minute without another miss puts it back.
test("the deadline shortens after a miss and recovers a minute later", async () => {
  const watchdog = await load();
  const now = 1_000_000;
  assert.equal(watchdog.renderDeadlineMs(now), watchdog.RENDER_DEADLINE_MS);
  assert.equal(watchdog.RENDER_DEADLINE_MS, 8_000);
  watchdog.noteRenderTimeout(now);
  assert.equal(watchdog.renderDeadlineMs(now + 1), watchdog.WEDGED_RENDER_DEADLINE_MS);
  assert.ok(watchdog.WEDGED_RENDER_DEADLINE_MS < watchdog.RENDER_DEADLINE_MS / 4);
  assert.equal(watchdog.renderDeadlineMs(now + watchdog.WEDGED_WINDOW_MS - 1), watchdog.WEDGED_RENDER_DEADLINE_MS);
  assert.equal(watchdog.renderDeadlineMs(now + watchdog.WEDGED_WINDOW_MS), watchdog.RENDER_DEADLINE_MS);
  assert.equal(watchdog.renderTimeoutCount(), 1);
});

test("the RENDER_DEADLINE_MS var replaces the deadline, and never lengthens the wedged one", async () => {
  const watchdog = await load();
  assert.equal(watchdog.renderDeadlineMs(0, "40"), 40);
  assert.equal(watchdog.renderDeadlineMs(0, "600000"), 600_000);
  // Anything that is not a positive number is ignored rather than turned into a zero deadline.
  for (const junk of ["", "0", "-5", "soon", undefined]) assert.equal(watchdog.renderDeadlineMs(0, junk), 8_000);
  watchdog.noteRenderTimeout(0);
  assert.equal(watchdog.renderDeadlineMs(1, "600000"), watchdog.WEDGED_RENDER_DEADLINE_MS);
  assert.equal(watchdog.renderDeadlineMs(1, "40"), 40);
});

test("only a browser loading a page counts as a document request", async () => {
  const { isDocumentRequest } = await load();
  const page = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const url = new URL("https://radar.cheap/fr/deals/x");
  assert.equal(isDocumentRequest(new Request(url, { headers: { accept: page } }), url), true);
  assert.equal(isDocumentRequest(new Request(url, { headers: { accept: page, RSC: "1" } }), url), false);
  assert.equal(isDocumentRequest(new Request(url, { headers: { accept: page, "Next-Router-State-Tree": "%5B%5D" } }), url), false);
  const flight = new URL("https://radar.cheap/fr/deals/x.rsc");
  assert.equal(isDocumentRequest(new Request(flight, { headers: { accept: page } }), flight), false);
  assert.equal(isDocumentRequest(new Request(url, { headers: { accept: "application/json" } }), url), false);
  assert.equal(isDocumentRequest(new Request(url), url), false);
});

// A page navigation that hit the admission gate used to be shown raw English JSON, in /fr and /es
// too. A browser now gets a small page in the path's language that retries by itself.
test("a browser gets a small page in its language; anything else gets the JSON error", async () => {
  const { unavailableResponse } = await load();
  const cases = [
    ["https://radar.cheap/fr/deals/x", "fr", /Cette page ne s'est pas chargée/],
    ["https://radar.cheap/es/sign-in", "es", /Esta página no se cargó/],
    ["https://radar.cheap/en", "en", /This page didn't load/],
    ["https://radar.cheap/admin", "en", /This page didn't load/],
  ];
  for (const [href, lang, heading] of cases) {
    const url = new URL(href);
    for (const reason of ["overloaded", "timeout"]) {
      const response = unavailableResponse(new Request(url, { headers: { accept: "text/html" } }), url, reason);
      assert.equal(response.status, 503);
      assert.match(response.headers.get("content-type"), /^text\/html/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("retry-after"), reason === "overloaded" ? "2" : "5");
      const html = await response.text();
      assert.match(html, new RegExp(`<html lang="${lang}">`));
      assert.match(html, heading);
      assert.match(html, /<meta http-equiv="refresh" content="5">/, "the page retries by itself");
      assert.match(html, /<meta name="robots" content="noindex">/);
      // Self-contained: nothing that would be one more request to a Worker already failing.
      assert.doesNotMatch(html, /<script|<link|<img|src=/);
    }
  }
  const url = new URL("https://radar.cheap/fr/deals/x");
  const flight = unavailableResponse(new Request(url, { headers: { accept: "text/html", RSC: "1" } }), url, "timeout");
  assert.equal(flight.status, 503);
  assert.deepEqual((await flight.json()).error.code, "RENDER_TIMEOUT");
  const api = unavailableResponse(new Request("https://radar.cheap/api/deals"), new URL("https://radar.cheap/api/deals"), "overloaded");
  const body = await api.json();
  assert.equal(body.error.code, "OVERLOADED", "the code API clients and the app already handle");
  assert.equal(api.headers.get("retry-after"), "2");
});
