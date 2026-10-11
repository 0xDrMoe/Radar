import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { code, dashboardClientSource } from "./source.mjs";

// The website, opened from the iOS app outside the US storefront, offers no way to buy Pro.
//
// Apple allows an app to point to another way to buy only on the United States storefront. The app
// opens every page of radar.cheap tagged with its storefront (mobile/lib/links.ts), and the website
// hides every purchase control for the rest of that tab unless the storefront is USA - before the
// first paint, because a button that showed until React hydrated is still a button App Review can
// tap. See app/app-context.ts.

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const contextSource = await read("../app/app-context.ts");
const context = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(contextSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  ).toString("base64")}`
);

/** Runs the pre-paint script as a page load would, and says whether purchases ended up hidden. */
function visit(search, stored = new Map(), { storageBroken = false } = {}) {
  const classes = new Set();
  const storage = {
    getItem: (key) => { if (storageBroken) throw new Error("SecurityError"); return stored.has(key) ? stored.get(key) : null; },
    setItem: (key, value) => { if (storageBroken) throw new Error("QuotaExceededError"); stored.set(key, String(value)); },
  };
  vm.runInNewContext(context.APP_CONTEXT_SCRIPT, {
    URLSearchParams,
    location: { search },
    sessionStorage: storage,
    document: { documentElement: { classList: { add: (name) => classes.add(name) } } },
  });
  return { hidden: classes.has(context.NO_PURCHASE_CLASS), stored };
}

test("a tab the app opened outside the US hides every way to buy, page after page", () => {
  const tab = visit("?from=ios_app&sf=CAN");
  assert.equal(tab.hidden, true, "the tagged page itself");
  // The reader moves on through the site: no tag in the URL any more, same tab.
  assert.equal(visit("", tab.stored).hidden, true, "the next page in the same tab");
  assert.equal(visit("?q=wings", tab.stored).hidden, true, "a search in the same tab");
});

test("the United States storefront is the one exception", () => {
  const tab = visit("?from=ios_app&sf=USA");
  assert.equal(tab.hidden, false);
  assert.equal(visit("", tab.stored).hidden, false);
  // Still known to be the app, so a checkout from here can say where it came from.
  assert.equal(tab.stored.get(context.APP_CONTEXT_KEY), "ios-us");
});

test("a storefront the app could not read hides them too", () => {
  for (const search of ["?from=ios_app&sf=unknown", "?from=ios_app", "?from=ios_app&sf=usa", "?from=ios_app&sf="]) {
    assert.equal(visit(search).hidden, true, search);
  }
});

test("a tagged page decides on its own when storage is refused", () => {
  // Failing open here would show a Canadian reader a Stripe button because of a browser setting.
  assert.equal(visit("?from=ios_app&sf=CAN", new Map(), { storageBroken: true }).hidden, true);
  assert.equal(visit("", new Map(), { storageBroken: true }).hidden, false);
});

test("an ordinary visitor sees the site as it is", () => {
  assert.equal(visit("").hidden, false);
  assert.equal(visit("?from=newsletter&sf=CAN").hidden, false);
});

test("the script runs before any page is parsed, and the stylesheet does the hiding", async () => {
  const layout = await read("../app/[locale]/layout.tsx");
  const script = layout.indexOf("__html: APP_CONTEXT_SCRIPT");
  assert.ok(script > 0, "the locale layout no longer runs the script");
  assert.ok(script < layout.indexOf("{children}"), "the script runs after the page it is meant to hide things on");
  const css = await read("../app/globals.css");
  assert.match(css, /html\.app-no-purchase \.purchase-cta \{ display: none !important; \}/);
  assert.match(css, /html\.app-no-purchase \.purchase-hidden-note \{ display: block; \}/);
});

test("every control that sells Pro is marked", async () => {
  const header = code(await read("../app/SiteHeader.tsx"));
  assert.match(header, /className="nav-pro-link purchase-cta"/);
  assert.match(header, /if \(!purchaseHidden\(\)\) list\.push\(\{ id: "pro"/, "the command palette still offers Pro");

  const footer = code(await read("../app/SiteFooter.tsx"));
  assert.match(footer, /className=\{link\.key === "pro" \? "purchase-cta" : undefined\}/);

  const badge = code(await read("../app/ProBadge.tsx"));
  assert.match(badge, /className="pro-badge purchase-cta" href="\/pro"/);
  assert.match(badge, /className="pro-lock purchase-cta" href="\/pro"/);

  const dashboard = code(dashboardClientSource());
  assert.match(dashboard, /function upgrade\(\) \{ if \(purchaseHidden\(\)\) return; router\.push\("\/pro"\); \}/);
  assert.match(dashboard, /<div className="pro-upsell purchase-cta">/);
  assert.match(dashboard, /className="pro-locked-action purchase-cta" href="\/pro"/);
  assert.match(dashboard, /className="primary purchase-cta" disabled=\{busy === "upgrade"\} onClick=\{upgrade\}/);
  // Nothing else on the dashboard links to /pro unmarked.
  const links = [...dashboard.matchAll(/<(?:Link|a)\b[^>]*href="\/pro"[^>]*>/g)].map((match) => match[0]);
  for (const link of links) assert.match(link, /purchase-cta/, `unmarked: ${link}`);

  const cta = code(await read("../app/[locale]/pro/UpgradeCta.tsx"));
  assert.match(cta, /<div className="pro-cta purchase-cta">/);
  assert.match(cta, /<p className="purchase-hidden-note pro-cta-app-note">\{t\("appOnlyNote"\)\}<\/p>/);
  const upgrade = cta.slice(cta.indexOf("async function upgrade"));
  assert.match(upgrade.slice(0, 200), /if \(purchaseHidden\(\)\) return;/, "the checkout starts without asking");
});

test("every header and footer link to /pro on the site is marked", async () => {
  // The two pieces of chrome every public page wears. A second Pro link added to either later
  // would be reachable from the app on every page it shows on. Written either way a Pro link can
  // be: through next-intl or ChromeLink ("/pro") or as a plain link with the locale in it
  // (`/${locale}/pro`).
  const proLink = /<(?:Link|NextLink|ChromeLink|a)\b[^>]*href=(?:"\/pro"|\{`\/\$\{locale\}\/pro`\})[^>]*>/g;
  const header = code(await read("../app/SiteHeader.tsx"));
  const headerLinks = [...header.matchAll(proLink)].map((match) => match[0]);
  assert.ok(headerLinks.length >= 1, "the header's Pro link was not found, so nothing here was checked");
  for (const link of headerLinks) assert.match(link, /purchase-cta/, `app/SiteHeader.tsx: ${link}`);
  // The footer renders its links from data, so the one that leads to /pro is the one its <li>
  // marks (checked above); no other element there may link to it.
  const footer = code(await read("../app/SiteFooter.tsx"));
  for (const link of [...footer.matchAll(proLink)].map((match) => match[0])) assert.match(link, /purchase-cta/, `app/SiteFooter.tsx: ${link}`);
  assert.equal([...footer.matchAll(/href: "\/pro"/g)].length, 1, "the footer has one Pro link, in the data its marked <li> renders");
});

test("checkout takes one known source and nothing else", async () => {
  const route = code(await read("../app/api/stripe/checkout/route.ts"));
  assert.match(route, /const source = body\.source === "ios_app" \? "ios_app" : null;/);
  assert.match(route, /withTrial,source,locale\);/);
  const stripe = code(await read("../app/stripe.ts"));
  assert.match(stripe, /"metadata\[source\]": source, "subscription_data\[metadata\]\[source\]": source/);
  // Only a tab the app opened on the US storefront says it came from the app.
  const cta = code(await read("../app/[locale]/pro/UpgradeCta.tsx"));
  assert.match(cta, /const source = appContext\(\) === "ios-us" \? "ios_app" : undefined;/);
});

test("every locale can say where Pro is instead", async () => {
  for (const locale of ["en", "fr", "es"]) {
    const catalog = JSON.parse(await read(`../messages/${locale}.json`));
    assert.ok(catalog.pro.appOnlyNote?.includes("Radar"), `${locale} has no appOnlyNote`);
  }
});
