import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const permissionSource = await readFile(new URL("../app/permissions.ts", import.meta.url), "utf8");
const permissions = await import(
  `data:text/javascript;base64,${Buffer.from(
    ts.transpileModule(permissionSource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText,
  ).toString("base64")}`
);
const { ALL_ROLES, ASSIGNABLE_ROLES, FIXED_PERMISSION_ROLES, isWorkspaceRole, PRESET_GRID_ROLES, ROLE_DESCRIPTIONS, WORKSPACE_HOME, WORKSPACE_ROLES } = permissions;

const authSource = await readFile(new URL("../app/auth.ts", import.meta.url), "utf8");
const adminRoute = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
const creatorRoute = await readFile(new URL("../app/api/creator/route.ts", import.meta.url), "utf8");

test("a workspace role is a real assignable role with somewhere to go", () => {
  for (const role of WORKSPACE_ROLES) {
    assert.ok(ALL_ROLES.includes(role), `${role} is not in ALL_ROLES`);
    assert.ok(ASSIGNABLE_ROLES.includes(role), `${role} cannot be assigned to anyone`);
    assert.ok(WORKSPACE_HOME[role]?.startsWith("/"), `${role} has no workspace to open`);
    assert.ok(ROLE_DESCRIPTIONS[role], `${role} has no description`);
    assert.ok(isWorkspaceRole(role));
  }
  assert.equal(isWorkspaceRole("admin"), false);
  assert.equal(isWorkspaceRole("user"), false);
});

test("a workspace role resolves to no admin permissions, in code", () => {
  // The whole guarantee these account types rest on. If this ever becomes a role_permissions
  // read, a single row — or a hand-edited database — could hand a creator the admin workspace.
  assert.match(authSource, /if \(role === "user" \|\| isWorkspaceRole\(role\)\) return new Set\(\);/);
});

