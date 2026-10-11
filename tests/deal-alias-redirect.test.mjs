// A duplicate listing folded into another keeps its row, archived, with a deal_aliases row naming
// the one kept. Its old address matched both rows, and the page's `LIMIT 1` took whichever SQLite
// read first - the archived twin - so a shared link said "no longer available" for an offer that
// is live one row over. These run the page's own lookup against SQLite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { registerHooks } from "node:module";
import { code } from "./source.mjs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?[jt]sx?$/.test(specifier)) specifier += ".ts";
    return nextResolve(specifier, context);
  },
});
const { dealPageVisibility, publicDealPredicate } = await import("../app/deal-lifecycle.ts");

const page = code(readFileSync(new URL("../app/[locale]/deals/[slug]/page.tsx", import.meta.url), "utf8"));

// The lookup exactly as the page runs it, with the joins it needs for nothing here left out.
function lookup() {
  const source = page.match(/const getDeal = cache\(async \(slug:string\) => \{\s*return env\.DB\.prepare\(`([\s\S]*?)`\)\.bind\(([^)]*)\)/);
  assert.ok(source, "getDeal's query is where this test reads it");
  const binds = source[2].split(",").length;
  const sql = source[1]
    .replace("${dealPageVisibility}", dealPageVisibility)
    .replace("${publicDealPredicate}", publicDealPredicate)
    .replace(/,r\.name canonical_restaurant[\s\S]*?other_branches\s*/, " ")
    .replace(/LEFT JOIN restaurants r ON r\.id=d\.restaurant_id LEFT JOIN restaurant_locations l ON l\.id=d\.location_id/, "");
  assert.doesNotMatch(sql, /\$\{/);
  return { sql, binds };
}

function catalogue() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE deals (id text PRIMARY KEY, slug text, status text, active integer, deleted_at text, publish_at text);
    CREATE TABLE deal_aliases (alias_id text PRIMARY KEY, canonical_deal_id text NOT NULL, created_at text);
    INSERT INTO deals VALUES ('stlouis-bank-wings-twin','stlouis-bank-wings-twin','archived',0,NULL,NULL);
    INSERT INTO deals VALUES ('stlouis-bank-wings','stlouis-bank-wings','live',1,NULL,NULL);
    INSERT INTO deals VALUES ('deal-00000000-0000-4000-8000-000000000001','old-slug-twin','archived',0,NULL,NULL);
    INSERT INTO deals VALUES ('retired-alone','retired-alone','archived',0,NULL,NULL);
    INSERT INTO deal_aliases VALUES ('stlouis-bank-wings-twin','stlouis-bank-wings',NULL);
    INSERT INTO deal_aliases VALUES ('deal-00000000-0000-4000-8000-000000000001','stlouis-bank-wings',NULL);`);
  return db;
}

test("an alias's address finds the deal kept, and says it came by the alias", () => {
  const { sql, binds } = lookup();
  const db = catalogue();
  const find = (slug) => db.prepare(sql).get(...Array(binds).fill(slug));
  // The archived twin's own slug: both rows match, and the live one wins.
  const twin = find("stlouis-bank-wings-twin");
  assert.equal(twin.id, "stlouis-bank-wings");
  assert.equal(twin.page_visibility, "public");
  assert.equal(twin.via_alias, 1);
  // An alias recorded by id, reached by the retired row's slug.
  assert.equal(find("old-slug-twin").id, "stlouis-bank-wings");
  assert.equal(find("old-slug-twin").via_alias, 1);
  // The kept deal's own address is not a redirect.
  assert.equal(find("stlouis-bank-wings").via_alias, 0);
  // A retired deal with no alias keeps its page, with the banner.
  const alone = find("retired-alone");
  assert.equal(alone.page_visibility, "retired");
  assert.equal(alone.via_alias, 0);
  assert.equal(find("never-existed"), undefined);
});

test("the page redirects an alias to the kept deal's own address", () => {
  assert.match(page, /import \{ notFound, permanentRedirect \} from "next\/navigation"/);
  assert.match(page, /if \(deal\.via_alias\) \{[\s\S]{0,400}permanentRedirect\(`\/\$\{locale\}\/deals\/\$\{encodeURIComponent\(deal\.slug \|\| deal\.id\)\}/);
});
