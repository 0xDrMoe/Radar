"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import RadarMark from "../../RadarMark";
import ChromeLink from "../../ChromeLink";
// ChromeLinks, not next-intl's <Link> (app/ChromeLink.tsx): for a reader without a session cookie a
// plain page load, which the Worker answers without a render - a reader who opens this from an
// email is often signed out, and the home page is baked and their dashboard a redirect the Worker
// answers itself - where a client-side link's flight is a render every time. For a reader with the
// cookie, a client-side navigation.
import { useApiErrorText, type ApiErrorBody } from "../../api-error-text";

export default function UnsubscribeForm({email,token}:{email:string;token:string}) {
  const t = useTranslations("unsubscribe");
  // The route's refusal is English; the reader reads its meaning in their own language, by code.
  const apiErrorText = useApiErrorText();
  const [state,setState] = useState<"idle"|"busy"|"done"|"error">("idle"),[message,setMessage] = useState("");
  // A failed request (offline, dropped connection) is an error like any other, not a button left on
  // "Updating…" for good.
  async function unsubscribe() { setState("busy"); let response: Response; try { response = await fetch("/api/email/unsubscribe",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,token})}); } catch { setState("error"); setMessage(t("couldNotComplete")); return; } const result = await response.json().catch(() => ({})) as ApiErrorBody; if (!response.ok) { setState("error"); setMessage(apiErrorText.message(result, t("couldNotComplete"))); } else { setState("done"); setMessage(t("unsubscribed")); } }
  return <div className="unsubscribe-card"><ChromeLink className="brand" href="/"><RadarMark />Radar<i>.</i></ChromeLink><h1>{t("heading")}</h1>{/* One status region, mounted from the start, so the confirmation is read when it lands. */}<p role="status">{state === "done" ? message : ""}</p>{state === "done" ? null : <><p>{t.rich("stopRoundups",{email:email || t("thisAddress"),b:(chunks) => <b>{chunks}</b>})}</p><button className="destructive" onClick={unsubscribe} disabled={state === "busy" || !email || !token}>{state === "busy" ? t("updating") : t("unsubscribeButton")}</button>{message && <p role="alert">{message}</p>}</>}<ChromeLink href="/dashboard/alerts">{t("manageGranular")}</ChromeLink></div>;
}
