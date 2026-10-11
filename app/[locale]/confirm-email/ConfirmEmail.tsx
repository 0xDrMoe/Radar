"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import RadarMark from "../../RadarMark";
import ChromeLink from "../../ChromeLink";
// ChromeLinks, not next-intl's <Link> (app/ChromeLink.tsx): for a reader without a session cookie a
// plain page load, which the Worker answers without a render - a reader who opens this from an
// email is often signed out, and the home page is baked and their dashboard a redirect the Worker
// answers itself - where a client-side link's flight is a render every time. For a reader with the
// cookie, a client-side navigation.
import { useApiErrorText, type ApiErrorBody } from "../../api-error-text";

export default function ConfirmEmail({email,token}:{email:string;token:string}) {
  const t = useTranslations("confirmEmail");
  // The route's refusal is English; the reader reads its meaning in their own language, by code.
  // Memoized on the translator, so listing it below does not re-run the confirmation.
  const apiErrorText = useApiErrorText();
  const [state,setState] = useState("confirming"),[message,setMessage] = useState(t("confirming"));
  useEffect(() => { let active = true; fetch("/api/email/confirm",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,token})}).then(async (response) => { const result = await response.json().catch(() => ({})) as ApiErrorBody & { kind?: string }; if (!active) return; if (response.ok) { const waitlist = result.kind === "waitlist"; setState(waitlist ? "waitlist" : "done"); setMessage(t(waitlist ? "waitlistConfirmed" : "confirmed")); } else { setState("error"); setMessage(apiErrorText.message(result, t("couldNotComplete"))); } }); return () => {active = false;}; },[email,token,t,apiErrorText]);
  return <div className="unsubscribe-card"><ChromeLink className="brand" href="/"><RadarMark />Radar<i>.</i></ChromeLink><h1>{t("heading")}</h1><p role="status" className={state === "error" ? "form-error" : ""}>{message}</p>{state === "done" && <ChromeLink href="/dashboard/alerts">{t("chooseAlertDays")}</ChromeLink>}{state === "error" && <ChromeLink href="/dashboard/alerts">{t("requestNewConfirmation")}</ChromeLink>}</div>;
}
