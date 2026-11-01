import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { code } from "./source.mjs";
import { elements, linkImports, literals } from "./jsx-links.mjs";
import { anchors, createElement as h, load, render } from "./tsx-render.mjs";

// The kind of link the site's own pages render, held to what the Worker does with each kind.
//
// A client-side navigation fetches the target's RSC flight, and worker/index.ts renders every flight:
// it never answers one from a baked file, the colo cache or its own redirects. A page load is a
// document request, and for a reader without Clerk's session cookie the Worker answers most of
// those without a render: the baked pages, the colo's copy of everything else under a locale, and
// for the dashboard a 307 to the baked sign-in page. So for a signed-out reader a client-side link to
// one of those is a render where a plain link costs none (the footer's dashboard link was two). For
// a reader with the cookie it is the other way round: the Worker renders every page they open, and
// the flight is the cheaper render.
//
// app/ChromeLink.tsx chooses by the cookie, as the Worker does. This file checks three things: that
// no client-side link or push a signed-out reader can follow goes to a page the Worker answers
// without rendering (read from the Worker's own tables, so the two cannot drift); that ChromeLink's
// paths and the plain links around them keep the reader's language; and, rendering the chrome both
// ways with react-dom/server, that it really is plain links signed out and unprefetched client-side
// links signed in, except a link to the page the reader is already on, which is plain for everyone.
// tests/link-prefetch.test.mjs keeps every <Link> from prefetching.
//
// What these renders cannot see is vinext itself: tests/tsx-render.mjs stands in for next/link and
// next/navigation, so how vinext formats an href and what its router does with a navigation (that a
// same-route push does not mount the page again, which is why the same-page rule exists) were
// checked in headless Chrome against a local build, not here.

const read = (path) => code(readFileSync(new URL(`../app/${path}`, import.meta.url), "utf8"));
const { localizedPath } = await load("app/locale-path.ts");
const { dashboardSections } = await load("app/[locale]/dashboard/sections.ts");

