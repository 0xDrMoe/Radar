import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";
import { code } from "./source.mjs";

// Every internal link a client component builds keeps the reader's language.
//
// The /fr home served its mobile bottom nav as "/sign-in?redirect_url=%2Fdashboard%2Fsaved", a
// creator's picks and the recently-viewed strip as "/deals/<slug>", and the dashboard's deal links
// the same. A path with no locale is sent on by the middleware to whatever language the cookie or
// the browser names, and with no cookie that is English: a French reader who tapped "Enregistrés"
// landed on the English sign-in page.
//
// next-intl's <Link> and useRouter (i18n/navigation) add the locale themselves, so a path handed
// to them is fine, and so does app/ChromeLink.tsx whichever kind of link it renders
// (tests/chrome-links.test.mjs holds its paths to that). Everything else - a raw <a>, next/link, a document navigation through
// window.location - is the URL the browser goes to, and has to carry the locale already: the way
// the rest of the app writes it, `/${locale}/deals/...`. English-only routes outside the [locale]
// tree (/admin, /creator, /portal, /affiliate, /api) and static files are not localized, so a
// link to them is not either.

// app/locale-path.ts is imported the way the other unit tests import app/ modules.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier) && context.parentURL?.includes("/app/")) {
      return nextResolve(`${specifier}.ts`, context);
    }
    return nextResolve(specifier, context);
  },
});
const { UNLOCALIZED_ROUTES, localizedPath, needsLocale } = await import("../app/locale-path.ts");
const { safeAuthRedirect } = await import("../app/auth-redirect.ts");

const APP = new URL("../app/", import.meta.url);

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${encodeURIComponent(entry.name)}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) return entry.name === "(operator)" ? [] : files(url);
    return /\.tsx?$/.test(entry.name) ? [url] : [];
  });
}

// The English-only workspaces live under app/(operator) and are skipped above: they are not
// localized, and neither are the links inside them. The API returns no markup.
const sources = files(APP)
  .map((url) => ({ path: decodeURIComponent(url.pathname.slice(APP.pathname.length)), source: code(readFileSync(url, "utf8")) }))
  .filter(({ path }) => !path.startsWith("api/"));
const clientComponents = sources.filter(({ source }) => /^\s*["']use client["']/.test(source));

/** Where the matching close of the bracket at `start` is, skipping strings and template text. */
function closing(source, start) {
  const open = source[start], close = { "{": "}", "(": ")" }[open];
  let depth = 0;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === '"' || character === "'" || character === "`") {
      cursor = stringEnd(source, cursor);
      continue;
    }
    if (character === open) depth += 1;
    else if (character === close && --depth === 0) return cursor;
  }
  return source.length;
}

function stringEnd(source, start) {
  const quote = source[start];
  for (let cursor = start + 1; cursor < source.length; cursor += 1) {
    if (source[cursor] === "\\") { cursor += 1; continue; }
    if (quote === "`" && source[cursor] === "$" && source[cursor + 1] === "{") { cursor = closing(source, cursor + 1); continue; }
    if (source[cursor] === quote) return cursor;
  }
  return source.length;
}

/**
 * The URLs an expression can produce, as far as its literals say: every string literal, and every
 * template literal up to its first interpolation that is not the locale. `/${locale}/deals/${slug}`
 * reads as "/${locale}/deals/", which is enough to see where it goes.
 */
function literals(expression) {
  const found = [];
  for (let cursor = 0; cursor < expression.length; cursor += 1) {
    const character = expression[cursor];
    if (character !== '"' && character !== "'" && character !== "`") continue;
    const end = stringEnd(expression, cursor);
    const body = expression.slice(cursor + 1, end);
    found.push(character === "`" ? body.replace(/\$\{(?!locale\})[\s\S]*$/, "") : body);
    cursor = end;
  }
  return found;
}

/**
 * Why `url` is a locale-less internal link, or null when it is fine. A redirect_url written out in
 * the literal is a place the browser goes next, so it is held to the same rule; one built by an
 * interpolation was cut off by literals() and is not judged.
 */
