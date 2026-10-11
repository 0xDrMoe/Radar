// The Worker entry's reliability and URL rules, driven through the built bundle (dist/server) the
// way production runs them: a real fetch handler, a real render, and fakes only for what Node does
// not have — D1, the asset binding and the colo cache. Needs `npm run build` first.
//
// The render watchdog is the reason this file exists. Locale page renders on an isolate can hang;
// a render here is made to hang the same way, by a database that never answers, and the question
// is what the visitor gets and how soon.
import assert from "node:assert/strict";
import test from "node:test";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { code } from "./source.mjs";

// The app reads its bindings from cloudflare:workers; a proxy onto a global lets each test hand the
// render its own database.
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

// What the Worker writes with console.error, which is what `wrangler tail` shows in production.
// Collected rather than printed: several tests here make it log on purpose.
const logged = [];
console.error = (...args) => { logged.push(args.map(String).join(" ")); };

// A fresh import is a fresh isolate: its own admission slots and its own watchdog record.
async function isolate() {
  const url = new URL("../dist/server/index.js", import.meta.url);
  url.searchParams.set("isolate", `${process.pid}-${Date.now()}-${Math.random()}`);
  return (await import(url.href)).default;
}

const CTX = { waitUntil(promise) { Promise.resolve(promise).catch(() => {}); }, passThroughOnException() {} };
const PAGE = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

// D1 as the wedged isolate experienced it: every query is accepted and none ever answers.
function hangingD1(log = []) {
  const statement = (sql) => ({
    bind: () => statement(sql),
    first: () => { log.push(sql); return new Promise(() => {}); },
    all: () => { log.push(sql); return new Promise(() => {}); },
    run: () => { log.push(sql); return new Promise(() => {}); },
    raw: () => { log.push(sql); return new Promise(() => {}); },
  });
  return { prepare: (sql) => statement(sql), batch: () => new Promise(() => {}) };
}

// The asset binding, holding the baked deal pages named here and nothing else.
function assets(baked = {}) {
  return {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname in baked) return new Response(baked[pathname], { status: 200, headers: { "content-type": "text/html" } });
      return new Response("Not found", { status: 404 });
    },
  };
}

// The colo cache, keyed by URL like the real one.
function fakeCaches() {
  const store = new Map();
  return {
    store,
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
}

function storedPage(body, ageMs) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "x-radar-cached-at": String(Date.now() - ageMs),
      "x-radar-cached-set-cookie": "NEXT_LOCALE=en; Path=/; SameSite=lax; Secure",
    },
  });
}

async function timed(promise) {
  const started = Date.now();
  const value = await promise;
  return [value, Date.now() - started];
}

function call(worker, env, href, init = {}) {
  globalThis.__TEST_ENV__ = env;
  return worker.fetch(new Request(href, init), env, CTX);
}

const DAY = 24 * 60 * 60_000;

test("a page render that never finishes is answered from the colo's copy, even an expired one", async () => {
  const worker = await isolate();
  const cache = fakeCaches();
  globalThis.caches = cache;
  try {
    // Three days old: past the 24 hours a copy is normally served for, so the Worker tries to render
    // and the render hangs. The old copy is still the best answer there is.
    cache.store.set("https://radar.cheap/__page-cache/dev/en/deals/stuck-deal", storedPage("<html><body>the colo's copy</body></html>", 3 * DAY));
    const env = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "150" };
    const [response, elapsed] = await timed(call(worker, env, "https://radar.cheap/en/deals/stuck-deal", { headers: { accept: PAGE } }));
    assert.equal(response.status, 200);
    assert.match(await response.text(), /the colo's copy/);
    assert.ok(elapsed < 2_000, `answered after ${elapsed} ms`);
    assert.equal(response.headers.get("cache-control"), "private, no-cache");
    assert.equal(response.headers.get("set-cookie"), "NEXT_LOCALE=en; Path=/; SameSite=lax; Secure");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", "still under the security headers");
  } finally {
    delete globalThis.caches;
  }
});

