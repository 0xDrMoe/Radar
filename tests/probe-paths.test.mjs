// The addresses the Worker answers with a small static 404 before anything renders
// (worker/probe-paths.ts): /wp-login.php, /.env, /xmlrpc.php and the rest of what scanners walk.
//
// The rule has to be narrow enough that no real page or file ever matches it, because one that did
// would be a 404 for everyone, served ahead of the admission gate, the bake and the colo cache - a
// page that silently stopped existing. So most of this file is the other direction: it walks every
// route under app/ (with sample values for the dynamic segments), the metadata routes, the files a
// deploy uploads and the pages the prerender bakes, and fails if any of them counts as a probe.
// Needs `npm run build` first, for the uploaded files.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { code } from "./source.mjs";

// worker/probe-paths.ts imports nothing, so it can be loaded here on its own.
const load = async () => {
  const source = await readFile(new URL("../worker/probe-paths.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(`${compiled}\n// ${Math.random()}`).toString("base64")}`);
};

const LOCALES = ["en", "fr", "es"];
const APP = fileURLToPath(new URL("../app/", import.meta.url));

// Sample values for a dynamic segment, by its name and the segment above it. A deal slug is
// slugify()'s alphabet (app/slug.ts: lowercase letters, digits and hyphens, no dot), including one
// that starts with "wp-": a restaurant can be called that, and below /deals/ it is left alone on
// purpose. An old deal id is `deal-` and a UUID. A photo key is what app/photo-storage.ts writes.
function samplesFor(segment, parent) {
  if (segment === "[locale]") return LOCALES;
  if (segment === "[slug]") return ["royal-oak-bank-ottawa-wings-wed", "wp-engine-ottawa-lunch", "deal-44cbf816-ece8-4131-8f08-0d30240b5cfb", "a".repeat(100)];
  if (segment === "[section]" && parent === "dashboard") {
    const sections = code(readFileSync(path.join(APP, "[locale]", "dashboard", "sections.ts"), "utf8"));
    const list = /dashboardSections = \[([^\]]*)\]/.exec(sections);
    assert.ok(list, "expected dashboardSections in app/[locale]/dashboard/sections.ts");
    return [...[...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]), "locations", "settings"];
  }
  if (segment === "[id]") return ["44cbf816-ece8-4131-8f08-0d30240b5cfb"];
  if (segment === "[...key]") return ["jpg", "png", "webp"].map((ext) => `restaurants/royal-oak-bank-ottawa-restaurant/1789691350495-b6df38a1.${ext}`);
  if (/^\[\[\.\.\..+\]\]$/.test(segment)) return ["", "factor-one", "factor-two", "sso-callback", "verify-email-address", "continue"];
  if (/^\[.+\]$/.test(segment)) return ["sample"];
  return [segment];
}

// Every address an app route answers, as concrete paths. A route group's "(name)" is not part of the
// address. The locale's [...rest] is the not-found page itself, so a 404 is its answer anyway.
function appRoutePaths() {
  const paths = new Set();
  const visit = (dir, segments) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, [...segments, entry.name]);
      else if (/^(page|route)\.(tsx?|jsx?)$/.test(entry.name)) {
        if (segments.includes("[...rest]")) continue;
        let expanded = [""];
        segments.forEach((segment, index) => {
          if (/^\(.+\)$/.test(segment)) return;
          const values = samplesFor(segment, segments[index - 1]);
          expanded = expanded.flatMap((prefix) => values.map((value) => (value ? `${prefix}/${value}` : prefix)));
        });
        for (const address of expanded) paths.add(address || "/");
      }
    }
  };
  visit(APP, []);
  return paths;
}

// Every file wrangler would upload from a directory, as the URL path it is served at (the same rule
// tests/https-www.test.mjs uses: its own metadata files and what .assetsignore lists are not sent).
function servedFiles(directory) {
  const ignoreFile = path.join(directory, ".assetsignore");
  const ignored = new Set(["_headers", "_redirects", ".assetsignore"]);
  if (existsSync(ignoreFile)) {
    for (const line of readFileSync(ignoreFile, "utf8").split(/\r?\n/)) {
      if (line.trim() && !line.trim().startsWith("#")) ignored.add(line.trim());
    }
  }
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), `${prefix}/${entry.name}`);
      else files.push(`${prefix}/${entry.name}`);
    }
  };
  walk(directory, "");
  return files;
}

