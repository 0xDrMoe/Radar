import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { adminClientSource, code } from "./source.mjs";

// The admin sidebar's grouping.
//
// Grouping a list of links is the kind of change that looks purely cosmetic and quietly isn't:
// the group a tab belongs to now lives in one file and the link itself in another, so a tab can
// be filed under a heading that never builds a link, or built as a link that no heading lists —
// and either way it disappears from the sidebar without anything failing. Both are asserted
// here. So is the case the grouping introduced: a role that can see nothing under a heading must
// not be shown the heading, because a label over empty space reads as broken rather than as
// withheld.

const load = async (path) => {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
};

const { adminTabs, adminNavGroups, adminPageTitle, groupNavLinks, tabTitleFor, tabBlurbFor } = await load("../app/(operator)/admin/sections.ts");
const { allArticles } = await load("../app/(operator)/admin/handbook.ts");
// The shell, which builds the sidebar and the header; the copy checks below read every file.
const adminClient = code(await readFile(new URL("../app/(operator)/admin/AdminClient.tsx", import.meta.url), "utf8"));
const adminClientAll = code(adminClientSource());
const portalCss = await readFile(new URL("../app/portal.css", import.meta.url), "utf8");

// The sidebar's <nav> carries a name ("Staff workspace"), so it is found by its opening, not "<nav>".
const sidebar = adminClient.slice(adminClient.indexOf("<nav"), adminClient.indexOf("</aside>"));
const nav = sidebar.slice(0, sidebar.indexOf("</nav>"));
const filedTabs = adminNavGroups.flatMap((group) => group.tabs);

test("every tab is filed in exactly one group, and the handbook in none", () => {
  assert.equal(new Set(filedTabs).size, filedTabs.length, "a tab is filed under two headings");
  for (const tab of adminTabs) {
    if (tab === "help") {
      assert.ok(!filedTabs.includes(tab), "the handbook belongs with the ways out, not in the nav");
      continue;
    }
    assert.ok(filedTabs.includes(tab), `"${tab}" is in no sidebar group, so nothing in the sidebar links to it`);
  }
});

test("every group the sidebar files a tab under actually builds a link for it", () => {
  // The other half of the same failure: sections.ts decides the headings and their order,
  // AdminClient builds the links. A tab present in one and absent from the other is invisible.
  const table = adminClient.slice(adminClient.indexOf("const navLinkFor"), adminClient.indexOf("</nav>"));
  for (const tab of filedTabs) {
    assert.ok(table.includes(`tab: "${tab}"`), `the sidebar files "${tab}" under a heading but never builds a link for it`);
  }
});

test("a heading has to be earning its space", () => {
  // One link under a label of its own is a label doing nothing but taking up room in a 250px rail.
  for (const group of adminNavGroups) {
    assert.ok(group.tabs.length >= 2, `"${group.label}" groups only ${group.tabs.length} link`);
    assert.ok(group.label.length <= 20, `"${group.label}" is too long for the sidebar's width`);
  }
  const ids = adminNavGroups.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length, "two groups share an id, so React sees one key twice");
});

test("every part of the workspace has something written about it", () => {
  // The handbook is filed by role and the sidebar by area, so the two meet through the area each
  // article names. A group with no article behind it is a part of the workspace nobody was told
  // how to use; an article naming an area that no longer exists is a chip pointing nowhere.
  const areas = new Set(adminNavGroups.map((group) => group.id));
  const covered = new Set();
  for (const { article } of allArticles()) {
    if (!article.area) continue;
    assert.ok(areas.has(article.area), `"${article.id}" is filed under area "${article.area}", which is not a sidebar group`);
    covered.add(article.area);
  }
  for (const area of areas) {
    assert.ok(covered.has(area), `nothing in the handbook covers the "${area}" part of the workspace`);
  }
});

test("every tab opens under its own name, not the last one in a chain", () => {
  // The heading and the line beneath it were both ternary chains ending in the audit log, so
  // affiliates, growth and the handbook itself each opened wearing the audit log's name and
  // description. A total lookup cannot fall through.
  for (const tab of adminTabs) {
    assert.ok(tabTitleFor(tab).length > 2, `"${tab}" has no heading`);
    assert.ok(tabBlurbFor(tab).length > 20, `"${tab}" has no description`);
  }
  for (const tab of ["help", "affiliates", "growth"]) {
    assert.notEqual(tabTitleFor(tab), tabTitleFor("audit"), `"${tab}" is still wearing the audit log's name`);
    assert.notEqual(tabBlurbFor(tab), tabBlurbFor("audit"), `"${tab}" is still wearing the audit log's description`);
  }
  assert.match(adminClient, /<h1>\{tabTitleFor\(tab\)\}<\/h1>/);
  assert.match(adminClient, /<p>\{tabBlurbFor\(tab\)\}<\/p>/);
  assert.ok(!/: "Audit log"\}/.test(adminClientAll), "the heading must not fall through to the audit log again");
});

