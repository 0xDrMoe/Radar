import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { adminClientSource, code } from "./source.mjs";

const read = (path) => code(readFileSync(new URL(path, import.meta.url), "utf8"));
const rootShell = () => read("../app/RootShell.tsx");
const provider = () => read("../app/ClerkClientProvider.tsx");
const header = () => read("../app/SiteHeader.tsx");
const sessionRoute = () => read("../app/api/session/route.ts");
const signIn = () => read("../app/[locale]/sign-in/[[...sign-in]]/page.tsx");
const signUp = () => read("../app/[locale]/sign-up/[[...sign-up]]/page.tsx");

// Clerk is 8 files, ~240KB compressed and ~780KB to parse. It was loading on every page for every
// reader, and for a signed-out one none of it is used: the only Clerk component a public page
// renders is the <UserButton/> in the header, which signed-out readers never see. A deal page
// arriving from Google is the case that matters, and it is exactly the case that paid the most.
test("Clerk is only mounted when there is a session cookie", () => {
  const source = rootShell();
  assert.match(source, /cookies\(\)/, "RootShell should look for the session cookie");
  assert.match(source, /__session/, "the gate is the session cookie");
  assert.match(source, /<ClerkClientProvider active=\{hasSession\}[ >]/, "the provider should be gated, not unconditional");
});

// The gate decides what is downloaded. It must never be mistaken for an authorization check - the
// token is verified server-side on every request in app/auth.ts, and a forged cookie buys a bigger
// download and nothing else.
test("the cookie gate reads presence only, never a claim inside the token", () => {
  const source = rootShell();
  assert.match(source, /Boolean\(\(await cookies\(\)\)\.get\("__session"\)\?\.value\)/);
  assert.doesNotMatch(source, /verifyToken|jwt|decode|atob/, "RootShell must not try to interpret the token");
});

// Asking Clerk "is anyone signed in" meant downloading Clerk to be told no. The server already
// answers that in /api/session, which the header fetches anyway.
test("the header does not ask Clerk whether the reader is signed in", () => {
  const source = header();
  assert.doesNotMatch(source, /\bShow\b/, "Clerk's <Show> forces Clerk onto every page");
  assert.match(source, /sessionLoaded && !session/, "signed-out controls should come from /api/session");
  assert.match(source, /sessionLoaded && session/, "signed-in controls should come from /api/session");
});

// Without this the header paints Sign in / Create account for a moment on every load and then
// swaps them, which every signed-in reader sees on every page.
test("the header waits for the session answer before choosing which controls to show", () => {
  const source = header();
  assert.match(source, /setSessionLoaded\(true\)/);
  assert.match(source, /\.finally\(\(\) => setSessionLoaded\(true\)\)/, "it must settle on failure too, not just on success");
});

// These two pages need Clerk while nobody is signed in yet, so the cookie gate above would leave
// them without it.
test("the sign-in and sign-up pages mount Clerk for themselves", () => {
  for (const [name, source] of [["sign-in", signIn()], ["sign-up", signUp()]]) {
    assert.match(source, /import ClerkClientProvider from/, `${name} should import the provider`);
    assert.match(source, /<ClerkClientProvider active[ >]/, `${name} should mount Clerk unconditionally`);
    // And in the page's language: without it the form inside a French page is English.
    assert.match(source, /<ClerkClientProvider active locale=\{locale\}>/, `${name} should pass its locale`);
  }
});

// Clerk's own strings follow the page's language. The translations are loaded on demand, only for
// fr and es and only once Clerk is mounting, so an English reader and every signed-out reader of a
// public page download neither.
test("Clerk is handed a localization for French and Spanish pages", () => {
  const source = provider();
  assert.match(source, /localization=\{localization\}/, "ClerkProvider must receive the localization");
  assert.match(source, /import\("@clerk\/localizations\/fr-FR"\)/, "French is loaded on demand");
  assert.match(source, /import\("@clerk\/localizations\/es-ES"\)/, "Spanish is loaded on demand");
  assert.doesNotMatch(source, /^import[^\n]*@clerk\/localizations/m, "a static import would put both on every page");
  assert.match(source, /active && !alreadyMounted && locale \?/, "nothing is fetched unless this provider is the one mounting Clerk");
  assert.match(rootShell(), /<ClerkClientProvider active=\{hasSession\} locale=\{lang\}>/, "RootShell passes the page's language");
});

