// IndexNow (https://www.indexnow.org): telling Bing, and the search engines that share its submissions
// (Yandex, Naver, Seznam; ChatGPT and Copilot search read Bing's index), which pages changed, rather
// than waiting for a crawl to notice. Google does not take part; its sitemap and crawl stay as they are.
//
// The key is public by design. It proves the submitter controls the host by being served, as the
// whole body of a text file, at /<key>.txt on that host: public/602d8d4ce8bbaf576a0b258628794d49.txt,
// routed through the Worker like every other top-level file (TOP_LEVEL_FILES in worker/index.ts,
// run_worker_first in wrangler.jsonc). tests/indexnow.test.mjs holds the three in step. Changing the
// key means a new file under the new name, not an edit to the old one.
//
// Import-free, because worker/index.ts imports it into the Worker entry.

export const INDEXNOW_KEY = "602d8d4ce8bbaf576a0b258628794d49";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
// The protocol's own ceiling on one submission.
export const INDEXNOW_MAX_URLS = 10_000;

// Submissions name this host only. affiliate.radar.cheap serves the same key file, but nothing on it
// is meant for a search index.
const PRODUCTION_ORIGIN = "https://radar.cheap";

/** Whether this deployment may submit at all: only the production site, never a local run or a test. */
export function indexNowEnabled(publicAppUrl: string | undefined): boolean {
  if (!publicAppUrl) return false;
  try {
    return new URL(publicAppUrl).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * The deal pages whose answer changed in [from, to): published (including a scheduled deal whose
 * publish_at came due), edited, re-checked by staff, confirmed by the owner, retired (expired,
 * archived, paused) or deleted. One window per cron tick, so each change is submitted once.
 *
 * A retired page answers noindex and a deleted one 404s; IndexNow wants those submitted too, so the
 * engine drops them sooner. A draft that never went public is left out unless it was deleted, and
 * then it only ever 404s. datetime() on both sides because the columns hold both SQLite's
 * CURRENT_TIMESTAMP form and ISO strings.
 */
export const CHANGED_DEAL_PAGES_SQL = `
  SELECT d.slug, d.id,
         (SELECT group_concat(t.locale) FROM deal_translations t WHERE t.deal_id=d.id AND t.title IS NOT NULL) translated_locales
    FROM deals d
   WHERE d.slug IS NOT NULL
     AND (
       (d.deleted_at IS NULL AND (
         d.status IN ('live','archived','expired','paused') AND (
              (datetime(d.updated_at) >= datetime(?1) AND datetime(d.updated_at) < datetime(?2))
           OR (datetime(d.verified_at) >= datetime(?1) AND datetime(d.verified_at) < datetime(?2))
           OR (datetime(d.owner_confirmed_at) >= datetime(?1) AND datetime(d.owner_confirmed_at) < datetime(?2))
           OR (datetime(d.publish_at) >= datetime(?1) AND datetime(d.publish_at) < datetime(?2))
         )
       ))
       OR (datetime(d.deleted_at) >= datetime(?1) AND datetime(d.deleted_at) < datetime(?2))
     )
   LIMIT ${INDEXNOW_MAX_URLS}`;

export type ChangedDealRow = { slug: string | null; id: string; translated_locales: string | null };

/**
 * The addresses of each changed deal: /en always, and /fr or /es only where a translation exists,
 * since an untranslated one canonicalizes to /en (translatedAlternates in app/alternates.ts) and is
 * not a page of its own. The same addresses app/sitemap.ts lists.
 */
export function dealPageUrls(rows: readonly ChangedDealRow[], origin = PRODUCTION_ORIGIN): string[] {
  const urls = new Set<string>();
  for (const row of rows) {
    const path = `/deals/${encodeURIComponent(row.slug || row.id)}`;
    urls.add(`${origin}/en${path}`);
    for (const locale of String(row.translated_locales || "").split(",")) {
      if (locale === "fr" || locale === "es") urls.add(`${origin}/${locale}${path}`);
    }
  }
  return [...urls].slice(0, INDEXNOW_MAX_URLS);
}

/** The JSON body of one submission, for URLs on the production host. */
export function indexNowPayload(urls: readonly string[]) {
  const host = new URL(PRODUCTION_ORIGIN).host;
  return {
    host,
    key: INDEXNOW_KEY,
    keyLocation: `${PRODUCTION_ORIGIN}/${INDEXNOW_KEY}.txt`,
    urlList: urls.filter((url) => new URL(url).host === host).slice(0, INDEXNOW_MAX_URLS),
  };
}

/**
 * Submits the URLs. Resolves with the endpoint's status (200 and 202 both mean accepted); throws only
 * on a network failure. Nothing to submit sends nothing.
 */
export async function submitToIndexNow(urls: readonly string[], fetcher: typeof fetch = fetch): Promise<number | null> {
  const payload = indexNowPayload(urls);
  if (!payload.urlList.length) return null;
  const response = await fetcher(INDEXNOW_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  await response.body?.cancel();
  return response.status;
}