// ---------------------------------------------------------------------------------------------
// What the Worker does with a signed-out reader's page load, mirrored from worker/index.ts.
//
// Its tables are read from its source text rather than imported: the entry imports the whole app and
// cloudflare:workers. The logic they feed - pageLookup, isBakedPath and signedOutDashboardRedirect -
// is short enough to mirror, and the checks below fail if a table disappears or changes shape.
// ---------------------------------------------------------------------------------------------
const WORKER = code(readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8"));
function workerSet(name) {
  const match = new RegExp(`const ${name} = new Set\\(\\[([^\\]]*)\\]\\)`).exec(WORKER);
  assert.ok(match, `worker/index.ts no longer has const ${name} = new Set([...])`);
  return new Set(JSON.parse(`[${match[1]}]`));
}
const CACHEABLE_LOCALES = workerSet("CACHEABLE_LOCALES");
const UNCACHEABLE_SEGMENTS = workerSet("UNCACHEABLE_SEGMENTS");
const AUTH_SHELLS = workerSet("AUTH_SHELLS");
const BAKED_PAGES = workerSet("BAKED_PAGES");
const SERVER_READ_PARAMS = (() => {
  const block = /const SERVER_READ_PARAMS = new Map<[^>]*>\(\[([\s\S]*?)\]\);/.exec(WORKER);
  assert.ok(block, "worker/index.ts no longer has const SERVER_READ_PARAMS = new Map(...)");
  return new Map([...block[1].matchAll(/\[\s*"([^"]*)"\s*,\s*\[([^\]]*)\]\s*\]/g)].map(([, route, params]) => [route, JSON.parse(`[${params}]`)]));
})();
const DASHBOARD_PATH = (() => {
  const match = /const DASHBOARD_PATH = \/(.+)\/;/.exec(WORKER);
  assert.ok(match, "worker/index.ts no longer has const DASHBOARD_PATH");
  return new RegExp(match[1]);
})();

/**
 * What the Worker does with a page load of `url` from a reader without a session cookie (whose
 * NEXT_LOCALE agrees with the path, as it does after any page of the site): "baked", "cached",
 * "redirect" (the dashboard's 307 to sign-in, no render), "rendered", or "elsewhere" for a path
 * outside the locale tree.
 */
function signedOutPageLoad(url) {
  const parsed = new URL(url, "https://radar.invalid");
  const pathname = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname;
  const segments = pathname.split("/").filter(Boolean);
  if (!CACHEABLE_LOCALES.has(segments[0])) return "elsewhere";
  // signedOutDashboardRedirect
  const dashboard = DASHBOARD_PATH.exec(pathname);
  if (dashboard && CACHEABLE_LOCALES.has(dashboard[1])) {
    const section = dashboard[2];
    if (section === undefined ? !parsed.searchParams.has("section") : dashboardSections.includes(section)) return "redirect";
  }
  // pageLookup
  if (segments[1] && UNCACHEABLE_SEGMENTS.has(segments[1]) && !(segments.length === 2 && AUTH_SHELLS.has(segments[1]))) return "rendered";
  if (parsed.search) {
    const route = segments.length === 1 ? "" : segments.length === 2 ? segments[1] : segments.length === 3 && segments[1] === "deals" ? "deals/[slug]" : segments.length === 3 && segments[1] === "ottawa" ? "ottawa/[topic]" : segments.length === 3 && segments[1] === "cities" ? "cities/[city]" : segments.length === 4 && segments[1] === "cities" ? "cities/[city]/[topic]" : null;
    const reads = route === null ? undefined : SERVER_READ_PARAMS.get(route);
    if (!reads || [...parsed.searchParams.keys()].some((key) => reads.includes(key))) return "rendered";
  }
  // isBakedPath, then the colo cache
  const page = pathname.slice(segments[0].length + 1);
  return BAKED_PAGES.has(page) || /^\/deals\/[^/]+$/.test(page) || (segments[0] === "en" && /^\/cities(\/[^/]+){0,2}$/.test(page)) ? "baked" : "cached";
}

test("the mirror reads the Worker's tables and agrees with what it does", () => {
  // The functions it mirrors are still there, and still consult what it reads.
  for (const name of ["pageLookup", "isBakedPath", "signedOutDashboardRedirect"]) assert.match(WORKER, new RegExp(`function ${name}\\(`), name);
  assert.match(WORKER, /UNCACHEABLE_SEGMENTS\.has\(segments\[1\]\) && !\(segments\.length === 2 && AUTH_SHELLS\.has\(segments\[1\]\)\)/);
  assert.match(WORKER, /return BAKED_PAGES\.has\(page\) \|\| \/\^\\\/deals\\\/\[\^\/\]\+\$\/\.test\(page\) \|\| \(locale === "en" && \/\^\\\/cities\(\\\/\[\^\/\]\+\)\{0,2\}\$\/\.test\(page\)\);/);
  assert.match(WORKER, /\(dashboardSections as readonly string\[\]\)\.includes\(section\)/);
  assert.deepEqual([...CACHEABLE_LOCALES], ["en", "fr", "es"]);
  assert.ok(BAKED_PAGES.has("") && BAKED_PAGES.has("/terms") && BAKED_PAGES.has("/sign-in"));
  assert.deepEqual(SERVER_READ_PARAMS.get("deals/[slug]"), ["return", "postal", "zip", "all"]);

  const cases = {
    "/en": "baked",
    "/fr?country=CA&q=wings": "baked",
    "/es/terms": "baked",
    "/en/for-restaurants#inquiry": "baked",
    "/en/sign-in?redirect_url=%2Fen%2Fdashboard": "baked",
    "/en/sign-up": "baked",
    "/en/deals/royal-oak": "baked",
    "/en/deals/royal-oak?utm_source=digest": "baked",
    "/en/pro": "cached",
    "/en/pro?plan=yearly": "cached",
    "/en/no-such-page": "cached",
    "/en/dashboard": "redirect",
    "/fr/dashboard/saved": "redirect",
    "/en/dashboard?section=saved": "rendered",
    "/en/dashboard/no-such-section": "rendered",
    "/en/sign-in/factor-one": "rendered",
    "/en/confirm-email?token=x": "rendered",
    "/en/deals/royal-oak?postal=K1A0A1": "rendered",
    "/en/a/b?x=1": "rendered",
    "/admin": "elsewhere",
    "/api/session": "elsewhere",
  };
  for (const [url, expected] of Object.entries(cases)) assert.equal(signedOutPageLoad(url), expected, url);
});

// ---------------------------------------------------------------------------------------------
// The source scan: client-side links and pushes a signed-out reader can follow.
// ---------------------------------------------------------------------------------------------

const APP = new URL("../app/", import.meta.url);
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return entry.name === "(operator)" || entry.name === "api" ? [] : files(url);
    return /\.tsx?$/.test(entry.name) ? [url] : [];
  });
}
// Every public file a signed-out reader can be shown, which is all of them but the dashboard: only a
// reader with the cookie gets it (the Worker sends anyone else to sign-in), so its client-side links
// are the cheaper render for everyone who sees them.
// ChromeLink itself is the one place a client-side link is chosen for a reader with the cookie, and
// the tests at the end of this file render it both ways.
const SIGNED_IN_ONLY = /^\[locale\]\/dashboard\/|^ChromeLink\.tsx$/;
const PUBLIC = files(APP)
  .map((url) => decodeURIComponent(url.pathname.slice(APP.pathname.length)))
  .filter((path) => !SIGNED_IN_ONLY.test(path));

