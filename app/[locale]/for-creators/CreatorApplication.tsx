"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import NextLink from "next/link";
import ChromeLink from "../../ChromeLink";
import Turnstile from "../../Turnstile";
import { useApiErrorText, type ApiErrorBody } from "../../api-error-text";
import { fetchSession } from "../../session-cache";

// Four states, and the form is only one of them. Which one applies is a question only the server
// can answer (is this account already a creator? is there an application waiting?), so the page
// asks on mount rather than rendering a form someone is not allowed to submit and failing them
// after they have filled it in.
type Status =
  | { kind: "loading" }
  | { kind: "anonymous" }
  | { kind: "creator"; handle: string }
  | { kind: "pending"; handle: string }
  | { kind: "rejected"; reason: string | null }
  | { kind: "form" };

interface ApplicationResponse {
  application?: { requested_handle?: string; status?: string; rejection_reason?: string | null } | null;
  creator?: { handle: string; status: string } | null;
}

export default function CreatorApplication({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const t = useTranslations("creatorApplication");
  const locale = useLocale();
  const apiErrorText = useApiErrorText();
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; fields?: Record<string, string> } | null>(null);
  // Set by a successful submit. The form, and the button that had focus, are replaced by whichever
  // card the server's answer selects; that card's heading takes focus so the outcome is read out
  // rather than focus falling to the top of the page.
  const submitted = useRef(false);
  const outcomeHeading = useCallback((el: HTMLHeadingElement | null) => {
    if (el && submitted.current) { submitted.current = false; el.focus(); }
  }, []);

  const load = useCallback(async () => {
    // Asked of the session the header has already fetched, before the applications route: that
    // route answers a signed-out reader with a 401, which the browser logs as a failed request on
    // every anonymous visit to this page.
    if (!(await fetchSession())) { setStatus({ kind: "anonymous" }); return; }
    const response = await fetch("/api/creator-applications");
    if (response.status === 401) { setStatus({ kind: "anonymous" }); return; }
    const body = await response.json().catch(() => ({})) as ApplicationResponse;
    if (body.creator) { setStatus({ kind: "creator", handle: body.creator.handle }); return; }
    const application = body.application;
    if (application?.status === "pending") { setStatus({ kind: "pending", handle: String(application.requested_handle || "") }); return; }
    if (application?.status === "rejected") { setStatus({ kind: "rejected", reason: application.rejection_reason || null }); return; }
    setStatus({ kind: "form" });
  }, []);

  // Which of the four states applies is a server fact, fetched once on mount — a legitimate
  // sync-with-an-external-system effect, not a value that could be derived during render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    let response: Response;
    try {
      response = await fetch("/api/creator-applications", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
    } catch {
      setBusy(false);
      setError({ message: t("failed") });
      return;
    }
    const body = await response.json().catch(() => ({})) as ApiErrorBody;
    setBusy(false);
    // In the reader's language, chosen from the error's code and field names, not the server's English.
    if (!response.ok) {
      const fields = apiErrorText.fields(body);
      setError({ message: apiErrorText.message(body, t("failed")), fields });
      if (fields && Object.keys(fields).length) requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    // Re-read rather than assuming: the server decides what state this account is in now.
    submitted.current = true;
    setStatus({ kind: "loading" });
    load();
  }

  if (status.kind === "loading") return <div className="creator-apply-card"><p role="status">{t("loading")}</p></div>;

  // A ChromeLink (app/ChromeLink.tsx): this card is for a reader the server does not know, who gets
  // a page load of the baked sign-in page. As a client-side <Link> it fetched sign-in's flight, a
  // render on every click. Back to this page afterwards, in the language it was read in.
  if (status.kind === "anonymous")
    return <div className="creator-apply-card">
      <h2>{t("signInHeading")}</h2>
      <p>{t("signInBody")}</p>
      <ChromeLink className="primary button-link" href={`/sign-in?redirect_url=${encodeURIComponent(`/${locale}/for-creators`)}`}>{t("signIn")}</ChromeLink>
    </div>;

  if (status.kind === "creator")
    return <div className="creator-apply-card">
      <h2 ref={outcomeHeading} tabIndex={-1}>{t("alreadyHeading")}</h2>
      <p>{t("alreadyBody", { handle: status.handle })}</p>
      {/* Operator route, outside the locale tree — plain next/link, the same split SiteHeader
          and the dashboard sidebar already make for /creator, /portal and /admin, and unprefetched
          like them (see i18n/navigation.ts). */}
      <NextLink className="primary button-link" href="/creator" prefetch={false}>{t("openWorkspace")}</NextLink>
    </div>;

  if (status.kind === "pending")
    return <div className="creator-apply-card">
      <h2 ref={outcomeHeading} tabIndex={-1}>{t("pendingHeading")}</h2>
      <p>{t("pendingBody", { handle: status.handle })}</p>
    </div>;

  if (status.kind === "rejected")
    return <div className="creator-apply-card">
      <h2 ref={outcomeHeading} tabIndex={-1}>{t("rejectedHeading")}</h2>
      <p>{status.reason || t("rejectedBody")}</p>
    </div>;

  return <form className="restaurant-inquiry creator-apply-form" onSubmit={submit} noValidate>
    <label className="wide">{t("handleLabel")}
      <input name="handle" aria-invalid={error?.fields?.handle ? true : undefined} aria-describedby={error?.fields?.handle ? "creator-handle-error" : undefined} required maxLength={32} placeholder={t("handlePlaceholder")} autoComplete="off" />
      <small>{t("handleHint")}</small>
      {error?.fields?.handle && <small className="field-error" id="creator-handle-error">{error.fields.handle}</small>}
    </label>
    <label className="wide">{t("channelLabel")}
      <input name="channelUrl" aria-invalid={error?.fields?.channelUrl ? true : undefined} aria-describedby={error?.fields?.channelUrl ? "creator-channelUrl-error" : undefined} type="url" required placeholder={t("channelPlaceholder")} />
      {error?.fields?.channelUrl && <small className="field-error" id="creator-channelUrl-error">{error.fields.channelUrl}</small>}
    </label>
    <label className="wide">{t("audienceLabel")}
      <textarea name="audience" aria-invalid={error?.fields?.audience ? true : undefined} aria-describedby={error?.fields?.audience ? "creator-audience-error" : undefined} required maxLength={600} placeholder={t("audiencePlaceholder")} />
      {error?.fields?.audience && <small className="field-error" id="creator-audience-error">{error.fields.audience}</small>}
    </label>
    <label className="wide">{t("pitchLabel")}
      <textarea name="pitch" maxLength={1500} placeholder={t("pitchPlaceholder")} />
    </label>
    <Turnstile siteKey={turnstileSiteKey} />
    <small className="wide">{t("agreeNote")}</small>
    <button className="primary" disabled={busy}>{busy ? t("submitting") : t("submit")}</button>
    {error && <p className="form-error wide" role="alert">{error.message}</p>}
  </form>;
}
