// Every migration stays inside the limits D1 puts on a statement, which are far tighter than the
// SQLite these tests and the prerender run on.
//
// drizzle/0057 passed every test, the build and a local prerender over a production export, then
// failed in CI's apply step: "too many terms in compound SELECT". It inserted nine search terms from
// one SELECT ... UNION ALL SELECT ... list, and D1 (workerd's SQLite) allows five terms in a compound
// SELECT where stock SQLite allows 500. node:sqlite cannot be told D1's limits, so they are checked
// here by reading the SQL: D1 refused the whole file, and nothing ran, but the deploy stopped.
//
// Checked: terms in a compound SELECT (UNION, INTERSECT, EXCEPT) at most 5; a LIKE or GLOB pattern
// at most 50 bytes; a statement at most 100 KB. A multi-row VALUES list is not a compound SELECT to
// SQLite and is not limited (drizzle/0012 inserts 32 rows in one).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const MAX_COMPOUND_TERMS = 5;
const MAX_PATTERN_BYTES = 50;
const MAX_STATEMENT_BYTES = 100_000;

/** Statements of a migration, comments dropped, with each one's string literals listed apart. */
export function statementsOf(sql) {
  const statements = [];
  let text = "", literals = [], literal = null;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (literal !== null) {
      if (c === "'" && sql[i + 1] === "'") { literal += "'"; i++; continue; }
      if (c === "'") { literals.push(literal); text += `'#${literals.length - 1}'`; literal = null; continue; }
      literal += c;
      continue;
    }
    if (c === "'") { literal = ""; continue; }
    if (c === "-" && sql[i + 1] === "-") { while (i < sql.length && sql[i] !== "\n") i++; text += "\n"; continue; }
    if (c === ";") { if (text.trim()) statements.push({ text, literals }); text = ""; literals = []; continue; }
    text += c;
  }
  if (text.trim()) statements.push({ text, literals });
  return statements;
}

const bytes = (value) => Buffer.byteLength(value, "utf8");

function problemsIn(sql) {
  const problems = [];
  for (const { text, literals } of statementsOf(sql)) {
    const terms = (text.match(/\b(UNION|INTERSECT|EXCEPT)\b/gi) || []).length + 1;
    const head = text.trim().replace(/\s+/g, " ").slice(0, 90);
    if (terms > MAX_COMPOUND_TERMS) problems.push(`${terms} terms in one compound SELECT (D1 allows ${MAX_COMPOUND_TERMS}): ${head}`);
    for (const match of text.matchAll(/\b(?:LIKE|GLOB)\s+'#(\d+)'/gi)) {
      const pattern = literals[Number(match[1])];
      if (bytes(pattern) > MAX_PATTERN_BYTES) problems.push(`a ${bytes(pattern)}-byte LIKE/GLOB pattern (D1 allows ${MAX_PATTERN_BYTES}): ${pattern.slice(0, 60)}`);
    }
    const length = bytes(text) + literals.reduce((total, value) => total + bytes(value), 0);
    if (length > MAX_STATEMENT_BYTES) problems.push(`a ${length}-byte statement (D1 allows ${MAX_STATEMENT_BYTES}): ${head}`);
  }
  return problems;
}

test("every migration stays inside D1's statement limits", () => {
  const dir = new URL("../drizzle/", import.meta.url);
  const problems = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) {
    for (const problem of problemsIn(readFileSync(new URL(name, dir), "utf8"))) problems.push(`${name}: ${problem}`);
  }
  assert.deepEqual(problems, []);
});

test("the check catches what D1 refused, and leaves what D1 ran alone", () => {
  const union = (n) => `INSERT INTO t(a) SELECT 'x0' ${Array.from({ length: n - 1 }, (_, i) => `UNION ALL SELECT 'x${i + 1}'`).join(" ")};`;
  // The statement drizzle/0057 first shipped with: nine terms.
  assert.equal(problemsIn(union(9)).length, 1);
  assert.deepEqual(problemsIn(union(5)), []);
  // A keyword inside a string or a comment is not a compound SELECT.
  assert.deepEqual(problemsIn("UPDATE t SET note = 'union all union all union all union all union all union'; -- UNION UNION UNION UNION UNION"), []);
  // Nor is a multi-row VALUES list.
  assert.deepEqual(problemsIn(`INSERT INTO t(a) VALUES ${Array.from({ length: 40 }, (_, i) => `('${i}')`).join(",")};`), []);
  assert.equal(problemsIn(`SELECT 1 FROM t WHERE a LIKE '${"x".repeat(51)}';`).length, 1);
  assert.deepEqual(problemsIn("SELECT 1 FROM t WHERE a LIKE '%0056%';"), []);
});
