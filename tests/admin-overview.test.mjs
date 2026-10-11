// The staff workspace's Overview and Market coverage tabs: what each role is shown, where its links
// go, and how the coverage hierarchy adds up. The overview's panels must follow what the server
// sends a role (app/api/admin/route.ts), never draw an empty chart as if it were a zero, and never
// send staff, who have no repository access, to a file under docs/.
import assert from "node:assert/strict";
import test from "node:test";
import { buildCoverageTree, stalePercent } from "../app/(operator)/admin/coverage-tree.ts";
import { adminSource, code } from "./source.mjs";

const overview = code(adminSource("tabs/OverviewTab.tsx"));
const coverage = code(adminSource("tabs/CoverageTab.tsx"));
const drinkRules = code(adminSource("DrinkRuleAlerts.tsx"));
const reminders = code(adminSource("StaffReminders.tsx"));

const node = (overrides) => ({ country: "CA", region: "ON", city: "Ottawa", postal_area: "K1P", deals: 1, live: 1, drafts: 0, restaurants: 1, stale: 0, ...overrides });

test("coverage rolls every level up from the postal areas below it", () => {
  const { roots, totals } = buildCoverageTree([
    node({ postal_area: "K1P", deals: 4, live: 3, drafts: 1, restaurants: 3, stale: 1 }),
    node({ postal_area: "K2A", deals: 2, live: 2, drafts: 0, restaurants: 2, stale: 1 }),
    node({ region: "QC", city: "Gatineau", postal_area: "J8X", deals: 1, live: 0, drafts: 1, restaurants: 1 }),
    node({ country: "US", region: "TN", city: "Knoxville", postal_area: "379", deals: 5, live: 5, restaurants: 4 }),
  ]);
  assert.deepEqual(totals, { deals: 12, live: 10, drafts: 2, stale: 2, restaurants: 10 });
  const canada = roots.find((root) => root.value === "CA");
  assert.equal(canada.totals.deals, 7);
  assert.deepEqual(canada.children.map((region) => [region.value, region.totals.deals]), [["ON", 6], ["QC", 1]], "biggest first");
  const ottawa = canada.children[0].children[0];
  assert.equal(ottawa.level, "city");
  assert.deepEqual(ottawa.children.map((area) => area.place), [
    { country: "CA", region: "ON", city: "Ottawa", postal: "K1P" },
    { country: "CA", region: "ON", city: "Ottawa", postal: "K2A" },
  ]);
  assert.equal(stalePercent(ottawa.totals), 33);
  assert.equal(stalePercent({ deals: 0, stale: 0 }), 0);
});

test("a place that was not recorded stays blank and sorts last, never guessed", () => {
  const { roots } = buildCoverageTree([
    node({ region: "", city: "Ottawa", deals: 9 }),
    node({ region: "ON", city: "Toronto", deals: 1 }),
  ]);
  const regions = roots[0].children;
  assert.deepEqual(regions.map((region) => region.value), ["ON", ""], "the unrecorded province goes last even with more deals");
  assert.equal(regions[1].children[0].value, "Ottawa", "the city under it is kept as recorded");
  assert.match(coverage, /region: "Province or state not recorded"/);
  assert.match(coverage, /city: "City not recorded"/);
});

test("the coverage tab filters by place and opens the inventory at a city or postal area", () => {
  assert.match(coverage, /data\.coverageTree/);
  assert.match(coverage, /<GeoFilter /);
  assert.match(coverage, /openTab\("deals", link\)/);
  assert.match(coverage, /node\.level === "city" && node\.value\) return geoQuery\(/);
  assert.match(coverage, /node\.level === "postal" && node\.value\) return geoQuery\(/);
  assert.match(coverage, /Brand-wide and national offers have no single place/);
  // The launch markets keep their targets and empty searches.
  assert.match(coverage, /data\.coverage\b/);
  assert.match(coverage, /minimum_offers/);
  assert.match(coverage, /zero_result_searches/);
});

test("the overview carries no service configuration and no market grid", () => {
  for (const gone of [/integrations/, /Mapbox/, /Resend/, /Email pilot/, /data\.coverage\b/]) assert.doesNotMatch(overview, gone);
});

test("each overview chart is drawn only for a role the server sends its data to", () => {
  // The same gates as the trends block of app/api/admin/route.ts.
  assert.match(overview, /const canSeeSignups = permissions\.has\("manage_users"\) \|\| canViewAnalytics;/);
  assert.match(overview, /\{canSeeSignups && \(\s*<DailyActivityChart\s+title="Signups"/);
  assert.match(overview, /\{canViewAnalytics && \(\s*<DailyActivityChart\s+title="Tracked site activity"/);
});

test("drink-rule alerts point to the Staff Handbook, not to a repository file", () => {
  assert.match(drinkRules, /"\/admin\/help#drink-rules"/);
  assert.match(drinkRules, /openTab\("help", "#drink-rules"\)/);
  assert.doesNotMatch(drinkRules, /docs\//);
  assert.doesNotMatch(overview, /docs\//);
});

test("Renew or confirm says what each action does and what happens after", () => {
  for (const term of ["Renew (Edit)", "End date is right", "Still right", "Review / Done"]) assert.ok(reminders.includes(`<dt>${term}</dt>`), term);
  assert.match(reminders, /The reminder closes now and the deal leaves search \{EXPIRY_GRACE_PERIOD_DAYS\} days after it ends\./);
  assert.match(reminders, /closes on its own within the hour/);
});
