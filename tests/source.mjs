import { readdirSync, readFileSync } from "node:fs";

/**
 * A source file with its comments removed.
 *
 * Several tests here assert about what a file *does* — the copy on a paywall, the route a locked
 * control takes, the value a failed write puts back. A comment explaining why the accent picker
 * must not link to radar.cheap is not a link to radar.cheap, and a comment about not hardcoding a
 * price is not a hardcoded price. Reading the raw text makes the explanation the bug, which
 * punishes exactly the commenting this codebase is written in.
 *
 * Comments also push code apart: a proximity assertion like "the catch puts the old value back"
 * fails on a three-line comment sitting between the two, for no reason a reader would accept.
 *
 * This used to be two regexes, and both of them silently ate source:
 *
 *   - `/\/\*[\s\S]*?\*\//g` treated any `/*` as a comment opener, including the one inside
 *     "https://*.clerk.accounts.dev" — the `//*` in that URL. Everything from there to the next
 *     `*\/` anywhere in the file vanished, which took two thirds of worker/index.ts with it.
 *   - `/(^|[^:])\/\/.*$/gm` had an `[^:]` guard so `https://` survived, but nothing protected a
 *     regex literal: `/^https:\/\/apps\.apple\.com\//` ends `\//`, an escaped slash against the
 *     closing delimiter, and the line was truncated from there.
 *
 * Both failures are silent. The helper returns a string either way, and an assertion against a
 * file that lost half its body fails — or passes — for reasons that have nothing to do with the
 * code under test. Another lookbehind would only hold until the next URL or regex shaped
 * differently, so this walks the source instead, tracking whether each `/` is inside a string, a
 * template literal, a regex literal, or actual code.
 *
 * It is still not a parser, and it does not need to be. Only comments are removed; everything
 * else is copied through byte for byte. So mistaking a division for a regex costs nothing on its
 * own — the characters are emitted either way. The scanner only has to be right about where a
 * comment genuinely starts.
 */

// Characters after which a `/` begins a regex literal rather than a division. This is the
// standard heuristic: division follows a value, a regex follows an operator or a delimiter.
const REGEX_ALLOWED_AFTER = new Set([..."(,=:[!&|?{};+-*%~^<>", ""]);
// Keywords that can be followed by a regex literal, where the character before the `/` is a
// letter and so would otherwise look like the end of a value.
const REGEX_ALLOWED_KEYWORDS = /(?:^|[^\w$])(?:return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;

function startsRegex(source, index) {
  let back = index - 1;
  while (back >= 0 && /\s/.test(source[back])) back -= 1;
  const previous = back >= 0 ? source[back] : "";
  if (REGEX_ALLOWED_AFTER.has(previous)) return true;
  return REGEX_ALLOWED_KEYWORDS.test(source.slice(0, back + 1));
}

// A regex literal cannot span a line, so requiring the closing delimiter on the same line keeps a
// misread division (`12px/1.5` in a stylesheet, say) from swallowing the rest of the file looking
// for a partner that was never there.
function regexEnd(source, index) {
  let inClass = false;
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "\\") { cursor += 1; continue; }
    if (character === "\n") return -1;
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) return cursor;
  }
  return -1;
}

function stringEnd(source, index, quote) {
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (character === "\\") { cursor += 1; continue; }
    if (character === quote) return cursor;
    // An unterminated single- or double-quoted string is a syntax error, not something to scan
    // past — stopping at the newline keeps one from consuming the rest of the file.
    if (character === "\n" && quote !== "`") return -1;
  }
  return -1;
}

