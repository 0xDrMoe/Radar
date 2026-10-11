import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { code } from "./source.mjs";

// tests/source.mjs strips comments so that source-text assertions read what a file DOES, not what
// its comments say about it. A dozen test files depend on it, and when it removes the wrong bytes
// nothing announces that: it still returns a string, and the assertions downstream simply start
// passing or failing for reasons unrelated to the code under test. Both regexes it used to be
// made of did exactly that, in production, on real files in this repo. Hence a test for the
// helper itself.

test("a URL containing //* does not open a block comment", () => {
  // The exact shape that broke it: worker/index.ts's Content-Security-Policy names Clerk's
  // wildcard host, and the "//*" in that URL was read as a "/*" comment opener. Everything up to
  // the next "*/" anywhere in the file disappeared — two thirds of it.
  const source = [
    'const clerkHosts = "https://*.clerk.accounts.dev";',
    "const afterwards = 1;",
    "/* a genuine comment */",
    "const alsoAfterwards = 2;",
  ].join("\n");
  const out = code(source);
  assert.match(out, /clerkHosts = "https:\/\/\*\.clerk\.accounts\.dev"/, "the URL must survive intact");
  assert.match(out, /const afterwards = 1;/);
  assert.match(out, /const alsoAfterwards = 2;/, "code after the URL must not be swallowed");
  assert.doesNotMatch(out, /a genuine comment/, "a real block comment must still be removed");
});

test("a regex literal ending in an escaped slash does not start a line comment", () => {
  // `/^https:\/\/apps\.apple\.com\//` ends with an escaped slash against the closing delimiter,
  // which puts a literal "//" in the source with no colon before it. The old line-comment regex
  // truncated the line from there, taking the rest of the statement with it.
  const source = "const appStore = /^https:\\/\\/apps\\.apple\\.com\\//;\nconst afterwards = 1;";
  const out = code(source);
  assert.match(out, /apps\\\.apple\\\.com/, "the regex literal must survive intact");
  assert.match(out, /const afterwards = 1;/);
});

test("comment markers inside strings and templates are left alone", () => {
  const source = [
    'const path = "a//b";',
    'const block = "not /* a */ comment";',
    "const template = `x${value}//y`;",
    "const afterwards = 1;",
  ].join("\n");
  const out = code(source);
  assert.match(out, /"a\/\/b"/);
  assert.match(out, /"not \/\* a \*\/ comment"/);
  assert.match(out, /`x\$\{value\}\/\/y`/);
  assert.match(out, /const afterwards = 1;/);
});

test("real comments are still removed", () => {
  const source = [
    "const a = 1; // trailing explanation",
    "/* leading",
    "   explanation */",
    "const b = 2;",
    "/** docblock */",
    "const c = 3;",
  ].join("\n");
  const out = code(source);
  assert.doesNotMatch(out, /explanation/, "both comment styles must go");
  assert.doesNotMatch(out, /docblock/);
  for (const kept of ["const a = 1;", "const b = 2;", "const c = 3;"]) assert.match(out, new RegExp(kept.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("a line comment keeps its newline so line-oriented assertions still line up", () => {
  const out = code("const a = 1; // gone\nconst b = 2;\n");
  assert.equal(out.split("\n").length, 3, "removing a line comment must not join two lines");
});

test("division is not mistaken for a regex in a way that eats a comment", () => {
  // Stylesheets go through this helper too, and `12px/1.5` is a slash that follows a value. If it
  // were read as opening a regex literal, the scanner would hunt for a closing slash and could
  // run past a real comment on the way.
  const out = code("font: 12px/1.5; /* gone */ color: red;");
  assert.match(out, /font: 12px\/1\.5;/);
  assert.match(out, /color: red;/);
  assert.doesNotMatch(out, /gone/);
});

// The regression that started all this: a real file in the repo, checked end to end rather than
// through a synthetic snippet, because the synthetic snippet is what a future rewrite would be
// tempted to keep passing while the real file broke again.
test("worker/index.ts survives with its code intact", () => {
  const raw = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  const out = code(raw);
  for (const construct of [
    "const CACHEABLE_LOCALES",
    "function pageLookup",
    "async function prerenderedPage",
    "function cacheKeyFor",
    'headers.set("Content-Security-Policy"',
    "async scheduled(",
  ]) {
    assert.ok(out.includes(construct), `${construct} must survive comment stripping`);
  }
  assert.doesNotMatch(out, /Colo-level cache for anonymous public pages/, "comment prose must still be removed");
});
