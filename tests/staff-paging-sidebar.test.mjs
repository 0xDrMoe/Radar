import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

// The staff workspace's paging and its sidebar width rule. Both are sliced out of the shipped
// modules rather than re-implemented, so these fail if the real rules change and this file does not.
async function loadPure(path, stopAt) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const pure = (stopAt ? source.slice(0, source.indexOf(stopAt)) : source)
    .replace('"use client";', "")
    .replace(/^import .*$/gm, "");
  return import(
    `data:text/javascript;base64,${Buffer.from(
      ts.transpileModule(pure, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
    ).toString("base64")}`
  );
}

const scope = await loadPure("../app/(operator)/ListScope.tsx", "export function ListToolbar");
const sidebar = await loadPure("../app/(operator)/admin/StaffSidebar.tsx", "function readStored");

const rows = Array.from({ length: 60 }, (_, i) => i + 1);

test("a list is cut into pages of the shared size, and says where the reader is", () => {
  assert.equal(scope.LIST_PAGE_SIZE, 25);
  const first = scope.pageRows(rows, 1);
  assert.deepEqual([first.page, first.pageCount, first.first, first.last, first.rows.length], [1, 3, 1, 25, 25]);
  assert.equal(scope.pageRangeLabel(first, "account"), "1–25 of 60 accounts");
  const last = scope.pageRows(rows, 3);
  assert.deepEqual([last.first, last.last, last.rows[0], last.rows.at(-1)], [51, 60, 51, 60]);
  assert.equal(scope.pageRangeLabel(last, "person", "people"), "51–60 of 60 people");
});

test("a page out of range lands on a real page, never an empty one", () => {
  // A filter that shrinks the list under a later page shows its last page.
  assert.equal(scope.pageRows(rows, 9).page, 3);
  assert.equal(scope.pageRows(rows, 0).page, 1);
  assert.equal(scope.pageRows(rows, Number.NaN).page, 1);
  const empty = scope.pageRows([], 4);
  assert.deepEqual([empty.page, empty.pageCount, empty.first, empty.last], [1, 1, 0, 0]);
  assert.equal(scope.pageRangeLabel(empty, "report"), "No reports");
  assert.equal(scope.pageRangeLabel(scope.pageRows(rows.slice(0, 7), 1), "deal"), "All 7 deals");
});

test("the sidebar's width is always inside its limits", () => {
  assert.equal(sidebar.clampSidebarWidth(10), sidebar.SIDEBAR_MIN);
  assert.equal(sidebar.clampSidebarWidth(5000), sidebar.SIDEBAR_MAX);
  assert.equal(sidebar.clampSidebarWidth("300"), 300);
  assert.equal(sidebar.clampSidebarWidth(301.6), 302);
  for (const junk of [null, undefined, "", "wide", Number.NaN, {}]) assert.equal(sidebar.clampSidebarWidth(junk), sidebar.SIDEBAR_DEFAULT);
  assert.ok(sidebar.SIDEBAR_MIN <= sidebar.SIDEBAR_DEFAULT && sidebar.SIDEBAR_DEFAULT <= sidebar.SIDEBAR_MAX);
});

test("every staff list is paged", async () => {
  // How many lists each file pages. A count, not a yes/no, so a list dropped in a refactor shows up.
  const pagers = {
    "tabs/DealsTab": 1, "tabs/RestaurantsTab": 1, "tabs/UsersTab": 1, "tabs/MailTab": 2, "tabs/FeedbackTab": 1,
    "tabs/ReportsTab": 1, "tabs/CampaignsTab": 3, "tabs/SuggestionsTab": 1, "tabs/SponsorshipsTab": 1,
    "tabs/AffiliatesTab": 6, "tabs/AdministrationTab": 2, "tabs/OverviewTab": 1, "tabs/CoverageTab": 1,
    "tabs/DirectoryTab": 1, "tabs/GrowthTab": 9, DraftReview: 1, StaffReminders: 1, RestaurantEditsQueue: 1,
    DrinkRuleAlerts: 1, FinancePanels: 2,
  };
  for (const [file, count] of Object.entries(pagers)) {
    const source = await readFile(new URL(`../app/(operator)/admin/${file}.tsx`, import.meta.url), "utf8");
    assert.ok((source.match(/<Pager /g) || []).length >= count, `${file} should page ${count} list(s)`);
    assert.doesNotMatch(source, /ShowAllRow|Show all \{/, `${file} still dumps a whole list`);
  }
  // The overview's review groups page instead of expanding, and the Growth top lists are no longer cut at 10.
  const overview = await readFile(new URL("../app/(operator)/admin/tabs/OverviewTab.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(overview, /GROUP_PREVIEW|reviewExpanded/);
  const growth = await readFile(new URL("../app/(operator)/admin/tabs/GrowthTab.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(growth, /previewCount|countries\)\.slice\(/);
});

test("staff times show minutes, with seconds only on hover", async () => {
  const ui = await readFile(new URL("../app/(operator)/admin/ui.tsx", import.meta.url), "utf8");
  assert.match(ui, /exact: \{ dateStyle: "full", timeStyle: "long" \}/);
  for (const [name, options] of ui.matchAll(/^ {2}(dateTime|long|time|date): (\{[^}]*\})/gm)) {
    assert.doesNotMatch(options, /second|timeStyle: "(medium|long|full)"/, `${name} shows seconds`);
  }
  const tabs = ["FeedbackTab", "ReportsTab", "AdministrationTab", "AuditTab", "MailTab"];
  for (const tab of tabs) {
    const source = await readFile(new URL(`../app/(operator)/admin/tabs/${tab}.tsx`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.toLocaleString\(\)/, `${tab} prints a time with seconds`);
  }
});