function stringsAfter(source, marker) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `expected ${marker}`);
  const open = source.indexOf("[", start);
  return [...source.slice(open, source.indexOf("]", open)).matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

test("what scanners ask for is a probe", async () => {
  const { isProbePath } = await load();
  for (const address of [
    "/wp-login.php", "/wp-admin", "/wp-admin/", "/wp-admin/setup-config.php", "/wp-content/plugins/hello.php",
    "/wp-includes/wlwmanifest.xml", "/xmlrpc.php", "/WP-LOGIN.PHP", "/.env", "/.env.production", "/.git/config",
    "/.git/HEAD", "/.aws/credentials", "/.DS_Store", "/.well-known/security.txt", "/admin.php", "/phpinfo.php",
    "/index.php", "/config.php.bak", "/backup.sql", "/db.sqlite", "/web.config", "/admin/.env", "/api/.env",
    "/default.aspx", "/cgi-bin/test.cgi", "/site.tar.gz", "/backup.zip", "/en/wp-login.php", "/fr/wp-admin",
    "/es/.env", "/en/xmlrpc.php", "/de/wp-login.php",
  ]) {
    assert.ok(isProbePath(address), `${address} is a scanner's address`);
  }
});

test("no route under app/ is a probe", async () => {
  const { isProbePath } = await load();
  const routes = appRoutePaths();
  // The walk itself, checked against a few addresses that must be in it.
  for (const expected of ["/en", "/fr/deals/royal-oak-bank-ottawa-wings-wed", "/es/dashboard/alerts", "/en/sign-in/factor-one", "/api/deals", "/admin", "/affiliate/earnings", "/api/photo/restaurants/royal-oak-bank-ottawa-restaurant/1789691350495-b6df38a1.webp"]) {
    assert.ok(routes.has(expected), `the route walk should include ${expected}`);
  }
  for (const address of routes) assert.ok(!isProbePath(address), `${address} is a page or an API route, and would be answered 404`);
  // Metadata routes, which are files in app/ rather than directories.
  for (const [file, address] of [["sitemap.ts", "/sitemap.xml"], ["robots.ts", "/robots.txt"], ["manifest.ts", "/manifest.webmanifest"]]) {
    assert.ok(existsSync(path.join(APP, file)), `app/${file}`);
    assert.ok(!isProbePath(address), `${address} is app/${file}`);
  }
  // A deal slug that starts with "wp-" is a restaurant's name, not WordPress.
  assert.ok(!isProbePath("/en/deals/wp-engine-ottawa-lunch"));
  assert.ok(!isProbePath("/_vinext/image"));
});

test("no file a deploy uploads, and no page the prerender bakes, is a probe", async () => {
  const { isProbePath } = await load();
  const client = fileURLToPath(new URL("../dist/client/", import.meta.url));
  assert.ok(existsSync(client), "dist/client is missing; run npm run build first");
  const uploaded = [...servedFiles(client), ...servedFiles(fileURLToPath(new URL("../public/", import.meta.url)))];
  assert.ok(uploaded.some((file) => file.startsWith("/_next/static/")), "expected the hashed build in dist/client");
  for (const file of uploaded) {
    assert.ok(!isProbePath(file), `${file} is uploaded, and would be answered 404 if it ever reached the Worker`);
    // The asset layer serves x.html at /x, which is the address a reader uses.
    if (file.endsWith(".html")) assert.ok(!isProbePath(file.slice(0, -".html".length)), `${file.slice(0, -5)} is a baked page`);
  }

  const worker = code(readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8"));
  for (const file of stringsAfter(worker, "const TOP_LEVEL_FILES = new Set([")) assert.ok(!isProbePath(file), file);

  const prerender = code(readFileSync(new URL("../scripts/prerender-deals.mjs", import.meta.url), "utf8"));
  const pages = stringsAfter(prerender, "const STATIC_PAGES = [");
  assert.ok(pages.length > 0);
  for (const locale of stringsAfter(prerender, "const LOCALES = [")) {
    for (const page of pages) assert.ok(!isProbePath(`/${locale}${page}`), `/${locale}${page} is baked at deploy`);
  }
});

test("a probe's 404 is a small page in the address's language, with nothing to run", async () => {
  const { probeNotFoundResponse } = await load();
  for (const [address, lang, heading] of [
    ["/wp-login.php", "en", "There is nothing here."],
    ["/fr/wp-admin", "fr", "Il n'y a rien ici."],
    ["/es/.env", "es", "Aquí no hay nada."],
    ["/de/.env", "en", "There is nothing here."],
  ]) {
    const url = new URL(`https://radar.cheap${address}`);
    const response = probeNotFoundResponse(new Request(url), url);
    assert.equal(response.status, 404, address);
    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    assert.equal(response.headers.get("set-cookie"), null, "nothing per reader");
    const html = await response.text();
    assert.ok(html.includes(`<html lang="${lang}">`), `${address} is answered in ${lang}`);
    assert.ok(html.includes(heading), address);
    assert.ok(html.includes(`<a href="/${lang}">`), `${address} links to its own locale's home page`);
    assert.match(html, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(html, /<script|<link|<img|<iframe/i, "no script, stylesheet, image or frame to fetch");
    assert.ok(html.length < 2_000, `${html.length} bytes`);

    const head = probeNotFoundResponse(new Request(url, { method: "HEAD" }), url);
    assert.equal(head.status, 404);
    assert.equal(head.body, null, "a HEAD is the headers alone");
    assert.equal(head.headers.get("content-type"), "text/html; charset=utf-8");
  }
});

// Ahead of everything that costs anything, and behind only what has to come first: the www and
// https redirects (a scanner on plain http gets the same redirect as anyone), and the top-level files
// (none is a probe, as above). On the address as it arrived, before the affiliate rewrite, so
// affiliate.radar.cheap/wp-login.php is a probe too; and before the admission gate, so a scanner's
// burst never holds a slot a reader is waiting for. tests/worker-pages.test.mjs drives this through
// the built Worker with the gate full.
test("the Worker answers a probe right after the redirects and the top-level files", () => {
  const source = code(readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8"));
  const handler = source.slice(source.indexOf("async fetch(request: Request, env: Env, ctx: ExecutionContext)"));
  const order = [
    "const redirect = wwwRedirectFor(url) ?? httpsRedirectFor(url);",
    "const file = await topLevelFile(request, env, url);",
    "if (isProbePath(url.pathname)) return withSecurityHeaders(probeNotFoundResponse(request, url), url);",
    "const affiliatePath = affiliatePathFor(url);",
    "const canonical = await canonicalDealRedirect(request, env, url);",
    "const lookup = internal ? null : pageLookup(request, url);",
    "const requestId = admission.admit(Date.now());",
  ].map((line) => {
    const at = handler.indexOf(line);
    assert.notEqual(at, -1, `expected \`${line}\` in the fetch handler`);
    return at;
  });
  assert.deepEqual(order, [...order].sort((a, b) => a - b), "in this order");
});