test("with no copy to fall back on, a browser gets a 503 page in its language and a script gets JSON", async () => {
  const worker = await isolate();
  const env = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "150" };
  const [page, elapsed] = await timed(call(worker, env, "https://radar.cheap/fr/deals/stuck-deal", { headers: { accept: PAGE } }));
  assert.equal(page.status, 503);
  assert.ok(elapsed < 2_000, `answered after ${elapsed} ms`);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal(page.headers.get("retry-after"), "5");
  const html = await page.text();
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /La page a mis trop de temps à se charger\./);
  // Named in the log, so a wedged isolate shows up in `wrangler tail` with the route it is stuck on.
  assert.ok(
    logged.some((line) => line.includes("render watchdog") && line.includes("/fr/deals/stuck-deal") && line.includes("served a 503")),
    `expected a watchdog line for the path; got ${JSON.stringify(logged.slice(-3))}`,
  );

  // A fetch from script. (A bare flight request is not usable here: without the framework's `_rsc`
  // cache-busting hash it is answered at once with a redirect that adds one, and never renders.
  // isDocumentRequest's handling of flight requests is covered in tests/render-watchdog.test.mjs.)
  const script = await call(worker, env, "https://radar.cheap/fr/deals/stuck-deal", { headers: { accept: "*/*" } });
  assert.equal(script.status, 503);
  assert.equal((await script.json()).error.code, "RENDER_TIMEOUT");
});

test("a personalized deal page that cannot render falls back to its prerendered copy", async () => {
  const worker = await isolate();
  const env = {
    DB: hangingD1(),
    ASSETS: assets({ "/en/deals/stuck-deal": "<html><body>baked at deploy</body></html>" }),
    RENDER_DEADLINE_MS: "150",
  };
  // `?return=` makes the page personal, so it skips the baked file and renders — and the render
  // hangs. The baked file is the same page without the back link and the distances.
  const response = await call(worker, env, "https://radar.cheap/en/deals/stuck-deal?return=%2Fen", { headers: { accept: PAGE } });
  assert.equal(response.status, 200);
  assert.match(await response.text(), /baked at deploy/);
  assert.equal(response.headers.get("cache-control"), "no-store", "it stands in for a personal page and must not be kept");
});

// The admission gate allows twelve requests in flight per isolate. A render that hangs forever
// used to hold its slot for thirty seconds; twelve of them and the isolate refused everything. A
// render the watchdog gives up on has to give its slot back, or the watchdog only moves the outage.
test("a render the watchdog gives up on gives its admission slot back", async () => {
  const worker = await isolate();
  const env = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "40" };
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await call(worker, env, "https://radar.cheap/en/deals/stuck-deal", { headers: { accept: "application/json" } });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "RENDER_TIMEOUT", `attempt ${attempt + 1} was refused at the gate instead`);
  }
});

test("after one miss the isolate stops holding each visitor for the full deadline", async () => {
  const worker = await isolate();
  const env = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "2500" };
  const headers = { accept: "application/json" };
  const [, first] = await timed(call(worker, env, "https://radar.cheap/en/deals/stuck-deal", { headers }));
  assert.ok(first >= 2_400, `the first miss waited the whole deadline (${first} ms)`);
  const [, second] = await timed(call(worker, env, "https://radar.cheap/es/deals/stuck-deal", { headers }));
  assert.ok(second >= 1_400 && second < 2_200, `the next one waited the short deadline (${second} ms)`);
});

// The gate's refusal used to be raw English JSON, even for a page navigation in French.
test("a page refused at the admission gate is a page, not JSON", async () => {
  const worker = await isolate();
  // Twelve renders that hang fill the isolate for a second, until the watchdog lets them go — long
  // enough to be refused while they hold it, short enough not to keep the test process alive.
  const env = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "1000" };
  const holders = [];
  for (let slot = 0; slot < 12; slot += 1) {
    holders.push(call(worker, env, `https://radar.cheap/en/deals/stuck-${slot}`, { headers: { accept: "application/json" } }));
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  const page = await call(worker, env, "https://radar.cheap/fr/sign-in", { headers: { accept: PAGE } });
  assert.equal(page.status, 503);
  assert.match(page.headers.get("content-type"), /^text\/html/);
  const html = await page.text();
  assert.match(html, /<html lang="fr">/);
  assert.match(html, /Radar reçoit plus de demandes/);
  const api = await call(worker, env, "https://radar.cheap/api/session", { headers: { accept: "application/json" } });
  assert.equal(api.status, 503);
  assert.equal((await api.json()).error.code, "OVERLOADED");
  assert.equal(api.headers.get("retry-after"), "2");
  for (const held of await Promise.all(holders)) assert.equal(held.status, 503);
});

