// The public site's stylesheets, minus the rules only the operator pages can use.
//
// Why this exists
// ---------------
// Both root layouts used to import all thirteen stylesheets in app/*.css through RootShell, so every
// reader of a deal page downloaded, parsed and matched the admin console, the restaurant portal and
// the affiliate and creator workspaces before the first paint: one render-blocking 185 KB file. The
// obvious fix, moving the operator rules into operator-only files, does not work here. The public
// dashboard is built from the portal's components (portal.css's cards, pills, forms, tables), and
// operator and public rules interleave across all thirteen files, so moving any of them reorders the
// cascade for the pages that keep them.
//
// So nothing moves. The operator root imports the thirteen files exactly as before, and the public
// root imports each one with `?public` (app/PublicShell.tsx), which the plugin in vite.config.ts
// serves as the same compiled stylesheet with the rules removed that cannot match anything a public
// page renders. Removing a rule that matches nothing changes no computed style, and every rule that
// stays keeps its place, so the public cascade is today's cascade with dead weight taken out.
//
// What "cannot match" means
// -------------------------
// A rule goes only when EVERY selector in its list requires a class name that appears nowhere in
// the public site's code. "Requires" is read strictly: a class in the selector's own compounds
// (`.portal > aside`, `html.dark .admin-row`), or one that every alternative of an :is()/:where()/
// :has() needs. A class inside :not() is never a requirement, and neither is an attribute selector
// or an id. A selector list is never edited in part: a browser drops a whole rule over one selector
// it cannot parse, so taking the unmatchable selectors out of a list could bring a rule back to life.
//
// "The public site's code" is every module reachable by import from the public route tree,
// app/[locale]/ - pages, layouts, the shell and the components they render, whatever directory those
// live in. A module only operator pages import (app/(operator)/**, and e.g. a picker only the portal
// uses) is not in it. From those modules every string literal is split on whitespace, the way the
// browser splits a class attribute, so `"hero motion-paused"` offers `hero` and `motion-paused`. And
// each is split again into its runs of letters, digits, `_` and `-`, for a class written inside a
// string of code or markup rather than as one: an inline script's `classList.add("app-no-purchase")`
// (the iOS purchase gate in app/app-context.ts is one), an HTML string's `class="note"`, a
// `querySelector(".menu-open")`. Split on whitespace alone, those offered the whole run of code around
// the class and never the class, and its rules were stripped in builds only. So `"/api/stripe/portal"`
// offers `api`, `stripe` and `portal` as well. That is deliberately more than the strings that end up
// in a className - any string that could be a class, or could hold one, counts as one - and it is why
// this can afford to know nothing about where a string goes: a word taken for a class by mistake
// keeps a few rules a page did not need, and a class missed takes away rules a page did.
//
// Class names built at runtime are the hazard, so they are read conservatively:
//   - `market-${market}` or `"toast-" + kind`: the static part is a prefix, and every class starting
//     with it is kept (market-us, market-ca, toast-error...). `${tone}-dot` is a suffix, likewise.
//   - `hero${paused ? " motion-paused" : ""}`: the interpolation's every value starts with a space or
//     is empty, so `hero` is a whole class, not a prefix. Anything this cannot evaluate - a variable,
//     a call - is assumed to glue on, and the neighbouring text becomes a prefix or suffix.
//   - A class that is entirely a value - `className={tone}` - is only as visible as the literals that
//     value comes from, which are strings somewhere in the public code in every case today.
//     tests/public-css.test.mjs holds the census of every such expression and why each is covered,
//     and fails on a new one, so a class from data (a database column, an API field) cannot be
//     stripped without somebody deciding it is safe.
//   - A name a string of code builds when it runs - an inline script's `classList.add("theme-" + t)` -
//     is not one of these: the scan reads that script as text, so `theme-` is only a word, never a
//     prefix. Such a class has to be written out whole somewhere in the public code, the way
//     app/app-context.ts keeps NO_PURCHASE_CLASS as a string of its own.
//   - Libraries that add classes of their own at runtime: Clerk (`cl-*`, the sign-in and sign-up
//     pages and the account menu) and lucide-react (`lucide`, `lucide-<icon>`). Always kept.
//
// Everything that is not a style rule stays: @font-face, @property, @keyframes under any vendor
// prefix (an animation can be named from an inline style or a script), custom properties on :root,
// and @layer blocks even when emptied, because the first mention of a layer fixes its order. Any
// other block the removals leave with nothing in it goes, since an empty block applies nothing:
// @media and @supports, and a container query, @scope or @starting-style alike. A block that was
// empty before anything was removed is left as it was. (The container query goes unnamed here and
// below: Tailwind reads this file for class names too, and its at-rule spelt out is the name of a
// Tailwind class, which would add a rule to the stylesheets the site ships.)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import postcss from "postcss";

