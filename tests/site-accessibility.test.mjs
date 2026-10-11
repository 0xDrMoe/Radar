import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { code, dashboardClientSource } from "./source.mjs";

// The home page and the chrome every public page shares: landmarks, the skip link, focus rings,
// contrast, motion, keyboard patterns, the words the reader sees, and what the page downloads.
// Most of this is invisible from the outside - a missing banner landmark, a ring that never draws,
// an error in the wrong language - and each of these was found by an audit rather than by anyone
// using the site, so the tests pin each fix to the source it lives in.

const root = fileURLToPath(new URL("..", import.meta.url));
const raw = (path) => readFileSync(join(root, path), "utf8");
const read = (path) => code(raw(path));
const messages = (locale) => JSON.parse(raw(`messages/${locale}.json`));
const LOCALES = ["en", "fr", "es"];
const at = (object, path) => path.split(".").reduce((node, key) => node?.[key], object);

// ---------------------------------------------------------------------------------------------
// The restaurant's mark and photo come from the restaurant's own website, never the deal's source.

// For some deals the source is a third-party deal listing site, so a source-as-website fallback put
// the listing site's favicon on the card as the restaurant's logo, and sent the live photo search
// to the listing site's page.
test("BrandLogo takes its favicon from the website alone", () => {
  const source = read("app/BrandLogo.tsx");
  assert.match(source, /function faviconUrl\(website\?: string \| null\)/);
  assert.match(source, /faviconUrl\(website\)/);
  assert.doesNotMatch(source, /faviconUrl\([^)]*source/, "the deal's source is not the restaurant's website");
  assert.match(source, /\{ name, website, logoUrl, className \}/, "`source` is accepted in the type but never read");
});