// A request the runtime kills for CPU never runs its `finally`, and its admission slot used to be
// held until it aged out - so a run of killed requests left the isolate refusing everything as
// OVERLOADED with nothing in flight. Here a kill is what the
// runtime makes of one: the request's timers are gone (it is started while setInterval and
// setTimeout do nothing) and it never answers. Its slot must come back within seconds, while twelve
// live requests that are merely slow still keep the thirteenth out.
test("a killed request's admission slot comes back within seconds; a slow live one keeps its slot", async () => {
  const killed = await isolate();
  const live = await isolate();
  const probe = (worker) => call(worker, { DB: hangingD1(), ASSETS: assets() }, "https://radar.cheap/api/session", { headers: { accept: "application/json" } });

  const { setInterval: realInterval, setTimeout: realTimeout } = globalThis;
  globalThis.setInterval = () => 0;
  globalThis.setTimeout = () => 0;
  try {
    const env = { DB: hangingD1(), ASSETS: assets() };
    for (let slot = 0; slot < 12; slot += 1) call(killed, env, `https://radar.cheap/en/deals/killed-${slot}`, { headers: { accept: "application/json" } });
    // Far enough for each to have been admitted and started, which is all microtasks.
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    globalThis.setInterval = realInterval;
    globalThis.setTimeout = realTimeout;
  }
  const refused = await probe(killed);
  assert.equal(refused.status, 503);
  assert.equal((await refused.json()).error.code, "OVERLOADED", "the twelve dead requests hold the isolate at first");

  // Twelve live renders that hang until the watchdog lets them go after three seconds.
  const liveEnv = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "3000" };
  const holders = [];
  for (let slot = 0; slot < 12; slot += 1) {
    holders.push(call(live, liveEnv, `https://radar.cheap/en/deals/slow-${slot}`, { headers: { accept: "application/json" } }));
  }
  await new Promise((resolve) => setTimeout(resolve, 2_300));

  const admitted = await probe(killed);
  assert.equal(admitted.status, 200, "the dead requests' slots were let go");
  assert.deepEqual(await admitted.json(), { user: null });

  const stillFull = await probe(live);
  assert.equal(stillFull.status, 503, "twelve live requests still fill the isolate");
  assert.equal((await stillFull.json()).error.code, "OVERLOADED");

  for (const held of await Promise.all(holders)) assert.equal(held.status, 503);
  const afterwards = await probe(live);
  assert.equal(afterwards.status, 200, "and give their slots back when they answer");
});

