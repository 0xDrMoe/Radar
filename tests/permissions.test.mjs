import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/permissions.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const permissions = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const { ACTION_PERMISSIONS, ADMIN_ENTRY_PERMISSION, ALL_PERMISSIONS, ALL_ROLES, ROLE_DESCRIPTIONS, PERMISSION_DESCRIPTIONS } = permissions;

const routeSource = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const postHandler = routeSource.slice(routeSource.indexOf("export async function POST"));
const handledActions = [...new Set([...postHandler.matchAll(/b\.action\s*===\s*"([a-z_]+)"/g)].map((match) => match[1]))];

test("the admin route handles at least the actions we think it does", () => {
  // A floor, so a wholesale refactor that stops the regex from matching fails loudly here rather
  // than making the two tests below pass vacuously.
  assert.ok(handledActions.length >= 20, `only found ${handledActions.length} admin actions`);
});

test("every admin write the route handles has a permission behind it", () => {
  // An unmapped action is refused at runtime, so this can never become a privilege hole — it
  // becomes a feature that silently 403s for everyone, including the owner, which is the failure
  // this test exists to catch before it ships.
  const unmapped = handledActions.filter((action) => !ACTION_PERMISSIONS[action]);
  assert.deepEqual(unmapped, [], `admin actions with no permission mapping: ${unmapped.join(", ")}`);
});

test("no permission mapping outlives the action it guarded", () => {
  const orphaned = Object.keys(ACTION_PERMISSIONS).filter((action) => !handledActions.includes(action));
  assert.deepEqual(orphaned, [], `mapped actions the route no longer handles: ${orphaned.join(", ")}`);
});

test("every mapping names a real permission", () => {
  for (const [action, permission] of Object.entries(ACTION_PERMISSIONS)) {
    assert.ok(ALL_PERMISSIONS.includes(permission), `${action} maps to unknown permission ${permission}`);
  }
  assert.ok(ALL_PERMISSIONS.includes(ADMIN_ENTRY_PERMISSION));
});

test("the route refuses anything it cannot find a permission for", () => {
  // The deny-by-default line itself. If this ever becomes a lookup with a fallback, the table
  // above stops being the authorization boundary and this test should fail.
  assert.match(postHandler, /if \(!needed \|\| !hasPermission\(current,needed\)\)/);
});

test("the admin workspace and the admin API agree on who may enter", () => {
  const authSource = routeSource.slice(0, routeSource.indexOf("export async function POST"));
  assert.match(authSource, /hasPermission\(signedIn,"read_admin"\)/);
});

test("hidden accounts are filtered in SQL, not in the browser", () => {
  // The point of the flag is that the row never reaches a client that may not see it. A filter
  // applied after the fetch would still ship every hidden account's email to that browser.
  // Anchored on the roster SELECT itself rather than the first "FROM users" in the file, which
  // is not necessarily this one — other queries read that table too.
  const listStart = routeSource.indexOf("SELECT id,email,name,role,status,hidden");
  assert.ok(listStart > -1, "could not find the admin user list query");
  const listQuery = routeSource.slice(listStart, listStart + 400);
  assert.match(listQuery, /isAdminPlus \? "" : " WHERE hidden=0"/);
});

test("only owner and admin can change account visibility", () => {
  const handler = routeSource.slice(routeSource.indexOf('b.action === "user_visibility"'));
  assert.match(handler.slice(0, 900), /current\.role !== "owner" && current\.role !== "admin"/);
  assert.match(handler.slice(0, 1200), /SELF_HIDE_BLOCKED/);
});

test("every role and permission is documented", () => {
  for (const role of ALL_ROLES) assert.ok(ROLE_DESCRIPTIONS[role], `role ${role} has no description`);
  assert.ok(ROLE_DESCRIPTIONS.custom, "the custom role has no description");
  for (const permission of ALL_PERMISSIONS) assert.ok(PERMISSION_DESCRIPTIONS[permission], `permission ${permission} has no description`);
});

test("docs/ROLES.md covers every role and permission by name", async () => {
  // The reference doc is only useful if it stays complete; a permission added to the code and not
  // to the doc is exactly the drift that makes people stop trusting it.
  const doc = await readFile(new URL("../docs/ROLES.md", import.meta.url), "utf8");
  for (const permission of ALL_PERMISSIONS) assert.ok(doc.includes(permission), `docs/ROLES.md does not mention ${permission}`);
  for (const role of ALL_ROLES) assert.ok(doc.includes(role), `docs/ROLES.md does not mention ${role}`);
  for (const action of Object.keys(ACTION_PERMISSIONS)) assert.ok(doc.includes(action), `docs/ROLES.md does not mention the ${action} action`);
});