// Client-side navigations a signed-out reader cannot reach, each with why.
const SIGNED_IN_PUSHES = {
  // The Pro page's "manage billing" button: shown only when the reader's plan is Pro.
  "[locale]/pro/UpgradeCta.tsx": ['"/dashboard/billing"'],
};

/** A URL as a link writes it, as the address a signed-out reader's browser would ask for. */
function address(url, { localized }) {
  const filled = url.replaceAll("${locale}", "en");
  return localized ? filled : localizedPath(filled, "en");
}

/** Each client-side link or push in `source` that a signed-out reader would follow to a page the Worker answers without rendering. */
function clientLinkProblems(source, allowed = []) {
  const found = [];
  const { wrapper, next } = linkImports(source);
  const targets = [];
  for (const element of elements(source, [...new Set(["Link", ...wrapper, ...next])])) {
    const href = element.attributes.get("href");
    // The language switcher: this page in another language, through next-intl so that the click
    // writes NEXT_LOCALE (see SiteHeader). One flight per switch, for both kinds of reader.
    if (element.attributes.has("locale") && href === "pathname") continue;
    targets.push({ what: `<${element.name} href=${href}>`, expression: href, localized: next.includes(element.name) });
  }
  // router.push and router.replace: next-intl's router (i18n/navigation) adds the locale, and so is
  // read like its <Link>.
  for (const match of source.matchAll(/\brouter\.(?:push|replace)\(/g)) {
    const open = match.index + match[0].length;
    const args = source.slice(open, source.indexOf(")", open));
    targets.push({ what: `${match[0]}${args})`, expression: args, localized: false });
  }
  for (const { what, expression, localized } of targets) {
    if (expression !== undefined && allowed.includes(expression.trim())) continue;
    const urls = expression === undefined ? [] : literals(expression);
    if (!urls.length) found.push(`${what}: goes somewhere this test cannot read`);
    for (const url of urls) {
      const answer = signedOutPageLoad(address(url, { localized }));
      if (answer !== "rendered" && answer !== "elsewhere") found.push(`${what}: client-side to ${url}, which a signed-out page load gets ${answer}, without a render`);
    }
  }
  return found;
}

test("no client-side link or push a signed-out reader can follow goes to a page the Worker answers without rendering", () => {
  assert.ok(PUBLIC.length > 60, `found ${PUBLIC.length} public files`);
  for (const path of ["SiteHeader.tsx", "SiteFooter.tsx", "HomeClient.tsx", "[locale]/deals/[slug]/DetailActions.tsx", "[locale]/for-creators/CreatorApplication.tsx"]) {
    assert.ok(PUBLIC.includes(path), path);
  }
  const found = PUBLIC.flatMap((path) => clientLinkProblems(read(path), SIGNED_IN_PUSHES[path]).map((problem) => `${path} ${problem}`));
  assert.deepEqual(found, []);
  // What is left in the header, and why: the English-only workspaces, which are not public pages and
  // render for every request, and the language switcher.
  const header = read("SiteHeader.tsx");
  const { wrapper, next } = linkImports(header);
  assert.deepEqual(elements(header, [...wrapper, ...next]).map((element) => element.attributes.get("href")), ['"/admin"', '"/creator"', '"/portal"', "pathname"]);
});

test("nobody is sent to sign-in by a client-side navigation", () => {
  // Whoever is sent there is signed out, and the Worker answers the page load with the baked sign-in
  // page. The deal page's Save and Report, the home page's heart and the Pro page's upgrade button
  // send a reader there from code, after a 401 or with no session.
  for (const path of ["[locale]/deals/[slug]/DetailActions.tsx", "HomeClient.tsx", "[locale]/pro/UpgradeCta.tsx"]) {
    const source = read(path);
    assert.match(source, /window\.location\.assign\(`\/\$\{locale\}\/sign-in\?redirect_url=\$\{encodeURIComponent\(/, path);
    assert.doesNotMatch(source, /router\.(?:push|replace)\([^)]*sign-(?:in|up)/, path);
  }
  for (const path of PUBLIC) assert.doesNotMatch(read(path), /\brouter\.(?:push|replace)\(\s*[`"']\/sign-(?:in|up)/, path);
});

// ---------------------------------------------------------------------------------------------
// The addresses: ChromeLink's paths and the plain links beside them.
// ---------------------------------------------------------------------------------------------

const CHROME = [
  "SiteHeader.tsx",
  "SiteFooter.tsx",
  "CookieNotice.tsx",
  "NotFoundContent.tsx",
  "[locale]/NotFoundPage.tsx",
  "[locale]/not-found.tsx",
  "[locale]/LegalToc.tsx",
  "[locale]/terms/page.tsx",
  "[locale]/privacy/page.tsx",
  "[locale]/support/page.tsx",
  "[locale]/terms/TermsFr.tsx",
  "[locale]/privacy/PrivacyFr.tsx",
  "[locale]/support/SupportFr.tsx",
  "[locale]/TranslationNotice.tsx",
  "[locale]/age-suitability/page.tsx",
];

// Where a plain link may go: the reader's own language, a place on this page, an email, a phone
// number, or another site. A site-relative link without the locale is sent on by the middleware to
// whatever language the cookie or the browser names (tests/locale-links.test.mjs) - a redirect,
// and a render.
const PLAIN_LINK = /^(?:\/\$\{locale\}(?=$|[/?#])|#|mailto:|tel:|https:\/\/)/;

/** Each plain link in `source` that leaves the reader's language. */
function plainLinkProblems(source) {
  const found = [];
  for (const href of elements(source, ["a"]).map((element) => element.attributes.get("href")).filter((href) => href !== undefined)) {
    const urls = literals(href);
    if (!urls.length) found.push(`href={${href}}: goes somewhere this test cannot read`);
    for (const url of urls) {
      if (!PLAIN_LINK.test(url)) found.push(`href=${href}: ${url || "an interpolation"} is not /\${locale}/..., #, mailto:, tel: or https://`);
    }
  }
  return found;
}

// ChromeLink takes a path without its locale ("/terms"), which each kind of link adds its own way,
// or a place on this page ("#results"). An address it carries for later - where sign-in returns the
// reader - is written out with the locale, because nothing adds one to it: the encoded literal, or
// encodeURIComponent of a `/${locale}...` template, or the chrome's afterSignIn (checked below).
const CHROME_PATH = /^(?:\/(?!\$\{locale\}|(?:en|fr|es)(?:$|[/?#]))|#)/;
const RETURN_ADDRESS = /redirect_url=(?:%2F\$\{locale\}|\$\{afterSignIn\}|\$\{encodeURIComponent\(`\/\$\{locale\})/;

/** Each ChromeLink in `source` (and each href in link data it maps over) with an address it cannot take. */
function chromeLinkProblems(source, { data = false } = {}) {
  const hrefs = elements(source, ["ChromeLink", "LinkTo"]).map((element) => element.attributes.get("href"));
  if (data) for (const match of source.matchAll(/\bhref:\s*("[^"]*"|`[^`]*`)/g)) hrefs.push(match[1]);
  const found = [];
  for (const href of hrefs) {
    if (href === undefined) { found.push("a ChromeLink without an href"); continue; }
    // Only the literals that are addresses: ChromeLink's type admits nothing but "/..." and "#...",
    // so any other string in the expression is something else ("overview" in a comparison).
    const urls = literals(href).filter((url) => /^[/#]/.test(url));
    // The helpers that build one, each written out with a locale-less path beside it (cityPath and
    // cityHomeQuery's are held to it in tests/city-pages.test.mjs).
    if (!urls.length && !/^(?:brandHref|exploreHref) \?\? "\/"$|^link\.href$|^home$|^dealPath\(\w+\)$|^accountHref\("\w+"\)$|^cityPath\(\w+(?:, \w+(?:\.\w+)?)?\)$|^cityHomeQuery\(\w+\)$/.test(href)) found.push(`href={${href}}: goes somewhere this test cannot read`);
    for (const url of urls) {
      if (!CHROME_PATH.test(url)) found.push(`href=${href}: ${url} is not a path without its locale, or a place on this page`);
      if (/redirect_url=/.test(href) && !RETURN_ADDRESS.test(href)) found.push(`href=${href}: the address it returns to has no locale`);
    }
  }
  return found;
}

test("the chrome's ChromeLinks are paths without their locale, and its plain links keep the reader's language", () => {
  const found = [];
  for (const path of CHROME) {
    const source = read(path);
    found.push(...plainLinkProblems(source.replace(/function PlainLink[\s\S]*?\n\}/, "")).map((problem) => `${path} ${problem}`));
    found.push(...chromeLinkProblems(source, { data: path === "SiteFooter.tsx" }).map((problem) => `${path} ${problem}`));
  }
  // And everywhere else a ChromeLink is written.
  for (const path of PUBLIC.filter((path) => !CHROME.includes(path)).concat(files(new URL("[locale]/dashboard/", APP)).map((url) => decodeURIComponent(url.pathname.slice(APP.pathname.length))))) {
    found.push(...chromeLinkProblems(read(path)).map((problem) => `${path} ${problem}`));
  }
  assert.deepEqual(found, []);
  // And the scan found what it is for: the header's and the footer's links, the notice's link to the
  // storage section, the legal pages' links to each other.
  const count = (path) => elements(read(path), ["ChromeLink"]).length;
  assert.ok(count("SiteHeader.tsx") >= 9, "the header's links");
  assert.ok((read("SiteFooter.tsx").match(/\bhref: ["`]\//g) ?? []).length >= 12, "the footer's columns");
  assert.equal(count("CookieNotice.tsx"), 1);
  for (const page of ["terms", "privacy", "support", "age-suitability"]) {
    assert.match(read(`[locale]/${page}/page.tsx`), /<ChromeLink href="\/(?:terms|privacy)/, `${page} links to the other legal pages`);
  }
});

test("a 404's links lead to the reader's language", () => {
  const content = read("NotFoundContent.tsx");
  assert.match(content, /LinkTo = PlainLink \}: \{ copy\?: Copy; LinkTo\?: HomeLink \}/);
  // Every public page that renders the card hands it ChromeLink, which writes the locale in; only the
  // English-only operator area, outside [locale], leaves it the plain link to "/", which the
  // middleware sends on to the reader's language.
  const renders = readdirSync(APP, { recursive: true })
    .filter((path) => /\.tsx$/.test(path))
    .map((path) => path.replaceAll("\\", "/"))
    .flatMap((path) => elements(read(path), ["NotFoundContent"]).map((element) => ({ path, LinkTo: element.attributes.get("LinkTo") })));
  assert.deepEqual(renders.filter(({ path }) => !path.startsWith("(operator)/")), [{ path: "[locale]/NotFoundPage.tsx", LinkTo: "ChromeLink" }]);
  assert.ok(renders.every(({ path, LinkTo }) => !path.startsWith("(operator)/") || LinkTo === undefined));
});

test("what a page hands the header for its own links is a place on that page", () => {
  // The home page passes "#top" and "#results"; every other page leaves them, and the header falls
  // back to "/", the home page, which ChromeLink puts in the reader's language.
  const header = read("SiteHeader.tsx");
  assert.match(header, /brandHref\?: `#\$\{string\}`/);
  assert.match(header, /exploreHref\?: `#\$\{string\}`/);
  assert.match(header, /<ChromeLink className="brand" href=\{brandHref \?\? "\/"\}>/);
  assert.match(header, /<ChromeLink href=\{exploreHref \?\? "\/"\}[ >]/);
});

test("signing in from the chrome returns the reader to their dashboard, in their language", () => {
  // Written out, not left to the sign-in page to fill in: the same destination safeAuthRedirect
  // would have made of "/dashboard" (tests/locale-links.test.mjs), and a link that says where it goes.
  for (const path of ["SiteHeader.tsx", "SiteFooter.tsx"]) {
    const source = read(path);
    assert.match(source, /const afterSignIn = encodeURIComponent\(`\/\$\{locale\}\/dashboard`\);/, path);
    assert.match(source, /`\/sign-in\?redirect_url=\$\{afterSignIn\}`/, path);
    assert.match(source, /`\/sign-up\?redirect_url=\$\{afterSignIn\}`/, path);
  }
});

test("the scans see the shapes they are for", () => {
  const wrapper = `import { Link, useRouter } from "../i18n/navigation";\n`;
  const next = `import NextLink from "next/link";\n`;
  // The shapes this replaced, and the ones the old rule let through: sign-in, sign-up and the
  // dashboard were "rendered regardless" before the Worker baked the first two and answered the
  // third with its own redirect.
  for (const shape of [
    `${wrapper}<Link href="/terms">Terms</Link>`,
    `${wrapper}<Link className="brand" href="/">`,
    `${wrapper}<Link href="/for-restaurants#inquiry">`,
    `${wrapper}<Link href="/pro">`,
    `${wrapper}<Link href="/dashboard">`,
    `${wrapper}<Link href="/dashboard/saved">`,
    `${wrapper}<Link href="/sign-in?redirect_url=%2Ffor-creators">`,
    `${wrapper}<Link href={\`/deals/\${slug}\`}>`,
    `${wrapper}<Link href={\`/\${locale}/privacy\`}>`,
    `${next}<NextLink href="/fr/support" prefetch={false}>`,
    `${wrapper}router.push(\`/sign-in?redirect_url=\${encodeURIComponent(returnTo)}\`);`,
    `${wrapper}router.push("/dashboard/alerts");`,
    `${wrapper}<Link href={pathname}>`,
    `${wrapper}<Link href={target}>`,
  ]) assert.equal(clientLinkProblems(shape).length, 1, shape);
  for (const fine of [
    `${wrapper}<Link href={pathname} locale={code} hrefLang={code}>`,
    `${next}<NextLink href="/admin" prefetch={false}>`,
    `${wrapper}<Link href="/sign-in/factor-one">`,
    `${wrapper}<Link href="/confirm-email">`,
    `${wrapper}<Link href={\`/deals/x?postal=\${postal}\`}>`,
  ])assert.deepEqual(clientLinkProblems(fine), [], fine);
  assert.deepEqual(clientLinkProblems(`${wrapper}router.push("/dashboard/account")`, ['"/dashboard/account"']), [], "an allowed push");

  assert.deepEqual(plainLinkProblems(`<a href="/terms">`), [`href="/terms": /terms is not /\${locale}/..., #, mailto:, tel: or https://`]);
  for (const shape of ["<a href={`/sign-in?redirect_url=${afterSignIn}`}>", "<a href={target}>", "<a href={`${base}/terms`}>", "<a href={`/${locale}terms`}>"]) {
    assert.equal(plainLinkProblems(shape).length, 1, shape);
  }
  for (const fine of ["<a href={`/${locale}`}>", "<a href={`/${locale}/privacy#storage`}>", "<a href={`#${id}`}>", '<a href="mailto:support@cedartechsolutions.ca">', '<a href="https://reportaproblem.apple.com" target="_blank">']) {
    assert.deepEqual(plainLinkProblems(fine), [], fine);
  }

  for (const shape of [
    "<ChromeLink href={`/${locale}/terms`}>",
    '<ChromeLink href="/fr/terms">',
    '<ChromeLink href="/en">',
    '<ChromeLink href="terms">',
    "<ChromeLink href={`/sign-in?redirect_url=%2Fdashboard`}>",
    "<ChromeLink href={`/sign-in?redirect_url=${encodeURIComponent(location.pathname)}`}>",
    "<ChromeLink href={target}>",
  ]) assert.equal(chromeLinkProblems(shape).length, 1, shape);
  for (const fine of [
    '<ChromeLink href="/">',
    '<ChromeLink href="/?suggest=1">',
    '<ChromeLink href="/privacy#storage">',
    '<ChromeLink href="#results">',
    '<ChromeLink href="/english-page">',
    "<ChromeLink href={`/sign-in?redirect_url=${afterSignIn}`}>",
    "<ChromeLink href={`/sign-in?redirect_url=${encodeURIComponent(`/${locale}/for-creators`)}`}>",
  ]) assert.deepEqual(chromeLinkProblems(fine), [], fine);
  assert.equal(chromeLinkProblems('const links = [{ key: "pro", href: `/${locale}/pro` }];', { data: true }).length, 1);
});

// ---------------------------------------------------------------------------------------------
// The chrome as it renders, both ways.
// ---------------------------------------------------------------------------------------------

const { HasSessionProvider } = await load("app/has-session.tsx");
const { default: ChromeLink, useChromeNavigate, isCurrentPage } = await load("app/ChromeLink.tsx");
const { default: SiteFooter } = await load("app/SiteFooter.tsx");
const { default: SiteHeader } = await load("app/SiteHeader.tsx");
const { default: NotFoundContent } = await load("app/NotFoundContent.tsx");
const as = (signedIn) => (child) => h(HasSessionProvider, { value: signedIn }, child);
const internal = (links) => links.filter(({ href }) => href?.startsWith("/"));

test("signed out, the chrome renders plain links in the reader's language", () => {
  for (const locale of ["en", "fr", "es"]) {
    const footer = render(h(SiteFooter, {}), { locale, pathname: `/${locale}/terms`, wrap: as(false) });
    const header = render(h(SiteHeader, {}), { locale, pathname: `/${locale}/terms`, wrap: as(false) });
    for (const [what, { html, nextLinks }] of [["footer", footer], ["header", header]]) {
      assert.deepEqual(nextLinks, [], `${what} in ${locale}: no client-side link`);
      const links = internal(anchors(html));
      assert.ok(links.length >= (what === "footer" ? 14 : 3), `${what} in ${locale}: ${links.length} links`);
      for (const { href, nextLink } of links) {
        assert.equal(nextLink, null, `${what} ${href}`);
        assert.match(href, new RegExp(`^/${locale}(?:$|[/?#])`), `${what} ${href} keeps the language`);
        // And each is a page the Worker answers for nothing: that is the point of a plain link.
        assert.notEqual(signedOutPageLoad(href), "rendered", `${what} ${href}`);
      }
    }
    // The footer's dashboard link is the Worker's 307, and sign-in returns to the dashboard in the
    // same language.
    const footerLinks = anchors(footer.html).map(({ href }) => href);
    assert.ok(footerLinks.includes(`/${locale}/dashboard`));
    assert.ok(footerLinks.includes(`/${locale}/sign-in?redirect_url=%2F${locale}%2Fdashboard`));
  }
});

test("signed in, the chrome renders client-side links that never prefetch", () => {
  for (const locale of ["en", "fr", "es"]) {
    // On a deal page, which no chrome link goes to (a link to the current page is plain: below).
    const footer = render(h(SiteFooter, {}), { locale, pathname: `/${locale}/deals/royal-oak`, wrap: as(true) });
    const header = render(h(SiteHeader, {}), { locale, pathname: `/${locale}/deals/royal-oak`, wrap: as(true) });
    for (const [what, { html, nextLinks }] of [["footer", footer], ["header", header]]) {
      const links = internal(anchors(html));
      assert.ok(links.length >= (what === "footer" ? 14 : 3), `${what} in ${locale}: ${links.length} links`);
      for (const { href, nextLink } of links) {
        assert.equal(nextLink, "false", `${what} ${href} is next/link with prefetch={false}`);
        assert.match(href, new RegExp(`^/${locale}(?:$|[/?#])`), `${what} ${href} keeps the language`);
      }
      assert.equal(nextLinks.length, links.length);
      assert.ok(nextLinks.every(({ prefetch }) => prefetch === false));
    }
    // Everything else on the page is what it was: an email, a place on the page.
    assert.ok(anchors(footer.html).some(({ href, nextLink }) => href.startsWith("mailto:") && nextLink === null));
    assert.ok(anchors(header.html).some(({ href, nextLink }) => href.startsWith("#") && nextLink === null));
  }
});

test("a ChromeLink's address is the same either way", () => {
  // From a page none of them is.
  for (const href of ["/", "/?suggest=1", "/#results", "/privacy#storage", "/for-restaurants#inquiry", "/sign-in?redirect_url=%2Ffr%2Fdashboard", "/deals/royal-oak", "/dashboard/saved"]) {
    const plain = anchors(render(h(ChromeLink, { href }, "x"), { locale: "fr", pathname: "/fr/terms", wrap: as(false) }).html);
    const client = anchors(render(h(ChromeLink, { href }, "x"), { locale: "fr", pathname: "/fr/terms", wrap: as(true) }).html);
    assert.deepEqual(plain, [{ href: localizedPath(href, "fr"), nextLink: null }], href);
    assert.deepEqual(client, [{ href: localizedPath(href, "fr"), nextLink: "false" }], href);
  }
  // A place on this page is a plain anchor for everyone.
  for (const signedIn of [false, true]) assert.deepEqual(anchors(render(h(ChromeLink, { href: "#results" }, "x"), { wrap: as(signedIn) }).html), [{ href: "#results", nextLink: null }]);
  // With no provider at all (a not-found page the locale layout rejected), plain.
  assert.deepEqual(anchors(render(h(ChromeLink, { href: "/terms" }, "x"), { locale: "es" }).html), [{ href: "/es/terms", nextLink: null }]);
  // And the 404's card, through it.
  const card = (signedIn) => anchors(render(h(NotFoundContent, { LinkTo: ChromeLink }), { locale: "es", pathname: "/es/no-such-page", wrap: as(signedIn) }).html);
  assert.deepEqual(card(false), [{ href: "/es", nextLink: null }, { href: "/es#results", nextLink: null }]);
  assert.deepEqual(card(true), [{ href: "/es", nextLink: "false" }, { href: "/es#results", nextLink: "false" }]);
});

// A client-side navigation to the route already on screen does not mount the page again, and the
// home page sets itself up from the address only on mount: signed in on /en?q=wings, a next/link to
// "/en" changed the address and left the wings results showing. So a link to the current page is a
// page load whoever follows it.
test("a link to the page the reader is on is a plain link, signed in too", () => {
  for (const locale of ["en", "fr", "es"]) {
    // The home page: the footer's brand and "Browse deals" are "/" (its suggest row is a button there).
    const footer = render(h(SiteFooter, { onSuggest: () => {} }), { locale, pathname: `/${locale}`, wrap: as(true) });
    const links = internal(anchors(footer.html));
    const home = links.filter(({ href }) => href === `/${locale}` || href.startsWith(`/${locale}?`) || href.startsWith(`/${locale}#`));
    assert.ok(home.length >= 2, `footer on the home page in ${locale}: ${JSON.stringify(home)}`);
    for (const link of home) assert.equal(link.nextLink, null, `footer ${link.href} on the home page`);
    assert.ok(!footer.nextLinks.some(({ href }) => href === `/${locale}` || href.startsWith(`/${locale}?`) || href.startsWith(`/${locale}#`)), "no next/link to the home page");
    // Every other link in it is still client-side.
    const others = links.filter((link) => !home.includes(link));
    assert.ok(others.length >= 10 && others.every(({ nextLink }) => nextLink === "false"), JSON.stringify(others));
  }
  // The same footer on another page links home client-side.
  assert.ok(render(h(SiteFooter, {}), { locale: "fr", pathname: "/fr/terms", wrap: as(true) }).nextLinks.some(({ href }) => href === "/fr"));
  // Whatever the query or the place on the page.
  for (const [href, pathname] of [["/privacy#storage", "/fr/privacy"], ["/?suggest=1", "/fr"], ["/#results", "/fr"], ["/dashboard/saved", "/fr/dashboard/saved"], ["/for-restaurants#inquiry", "/fr/for-restaurants"]]) {
    assert.deepEqual(anchors(render(h(ChromeLink, { href }, "x"), { locale: "fr", pathname, wrap: as(true) }).html), [{ href: localizedPath(href, "fr"), nextLink: null }], `${href} on ${pathname}`);
  }
  // A neighbouring page is still client-side: the dashboard's other sections.
  assert.deepEqual(anchors(render(h(ChromeLink, { href: "/dashboard" }, "x"), { locale: "fr", pathname: "/fr/dashboard/saved", wrap: as(true) }).html), [{ href: "/fr/dashboard", nextLink: "false" }]);
});

// A client-side navigation is not announced by the browser the way a page load is, and vinext has no
// route announcer of its own: app/RouteAnnouncer.tsx is the app's, and every page has to have it.
// What it does after a navigation needs a browser and was checked in one; here, that it is mounted
// at the root of both trees and renders a live region that is there, empty, from the first paint.
test("every page has the route announcer, an empty live region on first render", async () => {
  const shell = read("RootShell.tsx");
  assert.match(shell, /import RouteAnnouncer from "\.\/RouteAnnouncer"/);
  assert.equal([...shell.matchAll(/<RouteAnnouncer\s*\/>/g)].length, 1, "mounted once, in RootShell");
  for (const root of ["PublicShell.tsx", "OperatorShell.tsx"]) assert.match(read(root), /<RootShell\b/, `${root} renders RootShell`);
  const { default: RouteAnnouncer } = await load("app/RouteAnnouncer.tsx");
  const { html } = render(h(RouteAnnouncer), { pathname: "/en/terms" });
  assert.match(html, /^<p class="sr-only" role="status" aria-live="polite" aria-atomic="true" data-route-announcer="">\s*<\/p>$/, html);
});

test("the current page is told by its path alone", () => {
  for (const [href, pathname] of [["/", "/"], ["/?q=wings", "/"], ["/#results", "/"], ["/terms", "/terms/"], ["/deals/caf%C3%A9", "/deals/café"], ["/dashboard/saved?x=1#y", "/dashboard/saved"]]) {
    assert.equal(isCurrentPage(href, pathname), true, `${href} on ${pathname}`);
  }
  for (const [href, pathname] of [["/", "/terms"], ["/terms", "/"], ["/dashboard", "/dashboard/saved"], ["/deals/a", "/deals/ab"], ["/", null], ["/", ""]]) {
    assert.equal(isCurrentPage(href, pathname), false, `${href} on ${pathname}`);
  }
});

test("a navigation from code goes the same way as the links", () => {
  const pushes = [], assigns = [];
  globalThis.__routerPush = (href) => pushes.push(href);
  const window = globalThis.window;
  globalThis.window = { location: { assign: (href) => assigns.push(href) } };
  try {
    let navigate;
    const Probe = () => { navigate = useChromeNavigate(); return null; };
    render(h(Probe), { locale: "fr", pathname: "/fr/terms", wrap: as(false) });
    navigate("/pro");
    navigate("/?suggest=1");
    assert.deepEqual(assigns, ["/fr/pro", "/fr?suggest=1"], "signed out, a page load of the localized address");
    assert.deepEqual(pushes, []);
    render(h(Probe), { locale: "fr", pathname: "/fr/terms", wrap: as(true) });
    navigate("/pro");
    assert.deepEqual(pushes, ["/fr/pro"], "signed in, a client-side push");
    assert.equal(assigns.length, 2);
    // To the page the reader is on, a page load for them too.
    navigate("/terms#payments");
    render(h(Probe), { locale: "fr", pathname: "/fr", wrap: as(true) });
    navigate("/?suggest=1");
    assert.deepEqual(assigns.slice(2), ["/fr/terms#payments", "/fr?suggest=1"], "signed in, to the current page");
    assert.deepEqual(pushes, ["/fr/pro"]);
  } finally {
    globalThis.window = window;
    delete globalThis.__routerPush;
  }
});