// The heartbeat must not outlive its slot. The runtime ends a request that has hung once nothing it
// could wait for is left pending, and a running interval is something pending: a heartbeat that
// kept going after its slot was gone would keep a request that will never answer alive, for
// nothing. Here the request's heartbeat is driven by hand, and the clock jumps past STALE_AFTER_MS.
test("a request's heartbeat runs while its slot is held and stops itself once the slot is gone", async () => {
  const worker = await isolate();
  const heartbeats = [];
  const stopped = new Set();
  const realInterval = globalThis.setInterval;
  const realClear = globalThis.clearInterval;
  const realNow = Date.now;
  // Only the heartbeat's interval (HEARTBEAT_MS, 500) is taken over; anything else runs for real.
  globalThis.setInterval = (callback, ms, ...args) => {
    if (ms !== 500) return realInterval(callback, ms, ...args);
    const handle = { callback, unref() {} };
    heartbeats.push(handle);
    return handle;
  };
  globalThis.clearInterval = (handle) => (heartbeats.includes(handle) ? stopped.add(handle) : realClear(handle));
  let answered;
  try {
    const env = { DB: hangingD1(), ASSETS: assets(), RENDER_DEADLINE_MS: "1500" };
    answered = call(worker, env, "https://radar.cheap/en/deals/hung", { headers: { accept: "application/json" } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(heartbeats.length, 1, "the admitted request has a heartbeat");
    const [hung] = heartbeats;
    hung.callback();
    assert.ok(!stopped.has(hung), "it keeps beating while its slot is held");

    // Three seconds later with no beat in between, the next admission lets the quiet slot go...
    Date.now = () => realNow() + 3_000;
    const probe = await call(worker, { DB: hangingD1(), ASSETS: assets() }, "https://radar.cheap/api/session", { headers: { accept: "application/json" } });
    assert.equal(probe.status, 200);
    // ...and the heartbeat's next beat stops it, though the request itself has still not answered.
    hung.callback();
    assert.ok(stopped.has(hung), "a heartbeat whose slot is gone stops itself");
  } finally {
    Date.now = realNow;
    globalThis.setInterval = realInterval;
    globalThis.clearInterval = realClear;
  }
  assert.equal((await answered).status, 503, "the render watchdog still answers the request itself");
});

test("plain http on the production hosts is redirected to https, and nothing else is", async () => {
  const worker = await isolate();
  const env = { DB: hangingD1(), ASSETS: assets({ "/en/deals/some-deal": "<html>baked</html>" }) };
  const get = await call(worker, env, "http://radar.cheap/en/deals/some-deal?postal=K1A0B1");
  assert.equal(get.status, 301);
  assert.equal(get.headers.get("location"), "https://radar.cheap/en/deals/some-deal?postal=K1A0B1");
  const affiliate = await call(worker, env, "http://affiliate.radar.cheap/earnings");
  assert.equal(affiliate.status, 301);
  assert.equal(affiliate.headers.get("location"), "https://affiliate.radar.cheap/earnings");
  // A POST keeps its method and body across the redirect.
  const post = await call(worker, env, "http://radar.cheap/api/track", { method: "POST", body: "{}" });
  assert.equal(post.status, 308);
  // localhost is how the tests and a local build are served; it must be answered, not redirected.
  const local = await call(worker, env, "http://localhost/en/deals/some-deal", { headers: { accept: PAGE } });
  assert.equal(local.status, 200);
  assert.match(await local.text(), /baked/);
  assert.equal(local.headers.get("strict-transport-security"), null, "HSTS only over https");
  const secure = await call(worker, env, "https://radar.cheap/en/deals/some-deal", { headers: { accept: PAGE } });
  assert.equal(secure.status, 200);
  assert.equal(secure.headers.get("strict-transport-security"), "max-age=31536000; includeSubDomains");

  // Clerk's shared development domain is not allowed to serve script on the real
  // site, where the live key only ever loads Clerk from clerk.radar.cheap. A local build keeps it.
  const policy = secure.headers.get("content-security-policy");
  assert.match(policy, /script-src [^;]*https:\/\/clerk\.radar\.cheap/);
  assert.doesNotMatch(policy, /clerk\.accounts\.dev/);
  assert.match(local.headers.get("content-security-policy"), /script-src [^;]*https:\/\/\*\.clerk\.accounts\.dev/);
});

test("a deal page's URL variants redirect to the one real URL", async () => {
  const worker = await isolate();
  // Answers the Worker's id lookup, and gives the page render nothing, so a path that is not
  // redirected renders the deal page's own "not found".
  const queries = [];
  const statement = (sql, args = []) => ({
    bind: (...bound) => statement(sql, bound),
    first: async () => {
      if (!sql.startsWith("SELECT slug FROM deals WHERE id=?")) return null;
      queries.push(args[0]);
      return args[0] === "deal-44cbf816-ece8-4131-8f08-0d30240b5cfb" ? { slug: "north-navy-5-a-7-aperitivo-ottawa" } : null;
    },
    all: async () => ({ results: [], success: true, meta: {} }),
    run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
    raw: async () => [],
  });
  const db = { prepare: (sql) => statement(sql), batch: async (list) => list.map(() => ({ results: [] })) };
  const env = { DB: db, ASSETS: assets({ "/en/deals/chop-steakhouse-huntclub-ottawa": "<html>baked</html>" }) };
  const cases = [
    ["/en/deals/chop-steakhouse-huntclub-ottawa/", "/en/deals/chop-steakhouse-huntclub-ottawa"],
    ["/en/deals/chop-steakhouse-huntclub-ottawa.html", "/en/deals/chop-steakhouse-huntclub-ottawa"],
    ["/fr/deals/chop-steakhouse-huntclub-ottawa.html/?return=%2Ffr", "/fr/deals/chop-steakhouse-huntclub-ottawa?return=%2Ffr"],
    // The old id path a rewritten slug was first shared under, straight to the slug in one hop.
    ["/fr/deals/deal-44cbf816-ece8-4131-8f08-0d30240b5cfb", "/fr/deals/north-navy-5-a-7-aperitivo-ottawa"],
    ["/es/deals/deal-44cbf816-ece8-4131-8f08-0d30240b5cfb.html?utm_source=x", "/es/deals/north-navy-5-a-7-aperitivo-ottawa?utm_source=x"],
  ];
  for (const [from, to] of cases) {
    const response = await call(worker, env, `https://radar.cheap${from}`, { headers: { accept: PAGE } });
    assert.equal(response.status, 301, from);
    assert.equal(response.headers.get("location"), `https://radar.cheap${to}`, from);
  }
  // The canonical URL itself is served, and costs no lookup: only an id-shaped path asks D1.
  const before = queries.length;
  const page = await call(worker, env, "https://radar.cheap/en/deals/chop-steakhouse-huntclub-ottawa", { headers: { accept: PAGE } });
  assert.equal(page.status, 200);
  assert.equal(queries.length, before, "an ordinary slug must not cost a D1 query");
  // An id-shaped path with no other slug to go to is looked up, and then left to the page.
  const unknownId = "deal-00000000-0000-4000-8000-000000000000";
  const unknown = await call(worker, env, `https://radar.cheap/en/deals/${unknownId}`, { headers: { accept: PAGE } });
  assert.ok(queries.includes(unknownId), "an id-shaped path is looked up");
  assert.notEqual(unknown.status, 301);
  await unknown.body?.cancel();
  // A client-side navigation follows the framework's own redirect protocol, not a bare 301.
  const flight = await call(worker, env, "https://radar.cheap/en/deals/chop-steakhouse-huntclub-ottawa/", { headers: { accept: PAGE, RSC: "1" } });
  assert.notEqual(flight.status, 301);
  await flight.body?.cancel();
});

// The expiry and commission steps used to run bare at the top of scheduled(), so a single D1 error
// in either rejected the whole run before any job route was reached.
test("a failing cron step is recorded and the steps after it still run", async () => {
  const worker = await isolate();
  const ran = [];
  const audit = [];
  const failing = new Set(["UPDATE deals", "UPDATE creator_commissions"]);
  const db = {
    prepare: (sql) => {
      const statement = {
        bind: (...args) => { statement.args = args; return statement; },
        run: async () => {
          const kind = [...failing].find((prefix) => sql.trim().startsWith(prefix));
          ran.push(kind || sql.trim().slice(0, 30));
          if (kind) throw new Error(`D1_ERROR: ${kind} refused`);
          if (sql.includes("INSERT INTO audit_log")) audit.push(statement.args);
          return { meta: { changes: 0 } };
        },
      };
      return statement;
    },
  };
  await worker.scheduled({}, { DB: db }, CTX);
  assert.ok(ran.includes("UPDATE deals"), "expiry ran");
  assert.ok(ran.includes("UPDATE creator_commissions"), "maturing still ran after expiry failed");
  const actions = audit.map((args) => args[0]);
  assert.deepEqual(actions, ["deal_expiry_failed", "commission_maturing_failed"]);
  assert.match(audit[0][2], /UPDATE deals refused/);

  // And when D1 refuses everything, audit rows included, the run still completes rather than
  // rejecting: there is nothing left to record the failure in, but the jobs are still owed a turn.
  const down = { prepare: () => ({ bind() { return this; }, run: async () => { throw new Error("D1 is down"); } }) };
  await worker.scheduled({}, { DB: down }, CTX);
  assert.ok(logged.some((line) => line.includes("deal_expiry_failed")), "the lost audit row is at least logged");
});

// The catalogues were a dynamic import per render, a lazily loaded chunk per locale that every
// locale page awaited; a load left pending by a killed request hung every page in that language.
// They must now be part of what the Worker evaluates at startup: reachable from dist/server/index.js
// through static imports alone, with no import() between a render and its messages.
test("the message catalogues load with the Worker, not during a render", () => {
  const request = code(readFileSync(new URL("../i18n/request.ts", import.meta.url), "utf8"));
  assert.doesNotMatch(request, /import\(/, "i18n/request.ts must not load a catalogue per request");

  const serverDir = fileURLToPath(new URL("../dist/server/", import.meta.url));
  const staticImports = (file) => {
    const source = readFileSync(path.join(serverDir, file), "utf8");
    return [...source.matchAll(/(?:^|[;\n}])\s*import\s*(?:[^'"`;()]*?from\s*)?["'`](\.[^"'`]+)["'`]/g)]
      .map((match) => path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1])));
  };
  const startup = new Set();
  const visit = (file) => {
    if (startup.has(file)) return;
    startup.add(file);
    for (const next of staticImports(file)) visit(next);
  };
  visit("index.js");

  const chunks = readdirSync(path.join(serverDir, "_next", "static")).filter((name) => name.endsWith(".js"));
  for (const locale of ["en", "fr", "es"]) {
    const title = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), "utf8")).notFound.title;
    const holders = chunks
      .map((name) => `_next/static/${name}`)
      .filter((file) => readFileSync(path.join(serverDir, file), "utf8").includes(title));
    assert.ok(holders.length, `no server chunk holds the ${locale} catalogue`);
    assert.ok(
      holders.some((file) => startup.has(file)),
      `the ${locale} catalogue is only in lazily loaded chunks: ${holders.join(", ")}`,
    );
  }
});