// A signed-in reader visiting /sign-in gets RootShell's provider and the page's own. Two Clerk
// instances in one tree is the bug this guard exists to prevent.
test("a nested provider is a pass-through rather than a second Clerk", () => {
  const source = provider();
  assert.match(source, /createContext/, "the guard needs a context to detect the outer provider");
  assert.match(source, /useContext\(ClerkMounted\)/);
  assert.match(source, /if \(alreadyMounted \|\| !active/, "an inner provider must render children plain");
});

// /api/session used to be SELECT *, which handed every reader their whole users row -
// stripe_customer_id, stripe_subscription_id, the internal `hidden` flag, referred_by - in a JSON
// response any script on the page can read. The client contract is the `Session` type in
// app/HomeClient.tsx and it names twelve columns.
test("the session endpoint sends only the columns the client contract names", () => {
  const source = sessionRoute();
  assert.doesNotMatch(source, /SELECT \*/, "an allowlist, so a new column has to be named before it ships");
  assert.match(source, /SESSION_COLUMNS/);
  for (const secret of ["stripe_customer_id", "stripe_subscription_id", "hidden", "referred_by"]) {
    assert.doesNotMatch(source, new RegExp(secret), `${secret} must not reach the browser`);
  }
});

test("every column the session endpoint sends is one the client actually declares", () => {
  const route = sessionRoute();
  const block = route.slice(route.indexOf("SESSION_COLUMNS"), route.indexOf("] as const"));
  const columns = [...block.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(columns.length >= 10, `expected the column list, found ${columns.length}`);
  // The type in HomeClient is the contract every caller reads through.
  const contract = read("../app/HomeClient.tsx");
  const declared = contract.slice(contract.indexOf("type Session = {"), contract.indexOf("type ResolvedLocation"));
  for (const column of columns) {
    assert.match(declared, new RegExp(`\\b${column}\\b`), `${column} is sent but not declared on the Session type`);
  }
});

// Deleting a sponsorship removes a paid placement and its history; revoking a manager locks a
// real person out of their restaurant's portal. Neither can be undone, and the delete trigger is
// a bare X sitting in a row of harmless controls - the easiest thing on the screen to hit by
// accident. Both used to fire on the first click.
const adminClient = () => code(adminClientSource());

test("admin actions that cannot be undone ask first", () => {
  const source = adminClient();
  for (const action of ["delete_sponsorship", "revoke_restaurant_manager"]) {
    const site = source.indexOf(`action: "${action}"`);
    assert.notEqual(site, -1, `${action} should still be dispatched somewhere`);
    // The dispatch must sit inside a confirm dialog's `run`, not directly on an onClick.
    const before = source.slice(Math.max(0, site - 900), site);
    assert.match(before, /setConfirmDialog\(\{/, `${action} should be routed through a confirmation`);
    assert.match(before, /run:/, `${action} should be the dialog's action, not the button's`);
  }
});

test("the confirmation dialog defaults to the harmless button", () => {
  const source = adminClient();
  const start = source.indexOf("{confirmDialog && (");
  assert.notEqual(start, -1, "the dialog should be rendered");
  const dialog = source.slice(start, start + 1600);
  // A stray Enter should dismiss, never destroy.
  assert.match(dialog, /<button autoFocus onClick=\{\(\) => setConfirmDialog\(null\)\}>Cancel<\/button>/);
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(dialog, /Escape/, "Escape should close it");
  assert.match(dialog, /className="destructive"/, "the confirming button should read as destructive");
  // And it must name what is being destroyed rather than asking a generic question.
  assert.match(source, /confirmDialog\.body/);
});

// SiteHeader and HomeClient both mount on every homepage view and both need to know who the
// reader is. Two fetches of the same endpoint a few milliseconds apart is two D1 reads for an
// answer that cannot have changed between them.
test("the session is fetched once per page load, not once per component", () => {
  for (const [name, source] of [["SiteHeader", header()], ["HomeClient", read("../app/HomeClient.tsx")]]) {
    assert.match(source, /fetchSession\(\)/, `${name} should use the shared fetch`);
    assert.doesNotMatch(source, /fetch\("\/api\/session"\)/, `${name} should not call the endpoint directly`);
  }
});

test("a failed session request resolves rather than rejecting", () => {
  // Every caller treats "cannot know" as signed out, and a rejection here would leave the header
  // with no controls at all.
  const cache = read("../app/session-cache.ts");
  assert.match(cache, /\.catch\(\(\) => null\)/);
  // The promise, not the value, so two components mounting in the same tick share one request.
  assert.match(cache, /let inFlight: Promise<SessionUser> \| null/);
  assert.match(cache, /if \(!inFlight\)/);
});

// Clerk's hosted script was already gated on the session cookie, but @clerk/react - the bindings
// the provider and the header's account menu are imported from - stayed a static import, so its
// 120 KB chunk (31 KB gzipped) was preloaded and parsed on every public page, signed out or not.
test("@clerk/react is loaded on demand by the site chrome, never imported statically", () => {
  for (const [name, source] of [["ClerkClientProvider", provider()], ["SiteHeader", header()]]) {
    assert.doesNotMatch(source, /import\s+\{[^}]*\}\s+from\s+"@clerk\/react"/, `${name} must not import @clerk/react statically`);
    assert.match(source, /loadClerkReact\(\)/, `${name} should load it through app/clerk-react.ts`);
    assert.match(source, /lazy\(/, `${name} should render it through React.lazy`);
  }
  const loader = read("../app/clerk-react.ts");
  assert.match(loader, /import\("@clerk\/react"\)/);
  // Fetched before hydration for exactly the readers RootShell rendered with a session cookie.
  assert.match(loader, /hasAttribute\("data-signed-in"\)/);
  assert.match(rootShell(), /data-signed-in=\{hasSession \? "" : undefined\}/);
  // The account menu waits inside its own boundary rather than suspending the whole header.
  assert.match(header(), /<Suspense fallback=\{null\}><UserButton \/><\/Suspense>/);
});

// Without the cookie app/auth.ts has nothing to verify, so the answer is null before it is asked.
test("a reader with no session cookie is not sent to /api/session", () => {
  const cache = read("../app/session-cache.ts");
  assert.match(cache, /document\.cookie\.includes\("__session="\)/, "the same test as isSignedIn in worker/index.ts");
  assert.match(cache, /!hasSessionCookie\(\)\s*\?\s*Promise\.resolve\(null\)/);
  assert.match(read("../worker/index.ts"), /\.includes\("__session="\)/);
});

// A preload is a high-priority fetch on every page; the mono face draws only a keyboard hint there.
test("the mono font is not preloaded", () => {
  assert.match(rootShell(), /Geist_Mono\(\{[^}]*preload: false[^}]*\}\)/);
});