export function code(source) {
  let out = "";
  let cursor = 0;
  // Depth of `${ ... }` interpolations currently open, so a template literal's expression parts
  // are scanned as code (they can hold their own strings, regexes and comments) while its text
  // parts are not.
  const templateStack = [];
  while (cursor < source.length) {
    const character = source[cursor];
    const next = source[cursor + 1];

    if (character === "/" && next === "/") {
      // Line comment: drop through to the newline, which is kept so line numbers and any
      // line-oriented assertion still line up.
      const newline = source.indexOf("\n", cursor);
      cursor = newline === -1 ? source.length : newline;
      continue;
    }

    if (character === "/" && next === "*") {
      const close = source.indexOf("*/", cursor + 2);
      cursor = close === -1 ? source.length : close + 2;
      continue;
    }

    if (character === "/" && startsRegex(source, cursor)) {
      const end = regexEnd(source, cursor);
      if (end !== -1) {
        out += source.slice(cursor, end + 1);
        cursor = end + 1;
        continue;
      }
    }

    if (character === '"' || character === "'") {
      const end = stringEnd(source, cursor, character);
      if (end !== -1) {
        out += source.slice(cursor, end + 1);
        cursor = end + 1;
        continue;
      }
    }

    if (character === "`") {
      templateStack.push(0);
      out += character;
      cursor += 1;
      // Copy the literal text of the template until it ends or an interpolation opens.
      while (cursor < source.length && templateStack.length) {
        const inner = source[cursor];
        if (inner === "\\") { out += source.slice(cursor, cursor + 2); cursor += 2; continue; }
        if (inner === "`") { templateStack.pop(); out += inner; cursor += 1; break; }
        if (inner === "$" && source[cursor + 1] === "{") { out += "${"; cursor += 2; break; }
        out += inner;
        cursor += 1;
      }
      continue;
    }

    if (character === "}" && templateStack.length) {
      // Closing an interpolation returns to the template's text, which resumes on the next pass
      // through the loop only if this really was the interpolation's own brace.
      out += character;
      cursor += 1;
      let depth = templateStack[templateStack.length - 1];
      if (depth > 0) {
        templateStack[templateStack.length - 1] = depth - 1;
      } else {
        templateStack.pop();
        // Back into template text.
        while (cursor < source.length) {
          const inner = source[cursor];
          if (inner === "\\") { out += source.slice(cursor, cursor + 2); cursor += 2; continue; }
          if (inner === "`") { out += inner; cursor += 1; break; }
          if (inner === "$" && source[cursor + 1] === "{") { out += "${"; cursor += 2; templateStack.push(0); break; }
          out += inner;
          cursor += 1;
        }
      }
      continue;
    }

    if (character === "{" && templateStack.length) {
      templateStack[templateStack.length - 1] += 1;
    }

    out += character;
    cursor += 1;
  }
  return out;
}

const ADMIN_DIR = new URL("../app/(operator)/admin/", import.meta.url);

/**
 * The staff workspace's client, as one string.
 *
 * It used to be a single file, AdminClient.tsx. It is now a shell, a shared context, the deal
 * editor, the types and helpers they share, and one file per tab under tabs/. An assertion about
 * "somewhere in the admin client" reads this; one about a particular tab or the shell reads that
 * file with adminSource(). Raw text, in a stable order: wrap it in code() to drop comments.
 */
export const ADMIN_CLIENT_FILES = [
  "AdminClient.tsx",
  "workspace.tsx",
  "DealEditor.tsx",
  "types.ts",
  "format.ts",
  // The money panels the Admin tab lays out; they used to be the bottom half of the Growth tab.
  "FinancePanels.tsx",
  ...readdirSync(new URL("tabs/", ADMIN_DIR)).filter((name) => name.endsWith(".tsx")).sort().map((name) => `tabs/${name}`),
];

/** One file of the staff workspace's client, raw, by its path under app/(operator)/admin/. */
export function adminSource(path) {
  return readFileSync(new URL(path, ADMIN_DIR), "utf8");
}

export function adminClientSource() {
  return ADMIN_CLIENT_FILES.map(adminSource).join("\n");
}

const DASHBOARD_DIR = new URL("../app/[locale]/dashboard/", import.meta.url);

/**
 * The personal dashboard's client, as one string, in the same way as adminClientSource().
 *
 * It used to be a single file, DashboardClient.tsx. It is now a shell (data, nav, notices), the
 * pieces the sections share (dashboard-shared.tsx), and one file per section under sections/. An
 * assertion about "somewhere on the dashboard" reads this; one about a particular section reads that
 * file with dashboardSource().
 */
export const DASHBOARD_CLIENT_FILES = [
  "DashboardClient.tsx",
  "dashboard-shared.tsx",
  ...readdirSync(new URL("sections/", DASHBOARD_DIR)).filter((name) => name.endsWith(".tsx")).sort().map((name) => `sections/${name}`),
];

/** One file of the dashboard's client, raw, by its path under app/[locale]/dashboard/. */
export function dashboardSource(path) {
  return readFileSync(new URL(path, DASHBOARD_DIR), "utf8");
}

export function dashboardClientSource() {
  return DASHBOARD_CLIENT_FILES.map(dashboardSource).join("\n");
}
