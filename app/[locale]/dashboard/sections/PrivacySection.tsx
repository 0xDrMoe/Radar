"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Download, MapPin, MailX } from "lucide-react";
import { Link } from "../../../../i18n/navigation";
import { useApiErrorText, type ApiErrorBody } from "../../../api-error-text";
import { consentState, type SectionProps } from "../dashboard-shared";

// What Radar keeps about the reader and the controls over it, together: a copy of their data, what
// is known about where they are, the alert-email consent and a way to withdraw it, and deleting the
// account. These were the last lines of a long account page, under the billing controls.
//
// Downloading your own data is not an "export" in the staff workspace's sense and is not limited to
// any role: it is the reader's right of access (PIPEDA, Quebec's Law 25), and the route only ever
// answers with the signed-in account's own rows (app/account-export.ts).
export default function PrivacySection({ data, busy, mutate, reload }: SectionProps) {
  const t = useTranslations("dashboard"), locale = useLocale();
  const apiErrorText = useApiErrorText();
  const p = data.profile, consent = data.consent?.status;
  // Deleting the account, here rather than by email: the same typed confirmation and the same
  // server action the app's Delete Account screen uses (delete_account in app/api/user/route.ts).
  const [deletingAccount,setDeletingAccount] = useState(false),[deleteConfirm,setDeleteConfirm] = useState(""),[deleteError,setDeleteError] = useState(""),[deleting,setDeleting] = useState(false);
  // The deletion request is an email written in the reader's language: the subject names the
  // request and the body names the account, so support can act on it without asking which one.
  const deletionMailto = `mailto:support@cedartechsolutions.ca?subject=${encodeURIComponent(t("account.deletionEmailSubject"))}&body=${encodeURIComponent(t("account.deletionEmailBody", { email: p.email }))}`;
  const subscribed = consent === "confirmed" || consent === "pending" || consent === "waitlisted";
  async function deleteAccount() {
    setDeleting(true); setDeleteError("");
    try {
      const response = await fetch("/api/user",{ method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ action:"delete_account",confirm:"DELETE" }) });
      const result = await response.json().catch(() => ({})) as ApiErrorBody;
      if (!response.ok) { setDeleteError(apiErrorText.message(result,t("account.deleteFailed"))); return; }
      // The account, its session and its subscription on the web are gone server-side. The home page
      // is the only place left to go, as a signed-out reader.
      window.location.assign(`/${locale}`);
    } catch { setDeleteError(t("account.deleteFailed")); }
    finally { setDeleting(false); }
  }
  async function stopEmail() { if (await mutate({action:"revoke_email_consent"},t("privacy.emailStopped"))) await reload(); }
  return <>
    <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("privacy.kicker")}</span><h2>{t("privacy.heading")}</h2></div></div>
      <div className="dash-privacy-row"><Download aria-hidden="true"/><div><b>{t("privacy.downloadTitle")}</b><p>{t("privacy.downloadBody")}</p></div><a className="primary" href="/api/user/export">{t("account.downloadData")}</a></div>{/* eslint-disable-line @next/next/no-html-link-for-pages -- a downloadable API response, not an app page; Link would let Next prefetch it on hover and run the export */}
      <div className="dash-privacy-row"><MapPin aria-hidden="true"/><div><b>{t("privacy.locationTitle")}</b><p>{t("privacy.locationBody",{count:data.locations?.length || 0})}</p></div><Link href="/dashboard/areas">{t("privacy.locationCta")}</Link></div>
      <div className="dash-privacy-row"><MailX aria-hidden="true"/><div><b>{t("privacy.emailTitle")} <span className={`status ${consent === "confirmed" ? "on" : ""}`}>{t(`alerts.consentStatus.${consentState(consent)}`)}</span></b><p>{subscribed ? t("privacy.emailBodySubscribed") : t("privacy.emailBodyNone")}</p></div>{subscribed ? <button type="button" disabled={busy === "revoke_email_consent"} onClick={stopEmail}>{t("privacy.emailStop")}</button> : <Link href="/dashboard/alerts">{t("privacy.emailManage")}</Link>}</div>
      <div className="account-legal-links"><Link href="/privacy">{t("account.privacyPolicy")}</Link><Link href="/terms">{t("account.termsOfService")}</Link></div>
    </section>
    <section className="portal-card"><div className="portal-card-head"><div><h2>{t("account.deleteAccount")}</h2><p className="dash-card-note">{t("privacy.deleteNote")}</p></div>{!deletingAccount && <button type="button" className="danger" onClick={() => { setDeleteConfirm(""); setDeleteError(""); setDeletingAccount(true); }}>{t("account.deleteAccount")}</button>}</div>
      {/* What goes is said before it goes, because nobody can look afterwards. A web subscription is canceled by the server first; an App Store one only its subscriber can cancel, which is why it is named. Typing DELETE, not a second click: a word has to be meant. */}{deletingAccount && <div className="cancel-survey delete-account"><h3>{t("account.deleteTitle")}</h3><p>{t("account.deleteBody")}</p><p>{t("account.deleteSubscription")}</p><label className="wide">{t("account.deleteConfirmLabel")}<input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} aria-describedby="delete-account-error"/></label><p id="delete-account-error" className="field-error" role="alert">{deleteError}</p><div className="cancel-actions"><button type="button" className="primary" onClick={() => setDeletingAccount(false)}>{t("account.deleteKeep")}</button><button type="button" className="danger" disabled={deleteConfirm.trim().toUpperCase() !== "DELETE" || deleting} onClick={deleteAccount}>{deleting ? t("account.deleteWorking") : t("account.deleteConfirm")}</button></div><p className="billing-note">{t("account.deleteByEmail")} <a href={deletionMailto}>{t("account.requestDeletion")}</a></p></div>}
    </section>
  </>;
}