/** The query that asks for a stylesheet's public subset: `import "./globals.css?public"`. */
export const PUBLIC_QUERY = "public";

/**
 * Module ids the plugin transforms: a stylesheet imported with `?public`, including the forms Vite
 * gives it on the way (`?public&direct` when the dev server serves it to a <link>, and `?direct&public`).
 */
export const PUBLIC_CSS_ID = /\.css\?(?:[^#]*&)?public(?:[&#=]|$)/;

/**
 * Class names a library puts on public markup at runtime, which no file in this repo spells out.
 * Clerk renders the sign-in and sign-up forms and the account menu with `cl-*` classes (auth.css
 * styles them); lucide-react gives every icon `lucide` and `lucide-<icon name>`.
 */
export const LIBRARY_CLASS_PREFIXES = Object.freeze(["cl-", "lucide"]);

/** The directory whose route files are the public site. Everything they import is public code. */
export const PUBLIC_ROUTE_ROOT = "app/[locale]";

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];
const SCRIPT_FILE = /\.(?:[cm]?[jt]sx?)$/;

function walk(directory) {
  const out = [];
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

// A relative import specifier to the file it names, trying the extensions the bundler would
// (including TypeScript's `./x.js` for ./x.ts).
function resolveImport(specifier, fromFile) {
  const base = resolve(dirname(fromFile), specifier.split("?")[0]);
  const stem = base.replace(/\.[cm]?jsx?$/, "");
  const candidates = [
    base,
    ...SCRIPT_EXTENSIONS.map((ext) => base + ext),
    ...(stem !== base ? SCRIPT_EXTENSIONS.map((ext) => stem + ext) : []),
    ...SCRIPT_EXTENSIONS.map((ext) => join(base, "index" + ext)),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

let typescript;
async function loadTypescript() {
  typescript ??= (await import("typescript")).default;
  return typescript;
}

// tsconfig.json's `paths` (`"@/*": ["./*"]`) as prefix rewrites, so `import X from "@/app/X"` is
// followed like a relative import. Nothing uses the alias today; a public page that started to
// would otherwise hide a component from the scan.
function pathAliases(ts, root) {
  const file = join(root, "tsconfig.json");
  if (!existsSync(file)) return [];
  const { config } = ts.readConfigFile(file, ts.sys.readFile);
  const options = config?.compilerOptions || {};
  const base = join(root, options.baseUrl || ".");
  return Object.entries(options.paths || {}).flatMap(([pattern, targets]) => (pattern.endsWith("*")
    ? targets.filter((target) => target.endsWith("*")).map((target) => ({ from: pattern.slice(0, -1), to: join(base, target.slice(0, -1)) }))
    : []));
}

const WHITESPACE = /\s/;

/**
 * The strings an expression can evaluate to, when it is built from string literals alone (a
 * literal, a ternary between literals, parentheses), or null when it cannot be known statically.
 */
function literalValues(ts, node) {
  if (ts.isParenthesizedExpression(node)) return literalValues(ts, node.expression);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) {
    const whenTrue = literalValues(ts, node.whenTrue);
    const whenFalse = literalValues(ts, node.whenFalse);
    return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null;
  }
  return null;
}

// Whether an expression's value can put a character against the text on its left (side "start": its
// first character) or its right (side "end": its last) with no space between them. Only a value
// built entirely from literals can be shown not to; anything else - a variable, a call, `a && " b"`,
// which renders "false" - is assumed to.
function glues(ts, node, side) {
  if (ts.isParenthesizedExpression(node)) return glues(ts, node.expression, side);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    const text = node.text;
    return text.length > 0 && !WHITESPACE.test(side === "start" ? text[0] : text[text.length - 1]);
  }
  if (ts.isConditionalExpression(node)) return glues(ts, node.whenTrue, side) || glues(ts, node.whenFalse, side);
  if (ts.isTemplateExpression(node)) {
    // ` ${x}` starts with its space whatever x is; `${x} ` ends with one.
    if (side === "start") return node.head.text ? !WHITESPACE.test(node.head.text[0]) : glues(ts, node.templateSpans[0].expression, side);
    const last = node.templateSpans[node.templateSpans.length - 1];
    return last.literal.text ? !WHITESPACE.test(last.literal.text[last.literal.text.length - 1]) : glues(ts, last.expression, side);
  }
  return true;
}

function words(text) {
  return text.split(/\s+/).filter(Boolean);
}

// What separates the identifier-like runs in a string of code or markup - see the header. A class
// name of ours is letters, digits, `-` and `_`; a run of anything else is a quote, a dot, a bracket,
// an `=` or a space between them.
const NOT_IDENTIFIER = /[^A-Za-z0-9_-]+/;

/**
 * Every class name the public site's code can put on an element, read from its source.
 *
 * Returns `{ classes, prefixes, suffixes, files }`: whole class names, the static ends of names
 * built at runtime, and the files they were read from (absolute paths).
 */
export async function scanPublicSource(root, { routeRoot = PUBLIC_ROUTE_ROOT } = {}) {
  const ts = await loadTypescript();
  const aliases = pathAliases(ts, root);
  const classes = new Set();
  const prefixes = new Set();
  const suffixes = new Set();
  const seen = new Set();
  const queue = walk(join(root, routeRoot)).filter((file) => SCRIPT_FILE.test(file));

  const addWords = (text, { prefixAtEnd = false, suffixAtStart = false } = {}) => {
    const list = words(text);
    if (!list.length) return;
    list.forEach((word) => classes.add(word));
    // And every identifier-like run in it, for a class inside a string of code or markup:
    // `classList.add("save-data")` is one whitespace word, and `save-data` only one of its runs.
    for (const run of text.split(NOT_IDENTIFIER)) if (run) classes.add(run);
    if (suffixAtStart && !WHITESPACE.test(text[0])) suffixes.add(list[0]);
    if (prefixAtEnd && !WHITESPACE.test(text[text.length - 1])) prefixes.add(list[list.length - 1]);
  };

  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    const kind = /x$/.test(file) ? ts.ScriptKind.TSX : /\.[cm]?js$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, false, kind);

    // Packages are not followed: what a library renders is its own markup, and the two that put
    // classes on public pages are LIBRARY_CLASS_PREFIXES.
    const follow = (specifier) => {
      const alias = aliases.find((entry) => specifier.startsWith(entry.from));
      const target = specifier.startsWith(".") ? resolveImport(specifier, file)
        : alias ? resolveImport(`./${specifier.slice(alias.from.length)}`, join(alias.to, "index"))
          : null;
      if (target && SCRIPT_FILE.test(target) && !seen.has(target)) queue.push(target);
    };

    // Only a module named by a literal can be followed: `import("./x")` or `import(\`./x\`)`. One whose
    // name is worked out when it runs - `import(\`./sections/${name}\`)`, Vite's
    // `import.meta.glob("./sections/*.ts")` - is a module this cannot find, so its classes would be
    // stripped; tests/public-css.test.mjs fails on either in any file read here.
    const visit = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        follow(node.moduleSpecifier.text);
      } else if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteralLike(node.arguments[0])
        && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        follow(node.arguments[0].text);
      }

      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        addWords(node.text);
      } else if (ts.isTemplateExpression(node)) {
        // `a ${x} b-${y}`: each static chunk offers its words, and a word touching an interpolation
        // that can glue onto it is only the start (or end) of a class.
        const spans = node.templateSpans;
        addWords(node.head.text, { prefixAtEnd: glues(ts, spans[0].expression, "start") });
        spans.forEach((span, index) => {
          const next = spans[index + 1];
          addWords(span.literal.text, {
            suffixAtStart: glues(ts, span.expression, "end"),
            prefixAtEnd: next ? glues(ts, next.expression, "start") : false,
          });
        });
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        // "toast-" + kind, or kind + "-dot". Literal + literal is two literals, visited below.
        const left = literalValues(ts, node.left);
        const right = literalValues(ts, node.right);
        if (left && !right) left.forEach((text) => addWords(text, { prefixAtEnd: true }));
        if (right && !left) right.forEach((text) => addWords(text, { suffixAtStart: true }));
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  // Most of the prefixes and suffixes found this way are not class names at all - URLs, message
  // keys, `${width}w` in a srcset - and cost nothing: no class starts with "/api/" or "?c=". The
  // few that do match a class keep its rules, which is the safe direction to be wrong in.
  return { classes, prefixes, suffixes, files: [...seen].sort() };
}

