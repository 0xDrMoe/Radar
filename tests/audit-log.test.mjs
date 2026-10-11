// The audit log section and GET /api/admin/audit, which it reads.
//
// The route is run for real against a migrated SQLite database (tests/route-harness.mjs): who may
// read it, what each filter narrows to, and that paging walks the whole log without skipping or
// repeating an entry. The client assertions pin what the screen must never offer: a way to change
// the record.
import assert from "node:assert/strict";
import test from "node:test";
import { freshDatabase, harness } from "./route-harness.mjs";
import { adminSource, code } from "./source.mjs";

const { GET: auditGet } = await import("../app/api/admin/audit/route.ts");

const staff = (userId, role, permissions = []) => ({ userId, email: `${userId}@example.test`, role, displayName: userId, permissions: new Set(["read_admin", ...permissions]) });
const OWNER = staff("owner-1", "owner", ["manage_users"]);
const ADMIN = staff("admin-1", "admin", ["manage_users"]);
const MODERATOR = staff("mod-1", "moderator", ["moderate_feedback"]);
// Holding every permission is not the same as being owner or admin, and the log answers to the role.
const CUSTOM = staff("custom-1", "custom", ["manage_users", "export_data", "developer_tools", "manage_finance", "view_analytics"]);

const read = async (query = "") => {
  const response = await auditGet(new Request(`https://radar.cheap/api/admin/audit${query ? `?${query}` : ""}`));
  return { status: response.status, body: await response.json() };
};

function seed(db) {
  for (const [id, name, role] of [["dana", "Dana Reyes", "deal_editor"], ["sam", "Sam Okafor", "moderator"], ["admin-1", "Alex Admin", "admin"]]) {
    db.prepare("INSERT INTO users(id,email,name,role) VALUES(?,?,?,?)").run(id, `${id}@example.test`, name, role);
  }
  const insert = db.prepare("INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,reason,details,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
  insert.run("dana", "deal_editor", "lifecycle", "deal", "deal-x", "r1", "Kitchen closed for renovation", JSON.stringify({ status: "paused", title: "Tuesday wings", restaurant: "Joe's" }), "2026-09-01 10:00:00");
  insert.run("sam", "moderator", "report", "report", "17", "r2", "Fixed the hours", JSON.stringify({ status: "resolved" }), "2026-09-15 23:59:30");
  insert.run("admin-1", "admin", "user", "user", "dana", "r3", "Promoted to lead 500 deals", JSON.stringify({ previousRole: "moderator", newRole: "deal_editor" }), "2026-09-16 00:00:10");
  insert.run("dana", "deal_editor", "verify", "deal", "deal-y", "r4", null, "{}", "2026-10-01 08:30:00");
}

test("only owners and admins can read the audit log, whatever else they hold", async () => {
  const db = freshDatabase();
  seed(db);
  assert.equal((await read()).status, 401, "signed out");
  harness.user = MODERATOR;
  assert.equal((await read()).status, 403);
  harness.user = CUSTOM;
  assert.equal((await read()).status, 403, "a custom role with every permission is still not owner or admin");
  harness.user = ADMIN;
  const admin = await read();
  assert.equal(admin.status, 200);
  assert.equal(admin.body.events.length, 4);
  harness.user = OWNER;
  assert.equal((await read()).status, 200);
});

test("entries come newest first, with the actor's name and the deal joined in", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = ADMIN;
  const { body } = await read();
  assert.deepEqual(body.events.map((e) => e.target_id), ["deal-y", "dana", "17", "deal-x"]);
  const paused = body.events.find((e) => e.target_id === "deal-x");
  assert.equal(paused.actor_name, "Dana Reyes");
  assert.equal(body.nextCursor, null);
  assert.ok(body.facets.actions.includes("lifecycle"));
  assert.ok(body.facets.targetTypes.includes("report"));
  assert.deepEqual(body.facets.actors.map((a) => a.name).sort(), ["Alex Admin", "Dana Reyes", "Sam Okafor"]);
});

