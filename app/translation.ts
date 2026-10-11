import { env } from "cloudflare:workers";

// Auto-translates a deal's free-text fields for the translation cron (app/api/jobs/translate).
// Mirrors app/geocode.ts's graceful-degradation shape on purpose: a missing key or a failed call
// returns null rather than throwing, so a translation hiccup never blocks the job (that deal is
// just picked up again next tick) and never surfaces as an error to a site visitor, who simply
// keeps seeing the English fallback for that field. Category/cuisine are NOT handled here — see
// app/i18n/staticEnums.ts — they're a small fixed vocabulary, not free text worth paying to
// machine-translate per deal.
export type TranslatableDealFields = {
  title: string;
  description: string | null;
  schedule: string;
  price: string;
  terms: string | null;
  restrictions: string | null;
};

export type TranslatedDealFields = Partial<Record<keyof TranslatableDealFields, string>>;

interface DeepLResponse {
  translations?: Array<{ text: string }>;
}

// DeepL's free-tier keys are conventionally suffixed ":fx" and only work against the separate
// api-free host; pro keys use the standard host. Letting the key's own shape pick the endpoint
// avoids a second secret/config value just to say which plan is active.
function deeplEndpoint(apiKey: string) {
  return apiKey.endsWith(":fx") ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate";
}

export async function translateDealFields(
  fields: TranslatableDealFields,
  targetLocale: "fr" | "es",
): Promise<TranslatedDealFields | null> {
  const runtime = env as unknown as Record<string, string>;
  if (!runtime.DEEPL_API_KEY) return null;
  const keys = (Object.keys(fields) as (keyof TranslatableDealFields)[]).filter((key) => fields[key]?.trim());
  if (!keys.length) return null;
  try {
    const response = await fetch(deeplEndpoint(runtime.DEEPL_API_KEY), {
      method: "POST",
      headers: { Authorization: `DeepL-Auth-Key ${runtime.DEEPL_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({
        text: keys.map((key) => fields[key] as string),
        target_lang: targetLocale.toUpperCase(),
        source_lang: "EN",
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as DeepLResponse;
    if (!body.translations || body.translations.length !== keys.length) return null;
    const result: TranslatedDealFields = {};
    keys.forEach((key, index) => {
      const text = body.translations![index]?.text;
      if (text) result[key] = text;
    });
    return result;
  } catch {
    return null;
  }
}
