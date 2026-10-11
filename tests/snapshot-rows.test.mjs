// The deals snapshot's rows (app/deals-snapshot-rows.ts): a deal sent as an array of its values and
// rebuilt by an object literal, so a cold isolate parses each field name once instead of once per
// deal.
//
// The literal is written by hand, and a deal's fields are whatever `SELECT d.*` returns, so the two
// can drift. Drift is safe - a deal that is not exactly ROW_FIELDS travels as an object, as every
// deal did before - but it silently gives the saving back, which is what the last test is for.
import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase } from "./route-harness.mjs";
import { code } from "./source.mjs";
import { readFileSync } from "node:fs";

const { ROW_FIELDS, baseRow, rowBase } = await import("../app/deals-snapshot-rows.ts");

// A deal with every field, each holding something only it holds.
const sample = () => Object.fromEntries(ROW_FIELDS.map((field, i) => [field, i % 3 === 0 ? null : i % 3 === 1 ? `${field}-value` : i]));

test("the literal names every field once, in the list's order", () => {
  const rebuilt = rowBase(ROW_FIELDS.map((_, i) => i));
  assert.deepEqual(Object.keys(rebuilt), [...ROW_FIELDS]);
  assert.deepEqual(Object.values(rebuilt), ROW_FIELDS.map((_, i) => i));
  assert.equal(new Set(ROW_FIELDS).size, ROW_FIELDS.length, "no field twice");
});

test("a deal comes back from its row as the same JSON, field order included", () => {
  const deal = sample();
  const row = JSON.parse(JSON.stringify(baseRow(deal)));
  assert.equal(row.length, ROW_FIELDS.length);
  assert.equal(JSON.stringify(rowBase(row)), JSON.stringify(deal));
});

test("a deal of any other shape is not made a row", () => {
  assert.equal(baseRow({ ...sample(), footprint_regions: ["ON"] }), null, "a field more");
  const { emoji: _emoji, ...fewer } = sample();
  assert.equal(baseRow(fewer), null, "a field fewer");
  const { id, restaurant, ...rest } = sample();
  assert.equal(baseRow({ restaurant, id, ...rest }), null, "the same fields in another order");
  assert.equal(baseRow({ ...sample(), terms: undefined }), null, "an undefined, which JSON would write as null in a row and leave out of an object");
  const { chain_locations: _locations, ...renamed } = sample();
  assert.equal(baseRow({ ...renamed, locations: [] }), null, "the right number of fields under another name");
});

test("a row of the wrong length is refused, not rebuilt with holes", () => {
  assert.equal(rowBase(new Array(ROW_FIELDS.length - 1).fill(0)), null);
  assert.equal(rowBase(new Array(ROW_FIELDS.length + 1).fill(0)), null);
});

test("the route sends rows, reads both, and says which version does", () => {
  const route = code(readFileSync(new URL("../app/api/deals/route.ts", import.meta.url), "utf8"));
  assert.match(route, /return baseRow\(deal\) \?\? deal;/);
  assert.match(route, /const base = Array\.isArray\(entry\) \? rowBase\(entry\) : entry;\s*if \(!base \|\| typeof base !== "object"\) return null;/);
  assert.ok(Number(/^const SNAPSHOT_CACHE_VERSION = (\d+)/m.exec(route)?.[1]) >= 9, "a reader older than version 9 would take a row for a deal");
});

// `SELECT d.*` leads the snapshot's select, so the deals table's columns are the first fields of
// every deal, in the table's order. A migration that adds a column makes every deal a field longer:
// still served, as objects, with the cold-start saving gone. Add the column to ROW_FIELDS and to
// rowBase's literal, at the same place.
test("ROW_FIELDS begins with the deals table's columns, as the migrations leave them", () => {
  const db = freshDatabase();
  const columns = db.prepare("SELECT name FROM pragma_table_info('deals') ORDER BY cid").all().map((row) => row.name);
  db.close();
  assert.ok(columns.length > 30, "expected the deals table");
  assert.deepEqual(ROW_FIELDS.slice(0, columns.length), columns);
});