test("each filter narrows the whole log on the server", async () => {
  const db = freshDatabase();
  seed(db);
  harness.user = OWNER;
  const ids = async (query) => (await read(query)).body.events.map((e) => e.target_id);
  assert.deepEqual(await ids("actor=dana"), ["deal-y", "deal-x"]);
  assert.deepEqual(await ids("action=report"), ["17"]);
  assert.deepEqual(await ids("target=deal"), ["deal-y", "deal-x"]);
  assert.deepEqual(await ids("actor=dana&action=verify"), ["deal-y"]);
  // "To" includes its whole last day; "from" starts at midnight.
  assert.deepEqual(await ids("from=2026-09-15&to=2026-09-15"), ["17"]);
  assert.deepEqual(await ids("from=2026-09-16"), ["deal-y", "dana"]);
  assert.deepEqual(await ids("to=2026-09-01"), ["deal-x"]);
  // A malformed date is ignored rather than passed to SQL.
  assert.equal((await ids("from=yesterday")).length, 4);
  // Search reaches the actor's name, the reason and the details.
  assert.deepEqual(await ids("q=sam"), ["17"]);
  assert.deepEqual(await ids("q=renovation"), ["deal-x"]);
  assert.deepEqual(await ids("q=Tuesday%20wings"), ["deal-x"]);
  // % is text, not a wildcard: "50%" must not match "500 deals".
  assert.deepEqual(await ids("q=50%25"), []);
  assert.deepEqual(await ids("q=500"), ["dana"]);
});

test("pages of 100 walk the whole log, past the 400 the workspace payload carries", async () => {
  const db = freshDatabase();
  harness.user = ADMIN;
  const insert = db.prepare("INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id) VALUES('admin-1','admin','verify','deal',?,?)");
  for (let n = 0; n < 450; n += 1) insert.run(`deal-${n}`, `r${n}`);
  const seen = [];
  let cursor = null;
  let pages = 0;
  do {
    const { status, body } = await read(cursor ? `before=${cursor}` : "");
    assert.equal(status, 200);
    assert.ok(body.events.length <= 100);
    if (cursor) assert.equal(body.facets, undefined, "filter menus come with the first page only");
    seen.push(...body.events.map((e) => e.id));
    cursor = body.nextCursor;
    pages += 1;
  } while (cursor && pages < 10);
  assert.equal(pages, 5);
  assert.equal(seen.length, 450);
  assert.equal(new Set(seen).size, 450, "no entry appears twice");
  assert.deepEqual(seen, [...seen].sort((a, b) => b - a), "strictly newest first across pages");
  // Paging keeps the filters.
  const filtered = await read(`action=verify&before=${seen[99]}`);
  assert.equal(filtered.body.events[0].id, seen[100]);
});

test("the route only reads, and the screen offers no way to change an entry", () => {
  const route = code(adminSource("../../api/admin/audit/route.ts"));
  assert.doesNotMatch(route, /export async function (POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /\b(UPDATE|DELETE FROM|INSERT INTO)\b/);
  assert.match(route, /requireStaff\(request, \{ allow: \(user\) => isAdminTier\(user\.role\) \}\)/);
  assert.match(route, /LIMIT \$\{PAGE_SIZE \+ 1\}/);

  const tab = code(adminSource("tabs/AuditTab.tsx"));
  assert.match(tab, /\/api\/admin\/audit/);
  assert.doesNotMatch(tab, /method:\s*["'](POST|DELETE|PUT|PATCH)/);
  assert.doesNotMatch(tab, /\baction\(\{/, "no workspace action is sent from the audit log");
  assert.match(tab, /append-only/);
  // Details are labelled rows, not a JSON dump, and a deal entry links to the deal.
  assert.doesNotMatch(tab, /JSON\.stringify/);
  assert.match(tab, /openTab\("deals", `\?deal=\$\{encodeURIComponent\(dealLink\)\}`\)/);
});

test("the roles grid left the Users tab for its own component", () => {
  const users = code(adminSource("tabs/UsersTab.tsx"));
  assert.doesNotMatch(users, /set_role_permission|permissions-grid|PRESET_GRID_ROLES/);
  const grid = code(adminSource("RolesGrid.tsx"));
  assert.match(grid, /export function RolesGrid/);
  assert.match(grid, /action: "set_role_permission"/);
  // Admins can read it; only the owner can change a cell (the server checks this too).
  assert.match(grid, /disabled=\{!isOwner \|\| busy === cellKey\}/);
});

test("the Users tab keeps every account action, and the directory reads ?q=", () => {
  const users = code(adminSource("tabs/UsersTab.tsx"));
  for (const action of ['action: "user"', 'action: "creator_profile"', 'action: "user_visibility"'])
    assert.ok(users.includes(action), `${action} is missing from the Users tab`);
  for (const filter of ["Filter by role", "Filter by plan", "Filter by account status", "Filter by country", "Filter by signup date"])
    assert.ok(users.includes(filter), `the "${filter}" control is missing`);
  const directory = code(adminSource("tabs/DirectoryTab.tsx"));
  assert.match(directory, /new URLSearchParams\(window\.location\.search\)\.get\("q"\)/);
  assert.match(directory, /ROLE_DESCRIPTIONS/);
});