test("CardMedia only searches the restaurant's own website for a photo", () => {
  const source = read("app/CardMedia.tsx");
  assert.match(source, /else if \(!stored\.length && website\) candidates\.push\(\{ src: `\/api\/restaurant-photo\?url=\$\{encodeURIComponent\(website\)\}`/);
  assert.doesNotMatch(source, /encodeURIComponent\([^)]*source/);
  assert.doesNotMatch(source, /website \|\| source|source \|\| website/);
});

test("the home page and the nationwide list stop handing a source to the logo or the photo", () => {
  for (const path of ["app/HomeClient.tsx", "app/NationalDeals.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /<(BrandLogo|CardMedia)\b[^>]*\bsource=/, `${path} passes a source`);
  }
});

// With no stored photo, CardMedia draws the restaurant's logo whole, and searches its website live
// only when there is no logo either. That search finds whatever the site leads with, which is how
// a back bar, a martini and a stock photo came to be stored in the first place; drizzle/0060
// cleared five such photos and gave those restaurants their logo instead. The home page's deal
// detail panel never passed the logo, so it searched the site where the card beside it did not.
test("every public picture of a restaurant offers its logo before the live search", () => {
  for (const path of ["app/HomeClient.tsx", "app/[locale]/deals/[slug]/page.tsx"]) {
    const tags = read(path).match(/<(CardMedia|BrandLogo)\b[^>]*>/g) || [];
    assert.ok(tags.length >= 2, `${path} draws a restaurant`);
    for (const tag of tags) assert.match(tag, /\blogoUrl=\{/, `${path}: ${tag.slice(0, 90)} leaves out the logo`);
  }
});

// ---------------------------------------------------------------------------------------------
// srcset waits on the photo route.

const srcsetModule = async (enabled) => {
  const source = raw("app/photo-srcset.ts").replace(
    /export const PHOTO_ROUTE_SERVES_WIDTHS = (true|false);/,
    `export const PHOTO_ROUTE_SERVES_WIDTHS = ${enabled};`,
  );
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString("base64")}`);
};

// /api/photo serves the stored object whole. A srcset naming widths the route ignores would make
// the browser treat one file as several, so until the route learns ?w= the markup is unchanged.
test("card photos carry no srcset until the photo route can resize", async () => {
  assert.match(raw("app/photo-srcset.ts"), /export const PHOTO_ROUTE_SERVES_WIDTHS = false;/);
  assert.doesNotMatch(read("app/api/photo/[...key]/route.ts"), /searchParams\.get\("w"\)/, "the route learned ?w= - switch PHOTO_ROUTE_SERVES_WIDTHS on");
  const { responsivePhotoProps } = await srcsetModule(false);
  assert.deepEqual(responsivePhotoProps("/api/photo/restaurants/1/a.jpg"), {});
});

test("switched on, stored photos get widths and the live proxy does not", async () => {
  const { responsivePhotoProps, CARD_PHOTO_SIZES } = await srcsetModule(true);
  assert.deepEqual(responsivePhotoProps("/api/photo/restaurants/1/a.jpg"), {
    srcSet: "/api/photo/restaurants/1/a.jpg?w=400 400w, /api/photo/restaurants/1/a.jpg?w=800 800w",
    sizes: CARD_PHOTO_SIZES,
  });
  assert.equal(responsivePhotoProps("/api/photo/a.jpg?v=2", "50vw").srcSet, "/api/photo/a.jpg?v=2&w=400 400w, /api/photo/a.jpg?v=2&w=800 800w");
  assert.deepEqual(responsivePhotoProps("/api/restaurant-photo?url=https%3A%2F%2Fexample.com"), {});
  assert.deepEqual(responsivePhotoProps("https://example.com/a.jpg"), {});
  const media = read("app/CardMedia.tsx");
  assert.match(media, /current\.logo \? \{\} : responsivePhotoProps\(photoSrc\(current\.src\), sizes\)/, "logos are never given widths, and widths follow the generation-stamped address");
});

// ---------------------------------------------------------------------------------------------
// Turnstile on the home page loads when somebody reaches for a form, not with the page.

test("the home page's two lead forms arm Turnstile on first focus or press", () => {
  const home = read("app/HomeClient.tsx");
  assert.equal((home.match(/useLazyTurnstile\(turnstileSiteKey\)/g) || []).length, 2);
  for (const name of ["appLeadTurnstile", "leadTurnstile"]) {
    assert.match(home, new RegExp(`<form className="lead-capture"[^>]*onFocus=\\{${name}\\.arm\\} onPointerDown=\\{${name}\\.arm\\}>`), `${name} arms on focus and press`);
    assert.match(home, new RegExp(`\\{${name}\\.widget\\}`));
    assert.match(home, new RegExp(`const token = await ${name}\\.takeToken\\(\\);`), `${name} waits for its token on submit`);
  }
  assert.match(home, /\.\.\.\(token \? \{ "cf-turnstile-response": token \} : \{\}\)/, "the token rides in the JSON body as before");
  // The modals mount on request, so they keep the eager widget; the lead forms must not.
  const eager = home.match(/<Turnstile siteKey=\{turnstileSiteKey\} \/>/g) || [];
  assert.equal(eager.length, 2, "only the suggest and feedback modals render an eager widget");
  const leadForms = home.match(/<form className="lead-capture"[\s\S]*?<\/form>/g) || [];
  assert.equal(leadForms.length, 2);
  for (const form of leadForms) assert.doesNotMatch(form, /<Turnstile\b/);
});

test("Turnstile renders nothing until armed and shares one script load", () => {
  const source = read("app/Turnstile.tsx");
  assert.match(source, /const widget = siteKey && armed\s*\?/, "no widget, and so no script, before arm()");
  assert.equal((source.match(/document\.createElement\("script"\)/g) || []).length, 1);
  assert.match(source, /scriptLoad \?\?= new Promise/, "every widget waits on the same load");
  assert.match(source, /appearance: "interaction-only"/);
  assert.match(source, /"expired-callback": \(\) => onToken\?\.\(null\)/, "an expired token is not handed out");
});

// siteverify accepts a token once, and the routes verify it before validating fields, so a submit
// turned back for a missing field has spent it. The resubmit needs a fresh one.
test("a spent token is replaced before the next submit", () => {
  const source = read("app/Turnstile.tsx");
  assert.match(source, /token\.current = null;\s*if \(value && widgetId\.current && window\.turnstile\) window\.turnstile\.reset\(widgetId\.current\);/);
  assert.match(source, /form\.addEventListener\("submit", renew\)/, "the eager widget resets after its form submits");
});

test("the server still verifies every lead the same way", () => {
  assert.match(read("app/api/email/capture/route.ts"), /verifyTurnstile\(request, body\["cf-turnstile-response"\]\)/);
  assert.match(raw("app/api-utils.ts"), /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify/);
});

// ---------------------------------------------------------------------------------------------
// Landmarks and the skip link.

const walk = (dir) => readdirSync(join(root, dir)).flatMap((name) => {
  const path = join(dir, name);
  return statSync(join(root, path)).isDirectory() ? walk(path) : [path];
});

// A <header> or <footer> inside <main> is not a banner or contentinfo, so no page had either, and
// a skip link to <main> would have landed on the navigation it exists to skip.
test("public pages render the site header and footer through PublicPage, outside <main>", () => {
  const frame = read("app/PublicPage.tsx");
  assert.match(frame, /<SiteHeader \/>\s*<main id=\{MAIN_CONTENT_ID\} tabIndex=\{-1\}>\s*\{children\}\s*<\/main>\s*<SiteFooter \/>/);
  const renderers = walk("app").filter((path) => /\.tsx$/.test(path) && /<Site(Header|Footer)\b/.test(read(path)));
  assert.ok(renderers.includes(join("app", "PublicPage.tsx")) && renderers.includes(join("app", "HomeClient.tsx")), "the scan sees the renderers it exempts");
  const direct = renderers.filter((path) => !["PublicPage.tsx", "HomeClient.tsx"].includes(relative("app", path)));
  assert.deepEqual(direct, [], "render <PublicPage> instead of the header and footer inside a <main>");
  for (const page of ["terms", "privacy", "support", "launch", "age-suitability", "pro", "for-restaurants", "for-creators"]) {
    const source = read(`app/[locale]/${page}/page.tsx`);
    assert.match(source, /<PublicPage className="[a-z-]+">/, `${page} uses PublicPage`);
    assert.doesNotMatch(source, /<main\b/, `${page} has no <main> of its own`);
  }
  assert.match(read("app/[locale]/NotFoundPage.tsx"), /<PublicPage className="not-found-page">/);
});

test("the home page's header and footer sit either side of its one <main>", () => {
  const home = read("app/HomeClient.tsx");
  assert.equal((home.match(/<main\b/g) || []).length, 1);
  const header = home.indexOf("<SiteHeader");
  const open = home.indexOf("<main id={MAIN_CONTENT_ID} tabIndex={-1}>");
  const close = home.indexOf("</main>");
  const footer = home.indexOf("<SiteFooter");
  assert.ok(header > -1 && header < open && open < close && close < footer, "header, main, footer, in that order");
});

// The dashboard keeps its own sidebar chrome rather than SiteHeader, and had no skip link at all:
// a keyboard reader tabbed through the brand, seven sections and up to three workspace links on
// every visit. Its page was one <main> holding the rail and a <section>, so "main" was the rail too.
test("the dashboard opens with the skip link, and its content column is the page's one <main>", () => {
  const dashboard = read("app/[locale]/dashboard/DashboardClient.tsx");
  const start = dashboard.indexOf('return <div className="portal">');
  assert.ok(start > -1, "the loaded dashboard is framed by div.portal");
  const page = dashboard.slice(start);
  assert.match(page, /^return <div className="portal">\s*<a className="skip-link" href=\{`#\$\{MAIN_CONTENT_ID\}`\}>\{tNav\("skipToContent"\)\}<\/a>\s*<aside\b/, "the skip link comes first, before the rail");
  const railEnd = page.indexOf("</aside>");
  const open = page.indexOf('<main id={MAIN_CONTENT_ID} tabIndex={-1} className="portal-main" data-section={initialSection}>');
  const close = page.indexOf("</main>");
  assert.ok(railEnd > -1 && railEnd < open && open < close, "the rail sits outside and before the content");
  assert.equal((page.match(/<main\b/g) || []).length, 1, "one <main>");
  assert.doesNotMatch(dashboard, /<main className="portal"|<section className="portal-main"/);
  // Before the data arrives, the loading and error cards are the content.
  assert.equal((dashboard.match(/<main id=\{MAIN_CONTENT_ID\} tabIndex=\{-1\} className="portal-loading/g) || []).length, 2);
  // Nothing wraps it in a second <main> or a second header.
  for (const path of ["app/[locale]/dashboard/page.tsx", "app/[locale]/dashboard/[section]/page.tsx"]) assert.doesNotMatch(read(path), /<main\b|<SiteHeader/, path);
  // The phone rail still scrolls its active section into view, and the link keeps its own colours
  // outside the site nav: .skip-link is not scoped to .nav.
  assert.match(dashboard, /document\.querySelector<HTMLElement>\("\.portal aside nav"\)/);
  assert.match(raw("app/polish.css"), /\.skip-link\{position:fixed;[^}]*color: var\(--on-coral\);/);
});

test("every page's header is a banner that opens with a skip link", () => {
  const header = read("app/SiteHeader.tsx");
  assert.match(header, /<header className="site-header">\s*<nav className="nav site-nav" aria-label=\{t\("mainLabel"\)\}>\s*<a className="skip-link" href=\{`#\$\{skipToId \|\| MAIN_CONTENT_ID\}`\}>/);
  assert.match(header, /skipToId \? t\("skipToDeals"\) : t\("skipToContent"\)/);
  assert.equal(read("app/main-content.ts").match(/MAIN_CONTENT_ID = "([^"]+)"/)[1], "main-content");
  assert.match(read("app/site-chrome.css"), /main\[tabindex="-1"\]:focus \{ outline: none; \}/, "the landing point draws no ring around the page");
});

// The header's overlaps. French at 1280px put the theme toggle 70px over the search trigger; every
// language with a signed-in session ran the account cluster under the search trigger from 901px to
// 1100px; and the home page did it in English at every width for anyone signed in. `.nav-links`
// may shrink while nothing in it can, and the nav stops growing at 1180px while its gaps grow with
// the window. The fix was measured against the real stylesheets, 901px to 1600px in all three
// languages and every session; these pin the rules it is made of.

// Every rule under a width media query that styles the header: { file, media, selector }.
const HEADER_SELECTOR = /\.(nav|site-nav|nav-links|nav-primary|nav-actions|nav-burger|nav-dropdown[\w-]*|vertical-switch|command-trigger[\w-]*|accountbtn[\w-]*)(?![\w-])/;
function headerMediaRules() {
  const out = [];
  const scan = (css, file, media) => {
    let i = 0;
    while (i < css.length) {
      const open = css.indexOf("{", i);
      if (open < 0) break;
      const prelude = css.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
      let depth = 1, j = open + 1;
      for (; depth && j < css.length; j++) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
      }
      if (prelude.startsWith("@")) scan(css.slice(open + 1, j - 1), file, prelude.startsWith("@media") ? prelude : media);
      else if (/width/.test(media) && HEADER_SELECTOR.test(prelude)) out.push({ file, media, selector: prelude });
      i = j;
    }
  };
  for (const name of readdirSync(join(root, "app")).filter((file) => file.endsWith(".css"))) scan(raw(`app/${name}`), name, "");
  return out;
}

test("the header turns into the drawer at 1100px, in every rule that shapes the drawer", () => {
  const rules = headerMediaRules();
  const drawer = (file, selector) => rules.some((rule) => rule.file === file && rule.selector === selector && /^@media ?\(max-width: ?1100px\)$/.test(rule.media));
  assert.ok(drawer("polish.css", ".nav-burger"), "the burger shows");
  assert.ok(drawer("polish.css", ".nav-links"), "the links become the panel");
  assert.ok(drawer("polish.css", ".nav-dropdown"), "the dropdowns become rows");
  assert.ok(drawer("polish.css", ".vertical-switch"), "the switch makes room for the burger");
  assert.ok(drawer("refinements.css", ".nav button.nav-dropdown-trigger"), "the dropdown triggers keep the rows' padding");
  assert.ok(drawer("site-chrome.css", ".nav-primary, .nav-actions"), "the link groups hand their children to the column");
  assert.ok(drawer("site-chrome.css", ".nav-burger"), "the burger sits at the end of the bar");
  // Nothing that styles the bar is keyed to another width between the phone rules and the drawer's,
  // so no rule assumes the bar is one row where it is the drawer, or the other way round. Above it,
  // the one-row rules start at 1101px, and the home page's band ends at 1150px.
  for (const { file, media, selector } of rules) {
    for (const [, kind, px] of media.matchAll(/\((max|min)-width: ?(\d+)px\)/g)) {
      const width = Number(px);
      const allowed = kind === "max" ? width <= 700 || width === 1100 || width === 1150 : width === 1101 || width === 1151;
      assert.ok(allowed, `${file}: "${selector}" is keyed to ${kind}-width ${width}px`);
    }
  }
});

test("above the drawer the bar holds one row, and the home page's switch takes a second when it must", () => {
  const css = raw("app/site-chrome.css");
  const block = css.slice(css.indexOf("---- The one-row bar, above the drawer"), css.indexOf("---- Skip link target"));
  assert.ok(block.length > 0, "the block could not be found");
  // A long first name ends in an ellipsis, in its own box, instead of pushing the row.
  assert.match(block, /@media \(min-width: 1101px\) \{\s*\.site-nav \.accountbtn-label \{\s*max-width: 135px;\s*min-width: 0;\s*overflow: hidden;\s*text-overflow: ellipsis;\s*white-space: nowrap;\s*\}/);
  assert.match(read("app/SiteHeader.tsx"), /<ChromeLink className="accountbtn" href="\/dashboard">\s*<UserRound \/>\s*(?:\{\}\s*)?<span className="accountbtn-label">\{session\.name\?\.split\(" "\)\[0\] \|\| t\("dashboard"\)\}<\/span>\s*<\/ChromeLink>/);
  // French and Spanish keep the spacing the bar has at its narrowest.
  assert.match(block, /\.site-nav:is\(:lang\(fr\), :lang\(es\)\) \.nav-primary \{ gap: 12px; \}\s*\.site-nav:is\(:lang\(fr\), :lang\(es\)\) \.nav-actions \{ gap: 8px; \}/);
  // Just above the drawer a staff bar in French or Spanish drops the search trigger's "Ctrl K".
  // The trigger keeps its accessible name, which is the placeholder, not the shortcut.
  assert.match(block, /@media \(min-width: 1101px\) and \(max-width: 1150px\) \{\s*\.site-nav:is\(:lang\(fr\), :lang\(es\)\):has\(\.adminbtn\) > \.command-trigger \.command-trigger-key \{ display: none; \}\s*\}/);
  assert.match(read("app/CommandPalette.tsx"), /className="command-trigger" onClick=\{openPalette\} aria-label=\{placeholder\}/);
  // The second row: for everyone just above the drawer, and from there on in French and Spanish
  // and for anyone signed in. The ::after is a forced line break, so the switch never lands at the
  // far right after the search trigger.
  const secondRow = (selector) => new RegExp(`${selector} \\{\\s*flex-wrap: wrap;\\s*height: auto;\\s*row-gap: 0;\\s*padding-top: 20px;\\s*padding-bottom: 16px;\\s*\\}`);
  const band = block.slice(block.lastIndexOf("@media (min-width: 1101px) and (max-width: 1150px)"), block.indexOf("@media (min-width: 1151px)"));
  assert.match(band, secondRow("\\.site-nav:has\\(> \\.vertical-switch\\)"));
  assert.match(band, /\.site-nav:has\(> \.vertical-switch\)::after \{\s*content: "";\s*flex-basis: 100%;\s*height: 6px;\s*order: 1;\s*\}/);
  assert.match(band, /\.site-nav > \.vertical-switch \{ order: 2; \}/);
  const wide = block.slice(block.indexOf("@media (min-width: 1151px)"));
  assert.match(wide, secondRow("\\.site-nav:has\\(> \\.vertical-switch\\):is\\(:lang\\(fr\\), :lang\\(es\\), :has\\(\\.accountbtn-label\\)\\),\\s*html\\[data-signed-in\\] \\.site-nav:has\\(> \\.vertical-switch\\)"));
  // English signed out keeps its one row there: every rule past 1150px names the two languages or
  // a session.
  const selectors = [...wide.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{[^{}]*\}/g)].map((m) => m[1].trim()).filter((s) => !s.startsWith("@"));
  assert.equal(selectors.length, 3);
  // One selector per line: the commas inside :is() are not list separators.
  for (const selector of selectors.flatMap((list) => list.split(/,\r?\n/).map((s) => s.trim()))) {
    assert.ok(selector.includes(":is(:lang(fr), :lang(es), :has(.accountbtn-label))") || selector.startsWith("html[data-signed-in] "), selector);
  }
  // What the rules depend on: the switch is the bar's own child, the page says its language, and
  // the server says whether the request carried a session, from the cookie the page cache keys on.
  assert.match(read("app/SiteHeader.tsx"), /<nav className="nav site-nav"[\s\S]*?<\/button>\s*\{centerSlot\}/);
  assert.match(read("app/HomeClient.tsx"), /centerSlot=\{[\s\S]{0,200}<div className="vertical-switch"/);
  const shell = read("app/RootShell.tsx");
  assert.match(shell, /<html lang=\{lang\} data-signed-in=\{hasSession \? "" : undefined\}/);
  assert.match(shell, /const hasSession = Boolean\(\(await cookies\(\)\)\.get\("__session"\)\?\.value\);/);
});

// ---------------------------------------------------------------------------------------------
// Focus rings on the fields that draw their own box.

test("the search fields show focus on the field they draw", () => {
  const css = raw("app/site-chrome.css");
  assert.match(css, /\.search-box:has\(input:focus\),\s*\.filter-search:has\(input:focus\),\s*\.portal-search:has\(input:focus\) \{\s*outline: 2px solid var\(--coral-strong\);/);
  assert.match(css, /\.results \.filter-search:has\(input:focus\) \{ outline-color: #f6f1e6; \}/, "coral on the coral results band would not show");
  assert.match(css, /\.command-search:has\(input:focus\) \{\s*border-bottom-color: var\(--coral-strong\);/);
});

// ---------------------------------------------------------------------------------------------
// Contrast of the status colours, in both themes.

const luminance = (hex) => {
  const channels = hex.replace("#", "").match(/../g).map((pair) => parseInt(pair, 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
};
// The theme's palette block: the first `selector{...}` that defines the status tokens (globals.css
// opens more than one :root block).
const tokens = (selector) => {
  const css = raw("app/globals.css");
  for (let start = css.indexOf(`${selector}{`); start > -1; start = css.indexOf(`${selector}{`, start + 1)) {
    const block = css.slice(start, css.indexOf("}", start));
    if (!block.includes("--field-ok:")) continue;
    return Object.fromEntries([...block.matchAll(/--([a-z-]+):(#[0-9a-f]{6})\b/gi)].map(([, name, value]) => [name, value.toLowerCase()]));
  }
  assert.fail(`no ${selector} block defines --field-ok`);
};

// Success and error messages are text, at 12-14px, so 4.5:1 is the bar. #2f9e5c on cream was 3.07.
test("status text reads at 4.5:1 on the light theme's grounds", () => {
  const light = tokens(":root");
  assert.equal(light["field-ok"], "#1b6e3f");
  assert.equal(light["field-bad"], "#9e3434");
  for (const ground of [light.cream, "#ffffff"]) {
    for (const name of ["field-ok", "field-bad", "muted"]) {
      assert.ok(contrast(light[name], ground) >= 4.5, `${name} ${light[name]} on ${ground}: ${contrast(light[name], ground).toFixed(2)}`);
    }
  }
});

test("status text still reads on the dark theme", () => {
  const dark = tokens('html[data-theme="dark"]');
  for (const ground of [dark.cream, dark.field]) {
    for (const name of ["field-ok", "field-bad", "muted"]) {
      assert.ok(contrast(dark[name], ground) >= 4.5, `${name} ${dark[name]} on ${ground}: ${contrast(dark[name], ground).toFixed(2)}`);
    }
  }
});

test("placeholders and field errors use the tokens rather than their own lighter colours", () => {
  assert.match(raw("app/dashboard.css"), /\.search-box input::placeholder\{color:var\(--muted\)\}/);
  assert.match(raw("app/enhancements.css"), /\.field-error\{color:var\(--field-bad\);/);
  assert.doesNotMatch(raw("app/dashboard.css"), /::placeholder\{color:#7a857e\}/);
});

// ---------------------------------------------------------------------------------------------
// The moving hero: a stable heading, and a way to stop it.

test("the hero heading has one accessible name, whatever the typewriter is showing", () => {
  const home = read("app/HomeClient.tsx");
  assert.match(home, /<h1>\s*<span className="sr-only">\{`\$\{heroWords\[0\] \|\| ""\} \$\{t\("hero\.headingSuffix"\)\}`\}<\/span>\s*<span aria-hidden="true">/);
});

// WCAG 2.2.2: anything that moves for more than five seconds alongside other content can be paused.
test("the hero's motion can be paused, remembered, and is off under reduced motion", () => {
  const home = read("app/HomeClient.tsx");
  assert.equal((home.match(/paused: motionPaused/g) || []).length, 3, "the heading and both placeholders pause");
  assert.match(home, /className="motion-toggle"\s*aria-label=\{motionPaused \? t\("hero\.resumeMotion"\) : t\("hero\.pauseMotion"\)\}/);
  assert.match(home, /localStorage\.getItem\(MOTION_KEY\) === "paused"/);
  const typewriter = read("app/Typewriter.tsx");
  assert.match(typewriter, /if \(!phrases\.length \|\| reducedMotion \|\| paused\) return;/);
  assert.match(typewriter, /if \(!queries\.length \|\| reducedMotion \|\| paused\) return;/);
  const css = raw("app/site-chrome.css");
  assert.match(css, /\.hero\.motion-paused::after \{ animation-play-state: paused; \}/, "the sweep stops too");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.motion-toggle \{ display: none; \}/);
});

// ---------------------------------------------------------------------------------------------
// Keyboard patterns: the language menu, the vertical tabs and the Pro table.

test("the language menu is a menu of radio items the arrow keys move through", () => {
  const header = read("app/SiteHeader.tsx");
  assert.match(header, /aria-haspopup="menu"/);
  assert.match(header, /role="menu" id="language-menu"/);
  assert.match(header, /hrefLang=\{code\}\s*role="menuitemradio"\s*aria-checked=\{code === locale\}/);
  assert.match(header, /lang=\{code\}/, "each language names itself in its own language");
  for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "Escape"]) assert.match(header, new RegExp(`"${key}"`), `${key} is handled`);
  assert.doesNotMatch(header, /aria-controls="contribute-links"[^>]*aria-haspopup|aria-haspopup[^>]*aria-controls="contribute-links"/, "Contribute is a disclosure, not a menu");
});

test("the vertical switch is a tab list with a panel and arrow keys", () => {
  const home = read("app/HomeClient.tsx");
  assert.match(home, /role="tablist" aria-label=\{t\("verticalSwitch\.label"\)\}.{0,80}onKeyDown=\{onVerticalKey\}>/);
  assert.match(home, /id=\{`vertical-tab-\$\{v\.key\}`\}[\s\S]{0,120}role="tab"\s*aria-selected=\{vertical === v\.key\}\s*aria-controls="vertical-panel"\s*tabIndex=\{vertical === v\.key \? 0 : -1\}/);
  assert.match(home, /<div role="tabpanel" id="vertical-panel" aria-labelledby=\{`vertical-tab-\$\{vertical\}`\}/);
  const handler = home.slice(home.indexOf("function onVerticalKey"), home.indexOf("function onVerticalKey") + 900);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(handler, new RegExp(`"${key}"`));
});

test("the Pro comparison is announced as a table with row and column headers", () => {
  const pro = read("app/[locale]/pro/page.tsx");
  assert.match(pro, /className="pro-table" role="table" aria-label=\{t\("tableCaption"\)\}/);
  assert.match(pro, /role="columnheader" className="pro-table-head-feature"><span className="sr-only">\{t\("columnFeature"\)\}<\/span>/);
  assert.equal((pro.match(/role="row"/g) || []).length, 2, "the head row and the mapped feature rows");
  assert.match(pro, /className="pro-table-feature" role="rowheader"/);
  assert.equal((pro.match(/role="cell"/g) || []).length, 2);
  // display:none would take the feature column's header out of the table for a screen reader.
  assert.doesNotMatch(raw("app/pro.css"), /\.pro-table-head>span:first-child\{display:none\}/);
});

// ---------------------------------------------------------------------------------------------
// The words on the page are in the reader's language.

test("the home page's chips, area labels and badges come from the catalogue", () => {
  const home = read("app/HomeClient.tsx");
  for (const literal of ["postal search", "● On now", "Your suggestion could not be sent.", 'const INTENT_TRY_PREFIX = "Try "']) {
    assert.ok(!home.includes(literal), `"${literal}" is hardcoded`);
  }
  assert.match(home, /t\("results\.areaPostalSearch", \{ city/);
  assert.match(home, /t\(`filters\.popularTerms\.\$\{term\}`\)/);
  const terms = JSON.parse(home.match(/const popularSearches = (\[[^\]]+\]);/)[1]);
  const cities = [...home.match(/const quickCities = \[([\s\S]*?)\] as const;/)[1].matchAll(/\["[^"]+", "([a-zA-Z]+)"(?:, "[A-Z]{2}")?\]/g)].map((m) => m[1]);
  assert.equal(cities.length, 4);
  for (const locale of LOCALES) {
    const home = messages(locale).home;
    for (const term of terms) assert.equal(typeof home.filters.popularTerms[term], "string", `${locale} popularTerms.${term}`);
    for (const city of cities) assert.equal(typeof home.cityChips[city], "string", `${locale} cityChips.${city}`);
    for (const key of ["hero.searchTry", "hero.pauseMotion", "hero.resumeMotion", "results.areaPostalSearch", "results.areaNearCity", "results.areaNearYou", "appTeaser.onNow", "suggestModal.sendFailed"]) {
      assert.equal(typeof at(home, key), "string", `${locale} home.${key}`);
    }
  }
  assert.equal(messages("fr").home.cityChips.montreal, "Montréal");
  assert.notEqual(messages("fr").home.filters.popularTerms.oysters, messages("en").home.filters.popularTerms.oysters);
  assert.notEqual(messages("es").home.filters.popularTerms.wings, messages("en").home.filters.popularTerms.wings);
});

const errorCodes = (path) => [...new Set([...read(path).matchAll(/"([A-Z][A-Z_]{3,})"/g)].map((m) => m[1]))];
// The codes a route hands to apiError(). Stricter than errorCodes() for the routes that also
// compare against capitals that are not codes: /api/user checks for a typed "DELETE" and stores
// "UNKNOWN" as a delivery's error.
const apiErrorCodes = (path) => [...read(path).matchAll(/apiError\(\s*\d+\s*,\s*"([A-Z][A-Z_]+)"/g)].map((m) => m[1]);
// The dashboard's endpoints: its account actions, the billing portal and the cancellation flow.
const DASHBOARD_ROUTES = ["app/api/user/route.ts", "app/api/user/contributions/route.ts", "app/api/stripe/portal/route.ts", "app/api/stripe/retention/route.ts"];

// The routes answer in English. The forms show a sentence chosen from the error's code and the
// refused field's name, so every code a public form can receive needs a translation.
test("every error a public form can receive has a message in each language", () => {
  const codes = new Set([
    ...errorCodes("app/api/suggestions/route.ts"),
    ...errorCodes("app/api/email/capture/route.ts"),
    ...errorCodes("app/api/feedback/route.ts"),
    ...errorCodes("app/api/creator-applications/route.ts"),
    ...errorCodes("app/api/stripe/checkout/route.ts"),
    ...errorCodes("app/api/email/unsubscribe/route.ts"),
    ...errorCodes("app/api/email/confirm/route.ts"),
    // The deal page's report form (DetailActions).
    ...errorCodes("app/api/reports/route.ts"),
    // The dashboard (DashboardClient). delete_account passes on account-deletion.ts's own codes.
    ...DASHBOARD_ROUTES.flatMap(apiErrorCodes),
    ...[...read("app/account-deletion.ts").matchAll(/code: "([A-Z][A-Z_]+)"/g)].map((m) => m[1]),
  ]);
  // The deal list's refusals, which the home page and the dashboard show.
  const deals = read("app/api/deals/route.ts");
  for (const [, code] of deals.matchAll(/error: \{ code: "([A-Z_]+)"/g)) codes.add(code);
  codes.delete("POST");
  assert.ok(codes.has("CHALLENGE_FAILED") && codes.has("DUPLICATE_SUGGESTION") && codes.has("UNSUPPORTED_LOCATION") && codes.has("STRIPE_ERROR"));
  assert.ok(codes.has("DUPLICATE_AREA") && codes.has("OFFER_NOT_OPEN") && codes.has("NO_SUBSCRIPTION") && codes.has("IDENTITY_DELETE_FAILED"), "the dashboard's codes are read");
  // A code built at run time would get past the scan above, so there is exactly one, and it is the
  // deletion failure whose codes are read from account-deletion.ts.
  for (const path of DASHBOARD_ROUTES) {
    const dynamic = [...read(path).matchAll(/apiError\(\s*\d+\s*,\s*([^"\s][^,]*),/g)].map((m) => m[1]);
    assert.deepEqual(dynamic, path === "app/api/user/route.ts" ? ["failure.code"] : [], `${path} refuses with a code this test cannot read`);
  }
  // One code, one meaning: a tracked area the dashboard could not update is not a malformed postal
  // code, which is what INVALID_LOCATION tells the reader.
  assert.ok(!apiErrorCodes("app/api/user/route.ts").includes("INVALID_LOCATION"));
  const mapper = read("app/api-error-text.ts");
  const fieldKeys = new Set([...mapper.match(/const FIELD_MESSAGES[^=]*= \{([\s\S]*?)\};/)[1].matchAll(/: "([a-zA-Z]+)"/g)].map((m) => m[1]));
  for (const locale of LOCALES) {
    const errors = messages(locale).apiErrors;
    for (const code of codes) assert.equal(typeof errors.codes[code], "string", `${locale} apiErrors.codes.${code}`);
    for (const key of [...fieldKeys, "invalid"]) assert.equal(typeof errors.fields[key], "string", `${locale} apiErrors.fields.${key}`);
    assert.match(errors.duplicateSuggestionWithReference, /\{reference\}/);
  }
  assert.equal(messages("fr").apiErrors.fields.required === messages("en").apiErrors.fields.required, false);
});

test("the forms show the translated message, not the server's text", () => {
  for (const path of [
    "app/HomeClient.tsx",
    "app/[locale]/for-restaurants/RestaurantInquiry.tsx",
    "app/[locale]/for-creators/CreatorApplication.tsx",
    "app/[locale]/pro/UpgradeCta.tsx",
    "app/[locale]/unsubscribe/UnsubscribeForm.tsx",
    "app/[locale]/confirm-email/ConfirmEmail.tsx",
    "app/[locale]/dashboard/DashboardClient.tsx",
    "app/[locale]/dashboard/sections/BillingSection.tsx",
    "app/[locale]/dashboard/sections/PrivacySection.tsx",
    "app/[locale]/dashboard/sections/ContributionsSection.tsx",
  ]) {
    const source = read(path);
    assert.match(source, /useApiErrorText\(\)/, `${path} maps errors`);
    assert.doesNotMatch(source, /error\??\.message \|\|/, `${path} shows the server's English`);
    assert.doesNotMatch(source, /fields: result\?\.error\?\.fields/, `${path} shows the server's field text`);
  }
  // The dashboard read the server's English three ways: an error's message, a success's message
  // ("Check your email to confirm."), and whatever fetch threw ("Failed to fetch").
  const dashboard = code(dashboardClientSource());
  assert.doesNotMatch(dashboard, /function errorMessage|result\.message|cause instanceof Error \?/);
  assert.equal((dashboard.match(/apiErrorText\.message\(/g) || []).length, 6, "load, mutate, retention, the billing portal, account deletion and contributions");
  assert.match(dashboard, /setError\(cause instanceof ShownError \? cause\.message : t\("couldNotLoad"\)\)/);
  assert.match(dashboard, /setNotice\(cause instanceof ShownError \? cause\.message : t\("changeCouldNotBeSaved"\)\)/);
});

// The dashboard showed its consent row's raw status ("waitlisted"), an English postal example, and
// accent names from theme-accents.ts in English, in every language.
test("the dashboard's states, examples and labels come from the catalogue", () => {
  const dashboard = code(dashboardClientSource());
  for (const literal of ['placeholder="M5V', 'aria-label="Close"', "(Radar Pro)", "— Radar Pro", ">PRO<", "def.label", "data.consent?.status ||", "{area.radius} km"]) {
    assert.ok(!dashboard.includes(literal), `"${literal}" is hardcoded`);
  }
  assert.match(dashboard, /\{t\(`alerts\.consentStatus\.\$\{consentState\(data\.consent\?\.status\)\}`\)\}/);
  assert.match(dashboard, /name = t\(`account\.accentNames\.\$\{key\}`\), label = locked \? t\("account\.accentLocked",\{name\}\) : name;/);
  const states = JSON.parse(dashboard.match(/const CONSENT_STATES = (\[[^\]]+\]);/)[1]);
  // Every status the table is written with, and the "none" /api/user answers with no row.
  assert.deepEqual([...states].sort(), ["confirmed", "none", "pending", "revoked", "waitlisted"]);
  assert.match(read("app/api/user/route.ts"), /consent:consent \|\| \{ status:"none" \}/);
  const accents = [...raw("app/theme-accents.ts").matchAll(/^ {2}([a-z]+): \{ label:/gm)].map((m) => m[1]);
  assert.equal(accents.length, 8, "the accent list could not be read");
  const en = messages("en").dashboard;
  for (const locale of LOCALES) {
    const dashboardCopy = messages(locale).dashboard;
    for (const state of [...states, "unknown"]) assert.equal(typeof dashboardCopy.alerts.consentStatus[state], "string", `${locale} consentStatus.${state}`);
    for (const key of accents) assert.equal(typeof dashboardCopy.account.accentNames[key], "string", `${locale} accentNames.${key}`);
    assert.match(dashboardCopy.account.accentLocked, /\{name\}/);
    assert.match(dashboardCopy.alerts.postalPlaceholder, /^M5V 2T6 \S+ 10025$/, "the example codes stay; the word between them is translated");
    for (const key of ["close", "alerts.consentCheckEmail", "alerts.consentAlreadyConfirmed"]) assert.equal(typeof at(dashboardCopy, key), "string", `${locale} dashboard.${key}`);
    if (locale === "en") continue;
    for (const state of ["pending", "waitlisted", "confirmed", "revoked", "unknown"]) {
      assert.notEqual(dashboardCopy.alerts.consentStatus[state], en.alerts.consentStatus[state], `${locale} consentStatus.${state} is English`);
    }
    assert.notEqual(dashboardCopy.alerts.postalPlaceholder, en.alerts.postalPlaceholder);
    assert.notEqual(dashboardCopy.account.accentNames.gold, en.account.accentNames.gold);
    assert.notEqual(dashboardCopy.close, en.close);
  }
});

// The deletion request opened an English email ("Radar account deletion request") in every
// language, and said nothing about which account.
test("the dashboard's deletion request is an email in the reader's language", () => {
  const dashboard = read("app/[locale]/dashboard/sections/PrivacySection.tsx");
  assert.ok(!dashboard.includes("deletion%20request"), "the English subject is back");
  assert.match(dashboard, /const deletionMailto = `mailto:support@cedartechsolutions\.ca\?subject=\$\{encodeURIComponent\(t\("account\.deletionEmailSubject"\)\)\}&body=\$\{encodeURIComponent\(t\("account\.deletionEmailBody", \{ email: p\.email \}\)\)\}`;/);
  assert.match(dashboard, /<a href=\{deletionMailto\}>\{t\("account\.requestDeletion"\)\}<\/a>/);
  const en = messages("en").dashboard.account;
  for (const locale of LOCALES) {
    const account = messages(locale).dashboard.account;
    assert.equal(typeof account.deletionEmailSubject, "string", `${locale} deletionEmailSubject`);
    assert.match(account.deletionEmailSubject, /Radar/, `${locale}: the subject names the service`);
    assert.match(account.deletionEmailBody, /\{email\}/, `${locale}: the body names the account`);
    if (locale === "en") continue;
    assert.notEqual(account.deletionEmailSubject, en.deletionEmailSubject, `${locale} subject is English`);
    assert.notEqual(account.deletionEmailBody, en.deletionEmailBody, `${locale} body is English`);
  }
});

// The home page carried a whole account modal, in English, that nothing ever opened.
test("the home page has no dead account modal", () => {
  const home = read("app/HomeClient.tsx");
  for (const gone of ["setAccount", "savePrefs", "SignOutButton", "Sign out of Radar", "MY RADAR", "dashboard-overlay"]) {
    assert.ok(!home.includes(gone), `"${gone}" is back`);
  }
  for (const locale of LOCALES) assert.equal(messages(locale).home.notices.alertsSaved, undefined, `${locale} keeps the modal's notice`);
  // Nor its styles: the classes only the modal used, in any stylesheet, and in no markup either.
  const modalOnly = ["dashboard-overlay", "dashboard", "dash-head", "dash-stats", "dash-grid", "saved-list", "daychecks", "checkline", "labeltitle", "signout", "avatar"];
  const stylesheets = readdirSync(join(root, "app")).filter((file) => file.endsWith(".css"));
  for (const name of stylesheets) {
    const css = raw(`app/${name}`).replace(/\/\*[\s\S]*?\*\//g, "");
    for (const cls of modalOnly) assert.doesNotMatch(css, new RegExp(`\\.${cls}(?![\\w-])`), `app/${name} still styles .${cls}`);
  }
  // .muted shared a rule with the modal's list, and other pages use it.
  assert.match(raw("app/dashboard.css"), /\.muted\{color:var\(--muted\)\}/);
  const markup = walk("app").filter((path) => /\.tsx$/.test(path)).map((path) => read(path)).join("\n");
  for (const cls of modalOnly) assert.doesNotMatch(markup, new RegExp(`className=(?:"|\\{\`)(?:[^"\`]* )?${cls}(?:[ "\`])`), `.${cls} is in markup again`);
});

test("the command palette and the toast take their words from the catalogue", () => {
  assert.match(read("app/SiteHeader.tsx"), /noMatches=\{tCommand\("noMatches"\)\}/);
  assert.match(read("app/RootShell.tsx"), /<ToastProvider dismissLabel=\{tToast\("dismiss"\)\}>/);
  for (const locale of LOCALES) {
    const catalogue = messages(locale);
    assert.equal(typeof catalogue.commandPalette.noMatches, "string");
    assert.equal(typeof catalogue.toast.dismiss, "string");
    assert.equal(typeof catalogue.nav.skipToContent, "string");
    assert.equal(typeof catalogue.pro.columnFeature, "string");
  }
});

// ---------------------------------------------------------------------------------------------
// What every page connects to before it needs to.

test("pages preconnect only to what they will use", () => {
  const shell = read("app/RootShell.tsx");
  assert.doesNotMatch(shell, /api\.mapbox\.com/, "no public page loads Mapbox");
  assert.match(shell, /\{hasSession && <link rel="preconnect" href=\{clerkHost\} \/>\}/, "Clerk loads only for a session");
});
