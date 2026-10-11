import { env } from "cloudflare:workers";
import { apiError, clientKey, readJson, requireSameOrigin } from "../../api-utils";
import { classifyPath, classifySource, looksAutomated } from "../../pageview";

// One public page was opened. Answers 204 whatever happens to the count - a counter must never be a
// reason for a page to show an error, and a caller learns nothing it could use to probe - except a
// request from another site, which is refused like every other write.
//
// What is written is a counter, not an event (drizzle/0062_pageviews.sql): the day, a few buckets,
// and the country Cloudflare says the request came from. No user, no IP, no cookie, no path.
const noContent = () => new Response(null, { status: 204 });

// A flood of these would spend D1's daily write allowance, which the rest of the site shares, so a
// client is limited here, in memory, and not in D1: a limit that cost a write per request would be
// the very spend it exists to stop. Per isolate, so it bounds one client's rate rather than
// guaranteeing a total - enough, since a counter increment is all that is at stake.
const WINDOW_MS = 60_000;
const LIMIT_PER_WINDOW = 40;
const seen = new Map<string, { windowStart: number; count: number }>();

async function overLimit(): Promise<boolean> {
  const now = Date.now();
  const key = await clientKey("pageview");
  const entry = seen.get(key);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    // Bounded: an isolate that has met this many distinct clients forgets them all rather than grow.
    if (seen.size > 5_000) seen.clear();
    seen.set(key, { windowStart: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > LIMIT_PER_WINDOW;
}

export async function POST(request: Request) {
  try {
    if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
    if (looksAutomated(request.headers.get("user-agent"))) return noContent();
    if (await overLimit()) return noContent();
    const body = await readJson<{ path?: unknown; referrer?: unknown }>(request, 2_000);
    const page = classifyPath(String(body.path ?? ""));
    if (!page) return noContent();
    const host = request.headers.get("host") || new URL(request.url).host;
    const source = classifySource(body.referrer, host);
    const country = /^[A-Z]{2}$/.test(request.headers.get("cf-ipcountry") || "") ? (request.headers.get("cf-ipcountry") as string) : "";
    const day = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      "INSERT INTO pageviews_daily(day,kind,locale,country,source,views) VALUES(?,?,?,?,?,1) ON CONFLICT(day,kind,locale,country,source) DO UPDATE SET views=views+1",
    ).bind(day, page.kind, page.locale, country, source).run();
  } catch {
    // Nothing to tell the caller.
  }
  return noContent();
}
