"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Heart, Share2 } from "lucide-react";
import { useApiErrorText, type ApiErrorBody } from "../../../api-error-text";

export default function DetailActions({ dealId }:{ dealId:string }) {
  const locale = useLocale();
  const t = useTranslations("detailActions");
  const apiErrorText = useApiErrorText();
  const [saved,setSaved] = useState(false),[notice,setNotice] = useState(""),[reporting,setReporting] = useState(false),[busy,setBusy] = useState(false);
  // To sign in and back to this deal. A page load of the sign-in page, which the Worker answers
  // with its baked copy, as the Pro page's upgrade button does after a 401 (app/[locale]/pro/
  // UpgradeCta.tsx): whoever gets here is signed out, and a client-side push fetched sign-in's
  // flight instead, a render on every click.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a page load on purpose, as above
  const signIn = () => window.location.assign(`/${locale}/sign-in?redirect_url=${encodeURIComponent(location.pathname)}`);
  async function save() {
    const previous = saved; setSaved(!saved); setBusy(true); setNotice("");
    const response = await fetch("/api/user",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"favorite",dealId,saved:!saved})});
    if (response.status === 401) { signIn(); return; }
    if (!response.ok) { setSaved(previous); const result = await response.json().catch(() => ({})) as ApiErrorBody; setNotice(apiErrorText.message(result, t("couldNotUpdateSaved"))); }
    else setNotice(!previous ? t("savedToDashboard") : t("removedFromSaved"));
    setBusy(false);
  }
  async function share() {
    const url = location.href;
    try { if (navigator.share) await navigator.share({title:document.title,url}); else await navigator.clipboard.writeText(url); setNotice(t("shareLinkCopied")); }
    catch (cause) { if (!(cause instanceof Error) || cause.name !== "AbortError") setNotice(t("shareCouldNotCopy")); }
  }
  async function report(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); const values = new FormData(event.currentTarget);
    const response = await fetch("/api/reports",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({dealId,category:values.get("category"),notes:values.get("notes"),sourceUrl:values.get("sourceUrl")})});
    if (response.status === 401) { signIn(); return; }
    const result = await response.json().catch(() => ({})) as ApiErrorBody & { underReview?: boolean }; setBusy(false);
    if (!response.ok) { setNotice(apiErrorText.message(result, t("reportNotSent"))); return; }
    setReporting(false); setNotice(t(result.underReview ? "reportSentRechecking" : "reportSent"));
  }
  async function openReport() {
    const response = await fetch("/api/session");
    const body = await response.json().catch(() => ({})) as { user?: unknown };
    if (!body.user) { signIn(); return; }
    setReporting(true);
  }
  return <>
    <div className="detail-action-row"><button className="primary" onClick={save} disabled={busy}><Heart fill={saved ? "currentColor" : "none"}/>{saved ? t("saved") : t("save")}</button><button onClick={share}><Share2/>{t("share")}</button><button onClick={openReport}>{t("reportIncorrectInfo")}</button></div>
    {/* Always mounted so "Saved" and "Report sent" are read when they appear. */}
    <p className="detail-notice" role="status">{notice}</p>
    {reporting && <div className="detail-report"><form onSubmit={report}><h2>{t("reportIncorrectInfo")}</h2><label>{t("whatIsWrong")}<select name="category"><option value="deal_ended">{t("dealEnded")}</option><option value="incorrect_price">{t("incorrectPrice")}</option><option value="incorrect_schedule">{t("incorrectSchedule")}</option><option value="restaurant_closed">{t("restaurantClosed")}</option><option value="wrong_location">{t("wrongLocation")}</option><option value="misleading_terms">{t("misleadingTerms")}</option><option value="duplicate_listing">{t("duplicateListing")}</option></select></label><label>{t("details")}<textarea name="notes" maxLength={1000}/></label><label>{t("supportingSource")}<input type="url" name="sourceUrl"/></label><div><button type="button" onClick={() => setReporting(false)}>{t("cancel")}</button><button className="primary" disabled={busy}>{t("sendReport")}</button></div></form></div>}
  </>;
}