function problem(url) {
  if (!url.startsWith("/") || url.startsWith("//")) return null;
  const pathname = url.split(/[?#]/)[0];
  const lacksLocale = (path) => !path.startsWith("/${locale}") && needsLocale(path);
  if (lacksLocale(pathname)) return `${pathname} has no locale`;
  const redirect = /[?&]redirect_url=([^&#]*)/.exec(url)?.[1];
  if (redirect) {
    const target = decodeURIComponent(redirect);
    if (lacksLocale(target.split(/[?#]/)[0])) return `redirect_url ${target} has no locale`;
  }
  return null;
}

/** Every href a raw element (an <a>, or next/link) is given, and every document navigation. */
function rawTargets(source) {
  const targets = [];
  // next/link renders the path as written. next-intl's Link does not, and is left out.
  const nextLinks = [...source.matchAll(/import\s+(\w+)\s+from\s+["']next\/link["']/g)].map((match) => match[1]);
  const tag = new RegExp(`<(a|${["a", ...nextLinks].join("|")})\\b`, "g");
  for (const match of source.matchAll(tag)) {
    // The opening tag, to its own ">", stepping over attribute expressions.
    let cursor = match.index + match[0].length;
    for (; cursor < source.length && source[cursor] !== ">"; cursor += 1) {
      if (source[cursor] === "{") {
        const end = closing(source, cursor);
        const attribute = /\bhref=$/.test(source.slice(match.index, cursor)) ? source.slice(cursor + 1, end) : null;
        if (attribute !== null) targets.push({ element: `<${match[1]}>`, expression: attribute, at: match.index });
        cursor = end;
      } else if (source[cursor] === '"') {
        const end = stringEnd(source, cursor);
        if (/\bhref=$/.test(source.slice(match.index, cursor))) targets.push({ element: `<${match[1]}>`, expression: source.slice(cursor, end + 1), at: match.index });
        cursor = end;
      }
    }
  }
  for (const match of source.matchAll(/\blocation\.(?:assign|replace)\(|\bwindow\.open\(/g)) {
    const open = match.index + match[0].length - 1;
    targets.push({ element: match[0].slice(0, -1), expression: source.slice(open + 1, closing(source, open)), at: match.index });
  }
  for (const match of source.matchAll(/\blocation\.href\s*=(?!=)([^;\n]*)/g)) targets.push({ element: "location.href", expression: match[1], at: match.index });
  return targets;
}

// Server components too: none builds one today, and the rule is the same for their markup.
test("no client component builds a locale-less internal link", () => {
  assert.ok(clientComponents.length > 30, `found ${clientComponents.length} client components`);
  assert.ok(clientComponents.some(({ path }) => path === "HomeClient.tsx"));
  assert.ok(clientComponents.some(({ path }) => path === "[locale]/dashboard/DashboardClient.tsx"));
  const found = [];
  for (const { path, source } of sources) {
    for (const target of rawTargets(source)) {
      for (const url of literals(target.expression)) {
        const why = problem(url);
        // Named by what it says rather than a line number: the comments are gone from `source`,
        // and the lines with them.
        if (why) found.push(`${path} ${target.element} ${why}: ${target.expression.trim().slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(found, []);
});

test("the scan sees the shapes that shipped", () => {
  const flagged = (source) => rawTargets(source).flatMap((target) => literals(target.expression).map(problem)).filter(Boolean);
  // HomeClient's creator picks and recently viewed, and DashboardClient's DealLink.
  assert.equal(flagged("<a key={item.id} href={`/deals/${encodeURIComponent(item.slug)}`}>").length, 1);
  // The bottom nav: a conditional, both halves wrong, one of them twice over.
  assert.deepEqual(flagged(`<a href={session ? "/dashboard/saved" : "/sign-in?redirect_url=%2Fdashboard%2Fsaved"}><Heart/></a>`),
    ["/dashboard/saved has no locale", "/sign-in has no locale"]);
  assert.deepEqual(flagged("<a href={`/${locale}/sign-in?redirect_url=%2Fdashboard`}>"), ["redirect_url /dashboard has no locale"]);
  assert.equal(flagged(`import NextLink from "next/link";\n<NextLink href="/pro">Pro</NextLink>`).length, 1);
  assert.equal(flagged(`window.location.assign("/dashboard")`).length, 1);
  assert.equal(flagged(`window.location.href = "/dashboard";`).length, 1);
  // What is fine: the locale written in, next-intl's Link, the English-only routes, files, and
  // anything off-site.
  for (const fine of [
    "<a href={`/${locale}/deals/${encodeURIComponent(d.slug)}`}>",
    "<a href={`/${locale}/sign-in?redirect_url=${encodeURIComponent(`/${locale}/dashboard`)}`}>",
    `<a href="/fr/dashboard">`,
    `<Link href="/dashboard/saved">`,
    `import NextLink from "next/link";\n<NextLink href="/admin">`,
    `<a href="/api/export" download>`,
    `<a href="/favicon.ico">`,
    `<a href="#results">`,
    `<a href="https://www.google.com/maps">`,
    `<a href={dealHref(d)}>`,
    `window.location.href = result.url;`,
  ]) assert.deepEqual(flagged(fine), [], fine);
});

test("the English-only routes are the ones the middleware leaves alone", () => {
  // proxy.ts's matcher has to stay a literal for the build to read it, so the list is written
  // twice. They must agree, or a link to a new workspace is either sent to /fr/<workspace>, which
  // does not exist, or left without a locale on a page that has one.
  const proxy = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");
  const excluded = /\(\?!([^)]*)\)/.exec(proxy.match(/matcher:\s*\[\s*"([^"]+)"/)[1])[1].split("|").filter((entry) => /^[\w-]+$/.test(entry));
  assert.deepEqual([...UNLOCALIZED_ROUTES].sort(), excluded.sort());
  // And the locales are the ones i18n/routing.ts routes.
  const routing = readFileSync(new URL("../i18n/routing.ts", import.meta.url), "utf8");
  assert.match(routing, /locales: \["en", "fr", "es"\]/);
  for (const locale of ["en", "fr", "es"]) assert.equal(needsLocale(`/${locale}/pro`), false, locale);
});

test("localizedPath puts the locale on a public path and nothing else", () => {
  assert.equal(localizedPath("/dashboard/saved", "fr"), "/fr/dashboard/saved");
  assert.equal(localizedPath("/", "es"), "/es");
  assert.equal(localizedPath("/?suggest=1", "es"), "/es?suggest=1");
  assert.equal(localizedPath("/pro?plan=yearly#top", "fr"), "/fr/pro?plan=yearly#top");
  assert.equal(localizedPath("/fr/dashboard", "es"), "/fr/dashboard", "a path that names its language keeps it");
  assert.equal(localizedPath("/en", "fr"), "/en");
  for (const path of ["/admin", "/admin/deals", "/creator", "/portal", "/portal-invite/1?token=x", "/affiliate", "/api/me"]) {
    assert.equal(localizedPath(path, "fr"), path, `${path} is English-only`);
  }
  assert.equal(localizedPath("/dashboard"), "/dashboard", "no locale to add");
});

test("signing in returns a reader to their own language", () => {
  // The site's own links to sign-in write the locale into the redirect_url they carry
  // (tests/chrome-links.test.mjs), but a bare one still arrives - an older link, a bookmark, a
  // client-side link that put the locale on /sign-in and not on the address inside it. The sign-in
  // page reads that in its own language.
  assert.equal(safeAuthRedirect("?redirect_url=%2Fdashboard", "/dashboard", "fr"), "/fr/dashboard");
  assert.equal(safeAuthRedirect("?redirect_url=%2Ffor-creators", "/dashboard", "es"), "/es/for-creators");
  assert.equal(safeAuthRedirect("?redirect_url=%2Ffr%2Fdashboard%2Fsaved", "/dashboard", "es"), "/fr/dashboard/saved");
  assert.equal(safeAuthRedirect("?redirect_url=%2Fadmin", "/dashboard", "fr"), "/admin", "the workspaces are English-only");
  assert.equal(safeAuthRedirect("", "/dashboard", "fr"), "/fr/dashboard", "the fallback too");
  assert.equal(safeAuthRedirect("?redirect_url=https%3A%2F%2Fevil.example%2F", "/dashboard", "fr"), "/fr/dashboard", "never off-site");
  assert.equal(safeAuthRedirect("?redirect_url=%2F%2Fevil.example", "/dashboard", "fr"), "/fr/dashboard");
  assert.equal(safeAuthRedirect("?redirect_url=%2Fdashboard"), "/dashboard", "no locale given, nothing added");
  for (const page of ["sign-in/[[...sign-in]]", "sign-up/[[...sign-up]]"]) {
    const source = code(readFileSync(new URL(`../app/[locale]/${page}/page.tsx`, import.meta.url), "utf8"));
    assert.match(source, /safeAuthRedirect\([\s\S]*?"\/dashboard",\s*locale,?\s*\)/, `${page} passes its locale`);
  }
});

test("the dashboard's own redirects keep the locale they were asked in", () => {
  // GET /fr/dashboard, signed out, answered /sign-in?redirect_url=%2Fdashboard.
  const overview = code(readFileSync(new URL("../app/[locale]/dashboard/page.tsx", import.meta.url), "utf8"));
  const section = code(readFileSync(new URL("../app/[locale]/dashboard/[section]/page.tsx", import.meta.url), "utf8"));
  for (const source of [overview, section]) {
    assert.match(source, /const home = localizedPath\("\/dashboard", locale\);/);
    for (const [, target] of source.matchAll(/redirect\(([^;]*)\);/g)) {
      assert.match(target, /\bhome\b/, `redirect(${target}) goes to the localized dashboard`);
      for (const url of literals(target)) assert.equal(problem(url), null, `redirect(${target})`);
    }
  }
  assert.match(overview, /requireAppUser\(home, localizedPath\("\/sign-in", locale\)\)/);
  assert.match(section, /requireAppUser\(`\$\{home\}\/\$\{section\}`, localizedPath\("\/sign-in", locale\)\)/);
  const auth = code(readFileSync(new URL("../app/auth.ts", import.meta.url), "utf8"));
  assert.match(auth, /export async function requireAppUser\(returnTo: string, signInPath = "\/sign-in"\)/);
  assert.match(auth, /redirect\(\s*`\$\{safeReturnTo\(signInPath\)\}\?redirect_url=\$\{encodeURIComponent\(safeReturnTo\(returnTo\)\)\}`/);
  // What that sends a French reader to, and that a segment which is not a locale adds nothing.
  assert.equal(`${localizedPath("/sign-in", "fr")}?redirect_url=${encodeURIComponent(localizedPath("/dashboard", "fr"))}`, "/fr/sign-in?redirect_url=%2Ffr%2Fdashboard");
  assert.equal(localizedPath("/dashboard", "/evil.example"), "/dashboard");
  assert.equal(localizedPath("/sign-in", "xx"), "/sign-in");
});
