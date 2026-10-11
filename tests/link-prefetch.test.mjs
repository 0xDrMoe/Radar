import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { code } from "./source.mjs";
import { elements, linkImports } from "./jsx-links.mjs";

// No link on the public site prefetches.
//
// vinext's <Link> prefetches its target as soon as it comes within 250px of the viewport, and again
// on hover or touch. A prefetch is a request for the target's RSC flight, which the Worker renders
// every time: an RSC request is never answered from the colo cache or the baked pages
// (isCacheablePage in worker/index.ts). Every link in the header, the footer, a legal page and a
// card list was one, so a single page view rendered the pages it linked to as well - counted on a
// local build on 2026-09-30, scrolled to the footer with the menus opened: 29 on the /en home, 31 on
// a deal page, 35 on /en/terms, 30 on a 404, 13 of them within 65 ms of reaching the footer. Most
// readers open none of those pages.
//
// i18n/navigation.ts exports next-intl's <Link> with prefetching off unless a caller turns it on,
// and public code imports that one. next/link, used for the English-only workspaces, is told every
// time. Nothing in public code turns either back on.
//
// The workspaces themselves (app/(operator): the admin console, the creator and affiliate
// workspaces, the restaurant portal) are held to the same rule. Only staff, creators and restaurant
// operators see them, but each of their links prefetched the same way, and their brand and "Back to
// deals" links prefetched the public home page's flight, a render, on every view of a workspace.

const APP = new URL("../app/", import.meta.url);

// Every page and component: everything under app/ but the API, which renders no links.
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return entry.name === "api" ? [] : files(url);
    return /\.tsx?$/.test(entry.name) ? [url] : [];
  });
}
const sources = files(APP).map((url) => ({
  path: decodeURIComponent(url.pathname.slice(APP.pathname.length)),
  source: code(readFileSync(url, "utf8")),
}));

