import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { code } from "./source.mjs";

// The launch switch, guarded.
//
// /launch is an announcement written well before there is anything to announce, and the only
// thing keeping it off the public internet is one call to appStoreListingUrl(). That is a fragile
// kind of secret: nothing about the page looks unfinished, so a refactor that drops the guard
// produces a page that renders perfectly and says the app is on the App Store when it is not.
//
// Everything here asserts against source with comments stripped (see ./source.mjs). The prose
// above the gate explains the gate in detail and names every identifier these tests look for, so
// reading the raw file would let a comment satisfy an assertion about the code.
const read = (path) => code(readFileSync(new URL(path, import.meta.url), "utf8"));

const page = () => read("../app/[locale]/launch/page.tsx");
const store = () => read("../app/app-release.ts");
const sitemap = () => read("../app/sitemap.ts");
const launchEmail = () => read("../app/api/jobs/launch-email/route.ts");

test("the announcement page 404s until there is a real App Store link", () => {
  const source = page();
  assert.match(source, /import \{ notFound \} from "next\/navigation"/);
  assert.match(source, /appStoreListingUrl\(\)/);

  // Order matters, not just presence: the guard has to run before anything renders. A notFound()
  // placed after the JSX would be unreachable.
  const guard = source.indexOf("if (!appStoreUrl) notFound()");
  assert.notEqual(guard, -1, "expected the page to bail out when there is no listing URL");
  assert.ok(guard < source.indexOf("return ("), "the gate must come before the render");
});

test("the gate is one definition, shared by the page and the launch email", () => {
  // Two copies of "has the app shipped?" is the failure this prevents: the page going live while
  // the email still refuses, or worse, the other way round.
  for (const [name, source] of [["page", page()], ["launch email", launchEmail()]]) {
    assert.match(
      source,
      /import \{ appStoreListingUrl \} from "(?:\.\.\/)+app-release"/,
      `${name} should import the shared check rather than re-implementing it`,
    );
    // Reading the variable is the drift, not naming it. The launch email's 503 body says
    // "Set APP_STORE_URL to ..." on purpose — that is the one place the operator is told which
    // secret to set, and it should stay.
    assert.doesNotMatch(
      source,
      /\.APP_STORE_URL\b/,
      `${name} should not read APP_STORE_URL directly — two copies of the check are what drift`,
    );
  }
});

test("only an apps.apple.com link counts as shipped", () => {
  const source = store();
  assert.match(source, /startsWith\("https:\/\/apps\.apple\.com\/"\)/);

  // An empty or whitespace-only secret is the realistic wrong value — `wrangler secret put` with a
  // fumbled paste — and it must read as "not shipped", not as a link.
  assert.match(source, /\.trim\(\)/);
});

test("the shared check reaches for env lazily, so a page can import it", () => {
  const source = store();

  // This is the whole reason app-release.ts exists instead of the check living in app/appstore.ts.
  // A top-level `import { env } from "cloudflare:workers"` puts that specifier in the module graph
  // of every importer, and a page is rendered in plain Node twice — tests/rendered-html.test.mjs
  // and vinext's prerender — where it fails at load with ERR_UNSUPPORTED_ESM_URL_SCHEME before any
  // of the page runs. That took out three unrelated page tests when this was first written.
  assert.doesNotMatch(
    source,
    /^import .*cloudflare:workers/m,
    "importing cloudflare:workers at the top level breaks every page that imports this",
  );
  assert.match(source, /await import\("cloudflare:workers"\)/);
});

test("the sitemap lists the announcement only once it exists", () => {
  const source = sitemap();
  assert.match(source, /appStoreListingUrl\(\)/);
  assert.match(source, /"\/launch"/);

  // The entry has to be conditional. A sitemap is a crawl invitation, so listing a 404 is the
  // fastest way to get the unreleased URL indexed.
  const entry = source.indexOf('"/launch"');
  const conditional = source.indexOf("appStoreListingUrl()");
  assert.ok(conditional !== -1 && conditional < entry, "the /launch entry must sit behind the check");
});

test("the announcement does not quote a deal count", () => {
  // A number baked into an announcement is wrong within a week, and this page has no mechanism to
  // refresh one. Catches a well-meaning edit that adds "over 100 deals" to the lead.
  const prose = page();
  assert.doesNotMatch(
    prose,
    /\b\d{2,}\s*(\+|\s)?\s*(deals|restaurants|listings)\b/i,
    "keep counts out of the release copy — it cannot be kept true",
  );
});