test("nothing can edit a workspace role's permissions into existence", () => {
  // Two halves: the presets grid does not offer them, and the write path refuses them. The grid
  // alone is not enough — it only decides what the browser draws.
  for (const role of WORKSPACE_ROLES) {
    assert.ok(!PRESET_GRID_ROLES.includes(role), `${role} is editable in the presets grid`);
    assert.ok(FIXED_PERMISSION_ROLES.includes(role), `${role} is missing from FIXED_PERMISSION_ROLES`);
  }
  assert.ok(FIXED_PERMISSION_ROLES.includes("owner") && FIXED_PERMISSION_ROLES.includes("user"));
  const handler = adminRoute.slice(adminRoute.indexOf('b.action === "set_role_permission"'));
  assert.match(handler.slice(0, 1600), /FIXED_PERMISSION_ROLES\.includes\(targetRole\)/);
  // And only an owner may write to the presets at all.
  assert.match(handler.slice(0, 1600), /if \(current\.role !== "owner"\) return apiError\(403,"OWNER_REQUIRED"/);
});

test("staff may onboard a creator or restaurant, but may not promote anyone past that", () => {
  // The owner-only rule exists to stop privilege escalation. Relaxing it for roles that carry no
  // permission is safe exactly as long as "carries no permission" stays true above.
  const handler = adminRoute.slice(adminRoute.indexOf('b.action === "user"'), adminRoute.indexOf('b.action === "user_visibility"'));
  assert.match(handler, /const targetRoleIsWorkspace = isWorkspaceRole\(String\(b\.role\)\);/);
  assert.match(handler, /if \(current\.role !== "owner" && !staffAssignable\)/);
  // Leaving a workspace role is the same class of change; becoming anything else is not.
  assert.match(handler, /String\(b\.role\) === "user" && isWorkspaceRole\(currentRole\)/);
  // And the account being changed has to be outside the admin workspace to begin with, or
  // "onboarding" an owner or admin as a restaurant is a demotion staff are not allowed to make.
  assert.match(handler, /const staffAssignable = currentRoleIsStaffManaged && /);
});

test("the creator workspace needs the role and an active profile, on every request", () => {
  assert.match(creatorRoute, /if \(user\.role !== "creator"\)/);
  assert.match(creatorRoute, /if \(!profile \|\| profile\.status !== "active"\)/);
  // Both entry points go through the same context, so neither can drift from the other.
  for (const method of ["export async function GET", "export async function POST"]) {
    const body = creatorRoute.slice(creatorRoute.indexOf(method));
    assert.match(body.slice(0, 400), /const context = await creatorContext\(\);/, `${method} does not establish creator context first`);
  }
});

test("a creator only ever reads and writes their own rows", () => {
  // Every statement in the route that touches suggestions is scoped by the signed-in user id.
  for (const statement of creatorRoute.match(/(SELECT|UPDATE|INSERT INTO)[\s\S]*?(?=`)/g) || []) {
    if (!/\bsuggestions\b/.test(statement)) continue;
    assert.ok(
      /user_id=\?/.test(statement) || /INSERT INTO suggestions/.test(statement),
      `a suggestions statement is not scoped to one creator: ${statement.slice(0, 120)}`,
    );
  }
  assert.match(creatorRoute, /WHERE id=\? AND user_id=\? AND status='pending'/);
});

test("a reviewed submission cannot be edited or withdrawn", () => {
  // Otherwise a creator could change an offer out from under the person reviewing it, or after it
  // was already published from it.
  assert.match(creatorRoute, /SUBMISSION_LOCKED/);
  assert.match(creatorRoute, /if \(owned\.status !== "pending"\)/);
  const withdraw = creatorRoute.slice(creatorRoute.indexOf('b.action === "withdraw_submission"'));
  assert.match(withdraw, /status='withdrawn'[\s\S]*WHERE id=\? AND user_id=\? AND status='pending'/);
  assert.match(withdraw, /if \(!result\.meta\.changes\)/);
});

test("a referral is stamped once, at account creation, and only for a real creator", () => {
  // Re-attribution is the failure that matters here: if an existing account could pick up a
  // handle from a later visit, the last creator to get someone to click would take the credit.
  assert.match(authSource, /INSERT INTO users\(id,email,name,role,referred_by,referred_campaign\)/);
  assert.equal((authSource.match(/referred_by/g) || []).length, 1, "referred_by is written somewhere other than the initial insert");
  assert.match(authSource, /SELECT handle FROM creator_profiles WHERE handle=\? AND status='active'/);
  assert.match(authSource, /\^\[a-z0-9\]\[a-z0-9-\]\{1,31\}\$/);
});

test("a handle is validated the same way everywhere it is accepted", async () => {
  // The link component writes it, the track route stores it, the admin action sets it and auth.ts
  // trusts it. One shape, checked in all four, or attribution can name something that cannot own
  // it.
  const pattern = /\^\[a-z0-9\]\[a-z0-9-\]\{1,31\}\$/;
  const link = await readFile(new URL("../app/CreatorLink.tsx", import.meta.url), "utf8");
  const track = await readFile(new URL("../app/api/track/route.ts", import.meta.url), "utf8");
  for (const [name, source] of [["CreatorLink", link], ["track route", track], ["admin route", adminRoute], ["auth", authSource]]) {
    assert.match(source, pattern, `${name} does not use the shared handle shape`);
  }
});

test("the creator handle is unique, and only staff can set it", () => {
  const handler = adminRoute.slice(adminRoute.indexOf('b.action === "creator_profile"'));
  assert.match(handler.slice(0, 2400), /HANDLE_TAKEN/);
  assert.match(handler.slice(0, 2400), /SELECT user_id FROM creator_profiles WHERE handle=\? AND user_id<>\?/);
  // A handle on a non-creator account would be a link nobody can open.
  assert.match(handler.slice(0, 2400), /targetUser\.role !== "creator"/);
  // And the creator API never writes creator_profiles at all.
  assert.ok(!/INSERT INTO creator_profiles|UPDATE creator_profiles/.test(creatorRoute), "the creator API can change its own profile");
});

test("attribution is read from the creator key alone, not from free-text campaign", () => {
  // `campaign` is whatever the caller sent. Reading attribution off it would let anyone credit
  // themselves to a creator's numbers by sending one track event.
  assert.match(creatorRoute, /json_extract\(properties,'\$\.creator'\)=\?/);
  assert.ok(!/json_extract\(properties,'\$\.campaign'\)=\?/.test(creatorRoute));
});

test("docs/ROLES.md documents both workspaces and how to reach them", async () => {
  const doc = await readFile(new URL("../docs/ROLES.md", import.meta.url), "utf8");
  for (const role of WORKSPACE_ROLES) assert.ok(doc.includes(role), `docs/ROLES.md does not mention ${role}`);
  for (const path of Object.values(WORKSPACE_HOME)) assert.ok(doc.includes(path), `docs/ROLES.md does not mention ${path}`);
  assert.ok(doc.includes("creator_profiles"), "docs/ROLES.md does not mention the creator_profiles table");
  assert.ok(doc.includes("referred_by"), "docs/ROLES.md does not explain where sign-up attribution is stored");
});

test("every operator route is excluded from locale routing", async () => {
  // /creator shipped locale-prefixed because the matcher in proxy.ts lists its exclusions by
  // hand. A route under app/(operator) lives outside the [locale] tree, so a prefix sends it to
  // a page that does not exist — and the redirect looks perfectly normal while doing it.
  const { readdir } = await import("node:fs/promises");
  const matcher = await readFile(new URL("../proxy.ts", import.meta.url), "utf8");
  const entries = await readdir(new URL("../app/(operator)", import.meta.url), { withFileTypes: true });
  for (const entry of entries.filter((e) => e.isDirectory())) {
    assert.ok(
      new RegExp(`[(|!]${entry.name}[|)]`).test(matcher),
      `/${entry.name} is an operator route but proxy.ts does not exclude it from locale routing`,
    );
  }
});

const clickRoute = await readFile(new URL("../app/api/deals/click/route.ts", import.meta.url), "utf8");

test("a click is recorded against a real deal, in one of two named kinds", () => {
  assert.match(clickRoute, /const CLICK_KINDS = new Set\(\["view", "offer"\]\);/);
  assert.match(clickRoute, /if \(!CLICK_KINDS\.has\(kind\)\) return apiError\(422/);
  // Otherwise anyone could inflate any string into the numbers a payout is argued over.
  assert.match(clickRoute, /SELECT id FROM deals WHERE id=\? AND deleted_at IS NULL/);
  assert.match(clickRoute, /DEAL_NOT_FOUND/);
});

test("the creator a click is credited to comes from the cookie, resolved server-side", () => {
  // Never from the request body: the body is whatever the caller typed, so reading a handle from
  // it would let anyone post clicks into someone else's totals.
  assert.ok(!/body\.creator|b\.creator/.test(clickRoute), "the click route trusts a creator handle from the body");
  assert.match(clickRoute, /cookies\(\)\)\.get\("radar_creator"\)/);
  assert.match(clickRoute, /SELECT handle FROM creator_profiles WHERE handle=\? AND status='active'/);
});

test("clicks survive the navigation that caused them", async () => {
  // A plain fetch is canceled when the page goes away, which is exactly when both of these fire.
  const helper = await readFile(new URL("../app/trackDealClick.ts", import.meta.url), "utf8");
  assert.match(helper, /navigator\.sendBeacon\?\.\("\/api\/deals\/click"/);
  assert.match(helper, /keepalive: true/);
  assert.match(helper, /type: "application\/json"/);
});

test("the outbound offer link stays a real anchor", async () => {
  // Replacing it with a button that navigates would break middle-click, long-press and
  // open-in-new-tab — the ways people actually open a restaurant's page.
  const activity = await readFile(new URL("../app/[locale]/deals/[slug]/DealActivity.tsx", import.meta.url), "utf8");
  const anchor = activity.slice(activity.indexOf("export function OfferLink"));
  assert.match(anchor, /<a\b/);
  assert.match(anchor, /target="_blank"/);
  assert.match(anchor, /rel="noreferrer"/);
  assert.ok(!/preventDefault/.test(anchor), "the offer link interferes with its own navigation");
  // And a view is counted once per page, not once per effect run.
  assert.match(activity, /if \(recorded\.current\) return;/);
});

test("a restaurant only ever sees activity for deals it manages", async () => {
  // The activity query is a second place the restaurant grant has to be applied. Getting it wrong
  // leaks how every other restaurant's deals are performing to any manager who asks.
  const portal = await readFile(new URL("../app/api/portal/route.ts", import.meta.url), "utf8");
  const activity = portal.slice(portal.indexOf("type='deal_click'"), portal.indexOf("GROUP BY entity_id"));
  assert.match(activity, /entity_id IN \(SELECT id FROM deals WHERE restaurant_id IN \(\$\{placeholders\}\)/);
});

test("a creator only ever sees activity for their own submissions", () => {
  const scoped = creatorRoute.slice(creatorRoute.indexOf("type='deal_click' AND entity_id IN"));
  assert.match(scoped.slice(0, 200), /SELECT 'suggestion-' \|\| id FROM suggestions WHERE user_id=\?/);
});