/** Whether a class name can appear on a public page, per the inventory from scanPublicSource. */
export function isPublicClass(name, inventory) {
  if (inventory.classes.has(name)) return true;
  if (LIBRARY_CLASS_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
  for (const prefix of inventory.prefixes) if (name.startsWith(prefix)) return true;
  for (const suffix of inventory.suffixes) if (name.endsWith(suffix)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Selectors

const IDENT_CHAR = /[A-Za-z0-9_\-\u0080-\uFFFF]/;
const HEX = /[0-9A-Fa-f]/;

// Reads a CSS identifier starting at `start`, decoding escapes: a class with a colon or a bracket in
// its name is written with a backslash before it, and the name is what is compared.
function readIdent(text, start) {
  let value = "";
  let index = start;
  while (index < text.length) {
    const character = text[index];
    if (character === "\\") {
      let hex = "";
      let cursor = index + 1;
      while (hex.length < 6 && cursor < text.length && HEX.test(text[cursor])) hex += text[cursor++];
      if (hex) {
        if (cursor < text.length && /[ \t\n\r\f]/.test(text[cursor])) cursor += 1;
        const code = parseInt(hex, 16);
        value += code === 0 || code > 0x10ffff ? "\uFFFD" : String.fromCodePoint(code);
        index = cursor;
      } else {
        value += text[index + 1] ?? "";
        index += 2;
      }
      continue;
    }
    if (!IDENT_CHAR.test(character)) break;
    value += character;
    index += 1;
  }
  return { value, end: index };
}

// The index of the bracket closing the one at `open`, skipping strings, escapes and nested brackets.
function closing(text, open) {
  const pairs = { "(": ")", "[": "]" };
  const stack = [pairs[text[open]]];
  for (let index = open + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") { index += 1; continue; }
    if (character === '"' || character === "'") {
      for (index += 1; index < text.length && text[index] !== character; index += 1) if (text[index] === "\\") index += 1;
      continue;
    }
    if (pairs[character]) stack.push(pairs[character]);
    else if (character === stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return index;
    }
  }
  return text.length;
}

/** A selector list split at its top-level commas. */
export function splitSelectorList(selector) {
  const parts = [];
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "\\") { index += 1; continue; }
    if (character === '"' || character === "'") {
      for (index += 1; index < selector.length && selector[index] !== character; index += 1) if (selector[index] === "\\") index += 1;
      continue;
    }
    if (character === "(" || character === "[") { index = closing(selector, index); continue; }
    if (character === ",") { parts.push(selector.slice(start, index)); start = index + 1; }
  }
  parts.push(selector.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

// Pseudo-classes whose argument is a selector list the element (or, for :has, a relative) must match.
const MATCHES_ONE_OF = new Set(["is", "where", "matches", "-webkit-any", "-moz-any", "has"]);

/**
 * Whether one complex selector could match an element on a page whose class names all satisfy
 * `isKnown`. False only when the selector requires a class `isKnown` rejects.
 */
export function selectorCanMatch(selector, isKnown) {
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "\\") { index += 1; continue; }
    if (character === '"' || character === "'") {
      for (index += 1; index < selector.length && selector[index] !== character; index += 1) if (selector[index] === "\\") index += 1;
      continue;
    }
    if (character === "[") { index = closing(selector, index); continue; }
    if (character === ".") {
      const { value, end } = readIdent(selector, index + 1);
      if (value && !isKnown(value)) return false;
      index = end - 1;
      continue;
    }
    if (character === ":") {
      let cursor = index + 1;
      if (selector[cursor] === ":") cursor += 1;
      const { value: name, end } = readIdent(selector, cursor);
      if (selector[end] === "(") {
        const close = closing(selector, end);
        const argument = selector.slice(end + 1, close);
        if (MATCHES_ONE_OF.has(name.toLowerCase()) && !splitSelectorList(argument).some((alternative) => selectorCanMatch(alternative, isKnown))) return false;
        // :not(), :nth-child(An+B of S), :host(), ::slotted(), ::part(), :lang()... require nothing.
        index = close;
      } else {
        index = end - 1;
      }
      continue;
    }
  }
  return true;
}

/** Every class a selector names anywhere, :not() included, decoded. For censuses, not decisions. */
export function selectorClasses(selector) {
  const out = [];
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (character === "\\") { index += 1; continue; }
    if (character === '"' || character === "'") {
      for (index += 1; index < selector.length && selector[index] !== character; index += 1) if (selector[index] === "\\") index += 1;
      continue;
    }
    if (character === "[") { index = closing(selector, index); continue; }
    if (character === ".") {
      const { value, end } = readIdent(selector, index + 1);
      if (value) out.push(value);
      index = end - 1;
    }
  }
  return out;
}

