// The public site's stylesheet.
//
// Every public page used to download all thirteen app/*.css files as one render-blocking sheet, the
// admin console's and the restaurant portal's rules included. The public root now imports each file
// with `?public` (app/PublicShell.tsx), which the build serves without the rules no public page can
// match (the radar:public-stylesheets plugin in vite.config.ts, scripts/public-css.mjs); the operator
// root imports the same files whole (app/OperatorShell.tsx).
//
// Two things must never happen, and these tests fail if either does:
//   (a) a class a public page can carry loses its rules, so the page renders differently;
//   (b) the operator pages' stylesheet stops being the thirteen files, whole, in today's order.
// The build-output tests read dist/, which `npm test` builds first.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
import { DatabaseSync } from "node:sqlite";
import postcss from "postcss";
import ts from "typescript";
import {
  LIBRARY_CLASS_PREFIXES, PUBLIC_CSS_ID, isPublicClass, ruleIsOperatorOnly, scanPublicSource,
  selectorCanMatch, selectorClasses, stripOperatorOnly,
} from "../scripts/public-css.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const slash = (path) => path.split("\\").join("/");
const rel = (file) => slash(relative(root, file));

// The cascade: the order RootShell imported the sheets in before the public site got its own
// subset, which both shells keep.
const STYLESHEETS = ["globals", "enhancements", "dashboard", "polish", "portal", "auth", "refinements", "newfeatures", "markets", "pro", "dashboard-visuals", "affiliate", "site-chrome", "staff-workspace"];

const inventory = await scanPublicSource(root);
const isKnown = (name) => isPublicClass(name, inventory);

