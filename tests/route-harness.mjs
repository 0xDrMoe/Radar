// The shipped API handlers, run for real outside the Worker.
//
// Several bugs worth pinning live in the order a handler does things: a guard whose result is
// returned instead of tested, a throw that escapes a loop, a failure recorded nowhere. A source
// regex passes on all of those (tests/affiliate-payouts.test.mjs matched `requireSameOrigin(request)`
// the whole time the guard was inverted), so these tests import the route files themselves and call
// POST with a Request, against a SQLite database built from drizzle/*.sql.
//
// Node strips the TypeScript. Three imports have no meaning outside a Worker and are supplied here:
//
//   cloudflare:workers  `env`, whose values each test sets on `harness.env`
//   next/headers        request headers, from `harness.headers`
//   ../auth             the signed-in user, from `harness.user`. The real module verifies a Clerk
//                       session, which is not what any of these tests are about.
//
// Everything else a route imports is the real file. Import this module before the routes, since
// the hooks only apply to imports made after it has run.
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";

export const harness = {
  // Routes run without a Turnstile secret here, which in production refuses every public form
  // (verifyTurnstile in app/api-utils.ts). Tests say so the same way local development does.
  env: { TURNSTILE_DISABLED: "true" },
  headers: new Headers(),
  user: null,
  /** How many times a route asked who is signed in, which is how a test sees a guard stop it. */
  userLookups: 0,
  /** Set to a RegExp to make every statement whose SQL matches it fail, as a broken query would. */
  failSql: null,
  /** The address isProtectedOwner() answers true for; the real one is pinned in app/auth.ts. */
  protectedOwner: null,
};
globalThis.__ROUTE_HARNESS__ = harness;

const asModule = (source) => `data:text/javascript,${encodeURIComponent(source)}`;
const WORKERS = asModule(`
export const env = new Proxy({}, { get: (_target, key) => globalThis.__ROUTE_HARNESS__.env[key] });
export const waitUntil = () => {};
`);
const NEXT_HEADERS = asModule(`
export const headers = async () => globalThis.__ROUTE_HARNESS__.headers;
export const cookies = async () => ({ get: () => undefined });
`);
const AUTH = asModule(`
export async function getAppUser() {
  globalThis.__ROUTE_HARNESS__.userLookups += 1;
  return globalThis.__ROUTE_HARNESS__.user;
}
export function isPro(user) { return Boolean(user?.pro); }
export function hasPermission(user, permission) { return Boolean(user?.permissions?.has?.(permission)); }
export function canAdminister(user) { return hasPermission(user, "read_admin"); }
export function isProtectedOwner(email) { return Boolean(email) && email === globalThis.__ROUTE_HARNESS__.protectedOwner; }
`);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: WORKERS, shortCircuit: true };
    if (specifier === "next/headers") return { url: NEXT_HEADERS, shortCircuit: true };
    if (/^(\.\.?\/)+auth$/.test(specifier) && context.parentURL?.includes("/app/")) return { url: AUTH, shortCircuit: true };
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

/** D1's API over node:sqlite, as tests/plan-resolution.test.mjs has it, plus harness.failSql. */
function d1(db) {
  const check = (sql) => {
    if (harness.failSql && harness.failSql.test(sql)) throw new Error("D1_ERROR: simulated failure");
  };
  const statement = (sql, binds) => ({
    bind: (...args) => statement(sql, args),
    first: async () => { check(sql); const row = db.prepare(sql).get(...binds); return row === undefined ? null : { ...row }; },
    all: async () => { check(sql); return { results: db.prepare(sql).all(...binds).map((row) => ({ ...row })), success: true, meta: {} }; },
    run: async () => { check(sql); const info = db.prepare(sql).run(...binds); return { results: [], success: true, meta: { changes: Number(info.changes ?? 0) } }; },
  });
  return {
    prepare: (sql) => statement(sql, []),
    batch: async (list) => { const out = []; for (const entry of list) out.push(await entry.all()); return out; },
  };
}

/** A fresh database with every migration applied, installed as env.DB. Resets the harness too. */
export function freshDatabase() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(new URL("../drizzle/", import.meta.url)).filter((name) => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), "utf8"));
  }
  for (const key of Object.keys(harness.env)) delete harness.env[key];
  harness.env.TURNSTILE_DISABLED = "true";
  harness.env.DB = d1(db);
  harness.headers = new Headers({ host: "radar.cheap" });
  harness.user = null;
  harness.userLookups = 0;
  harness.failSql = null;
  harness.protectedOwner = null;
  return db;
}

/** A POST as the browser sends it from the given origin; `origin: null` sends no Origin at all. */
export function post(url, body, { origin = "https://radar.cheap", headers = {} } = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(origin ? { origin } : {}), ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Replaces fetch for the duration of `run`, recording every call. */
export async function withFetch(respond, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    const call = { url: String(input instanceof Request ? input.url : input), init, body: init.body ? String(init.body) : "" };
    calls.push(call);
    return respond(call);
  };
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = original;
  }
}