test("the workspace is not named after one of the roles in it", () => {
  // "Admin" is one role out of six. A deal editor, a moderator and an analyst all open this
  // place, and calling the whole of it Admin tells each of them they are somewhere they are not.
  assert.match(adminClient, /workspace-label">STAFF WORKSPACE/);
  assert.ok(!/ADMIN WORKSPACE/.test(adminClientAll), "the sidebar should not name the place after one role");
  assert.ok(!/the admin workspace/i.test(adminClientAll), "nor should the copy the reader sees");
  assert.match(adminPageTitle("help"), /Staff workspace/, "nor the browser tab");
});

test("a group nobody can see anything in is not rendered at all", () => {
  // An analyst holds read_admin and nothing else, so only the ungated links are ever built. They
  // must not be shown "Moderation" or "Access & records" over empty space.
  const analyst = [{ tab: "overview" }, { tab: "deals" }, { tab: "ended" }, { tab: "restaurants" }, { tab: "campaigns" }];
  const grouped = groupNavLinks(analyst);
  assert.deepEqual(grouped.map((entry) => entry.group.id), ["catalog", "commerce"]);
  for (const entry of grouped) assert.ok(entry.links.length > 0, `"${entry.group.label}" rendered with nothing under it`);
  // And the degenerate case: somebody whose links are all gated gets no headings whatsoever
  // rather than four labels and nothing else.
  assert.deepEqual(groupNavLinks([]), []);
});

test("the order of the sidebar is the order of the command palette", () => {
  const grouped = groupNavLinks(adminTabs.filter((tab) => tab !== "help").map((tab) => ({ tab })));
  assert.deepEqual(grouped.map((entry) => entry.group.id), adminNavGroups.map((group) => group.id));
  assert.deepEqual(grouped.flatMap((entry) => entry.links.map((link) => link.tab)), filedTabs);
  // adminTabs drives the palette's list. Keeping the two in step means somebody who learned the
  // sidebar does not have to learn a second order to use the keyboard.
  assert.deepEqual([...adminTabs], [...filedTabs, "help"]);
});

test("the handbook sits between the two ways out, highlighted and ungated", () => {
  const dashboard = sidebar.indexOf('href="/dashboard"');
  const handbook = sidebar.indexOf('href="/admin/help"');
  const away = sidebar.indexOf("Back to Radar");
  assert.ok(dashboard > -1 && handbook > -1 && away > -1, "the sidebar should still hold all three");
  assert.ok(dashboard < handbook && handbook < away, "the handbook belongs between the personal dashboard and the way out");
  assert.match(sidebar, /backlink nav-handbook/, "the handbook link has to carry the class that highlights it");
  // Every other conditional entry in this sidebar is wrapped in a permission check. This one is
  // deliberately not: the person most likely to need it is the one with the fewest permissions.
  assert.ok(!sidebar.slice(dashboard, away).includes("&&"), "the handbook link must not be permission-gated");
  assert.ok(!nav.includes("help"), "the handbook must not also appear in the nav");
});

test("nav links route through tabPath rather than repeating their own paths", () => {
  assert.match(nav, /href=\{tabPath\(link\.tab\)\}/);
  assert.ok(!/href="\/admin/.test(nav), "a hardcoded path here is a dead link the day a route is renamed");
});

test("the highlight and the group labels resolve, and survive the narrow sidebar", () => {
  assert.match(portalCss, /\.portal aside nav \.nav-group \{/, "the group label needs a rule to be quiet with");
  assert.match(portalCss, /\.backlink\.nav-handbook \{/, "the handbook highlight needs a rule");
  // Below 1000px the sidebar is an icon rail: every text label goes, including the group labels,
  // which would otherwise render as stray words between icons.
  const rail = portalCss.slice(portalCss.indexOf("@media (max-width: 1000px)"), portalCss.indexOf("@media (max-width: 700px)"));
  assert.ok(rail.includes(".portal aside nav .nav-group"), "the group labels have to go when the sidebar is icons only");
  assert.match(
    rail,
    /\.backlink\.nav-handbook \{[^}]*display: flex/,
    "the other backlinks are hidden in the rail — the handbook has to opt back in or it vanishes",
  );
});