/** Why each link in `source` would prefetch, or nothing. */
function prefetchProblems(source) {
  const found = [];
  const { wrapper, next } = linkImports(source);
  if (/from\s*["']next-intl\/navigation["']/.test(source)) {
    found.push("imports next-intl/navigation, whose <Link> prefetches; import from i18n/navigation");
  }
  for (const element of elements(source, [...new Set(["Link", ...wrapper, ...next])])) {
    const prefetch = element.attributes.get("prefetch");
    const where = `<${element.name} href=${element.attributes.get("href") ?? "?"}>`;
    if (next.includes(element.name)) {
      // next/link prefetches unless it is told not to, on every element.
      if (prefetch !== "false") found.push(`${where}: next/link without prefetch={false}`);
    } else if (wrapper.includes(element.name)) {
      if (prefetch !== undefined && prefetch !== "false") found.push(`${where}: prefetch={${prefetch}} turns it back on`);
    } else {
      found.push(`${where}: a <Link> from neither i18n/navigation nor next/link`);
    }
    // Props spread onto a link can carry a prefetch this cannot see, so a spread needs an explicit
    // prefetch={false} after it: a later prop wins.
    if (element.order.lastIndexOf("...") > element.order.lastIndexOf("prefetch")) found.push(`${where}: spread props after (or without) prefetch={false}`);
  }
  // On anything at all: an attribute that asks for prefetching, and the router's own prefetch().
  for (const match of source.matchAll(/\bprefetch=(?:\{\s*(?:true|null|undefined|["'`]auto["'`])\s*\}|["']auto["'])/g)) found.push(`${match[0]} asks for a prefetch`);
  for (const match of source.matchAll(/\.prefetch\(/g)) found.push(`${source.slice(Math.max(0, match.index - 30), match.index + 10).trim()}: prefetches a page by hand`);
  return found;
}

test("no link on the site prefetches, the workspaces' included", () => {
  assert.ok(sources.length > 60, `found ${sources.length} files under app/`);
  assert.ok(sources.some(({ path }) => path === "SiteHeader.tsx"));
  assert.ok(sources.some(({ path }) => path === "(operator)/admin/AdminClient.tsx"), "the workspaces are scanned");
  const found = sources.flatMap(({ path, source }) => prefetchProblems(source).map((problem) => `${path} ${problem}`));
  assert.deepEqual(found, []);
});

test("the scan sees the shapes that prefetch", () => {
  const wrapper = `import { Link, useRouter } from "../i18n/navigation";\n`;
  const next = `import NextLink from "next/link";\n`;
  // What prefetched before, and the ways it could come back.
  assert.equal(prefetchProblems(`import { Link } from "next-intl/navigation";\n<Link href="/terms">`).length, 2, "next-intl's own Link");
  assert.equal(prefetchProblems(`${next}<NextLink href="/admin">`).length, 1, "next/link left alone");
  assert.equal(prefetchProblems(`${next}<NextLink href="/admin" prefetch>`).length, 1, "a bare prefetch is prefetch={true}");
  assert.equal(prefetchProblems(`${next}<NextLink href="/admin" prefetch={null}>`).length, 2, "null is next/link's auto");
  assert.equal(prefetchProblems(`${wrapper}<Link href="/pro" prefetch={true}>`).length, 2);
  assert.equal(prefetchProblems(`${wrapper}<Link href="/pro" prefetch="auto">`).length, 2);
  assert.equal(prefetchProblems(`${wrapper}<Link href="/pro" {...props}>`).length, 1);
  assert.equal(prefetchProblems(`${next}<NextLink href="/portal" prefetch={false} {...rest}>`).length, 1, "the spread wins");
  assert.equal(prefetchProblems(`import Link from "some-router";\n<Link href="/pro">`).length, 1, "a Link this test does not know");
  assert.equal(prefetchProblems(`${wrapper}router.prefetch("/pro");`).length, 1);
  // What is fine.
  for (const fine of [
    `${wrapper}<Link href="/dashboard">`,
    `${wrapper}<Link className="accountbtn" href="/dashboard" prefetch={false}>`,
    `import { Link as IntlLink } from "../../i18n/navigation";\n<IntlLink href="/dashboard">`,
    `${next}<NextLink className="iconbtn" href="/admin" title={t("staff")} prefetch={false}>`,
    `${next}<NextLink href="/portal" {...rest} prefetch={false}>`,
    `<a href={\`/\${locale}/terms\`}>`,
    `<link rel="dns-prefetch" href="https://challenges.cloudflare.com" />`,
  ]) assert.deepEqual(prefetchProblems(fine), [], fine);
});

// i18n/navigation.ts, with next-intl's navigation and the routing config stood in for: the real
// routing config reads import.meta.env, which only the build defines.
const NAVIGATION_STUB = `data:text/javascript,${encodeURIComponent(`
  export const navigation = {
    Link: function IntlLink() {}, redirect() {}, usePathname() {}, useRouter() {}, getPathname() {},
  };
  export function createNavigation(routing) { navigation.routing = routing; return navigation; }
`)}`;
const ROUTING_STUB = `data:text/javascript,${encodeURIComponent(`export const routing = { locales: ["en", "fr", "es"], defaultLocale: "en" };`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith("/i18n/navigation.ts")) {
      if (specifier === "next-intl/navigation") return { url: NAVIGATION_STUB, shortCircuit: true };
      if (specifier === "./routing") return { url: ROUTING_STUB, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

test("i18n/navigation's Link is next-intl's, with prefetching off unless asked for", async () => {
  const navigation = await import("../i18n/navigation.ts");
  const { navigation: intl } = await import(NAVIGATION_STUB);
  assert.deepEqual(intl.routing.locales, ["en", "fr", "es"], "built from the app's routing");

  const link = navigation.Link({ href: "/terms", className: "brand", children: "Terms" });
  assert.equal(link.type, intl.Link, "it renders next-intl's Link, which localizes the href");
  assert.equal(link.props.prefetch, false);
  assert.equal(link.props.href, "/terms");
  assert.equal(link.props.className, "brand");
  assert.equal(link.props.children, "Terms");
  assert.equal(navigation.Link({ href: "/", prefetch: undefined }).props.prefetch, false);
  // null is "auto" to next/link (resolveLinkPrefetchMode), so it is read as unset, not passed on.
  assert.equal(navigation.Link({ href: "/", prefetch: null }).props.prefetch, false);
  // A caller can still ask for it; public code may not (the scan above).
  assert.equal(navigation.Link({ href: "/", prefetch: true }).props.prefetch, true);
  assert.equal(navigation.Link({ href: "/", prefetch: false }).props.prefetch, false);

  // The rest of next-intl's navigation is passed through untouched.
  for (const name of ["redirect", "usePathname", "useRouter", "getPathname"]) assert.equal(navigation[name], intl[name], name);
});

// What prefetch={false} switches off is vinext's to decide, and next/link is vinext's shim of it.
// Off has to mean off on hover and touch as well as in view; in Next.js's own App Router it does,
// and vinext follows it while the app router's navigation runtime is registered - which it is from
// hydration on, so every Link renders in "app" mode. (In "pages" mode vinext still prefetches on
// hover, as Next's Pages Router did.) The two decisions are checked here; the router mode a Link
// hydrates in is not, and neither is the whole chain in a browser - those were counted by hand, in
// headless Chrome against the built Worker, for the versions pinned below.
test("prefetch={false} stops vinext prefetching a link in view, on hover and on touch", async () => {
  const { canLinkPrefetch, canLinkIntentPrefetch } = await import("vinext/shims/link-prefetch");
  const production = { nodeEnv: "production", isDangerous: false };
  // Left alone, a link prefetches both ways: the reason the wrapper exists.
  assert.equal(canLinkPrefetch({ ...production, prefetch: undefined }), true);
  assert.equal(canLinkIntentPrefetch({ ...production, prefetch: undefined, routerMode: "app" }), true);
  assert.equal(canLinkPrefetch({ ...production, prefetch: false }), false, "in view");
  assert.equal(canLinkIntentPrefetch({ ...production, prefetch: false, routerMode: "app" }), false, "on hover or touch");
  // And next/link hands both of them the prop it was given: the one property of its source that
  // matters here, read loosely enough that a reformat does not fail it.
  const link = readFileSync(new URL(import.meta.resolve("vinext/shims/link")), "utf8");
  for (const decision of ["canLinkPrefetch", "canLinkIntentPrefetch"]) {
    assert.match(link, new RegExp(`\\b${decision}\\(\\{[^}]*\\bprefetch:\\s*effectivePrefetchProp\\b`), decision);
  }
  assert.match(link, /\beffectivePrefetchProp\s*=[^;]*\bprefetchProp\b/);
});

// Everything above was established for these versions, by reading their source and by counting
// requests in a browser (0 prefetches over 13 views, signed in and out, scrolled to the footer with
// every link hovered and touched, 2026-10-01). next-intl is a caret range in package.json, so an
// install can move it without anyone choosing to.
const REVIEWED = { vinext: "1.0.0-beta.8", "next-intl": "4.14.3" };
function installedVersion(name, entry) {
  // From the installed package's own package.json, found above the file the package resolves to:
  // node_modules sits wherever the install put it, which is not always beside this checkout.
  let dir = new URL(".", import.meta.resolve(entry));
  for (;;) {
    try {
      const manifest = JSON.parse(readFileSync(new URL("package.json", dir), "utf8"));
      if (manifest.name === name) return manifest.version;
    } catch {
      // No package.json at this level.
    }
    const parent = new URL("..", dir);
    if (parent.href === dir.href) throw new Error(`no package.json for ${name}`);
    dir = parent;
  }
}

test("vinext and next-intl are the versions the prefetch behaviour was checked against", () => {
  for (const [name, entry] of [["vinext", "vinext/shims/link"], ["next-intl", "next-intl"]]) {
    assert.equal(installedVersion(name, entry), REVIEWED[name], `${name} changed. Re-run the prefetch census (a browser counting RSC requests with ` +
      `next-router-prefetch over the public pages, signed in and out, scrolled to the footer, every link hovered and touched) and ` +
      `re-read how next/link and next-intl's <Link> treat prefetch before updating REVIEWED in tests/link-prefetch.test.mjs.`);
  }
});

// The real next-intl <Link>, rendered: what i18n/navigation.ts gives it has to reach next/link, which
// is where vinext reads it. tests/tsx-render.mjs stands in for next/link and records its props;
// next-intl, its navigation and the app's routing are the real ones. Imported with a query string, so
// that this copy of i18n/navigation.ts is not the stubbed one the test above loaded.
test("next-intl's <Link> passes prefetch={false} on to next/link, with the address localized", async () => {
  const { createElement: h, render } = await import("./tsx-render.mjs");
  const navigation = await import("../i18n/navigation.ts?real");
  assert.notEqual(navigation.Link, (await import("../i18n/navigation.ts")).Link, "not the stubbed copy");
  for (const [props, expected] of [
    [{ href: "/terms" }, { href: "/fr/terms", prefetch: false }],
    [{ href: "/dashboard/saved", prefetch: undefined }, { href: "/fr/dashboard/saved", prefetch: false }],
    [{ href: "/pro", prefetch: null }, { href: "/fr/pro", prefetch: false }],
    [{ href: "/pro", prefetch: true }, { href: "/fr/pro", prefetch: true }],
  ]) {
    const { nextLinks } = render(h(navigation.Link, props, "x"), { locale: "fr", pathname: "/fr/terms" });
    assert.equal(nextLinks.length, 1, JSON.stringify(props));
    assert.deepEqual({ href: nextLinks[0].href, prefetch: nextLinks[0].prefetch }, expected, JSON.stringify(props));
  }
  // The language switcher's shape: the same page in another language, still unprefetched.
  const { nextLinks } = render(h(navigation.Link, { href: "/terms", locale: "es" }, "Español"), { locale: "fr", pathname: "/fr/terms" });
  assert.deepEqual(nextLinks.map(({ href, prefetch }) => ({ href, prefetch })), [{ href: "/es/terms", prefetch: false }]);
});