/** Whether a rule's whole selector list can match nothing on a public page. */
export function ruleIsOperatorOnly(selector, isKnown) {
  return splitSelectorList(selector).every((part) => !selectorCanMatch(part, isKnown));
}

// At-rules whose blocks hold something other than style rules, which are never looked inside.
const OPAQUE_AT_RULES = new Set(["font-face", "property", "page", "counter-style", "font-feature-values", "font-palette-values", "view-transition", "position-try"]);

// And keyframes, by any name that ends in it: @keyframes, @-webkit-keyframes, @-o-keyframes... A list
// of the prefixed names missed @-o-keyframes, whose `12.5%` stop, read as a selector, needs a class
// named "5": the stop would have been taken out of the animation. No sheet here has one today.
const isOpaque = (name) => /keyframes$/i.test(name) || OPAQUE_AT_RULES.has(name.toLowerCase());

/**
 * `css` without the style rules no public page can match. Returns `{ css, removed }`, where removed
 * lists the selectors taken out, in order.
 */
export function stripOperatorOnly(css, inventory, { from } = {}) {
  const isKnown = (name) => isPublicClass(name, inventory);
  const root = postcss.parse(css, { from });
  const removed = [];
  const visit = (container) => {
    for (const node of [...(container.nodes || [])]) {
      if (node.type === "atrule") {
        if (isOpaque(node.name) || !node.nodes) continue;
        const had = node.nodes.some((child) => child.type !== "comment");
        visit(node);
        // Any block the removals have left with nothing inside applies nothing, and goes - @media,
        // @supports, a container query, @scope, @starting-style. Except @layer, kept even empty: where a
        // layer is first named decides its order. And a block empty before this pass is not this
        // pass's to remove.
        if (had && node.name.toLowerCase() !== "layer" && !node.nodes.some((child) => child.type !== "comment")) node.remove();
      } else if (node.type === "rule") {
        if (ruleIsOperatorOnly(node.selector, isKnown)) {
          removed.push(node.selector);
          node.remove();
        } else {
          visit(node); // nested rules: `&` stands for this rule, which can match
        }
      }
    }
  };
  visit(root);
  return { css: root.toString(), removed };
}