function sourceFile(file) {
  const text = readFileSync(file, "utf8");
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

// The stylesheet specifiers a module imports, in order.
function stylesheetImports(file) {
  return sourceFile(file).statements
    .filter((statement) => ts.isImportDeclaration(statement) && /\.css(\?|$)/.test(statement.moduleSpecifier.text))
    .map((statement) => statement.moduleSpecifier.text);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

// ---------------------------------------------------------------------------------------------
// The mechanism

test("a selector can match only if the page could carry every class it requires", () => {
  const known = new Set(["card", "open", "wide:card"]);
  const has = (name) => known.has(name);
  const cases = [
    [".card", true],
    [".card .portal-row", false],
    ["html[data-theme=\"dark\"] .card:hover > span", true],
    ["html[data-theme=dark] .admin-list b", false],
    [".card:not(.admin-row)", true],
    [":is(.card, .admin-row) b", true],
    [":is(.admin-row, .queue-list) b", false],
    [":where(.admin-row) .card", false],
    [".card:has(.admin-row)", false],
    [".card:has(> .open)", true],
    ["[class~=\"admin-row\"]", true],
    ["#admin-root .card", true],
    [".wide\\:card", true],
    [".narrow\\:card", false],
    [".card::before", true],
    ["& .card", true],
    ["& .admin-row", false],
    [".card:nth-child(2n + 1 of .admin-row)", true],
    ["a[href=\".admin-row\"]", true],
  ];
  for (const [selector, expected] of cases) assert.equal(selectorCanMatch(selector, has), expected, selector);
  assert.deepEqual(selectorClasses(".a:not(.b) .wide\\:card[title=\".c\"]"), ["a", "b", "wide:card"]);
});

test("a rule goes only when every selector in its list is unmatchable, and nothing else goes", () => {
  const inventoryOf = (...classes) => ({ classes: new Set(classes), prefixes: new Set(["toast-"]), suffixes: new Set(["-dot"]) });
  const css = [
    "@layer theme, base;",
    "@font-face{font-family:x;src:url(x.woff2)}",
    "@property --spin{syntax:\"<angle>\";inherits:false;initial-value:0deg}",
    ":root{--gap:4px}",
    ".card,.admin-row{color:red}",
    ".admin-row,.queue-list{color:blue}",
    ".admin-row .card{margin:0}",
    ".toast-error svg{fill:red}",
    ".amber-dot{color:orange}",
    ".cl-card{border:0}",
    ".lucide-map-pin{width:1em}",
    "@media (max-width:600px){.admin-row{display:none}.queue-list{gap:0}}",
    "@media (max-width:700px){.admin-row{display:none}.card{gap:0}}",
    "@supports (display:grid){@media (min-width:1px){.queue-list{display:grid}}}",
    "@layer base{.admin-row{color:red}}",
    "@keyframes admin-pulse{from{opacity:0}to{opacity:1}}",
    ".card{.admin-row &{color:red}.inner{color:blue}}",
  ].join("\n");
  const { css: out, removed } = stripOperatorOnly(css, inventoryOf("card", "inner"));
  assert.deepEqual(removed, [".admin-row,.queue-list", ".admin-row .card", ".admin-row", ".queue-list", ".admin-row", ".queue-list", ".admin-row", ".admin-row &"]);
  for (const kept of ["@layer theme, base;", "@font-face{font-family:x;src:url(x.woff2)}", "@property --spin", ":root{--gap:4px}", ".card,.admin-row{color:red}", ".toast-error svg", ".amber-dot", ".cl-card", ".lucide-map-pin", "@keyframes admin-pulse{from{opacity:0}to{opacity:1}}", ".inner{color:blue}"]) {
    assert.ok(out.includes(kept), `keeps ${kept}`);
  }
  assert.ok(out.includes("@media (max-width:700px){.card{gap:0}}"), "a block that still holds a rule keeps it");
  assert.doesNotMatch(out, /max-width:600px/, "an emptied @media goes");
  assert.doesNotMatch(out, /@supports/, "and so does its emptied parent");
  assert.match(out, /@layer base\{\s*\}/, "an emptied @layer block stays: its first mention fixes the layer order");
  assert.deepEqual(stripOperatorOnly(out, inventoryOf("card", "inner")).removed, [], "stripping twice removes nothing more");
  assert.deepEqual([...LIBRARY_CLASS_PREFIXES], ["cl-", "lucide"]);
});

test("any block the removals empty goes but @layer, and keyframes under any prefix are never looked inside", () => {
  const inventory = { classes: new Set(["card"]), prefixes: new Set(), suffixes: new Set() };
  // Named without their @: Tailwind reads this file for class names as well, and one of these written
  // whole is the name of a Tailwind class, which would put a rule in the stylesheets the site ships.
  for (const block of ["media (min-width:1px)", "supports (display:grid)", "container (min-width:1px)", "scope (.card)", "starting-style"]) {
    assert.equal(stripOperatorOnly(`@${block}{.admin-row{color:red}}`, inventory).css, "", `an emptied @${block} goes`);
  }
  assert.match(stripOperatorOnly("@layer x{.admin-row{color:red}}", inventory).css, /^@layer x\{\s*\}$/, "an emptied @layer stays");
  assert.equal(stripOperatorOnly("@media print{}", inventory).css, "@media print{}", "a block empty before the pass is left as it was");
  // A keyframe stop read as a selector would need a class: `12.5%` one named "5".
  for (const name of ["keyframes", "-webkit-keyframes", "-moz-keyframes", "-o-keyframes", "-MS-KEYFRAMES"]) {
    const css = `@${name} pulse{0%{opacity:0}12.5%{opacity:.5}to{opacity:1}}`;
    assert.deepEqual(stripOperatorOnly(css, inventory), { css, removed: [] }, `@${name} is left whole`);
  }
});

test("the scan reads class names from everything the public routes import, and nothing else", async () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-public-css-"));
  try {
    const write = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
    write("tsconfig.json", JSON.stringify({ compilerOptions: { paths: { "@/*": ["./*"] } } }));
    write("app/[locale]/page.tsx", [
      "import Card from \"../Card\";",
      "import { Badge } from \"@/app/Badge\";",
      // Classes inside strings of code and markup, as an inline pre-paint script writes them.
      "const GATE = `(function(){if(location.search)document.documentElement.classList.add(\"app-no-purchase\")})();`;",
      "const NOTE = '<p class=\"inline-note\">';",
      "const OPEN = \"document.querySelector('.menu-open')\";",
      "const THEME = \"document.body.classList.add('theme-' + t)\";",
      "export default function Page({ kind, tone, paused }: { kind: string; tone: string; paused: boolean }) {",
      "  return <main className=\"page-shell wide\">",
      "    <a className=\"nav-pro-link purchase-cta\" href=\"/pro\" />",
      "    <Card />",
      "    <section className={`hero${paused ? \" motion-paused\" : \"\"}`} />",
      "    <span className={`market-chip market-${kind.toLowerCase()}`} />",
      "    <i className={tone + \"-dot\"} />",
      "    <b className={\"toast-\" + kind} />",
      "    <Badge />",
      "  </main>;",
      "}",
    ].join("\n"));
    write("app/Card.tsx", "const Lazy = () => import(\"./Lazy\");\nexport default function Card() { return <div className=\"card\" data-lazy={String(Lazy)} />; }\n");
    write("app/Lazy.tsx", "export default function Lazy() { return <p className=\"lazy-note\" />; }\n");
    write("app/Badge.tsx", "export function Badge() { return <em className=\"badge\" />; }\n");
    write("app/OperatorOnly.tsx", "export default function OperatorOnly() { return <div className=\"admin-row\" />; }\n");
    write("app/(operator)/admin/page.tsx", "import OperatorOnly from \"../../OperatorOnly\";\nexport default function Admin() { return <OperatorOnly />; }\n");
    const scan = await scanPublicSource(dir);
    assert.deepEqual(scan.files.map((file) => slash(relative(dir, file))), ["app/Badge.tsx", "app/Card.tsx", "app/Lazy.tsx", "app/[locale]/page.tsx"]);
    for (const name of ["page-shell", "wide", "hero", "motion-paused", "market-chip", "card", "lazy-note", "badge"]) assert.ok(scan.classes.has(name), name);
    assert.ok(!scan.classes.has("admin-row"), "a component only an operator page imports is not public code");
    assert.ok(scan.prefixes.has("market-") && scan.prefixes.has("toast-"), "the static start of a built name is a prefix");
    assert.ok(scan.suffixes.has("-dot"), "and its static end a suffix");
    assert.ok(!scan.prefixes.has("hero"), "an interpolation that only ever adds a space-led class glues nothing on");
    for (const [name, kept] of [["market-us", true], ["toast-error", true], ["amber-dot", true], ["hero-banner", false], ["admin-row", false], ["cl-rootBox", true], ["lucide-map-pin", true]]) {
      assert.equal(isPublicClass(name, scan), kept, name);
    }
    // A class written inside a string of code or markup is one of the string's identifier-like runs,
    // not one of its whitespace words, which are runs of code around it. The iOS purchase gate puts
    // app-no-purchase on <html> that way (app/app-context.ts); read by whitespace alone, the rule
    // hiding every purchase control in the app's browser was stripped, and only from the build.
    for (const name of ["app-no-purchase", "inline-note", "menu-open"]) assert.ok(scan.classes.has(name), `${name}, from inside a string`);
    assert.deepEqual(stripOperatorOnly("html.app-no-purchase .purchase-cta{display:none!important}", scan).removed, [], "the purchase gate's rule is kept");
    // But a name such a string builds when it runs is not seen whole: `theme-` there is a word, not a
    // prefix. Classes like that have to be written out whole somewhere public.
    assert.ok(scan.classes.has("theme-") && !scan.prefixes.has("theme-") && !isPublicClass("theme-dark", scan));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the plugin transforms only stylesheets asked for with ?public", () => {
  const base = "C:/Radar/app/globals.css";
  for (const id of [`${base}?public`, `${base}?public&direct`, `${base}?direct&public`, "/app/site-chrome.css?public"]) assert.match(id, PUBLIC_CSS_ID, id);
  for (const id of [base, `${base}?direct`, `${base}?publicity`, `${base}?nonpublic`, `${base}?inline`, "C:/Radar/public/x.css", "C:/Radar/app/public.css"]) assert.doesNotMatch(id, PUBLIC_CSS_ID, id);
  const config = read("vite.config.ts");
  assert.match(config, /filter: \{ id: PUBLIC_CSS_ID \}/, "the transform is filtered to those ids");
  assert.match(config, /name: "radar:public-stylesheets",\s*apply: "build",/);
  assert.match(config, /plugins: \[\s*vinext\(\),\s*publicStylesheets\(\),/);
});

// ---------------------------------------------------------------------------------------------
// (b) The operator root keeps today's cascade

test("the operator shell imports the fourteen stylesheets whole, in today's order", () => {
  assert.deepEqual(stylesheetImports(join(root, "app/OperatorShell.tsx")), STYLESHEETS.map((name) => `./${name}.css`));
});

test("the public shell imports the same fourteen, in the same order, each with ?public", () => {
  assert.deepEqual(stylesheetImports(join(root, "app/PublicShell.tsx")), STYLESHEETS.map((name) => `./${name}.css?public`));
});

test("every stylesheet is in both shells, and no other module imports one", () => {
  assert.deepEqual(readdirSync(join(root, "app")).filter((name) => name.endsWith(".css")).map((name) => name.slice(0, -4)).sort(), [...STYLESHEETS].sort());
  const importers = ["app", "i18n", "worker"].flatMap((dir) => walk(join(root, dir)))
    .filter((file) => /\.(tsx?|mjs|js)$/.test(file) && stylesheetImports(file).length)
    .map(rel).sort();
  assert.deepEqual(importers, ["app/OperatorShell.tsx", "app/PublicShell.tsx"]);
});

test("each root layout renders its own shell", () => {
  const publicLayout = read("app/[locale]/layout.tsx");
  const operatorLayout = read("app/(operator)/layout.tsx");
  assert.match(publicLayout, /import \{ PublicShell \} from "\.\.\/PublicShell";/);
  assert.match(publicLayout, /<PublicShell lang=\{locale\}>/);
  assert.match(operatorLayout, /import \{ OperatorShell \} from "\.\.\/OperatorShell";/);
  assert.match(operatorLayout, /<OperatorShell lang="en">/);
  for (const layout of [publicLayout, operatorLayout]) assert.doesNotMatch(layout, /RootShell|OperatorShell.*PublicShell|PublicShell.*OperatorShell/s);
});

// ---------------------------------------------------------------------------------------------
// The built stylesheets

const manifest = (await import(pathToFileURL(join(root, "dist/server/__vite_rsc_assets_manifest.js")).href)).default;
const builtCss = (href) => readFileSync(join(root, "dist/client", href), "utf8");
const rulesOf = (css) => { const rules = []; postcss.parse(css).walkRules((rule) => { if (!/keyframes/i.test(rule.parent?.name || "")) rules.push(rule); }); return rules; };
const classesOf = (css) => new Set(rulesOf(css).flatMap((rule) => selectorClasses(rule.selector)));

test("each root links exactly one stylesheet of its own", () => {
  const resources = manifest.serverResources;
  assert.deepEqual(Object.keys(resources).sort(), ["app/OperatorShell.tsx", "app/PublicShell.tsx"], "no other server module carries a stylesheet");
  assert.equal(resources["app/OperatorShell.tsx"].css.length, 1);
  assert.equal(resources["app/PublicShell.tsx"].css.length, 1);
  assert.notEqual(resources["app/OperatorShell.tsx"].css[0], resources["app/PublicShell.tsx"].css[0]);
});

const operatorCss = builtCss(manifest.serverResources["app/OperatorShell.tsx"].css[0]);
const publicCss = builtCss(manifest.serverResources["app/PublicShell.tsx"].css[0]);

// What the plugin removes from each source file, read from the source itself.
const sources = STYLESHEETS.map((name) => ({ name, css: read(`app/${name}.css`) }));
const removedRules = sources.flatMap(({ name, css }) => stripOperatorOnly(css, inventory, { from: name }).removed.map((selector) => ({ name, selector })));
const keptClasses = new Set(sources.flatMap(({ css }) => rulesOf(stripOperatorOnly(css, inventory).css).flatMap((rule) => selectorClasses(rule.selector))));
const removedOnlyClasses = new Set(removedRules.flatMap(({ selector }) => selectorClasses(selector)).filter((name) => !keptClasses.has(name)));

// Where Tailwind's generated utilities end, at the top of globals.css's output: a utility can share
// a name with a class of ours, so classes are looked for after it.
function afterUtilities(css) {
  const start = css.indexOf("@layer utilities{");
  if (start < 0) return 0;
  for (let index = start, depth = 0; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    else if (css[index] === "}" && (depth -= 1) === 0) return index + 1;
  }
  return 0;
}
const position = (css, name) => {
  const from = afterUtilities(css);
  const at = css.slice(from).search(new RegExp(`\\.${name}(?![\\w-])`));
  return at < 0 ? -1 : from + at;
};

test("the operator stylesheet is the fourteen sheets in today's order, with nothing taken out", () => {
  // Order: the first class that only one sheet names, found in the built file, sheet by sheet.
  const named = sources.map(({ css }) => new Set(rulesOf(css).flatMap((rule) => selectorClasses(rule.selector))));
  let last = -1;
  for (const [index, { name }] of sources.entries()) {
    const marker = [...named[index]].find((cls) => /^[a-z][a-z0-9-]*$/.test(cls) && named.every((set, other) => other === index || !set.has(cls)) && keptClasses.has(cls));
    assert.ok(marker, `${name}.css has a class of its own to find it by`);
    const at = position(operatorCss, marker);
    assert.ok(at > last, `${name}.css (.${marker}) comes after the sheet before it in the operator stylesheet`);
    assert.ok(position(publicCss, marker) >= 0, `${name}.css (.${marker}) is in the public stylesheet too`);
    last = at;
  }
  // Nothing taken out: every class the public subset drops is still styled for the operator pages.
  assert.ok(removedOnlyClasses.size > 100, `the public subset drops the operator pages' classes (${removedOnlyClasses.size})`);
  const operatorClasses = classesOf(operatorCss);
  for (const name of removedOnlyClasses) assert.ok(operatorClasses.has(name), `.${name} is still in the operator stylesheet`);
  assert.ok(stripOperatorOnly(operatorCss, inventory).removed.length > 100, "the operator stylesheet still holds the operator-only rules");
});

test("the public stylesheet keeps every rule a public page can match and none it cannot", () => {
  const publicClasses = classesOf(publicCss);
  for (const name of keptClasses) assert.ok(publicClasses.has(name), `.${name} survives the build`);
  for (const name of removedOnlyClasses) assert.ok(!publicClasses.has(name), `.${name} is not in the public stylesheet`);
  assert.deepEqual(stripOperatorOnly(publicCss, inventory).removed, [], "every sheet went through the plugin: nothing operator-only is left");
  // The iOS purchase gate's three among them (app/app-context.ts, app/globals.css): a script puts
  // app-no-purchase on <html> before the first paint, which no rendered page shows and no census of
  // className attributes sees, and with these rules gone the app's browser offers Stripe's checkout
  // where App Review forbids it.
  for (const name of ["cl-rootBox", "cl-card", "auth-shell", "portal-card", "delivery-row", "toast-error", "redemption-pill-code", "market-us", "app-no-purchase", "purchase-cta", "purchase-hidden-note"]) {
    assert.ok(publicClasses.has(name), `.${name}, which public pages use, is kept`);
  }
  assert.ok(publicCss.length < operatorCss.length * 0.85, `the public stylesheet is lighter (${publicCss.length} of ${operatorCss.length} bytes)`);
});

// ---------------------------------------------------------------------------------------------
// (a) A class a public page can carry is never stripped

// Every JSX attribute that names classes (className, emojiClassName...) in the public code, and what
// its value is made of: literal words; runtime parts glued to static text ("prefix": the text before
// must be a prefix the scan recorded, "suffix": the text after a suffix); and runtime parts that
// are a whole class on their own. A `const` in the same file is followed to what it is set to.
//
// Deliberately written apart from the scan in scripts/public-css.mjs - it reads the markup, not
// every string - so that the two can disagree. It reads the files the scan read, though, so it
// cannot see a public module the scan never reached: whether there is one is for the reachability
// tests further down, which start from every module under app/ and i18n/ rather than from that list.
function classAttributes() {
  const out = [];
  for (const file of inventory.files) {
    const source = sourceFile(file);
    const constants = new Map();
    const collect = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (node.parent.flags & ts.NodeFlags.Const)) {
        constants.set(node.name.text, [...(constants.get(node.name.text) || []), node.initializer]);
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
    const visit = (node) => {
      if (ts.isJsxAttribute(node) && /className$/i.test(node.name.getText(source)) && node.initializer) {
        const words = [];
        const dynamic = [];
        const glued = [];
        const literalText = (expr) => (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr) ? expr.text : null);
        // Whether a value can put a non-space character against its neighbour ("start": the text
        // before it, "end": the text after). Only a value built from literals can be shown not to.
        const canTouch = (expr, side) => {
          const text = literalText(expr);
          if (text !== null) return text.length > 0 && !/\s/.test(side === "start" ? text[0] : text[text.length - 1]);
          if (ts.isParenthesizedExpression(expr)) return canTouch(expr.expression, side);
          if (ts.isConditionalExpression(expr)) return canTouch(expr.whenTrue, side) || canTouch(expr.whenFalse, side);
          if (ts.isTemplateExpression(expr)) {
            const spans = expr.templateSpans;
            const edge = side === "start" ? expr.head.text : spans[spans.length - 1].literal.text;
            if (edge) return !/\s/.test(side === "start" ? edge[0] : edge[edge.length - 1]);
            return canTouch(side === "start" ? spans[0].expression : spans[spans.length - 1].expression, side);
          }
          return true;
        };
        // Explains `expr`, and returns the runtime parts it added.
        const explain = (expr, seen) => {
          const start = dynamic.length;
          const text = literalText(expr);
          if (text !== null) words.push(...text.split(/\s+/).filter(Boolean));
          else if (ts.isJsxExpression(expr)) { if (expr.expression) explain(expr.expression, seen); }
          else if (ts.isParenthesizedExpression(expr)) explain(expr.expression, seen);
          else if (expr.kind === ts.SyntaxKind.NullKeyword || expr.kind === ts.SyntaxKind.FalseKeyword || (ts.isIdentifier(expr) && expr.text === "undefined")) { /* no class */ }
          else if (ts.isConditionalExpression(expr)) { explain(expr.whenTrue, seen); explain(expr.whenFalse, seen); }
          else if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) explain(expr.right, seen);
          else if (ts.isBinaryExpression(expr) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expr.operatorToken.kind)) { explain(expr.left, seen); explain(expr.right, seen); }
          else if (ts.isBinaryExpression(expr) && expr.operatorToken.kind === ts.SyntaxKind.PlusToken) {
            const left = literalText(expr.left);
            const right = literalText(expr.right);
            const leftParts = explain(expr.left, seen);
            const rightParts = explain(expr.right, seen);
            if (left && !/\s$/.test(left) && rightParts.length && canTouch(expr.right, "start")) glued.push({ kind: "prefix", text: left.split(/\s+/).pop(), parts: rightParts, anchored: true });
            if (right && !/^\s/.test(right) && leftParts.length && canTouch(expr.left, "end")) glued.push({ kind: "suffix", text: right.split(/\s+/)[0], parts: leftParts, anchored: true });
          } else if (ts.isTemplateExpression(expr)) {
            const chunks = [expr.head.text, ...expr.templateSpans.map((span) => span.literal.text)];
            chunks.forEach((chunk) => words.push(...chunk.split(/\s+/).filter(Boolean)));
            expr.templateSpans.forEach((span, index) => {
              const parts = explain(span.expression, seen);
              if (!parts.length) return;
              const before = chunks[index];
              const after = chunks[index + 1];
              // A prefix names a class only if nothing else is glued onto its other end: the text
              // runs back to a space or the start of the string (and a suffix on to a space or the end).
              if (before && !/\s$/.test(before) && canTouch(span.expression, "start")) glued.push({ kind: "prefix", text: before.split(/\s+/).pop(), parts, anchored: index === 0 || /\s/.test(before) });
              if (after && !/^\s/.test(after) && canTouch(span.expression, "end")) glued.push({ kind: "suffix", text: after.split(/\s+/)[0], parts, anchored: index === chunks.length - 2 || /\s/.test(after) });
            });
          } else if (ts.isElementAccessExpression(expr) && ts.isArrayLiteralExpression(expr.expression)) {
            expr.expression.elements.forEach((element) => explain(element, seen));
          } else if (ts.isIdentifier(expr) && constants.has(expr.text) && !seen.has(expr.text)) {
            for (const initializer of constants.get(expr.text)) explain(initializer, new Set([...seen, expr.text]));
          } else {
            dynamic.push(expr.getText(source));
          }
          return dynamic.slice(start);
        };
        explain(node.initializer, new Set());
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        out.push({ file: rel(file), line: line + 1, words, dynamic, glued });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return out;
}

// Class names that are a whole runtime value, each checked by hand: where its values come from,
// and why the scan sees every one of them. A new entry needs the same answer.
const REVIEWED = {
  // next/font's generated classes, which set the font variables. No app stylesheet names them.
  "app/RootShell.tsx: workSans.variable": "next/font",
  "app/RootShell.tsx: spaceGrotesk.variable": "next/font",
  "app/RootShell.tsx: geistMono.variable": "next/font",
  // "good" | "bad" | "warn" | "pending": the four literals deliveryTone returns (app/delivery-history.ts).
  "app/[locale]/dashboard/sections/HistorySection.tsx: deliveryTone(state)": "app/delivery-history.ts",
};
// A prop that names classes is checked where it is passed: every call site is one of these
// attributes too, in this same census.
const isClassProp = (text) => /^[A-Za-z]*[cC]lassName$/.test(text);

test("every class a public component writes is kept, and every name built at runtime is one the scan sees", () => {
  const attributes = classAttributes();
  assert.ok(attributes.length > 300, `the census found the public markup (${attributes.length} class attributes)`);
  const problems = [];
  const used = new Set();
  for (const { file, line, words, dynamic, glued } of attributes) {
    for (const word of words) if (!isKnown(word)) problems.push(`${file}:${line}: .${word} would be stripped`);
    for (const { kind, text, parts, anchored } of glued) {
      const found = kind === "prefix" ? inventory.prefixes.has(text) : inventory.suffixes.has(text);
      if (!anchored) problems.push(`${file}:${line}: "${text}" has runtime values glued to both ends (\`${parts.join(", ")}\`), so no prefix or suffix names the class; spell the static part out at one end`);
      else if (!found) problems.push(`${file}:${line}: \`${parts.join(", ")}\` is glued to "${text}", which the scan did not record as a ${kind}`);
    }
    for (const expr of dynamic) {
      const key = `${file}: ${expr}`;
      if (glued.some((entry) => entry.parts.includes(expr)) || isClassProp(expr)) continue;
      if (REVIEWED[key]) { used.add(key); continue; }
      problems.push(`${file}:${line}: a class is the runtime value of \`${expr}\`. The scan only sees literals: if every value it can take is a literal in the public code, add "${key}" to REVIEWED with where they come from; if a value can come from data, build the name from a literal prefix instead (\`name-\${value}\`)`);
    }
  }
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(REVIEWED).filter((key) => !used.has(key)), [], "a REVIEWED entry nothing uses any more should go");
});

// Whether the scan has read everything public pages are built from. It reads what the public routes
// import, and only a module named by a literal can be followed; the two checks below are written
// apart from it, so that they can disagree with it.
//
// First, every module under app/ and i18n/ - a component, or a .ts file a component takes class
// names from - has to be one the scan read, or one that only code rendering no public page loads:
// the operator pages, the API, the Worker, the scripts, and the few entry points the framework loads
// by name that answer something other than a page. Anything else is loaded some way the scan does
// not know, and its classes would be stripped. And whatever a module the scan read imports, the scan
// read too.
const NOT_PUBLIC = /^(?:app\/\(operator\)\/|app\/api\/|worker\/|scripts\/)/;
const NOT_PUBLIC_ENTRIES = {
  "app/manifest.ts": "the web app manifest",
  "app/robots.ts": "robots.txt",
  "app/sitemap.ts": "the sitemap",
  "i18n/request.ts": "next-intl's request config, which picks a locale's messages",
};
const SCRIPT = /\.[cm]?[jt]sx?$/;

// The relative modules a file names: imports, exports from, and `import("./x")`.
const specifiersIn = (text) => [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map(([, specifier]) => specifier);

// The file a relative specifier names, tried as the bundler would: as written, with each script
// extension, TypeScript's `./x.js` for ./x.ts, and a directory's index.
function resolveModule(fromFile, specifier) {
  const base = resolve(dirname(fromFile), specifier.split("?")[0]);
  const stem = base.replace(/\.[cm]?jsx?$/, "");
  const extensions = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
  for (const candidate of [base, ...extensions.map((ext) => stem + ext), ...extensions.map((ext) => join(base, `index${ext}`))]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** What breaks the rule above in the checkout at `base`, given the scan of it. */
function unexplainedModules(base, scan) {
  const relOf = (file) => slash(relative(base, file));
  const scanned = new Set(scan.files.map(relOf));
  const sources = ["app", "i18n", "worker", "scripts"].filter((dir) => existsSync(join(base, dir)))
    .flatMap((dir) => walk(join(base, dir))).filter((file) => SCRIPT.test(file));
  const imports = new Map(sources.map((file) => [relOf(file), specifiersIn(readFileSync(file, "utf8")).map((specifier) => resolveModule(file, specifier)).filter(Boolean).map(relOf)]));
  // Everything code that renders no public page loads, however indirectly.
  const reached = new Set();
  const queue = [...imports.keys()].filter((file) => NOT_PUBLIC.test(file) || Object.hasOwn(NOT_PUBLIC_ENTRIES, file));
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    queue.push(...(imports.get(file) || []));
  }
  const problems = [];
  for (const [file, targets] of imports) {
    if (scanned.has(file)) {
      for (const target of targets) if (SCRIPT.test(target) && !scanned.has(target)) problems.push(`${file} imports ${target}, which the scan did not read`);
    } else if (/^(?:app|i18n)\/.*\.tsx?$/.test(file) && !/\.d\.ts$/.test(file) && !reached.has(file)) {
      problems.push(`${file} is neither read by the scan nor loaded only by code that renders no public page`);
    }
  }
  return problems.sort();
}

// Second, no module the scan read loads another by a name worked out when it runs: Vite's
// import.meta.glob, or import() and require() of anything but a literal. The scan cannot follow
// either, and the module it loads is public code the census never sees.
function dynamicImportsIn(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, /x$/.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = [];
  const visit = (node) => {
    const glob = ts.isPropertyAccessExpression(node) && ts.isMetaProperty(node.expression) && node.expression.keywordToken === ts.SyntaxKind.ImportKeyword && /^glob/i.test(node.name.text);
    const load = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"));
    if (glob || (load && !(node.arguments.length && ts.isStringLiteralLike(node.arguments[0])))) {
      found.push(`${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${node.getText(source).slice(0, 80)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

test("the reachability checks catch a module loaded some way the scan cannot follow", async () => {
  const dir = mkdtempSync(join(tmpdir(), "radar-public-css-"));
  try {
    const write = (path, text) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), text); };
    const page = [
      "import Card from \"../Card\";",
      "const sections = import.meta.glob(\"../sections/*.ts\", { eager: true });",
      "export const panel = (name: string) => import(`../panels/${name}`);",
      "export const lazy = () => import(`../Lazy`);",
      "export default function Page() { return <Card />; }",
    ].join("\n");
    write("app/[locale]/page.tsx", page);
    write("app/Card.tsx", "export default function Card() { return <div className=\"card\" />; }\n");
    write("app/Lazy.tsx", "export default function Lazy() { return <p className=\"lazy-note\" />; }\n");
    write("app/sections/hero.ts", "export const hero = \"hero-banner\";\n");
    write("i18n/tones.ts", "export const tones = { good: \"tone-good\" };\n");
    write("app/(operator)/admin/page.tsx", "import { pick } from \"../../picker\";\nexport default function Admin() { return <b className={pick} />; }\n");
    write("app/picker.ts", "export const pick = \"admin-pick\";\n");
    write("app/api/deals/route.ts", "import { list } from \"../../deal-list\";\nexport function GET() { return Response.json(list); }\n");
    write("app/deal-list.ts", "export const list = [];\n");
    write("app/robots.ts", "export default function robots() { return {}; }\n");
    const scan = await scanPublicSource(dir);
    assert.deepEqual(scan.files.map((file) => slash(relative(dir, file))), ["app/Card.tsx", "app/Lazy.tsx", "app/[locale]/page.tsx"], "a template literal with nothing in it is followed like a string");
    assert.deepEqual(unexplainedModules(dir, scan), [
      "app/sections/hero.ts is neither read by the scan nor loaded only by code that renders no public page",
      "i18n/tones.ts is neither read by the scan nor loaded only by code that renders no public page",
    ], "a module only operator pages, the API or a metadata route loads is not public; one nothing names is suspect");
    assert.deepEqual(dynamicImportsIn("page.tsx", page), [
      "2: import.meta.glob",
      "3: import(`../panels/${name}`)",
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every module under app/ and i18n/ is public code, or loaded only by code that renders no public page", () => {
  assert.deepEqual(unexplainedModules(root, inventory), []);
});

test("no public module loads another by a name the scan cannot read", () => {
  const found = inventory.files.flatMap((file) => dynamicImportsIn(file, readFileSync(file, "utf8")).map((at) => `${rel(file)}:${at}`));
  assert.deepEqual(found, [], "spell the module out in an import, or as a literal import(\"./x\"), so that the scan can follow it");
});

// Rendered pages: the built worker, a small catalogue, no network.
const ALIAS = `data:text/javascript,${encodeURIComponent(`
export const env = new Proxy({}, { get: (_target, key) => globalThis.__PUBLIC_CSS_TEST_ENV__?.[key] });
export const waitUntil = (promise) => { if (promise && typeof promise.catch === "function") promise.catch(() => {}); };
`)}`;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "cloudflare:workers") return { url: ALIAS, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

function d1(db) {
  const plain = (row) => ({ ...row });
  const statement = (sql, binds) => ({
    bind: (...args) => statement(sql, args),
    first: async (column) => { const row = db.prepare(sql).get(...binds); if (row === undefined) return null; return column === undefined ? plain(row) : (row[column] ?? null); },
    all: async () => ({ results: db.prepare(sql).all(...binds).map(plain), success: true, meta: {} }),
    run: async () => { const info = db.prepare(sql).run(...binds); return { results: [], success: true, meta: { changes: Number(info.changes ?? 0) } }; },
  });
  return { prepare: (sql) => statement(sql, []), batch: async (list) => Promise.all(list.map((entry) => entry.all())) };
}

function catalogue() {
  const db = new DatabaseSync(":memory:");
  for (const file of readdirSync(join(root, "drizzle")).filter((name) => name.endsWith(".sql")).sort()) db.exec(read(`drizzle/${file}`));
  const stamp = new Date(Date.now() - 3 * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
  db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,website,country) VALUES ('corner-pub','The Corner Pub','Pub',0,'https://corner.example','CA')").run();
  db.prepare("INSERT INTO restaurants (id,name,cuisine,is_chain,national_chain,website,country,footprint) VALUES ('burger-us','Burger Barn','Burgers',1,1,'https://burger.example','US',?)").run(JSON.stringify({ NY: 3, TX: 2 }));
  db.prepare("INSERT INTO restaurant_locations (id,restaurant_id,address,city,region,country,postal_prefix,latitude,longitude,timezone) VALUES ('corner','corner-pub','12 Elgin St','Ottawa','ON','CA','K1P',45.42,-75.69,'America/Toronto')").run();
  const deal = db.prepare(`INSERT INTO deals (id,slug,restaurant,restaurant_id,location_id,title,category,cuisine,schedule,city,postal_prefix,address,price,emoji,source_url,
      status,active,verification_status,verified_at,created_at,location_scope,promo_code,redemption)
    VALUES (?,?,?,?,?,?,'Happy hour','Pub',?,?,?,?,?,'*',?,?,?,'verified',?,?,?,?,?)`);
  deal.run("corner-wings", "corner-wings", "The Corner Pub", "corner-pub", "corner", "Wing night", "Wed", "Ottawa", "K1P", "12 Elgin St", "Half price wings", "https://corner.example/specials", "live", 1, stamp, stamp, null, null, "in_store");
  deal.run("corner-oysters", "corner-oysters", "The Corner Pub", "corner-pub", "corner", "Oyster Monday", "Mon", "Ottawa", "K1P", "12 Elgin St", "$1 oysters", "https://corner.example/specials", "archived", 0, stamp, stamp, null, null, null);
  deal.run("burger-deal", "burger-deal", "Burger Barn", "burger-us", null, "$2 off a $15 order", "Daily", "", "", "", "$2 off $15", "https://burger.example/deals", "live", 1, stamp, stamp, "national", "SAVE2", "in_store,app,online,code");
  db.prepare("INSERT INTO deal_locations (deal_id,location_id,eligibility,source_url,verified_at) VALUES ('corner-wings','corner','confirmed','https://corner.example/specials',?)").run(stamp);
  return db;
}

const PAGES = [
  "/en", "/fr", "/en/pro", "/en/for-restaurants", "/en/for-creators", "/en/privacy", "/en/terms", "/en/support",
  "/en/age-suitability", "/en/sign-in", "/en/sign-up", "/en/unsubscribe", "/en/confirm-email", "/en/launch",
  "/en/no/such/page", "/en/deals/corner-wings", "/fr/deals/corner-wings", "/en/deals/burger-deal", "/en/deals/corner-oysters",
];

// /sign-in and /sign-up are Clerk's form, which renders only in a build that was given the Clerk
// publishable key - CI passes VITE_CLERK_PUBLISHABLE_KEY to `npm test`, and a checkout reads it from
// .env.local. A build without one answers both with a 500 (ClerkClientProvider mounts no
// ClerkProvider without the key, and Clerk's form will not render outside one), so they are
// rendered only when the key is in the build, and must then render like any other page.
const CLERK_PAGES = new Set(["/en/sign-in", "/en/sign-up"]);
const builtWithClerkKey = walk(join(root, "dist/server")).some((file) => file.endsWith(".js") && /pk_(?:test|live)_[A-Za-z0-9]{10,}/.test(readFileSync(file, "utf8")));

test("no class on a rendered public page loses its rules, and no rule the build removed could match one", async (t) => {
  if (!builtWithClerkKey) t.diagnostic(`built without a Clerk publishable key: ${[...CLERK_PAGES].join(" and ")} not rendered`);
  globalThis.__PUBLIC_CSS_TEST_ENV__ = { DB: d1(catalogue()), ASSETS: { fetch: async () => new Response("", { status: 404 }) } };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("offline", { status: 503 });
  try {
    const url = pathToFileURL(join(root, "dist/server/index.js"));
    url.searchParams.set("test", `public-css-${process.pid}`);
    const { default: worker } = await import(url.href);
    const operatorClasses = classesOf(operatorCss);
    const publicClasses = classesOf(publicCss);
    const publicHref = manifest.serverResources["app/PublicShell.tsx"].css[0];
    for (const path of PAGES.filter((page) => builtWithClerkKey || !CLERK_PAGES.has(page))) {
      const response = await worker.fetch(new Request(`https://radar.cheap${path}`, { headers: { accept: "text/html", "user-agent": "public-css-test" } }), globalThis.__PUBLIC_CSS_TEST_ENV__, { waitUntil() {}, passThroughOnException() {} });
      const html = await response.text();
      assert.ok([200, 404].includes(response.status), `${path} renders (${response.status})`);
      assert.ok(html.includes(`<link rel="stylesheet" href="${publicHref}"`), `${path} links the public stylesheet`);
      assert.ok(!html.includes(manifest.serverResources["app/OperatorShell.tsx"].css[0]), `${path} does not link the operator stylesheet`);
      const pageClasses = new Set([...html.matchAll(/\sclass="([^"]*)"/g)].flatMap(([, value]) => value.split(/\s+/).filter(Boolean)));
      assert.ok(pageClasses.size > 5, `${path} has markup to check (${pageClasses.size} classes)`);
      for (const name of pageClasses) {
        assert.ok(!operatorClasses.has(name) || publicClasses.has(name), `${path}: .${name} is on the page but only the operator stylesheet styles it`);
      }
      for (const { name, selector } of removedRules) {
        assert.ok(!selectorCanMatch(selector, (cls) => pageClasses.has(cls)), `${path}: "${selector}" (${name}.css) was removed, yet every class it needs is on the page`);
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("a rule is operator-only exactly when all of its selectors are", () => {
  assert.equal(ruleIsOperatorOnly(".admin-row, .queue-list", isKnown), !isKnown("admin-row") && !isKnown("queue-list"));
  assert.equal(ruleIsOperatorOnly(".portal-card, .admin-row", isKnown), false, "one public selector keeps the rule");
});
