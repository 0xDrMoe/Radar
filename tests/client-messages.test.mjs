// What of the message catalogue reaches the browser, and whether it is enough.
//
// The locale layout used to hand NextIntlClientProvider the whole catalogue, so every page carried
// all 46 KB of it twice (flight data and the HTML around it) and every server render paid to
// serialize and re-parse it: /en/unsubscribe was 87 KB for one form. Now the layout provides only
// the shared namespaces and each page provides its own (i18n/client-messages.ts). The risk that
// trades for is a client component reading a namespace its page no longer sends, which fails
// quietly: next-intl renders the key's name in place of the words and logs an error nobody reads.
//
// So this follows every page's imports, statically, into its client components, collects the
// namespaces they read, and fails when the page does not provide one - or provides one that nothing
// on it reads, since every namespace sent is bytes and CPU on every render of that page.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerHooks } from "node:module";
import ts from "typescript";
import { code } from "./source.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LOCALE_DIR = path.join(ROOT, "app", "[locale]");
const rel = (file) => path.relative(ROOT, file).split(path.sep).join("/");
const catalogue = (locale) => JSON.parse(readFileSync(path.join(ROOT, "messages", `${locale}.json`), "utf8"));
const en = catalogue("en");

async function loadClientMessages() {
  const source = readFileSync(path.join(ROOT, "i18n", "client-messages.ts"), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
}
const { SHARED_CLIENT_NAMESPACES, pickMessages } = await loadClientMessages();

// --- the import graph --------------------------------------------------------------------------

const EXTENSIONS = [".tsx", ".ts", ".mjs", ".js", "/index.tsx", "/index.ts"];
function resolveImport(from, specifier) {
  let base;
  if (specifier.startsWith("./") || specifier.startsWith("../")) base = path.resolve(path.dirname(from), specifier);
  else if (specifier.startsWith("@/")) base = path.resolve(ROOT, specifier.slice(2));
  else return null;
  if (existsSync(base) && statSync(base).isFile()) return /\.(tsx?|mjs|js)$/.test(base) ? base : null;
  for (const extension of EXTENSIONS) if (existsSync(base + extension)) return base + extension;
  return null;
}

// Static imports, re-exports and import() alike: a component loaded lazily is still on the page.
const IMPORT = /(?:import|export)\s[^'";]*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;
const files = new Map();
function inspect(file) {
  if (files.has(file)) return files.get(file);
  const source = code(readFileSync(file, "utf8"));
  const info = {
    client: /^\s*["']use client["']/.test(source),
    imports: [...source.matchAll(IMPORT)].map((match) => resolveImport(file, match[1] || match[2] || match[3])).filter(Boolean),
    // A namespace that is not a string literal cannot be checked, so it is reported as one.
    namespaces: [...source.matchAll(/useTranslations\(\s*([^)]*?)\s*\)/g)].map((match) => {
      const literal = /^["'`]([\w.]+)["'`]$/.exec(match[1]);
      return literal ? literal[1] : `<unreadable: useTranslations(${match[1]})>`;
    }),
    readsWholeCatalogue: /\buseMessages\s*\(/.test(source),
  };
  files.set(file, info);
  return info;
}

/** Namespace -> the client files under `entry` that read it. Server files are walked, not counted. */
function clientNamespaces(entry) {
  const needs = new Map();
  const seen = new Set();
  const walk = (file, inClient) => {
    const info = inspect(file);
    const client = inClient || info.client;
    const key = `${file}|${client}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (client) {
      for (const namespace of info.namespaces) needs.set(namespace, [...(needs.get(namespace) || []), rel(file)]);
      if (info.readsWholeCatalogue) needs.set("<useMessages: the whole catalogue>", [rel(file)]);
    }
    for (const next of info.imports) walk(next, client);
  };
  walk(entry, false);
  return needs;
}

/** The namespaces a file's own <ClientMessages> names, or null when it renders none. */
function providedBy(file) {
  const source = code(readFileSync(file, "utf8"));
  const uses = [...source.matchAll(/<ClientMessages\b([^>]*)>/g)];
  if (!uses.length) return null;
  assert.equal(uses.length, 1, `${rel(file)} renders one ClientMessages, around everything it returns`);
  const list = /namespaces=\{\[([^\]]*)\]\}/.exec(uses[0][1]);
  return list ? [...list[1].matchAll(/["']([\w.]+)["']/g)].map((match) => match[1]) : [];
}

const covers = (provided, namespace) => provided.some((path) => namespace === path || namespace.startsWith(`${path}.`));

function routeFiles(dir = LOCALE_DIR) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeFiles(full));
    else if (/^(page|layout|not-found)\.tsx$/.test(entry.name)) found.push(full);
  }
  return found.sort();
}

// The provider a route file's client components sit under: its own, else the nearest layout's
// between it and app/[locale], else the locale layout's shared set.
function effectiveProvider(file) {
  const own = providedBy(file);
  if (own) return { from: rel(file), namespaces: own };
  if (path.basename(file) !== "layout.tsx" || path.dirname(file) !== LOCALE_DIR) {
    for (let dir = path.dirname(file); dir.startsWith(LOCALE_DIR) && dir !== LOCALE_DIR; dir = path.dirname(dir)) {
      const layout = path.join(dir, "layout.tsx");
      if (layout !== file && existsSync(layout)) {
        const fromLayout = providedBy(layout);
        if (fromLayout) return { from: rel(layout), namespaces: fromLayout };
      }
    }
  }
  return { from: "app/[locale]/layout.tsx", namespaces: [] };
}

// --- the checks --------------------------------------------------------------------------------

test("every page provides each namespace its client components read", () => {
  const problems = [];
  const routes = routeFiles();
  assert.ok(routes.length >= 20, `found ${routes.length} route files under app/[locale]`);
  for (const file of routes) {
    const { from, namespaces } = effectiveProvider(file);
    const provided = [...SHARED_CLIENT_NAMESPACES, ...namespaces];
    for (const [namespace, readers] of clientNamespaces(file)) {
      if (!covers(provided, namespace)) problems.push(`${rel(file)}: ${readers.join(", ")} read "${namespace}", which ${from} does not provide`);
    }
  }
  assert.deepEqual(problems, []);
});

test("no page sends a namespace nothing on it reads", () => {
  const problems = [];
  for (const file of routeFiles()) {
    const own = providedBy(file);
    if (!own) continue;
    // A layout's provider serves every page below it, so what it must justify is the union of theirs.
    const scope = path.basename(file) === "layout.tsx"
      ? routeFiles(path.dirname(file)).filter((other) => other !== file && !providedBy(other))
      : [file];
    const read = scope.flatMap((entry) => [...clientNamespaces(entry).keys()]);
    for (const namespace of own) {
      if (!read.some((used) => used === namespace || used.startsWith(`${namespace}.`) || namespace.startsWith(`${used}.`))) {
        problems.push(`${rel(file)} provides "${namespace}", which no client component on it reads`);
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("every namespace named is in the catalogue", () => {
  const named = new Set(SHARED_CLIENT_NAMESPACES);
  for (const file of routeFiles()) for (const namespace of providedBy(file) || []) named.add(namespace);
  for (const namespace of named) {
    const value = namespace.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), en);
    assert.ok(value && typeof value === "object", `"${namespace}" is not a namespace in messages/en.json`);
  }
});

test("the catalogue reaches the browser only through ClientMessages", () => {
  const offenders = [];
  const scan = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) scan(full);
      else if (/\.(tsx|ts)$/.test(entry.name) && rel(full) !== "i18n/ClientMessages.tsx") {
        if (/<NextIntlClientProvider\b/.test(code(readFileSync(full, "utf8")))) offenders.push(rel(full));
      }
    }
  };
  scan(path.join(ROOT, "app"));
  scan(path.join(ROOT, "i18n"));
  assert.deepEqual(offenders, [], "a NextIntlClientProvider here would decide for itself what of the catalogue to send");
  // And the locale layout, which every page renders under, names nothing beyond the shared set.
  assert.deepEqual(providedBy(path.join(LOCALE_DIR, "layout.tsx")), []);
});

test("pickMessages hands back the catalogue's own objects, and only the parts named", () => {
  const messages = { nav: { a: "1" }, home: { cookieNotice: { b: "2" }, hero: { c: "3" } }, pro: { d: "4" } };
  const picked = pickMessages(messages, ["nav", "home.cookieNotice", "missing", "pro.nothing"]);
  assert.deepEqual(Object.keys(picked).sort(), ["home", "nav"]);
  assert.equal(picked.nav, messages.nav, "the same object, so the flight data writes it once");
  assert.equal(picked.home.cookieNotice, messages.home.cookieNotice);
  assert.equal(picked.home.hero, undefined);
  // A namespace taken whole is not replaced by a part of it, in either order.
  for (const order of [["home.cookieNotice", "home"], ["home", "home.cookieNotice"]]) {
    assert.equal(pickMessages(messages, order).home, messages.home);
  }
});

// i18n/request.ts names the time zone, so next-intl stops building a DateTimeFormat to discover it
// on every config it makes. That is only free if no message formats a date or a time with it.
test("no message formats a date or a time, so the configured zone changes nothing a reader sees", () => {
  assert.match(code(readFileSync(path.join(ROOT, "i18n", "request.ts"), "utf8")), /timeZone:/);
  for (const locale of ["en", "fr", "es"]) {
    const text = JSON.stringify(catalogue(locale));
    assert.doesNotMatch(text, /\{\s*\w+\s*,\s*(date|time)\b/, `${locale} has a message that formats a date or time`);
  }
});

// --- the built pages ---------------------------------------------------------------------------

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

async function render(pathname) {
  const { default: worker } = await import(new URL("../dist/server/index.js", import.meta.url).href);
  const statement = () => ({ bind: statement, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }), raw: async () => [] });
  const env = { DB: { prepare: statement, batch: async (list) => list.map(() => ({ results: [] })) }, ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } };
  globalThis.__TEST_ENV__ = env;
  const response = await worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html", "user-agent": "test" } }), env, { waitUntil() {}, passThroughOnException() {} });
  return { status: response.status, html: await response.text() };
}

// The flight data as the browser receives it: the argument of every `.rsc.push(...)` script.
function flightRows(html) {
  return [...html.matchAll(/\.rsc\.push\(("(?:[^"\\]|\\.)*")\)/g)].map((match) => JSON.parse(match[1])).join("");
}

// Not /sign-in: a local build has no Clerk publishable key, and <SignIn/> throws without one (see
// tests/deal-page-render.test.mjs). The static checks above cover its provider.
test("a built page carries its own namespaces and not the rest of the catalogue", async () => {
  const pages = [
    ["/en/unsubscribe", ["unsubscribe", "apiErrors"]],
    ["/fr/confirm-email", ["confirmEmail", "apiErrors"]],
    ["/es/for-restaurants", ["restaurantInquiry", "apiErrors"]],
    ["/en/privacy", []],
  ];
  for (const [pathname, own] of pages) {
    const { status, html } = await render(pathname);
    assert.equal(status, 200, pathname);
    const flight = flightRows(html);
    assert.ok(flight.length > 1000, `${pathname}: found its flight data`);
    // The not-found boundary's own provider is part of every page's flight data (notFound).
    const allowed = new Set([...SHARED_CLIENT_NAMESPACES.map((name) => name.split(".")[0]), "notFound", ...own]);
    const carried = Object.keys(en).filter((namespace) => flight.includes(`"${namespace}":{`));
    assert.deepEqual(carried.filter((namespace) => !allowed.has(namespace)), [], `${pathname} carries namespaces it does not read`);
    for (const namespace of own) assert.ok(carried.includes(namespace), `${pathname} carries ${namespace}`);
  }
});
