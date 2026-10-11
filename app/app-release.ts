/**
 * Has the iPhone app shipped? One answer, for everything that needs to know.
 *
 * This is the launch switch. Three things read it and they must never disagree: the announcement
 * page at `/launch` does not exist until it returns a link, `app/sitemap.ts` does not list that
 * page until it does, and `/api/jobs/launch-email` refuses to mail the waitlist without one. A
 * page live before the store listing is a dead Download button in front of everyone we invited;
 * an email whose only button 404s cannot be recalled. Splitting the check in three is how those
 * drift apart.
 *
 * Setting the secret is enough to flip all three. `wrangler secret put` publishes a new Worker
 * version, which changes CF_VERSION, which is part of the page cache key in worker/index.ts — so
 * no deploy is needed on the day, and nothing has to be edited under time pressure.
 *
 * ---
 *
 * Why the import is inside the function, which looks like an affectation and is not.
 *
 * `import { env } from "cloudflare:workers"` at the top of a module puts `cloudflare:workers` into
 * the module graph of everything that imports it. A page is rendered in plain Node in two places
 * that have no such module — `tests/rendered-html.test.mjs` and vinext's own prerender — and both
 * fail at load with ERR_UNSUPPORTED_ESM_URL_SCHEME before a line of the page runs. That is not a
 * failure of the page under test; it is a failure to import it.
 *
 * Doing it dynamically keeps the specifier out of the static graph, so a page that imports this
 * module still loads anywhere, and only actually rendering `/launch` needs a Worker. `app/sitemap.ts`
 * reaches for `env` the same way and for the same reason.
 *
 * `app/appstore.ts` is deliberately not the home for this. That module talks to Apple's App Store
 * Server API, imports `cloudflare:workers` at the top, and is only ever reached from an API route —
 * importing it from a page would reintroduce exactly the problem above.
 */
export async function appStoreListingUrl(): Promise<string | null> {
  const { env } = await import("cloudflare:workers");
  // Trimmed before the test, because the realistic wrong value is a fumbled `wrangler secret put`
  // leaving whitespace or an empty string — both of which must read as "not shipped", not as a link.
  const value = ((env as unknown as Record<string, string>).APP_STORE_URL || "").trim();
  // startsWith rather than a regex: an escaped `\/\/` inside a regex literal reads as the start of
  // a comment to the source-scanning the tests do, which silently truncated this very check once.
  return value.startsWith("https://apps.apple.com/") ? value : null;
}
