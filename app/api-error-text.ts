"use client";
import { useTranslations } from "next-intl";
import { useMemo } from "react";

// What the API sends back when it refuses something: app/api-utils.ts apiError().
export type ApiErrorBody = {
  error?: { code?: string; message?: string; fields?: Record<string, string> } | string;
};

// The routes write their messages in English, and the forms used to show them as they came: a
// reader on /fr who left a field empty read "Required", and one whose challenge had expired read
// "Please complete the verification and try again." Those words are for the reader, so they are
// chosen here, in the reader's language, from what the server means rather than what it said: the
// error's `code`, and for a field error the field's name. The server's text is kept for logs and
// for API clients that are not a page.
//
// Every field the public forms can have refused, by the message it gets. A field that is not listed
// still gets a sentence in the reader's language, just a less specific one.
const FIELD_MESSAGES: Record<string, string> = {
  restaurant: "required",
  deal: "required",
  schedule: "required",
  relationship: "required",
  audience: "required",
  postal: "postal",
  email: "email",
  source: "source",
  expiresAt: "expiresAt",
  handle: "handle",
  channelUrl: "channelUrl",
  days: "days",
};

// A duplicate suggestion names the review it is waiting in (app/api/suggestions: BL-<year>-<hex>),
// which is worth keeping: it is what the reader would quote to support.
const REFERENCE = /\bBL-\d{4}-[0-9A-F]{8}\b/;

export function useApiErrorText() {
  const t = useTranslations("apiErrors");
  return useMemo(() => {
    function message(body: ApiErrorBody | null | undefined, fallback: string): string {
      const error = body?.error;
      if (!error || typeof error === "string" || !error.code) return fallback;
      if (error.code === "DUPLICATE_SUGGESTION") {
        const reference = error.message?.match(REFERENCE)?.[0];
        return reference ? t("duplicateSuggestionWithReference", { reference }) : t("codes.DUPLICATE_SUGGESTION");
      }
      const key = `codes.${error.code}`;
      return t.has(key) ? t(key) : fallback;
    }
    function fields(body: ApiErrorBody | null | undefined): Record<string, string> | undefined {
      const error = body?.error;
      if (!error || typeof error === "string" || !error.fields) return undefined;
      return Object.fromEntries(Object.keys(error.fields).map((name) => [name, t(`fields.${FIELD_MESSAGES[name] || "invalid"}`)]));
    }
    return { message, fields };
  }, [t]);
}
