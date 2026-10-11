import { env } from "cloudflare:workers";
import { apiError, hasJobSecret } from "../../../api-utils";
import { translateDealFields } from "../../../translation";

const TARGET_LOCALES = ["fr", "es"] as const;
const DEFAULT_BATCH_SIZE = 25;
// Generous ceiling so a manual `?limit=` backfill call right after deploy can clear the existing
// catalog in one shot instead of waiting for the hourly steady-state batch to work through it —
// still bounded so a mistaken huge value can't run the job away.
const MAX_BATCH_SIZE = 300;

interface StaleDealRow {
  id: string;
  title: string;
  description: string | null;
  schedule: string;
  price: string;
  terms: string | null;
  restrictions: string | null;
  updated_at: string;
}

export async function POST(request: Request) {
  const runtime = env as unknown as Record<string, string>;
  if (!hasJobSecret(request, runtime.TRANSLATE_JOB_SECRET)) {
    return apiError(401, "INVALID_SCHEDULER", "Scheduler authentication failed.");
  }

  const url = new URL(request.url);
  const batchSize = Math.max(1, Math.min(MAX_BATCH_SIZE, Number(url.searchParams.get("limit")) || DEFAULT_BATCH_SIZE));

  const started = new Date();
  const jobId = `translate:${started.toISOString().slice(0, 13)}`;
  const claimed = await env.DB.prepare(
    "INSERT OR IGNORE INTO translation_job_runs(id,status,started_at) VALUES(?,'running',CURRENT_TIMESTAMP)",
  ).bind(jobId).run();
  if (!claimed.meta.changes) return Response.json({ ok: true, duplicate: true, jobId });

  let translated = 0;
  let failed = 0;
  const details: Record<string, { translated: number; failed: number }> = {};

  // DeepL isn't configured — record the run as skipped (not failed) so this shows up as an
  // expected, visible no-op in translation_job_runs rather than silently doing nothing.
  if (!runtime.DEEPL_API_KEY) {
    await env.DB.prepare(
      "UPDATE translation_job_runs SET status='skipped',finished_at=CURRENT_TIMESTAMP,details=? WHERE id=?",
    ).bind(JSON.stringify({ reason: "DEEPL_API_KEY not configured" }), jobId).run();
    return Response.json({ ok: true, jobId, status: "skipped", reason: "Translation provider not configured." });
  }

  for (const locale of TARGET_LOCALES) {
    let localeTranslated = 0;
    let localeFailed = 0;
    const stale = await env.DB.prepare(
      `SELECT d.id,d.title,d.description,d.schedule,d.price,d.terms,d.restrictions,d.updated_at
       FROM deals d
       LEFT JOIN deal_translations t ON t.deal_id = d.id AND t.locale = ?
       WHERE d.deleted_at IS NULL
         AND (t.deal_id IS NULL OR datetime(t.source_updated_at) < datetime(d.updated_at))
       ORDER BY d.updated_at DESC
       LIMIT ?`,
    ).bind(locale, batchSize).all<StaleDealRow>();

    for (const deal of stale.results) {
      const result = await translateDealFields(
        { title: deal.title, description: deal.description, schedule: deal.schedule, price: deal.price, terms: deal.terms, restrictions: deal.restrictions },
        locale,
      );
      if (!result) { localeFailed++; continue; }
      await env.DB.prepare(
        `INSERT INTO deal_translations(deal_id,locale,title,description,schedule,price,terms,restrictions,source_updated_at,translated_at)
         VALUES(?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
         ON CONFLICT(deal_id,locale) DO UPDATE SET
           title=excluded.title,description=excluded.description,schedule=excluded.schedule,price=excluded.price,
           terms=excluded.terms,restrictions=excluded.restrictions,source_updated_at=excluded.source_updated_at,translated_at=CURRENT_TIMESTAMP`,
      ).bind(
        deal.id, locale,
        result.title ?? null, result.description ?? null, result.schedule ?? null, result.price ?? null, result.terms ?? null, result.restrictions ?? null,
        deal.updated_at,
      ).run();
      localeTranslated++;
    }
    translated += localeTranslated;
    failed += localeFailed;
    details[locale] = { translated: localeTranslated, failed: localeFailed };
  }

  if (failed) {
    await env.DB.prepare(
      "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,details) VALUES('system:cron','system','deal_translation_failed','job','translate',?)",
    ).bind(JSON.stringify(details).slice(0, 1500)).run();
  }

  await env.DB.prepare(
    "UPDATE translation_job_runs SET status=?,translated=?,details=?,finished_at=CURRENT_TIMESTAMP WHERE id=?",
  ).bind(failed ? "completed_with_errors" : "completed", translated, JSON.stringify(details), jobId).run();

  return Response.json({ ok: true, jobId, translated, failed, details });
}