// The shared list-scoping rule every admin tab now runs through. Sliced out of the shipped module
// rather than re-implemented, so this fails if the real rule changes and this file does not.
const scopeSource = await readFile(new URL("../app/(operator)/ListScope.tsx", import.meta.url), "utf8");
const { selectRows, listCountLabel, LIST_PREVIEW_COUNT } = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(
      // Drop the JSX components; only the pure selection layer is under test here.
      scopeSource.slice(0, scopeSource.indexOf("export function ListToolbar")).replace('"use client";', "").replace(/^import .*$/m, ""),
      { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
    ).outputText,
  ).toString("base64")}`
);
const searchUser = (u) => `${u.name || ""} ${u.email} ${u.home_postal || ""}`;
const selectUsers = (rows, { query, role, showAll }) =>
  selectRows(role === "All roles" ? rows : rows.filter((u) => u.role === role), searchUser,
    { query, filtered: role !== "All roles", showAll });
const USER_PREVIEW_COUNT = LIST_PREVIEW_COUNT;

const person = (email, role = "user", name = null, postal = null) => ({ email, role, name, home_postal: postal });
const roster = [
  ...Array.from({ length: 12 }, (_, i) => person(`member${i}@example.com`)),
  person("dana@example.com", "moderator", "Dana Reyes", "K1P 1J1"),
  person("sam@example.com", "admin", "Sam Fox"),
];

test("the count line names what is on screen, and says so differently in each state", () => {
  const previewed = selectUsers(roster, { query: "", role: "All roles", showAll: false });
  assert.match(listCountLabel(previewed, roster.length, "account", false), /^8 most recent of 14 — search/);
  const expanded = selectUsers(roster, { query: "", role: "All roles", showAll: true });
  assert.equal(listCountLabel(expanded, roster.length, "account", true), "All 14 accounts, newest first");
  const searched = selectUsers(roster, { query: "dana", role: "All roles", showAll: false });
  assert.equal(listCountLabel(searched, roster.length, "account", false), "1 of 14 accounts");
  // A set smaller than the preview is complete, and must not claim to be a sample of itself.
  const small = selectUsers(roster.slice(0, 3), { query: "", role: "All roles", showAll: false });
  assert.equal(listCountLabel(small, 3, "account", false), "All 3 accounts, newest first");
  assert.equal(listCountLabel(selectUsers(roster.slice(0, 1), { query: "", role: "All roles", showAll: false }), 1, "account", false), "All 1 account, newest first");
});

test("the default view is a bounded preview, not the whole roster", () => {
  const { visible, matched, narrowed } = selectUsers(roster, { query: "", role: "All roles", showAll: false });
  assert.equal(visible.length, USER_PREVIEW_COUNT);
  assert.equal(matched.length, roster.length);
  assert.equal(narrowed, false, "an unfiltered list is not narrowed — the count line depends on this");
});

test("asking for everyone shows everyone", () => {
  const { visible } = selectUsers(roster, { query: "", role: "All roles", showAll: true });
  assert.equal(visible.length, roster.length);
});

test("a search reaches past the preview and is never truncated", () => {
  // dana is the 13th entry, so a preview-limited search would miss her entirely.
  const { visible, narrowed } = selectUsers(roster, { query: "dana", role: "All roles", showAll: false });
  assert.deepEqual(visible.map((u) => u.email), ["dana@example.com"]);
  assert.equal(narrowed, true);
});

test("search covers name, email, and area, case-insensitively", () => {
  const by = (query) => selectUsers(roster, { query, role: "All roles", showAll: false }).visible.map((u) => u.email);
  assert.deepEqual(by("REYES"), ["dana@example.com"]);
  assert.deepEqual(by("k1p"), ["dana@example.com"]);
  assert.deepEqual(by("sam@example"), ["sam@example.com"]);
  assert.deepEqual(by("  Sam Fox  "), ["sam@example.com"]);
  assert.deepEqual(by("nobody"), []);
});

test("the role filter narrows on its own and composes with search", () => {
  assert.deepEqual(selectUsers(roster, { query: "", role: "admin", showAll: false }).visible.map((u) => u.email), ["sam@example.com"]);
  assert.deepEqual(selectUsers(roster, { query: "dana", role: "admin", showAll: false }).visible, []);
  assert.deepEqual(selectUsers(roster, { query: "dana", role: "moderator", showAll: false }).visible.map((u) => u.email), ["dana@example.com"]);
});

test("a roster smaller than the preview is shown whole", () => {
  const { visible, matched } = selectUsers(roster.slice(0, 3), { query: "", role: "All roles", showAll: false });
  assert.equal(visible.length, 3);
  assert.equal(matched.length, 3);
});
