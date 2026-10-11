"use client";
import { useTranslations } from "next-intl";
import { Bell, Lock, Mail, MapPin, ShieldCheck } from "lucide-react";
import { ProLock } from "../../../ProBadge";
import { Link } from "../../../../i18n/navigation";
import { FREE_ALERT_TIME } from "../../../plan-limits";
import { maxRadiusKm } from "../../../radius";
import { alertDaysOf, consentState, ProUpsell, type NotificationPreference, type SectionProps } from "../dashboard-shared";

// Deal alerts, as the three things they need in the order they need them: an email address that
// has said yes, a schedule, and a test that it arrives. The page used to be one form with a status
// pill in its corner, so somebody whose consent was still pending filled in a schedule, saved it,
// and was told the switch could not be turned on, with no word of why until they read the pill.
export default function AlertsSection({ data, pro, busy, mutate, reload, setNotice }: SectionProps) {
  const t = useTranslations("dashboard");
  const p = data.profile, consent = data.consent?.status, confirmed = consent === "confirmed";
  const pref:Partial<NotificationPreference> = data.notificationPreferences?.[0] || {};
  const alertDays = alertDaysOf(pref);
  const dayValues: Array<[string,string]> = [["1",t("alerts.dayMon")],["2",t("alerts.dayTue")],["3",t("alerts.dayWed")],["4",t("alerts.dayThu")],["5",t("alerts.dayFri")],["6",t("alerts.daySat")],["0",t("alerts.daySun")]];
  // The roundup covers the default tracked area when there is one, as the digest job decides. Only
  // without one does the home postal place it, so only then is it asked for.
  // A paused area is not one: the job reads active areas only, and so does the server's check.
  const areas = data.locations || [], area = areas.find((entry) => entry.is_default && entry.active) || areas.find((entry) => entry.active);
  // Free plans get one alert day, not a multi-select. Enforced server-side in /api/user and again by
  // the digest job; this only keeps the checkbox row behaving like a radio group without converting
  // the whole uncontrolled form to controlled state.
  function onFreeDayToggle(event:React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.checked) return;
    event.target.form?.querySelectorAll<HTMLInputElement>('input[name="days"]').forEach((box) => { if (box !== event.target) box.checked = false; });
  }
  async function saveAlerts(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    if (await mutate({action:"preferences",postal:area ? null : values.get("postal"),enabled:values.get("enabled") === "on",days:values.getAll("days"),time:values.get("time")},t("alerts.settingsSaved"))) await reload();
  }
  // The server says where the request stands, and that decides the sentence: a confirmation email
  // is on its way, the alerts were already confirmed, or they are waiting for a place in the pilot.
  async function requestConsent(language:string) {
    const result = await mutate({action:"request_email_consent",language},t("alerts.waitlistRecorded"));
    if (!result) return;
    if (result.status === "pending") setNotice(t("alerts.consentCheckEmail"));
    else if (result.status === "confirmed") setNotice(t("alerts.consentAlreadyConfirmed"));
    await reload();
  }
  return <>
    <section className="portal-card dash-step"><div className="portal-card-head"><div><span className="kicker">{t("alerts.kicker")}</span><h2>{t("alerts.heading")}</h2><p className="dash-card-note"><span className="dash-step-number">1</span>{t("alerts.stepConsent")}</p></div><span className={`status ${confirmed ? "on" : ""}`}>{t(`alerts.consentStatus.${consentState(data.consent?.status)}`)}</span></div>
      <p className="dash-card-note">{t("alerts.neverOptIn")}</p>
      {consent === "waitlisted" ? <div className="launch-note"><ShieldCheck/><div><b>{t("alerts.waitlistedTitle")}</b><p>{t("alerts.waitlistedBody")}</p></div></div>
        : consent === "pending" ? <div className="launch-note"><Mail/><div><b>{t("alerts.pendingTitle")}</b><p>{t("alerts.pendingBody",{email:p.email})}</p></div></div>
        : confirmed ? <div className="launch-note"><ShieldCheck/><div><b>{t("alerts.confirmedTitle")}</b><p>{t("alerts.confirmedBody",{email:p.email})}</p></div></div>
        : <div className="launch-note"><ShieldCheck/><div><b>{t("alerts.notEnabledTitle")}</b><p>{t("alerts.notEnabledBody")}</p><button className="primary" disabled={busy === "request_email_consent"} onClick={() => requestConsent(p.language)}>{t("alerts.joinWaitlist")}</button></div></div>}
    </section>
    <section className="portal-card dash-step"><div className="portal-card-head"><div><h2>{t("alerts.scheduleHeading")}</h2><p className="dash-card-note"><span className="dash-step-number">2</span>{t("alerts.stepSchedule")}</p></div>{pro && <span className="sponsor-status">{t("account.proBadge")}</span>}</div>
      {!pro && <ProUpsell icon={Bell} title={t("alerts.freeTierTitle")} body={t("alerts.freeTierBody")} cta={t("areas.upgrade")}/>}
      <form className="preferences" onSubmit={saveAlerts}>
        {area
          ? <p className="wide dash-covers"><MapPin aria-hidden="true"/><span>{t("alerts.coversArea",{area:area.label || area.postal,radius:Math.min(area.radius || 0,maxRadiusKm(pro))})}</span><Link href="/dashboard/areas">{t("alerts.changeArea")}</Link></p>
          : <label>{t("alerts.homePostal")}<input name="postal" autoComplete="postal-code" defaultValue={p.home_postal || ""} placeholder={t("alerts.postalPlaceholder")} required/><small className="dash-field-note">{t("alerts.homePostalHint")}</small></label>}
        <label><span className="pro-field-label">{t("alerts.deliveryTime")}{!pro && <ProLock title={t("alerts.timeLockTitle")}/>}</span><input type="time" name="time" defaultValue={pro ? (pref.delivery_time || FREE_ALERT_TIME) : FREE_ALERT_TIME} disabled={!pro}/>{!pro && <span className="pro-hint"><Lock/>{t("alerts.timeHint")}</span>}</label>
        <fieldset className="wide day-fieldset" aria-describedby={pro ? undefined : "alert-days-hint"}><legend className="pro-field-label">{t("alerts.deliveryDays")}{!pro && <ProLock title={t("alerts.daysLockTitle")}/>}</legend>{/* Without this line a free user ticks a second day, watches the first one silently untick itself, and has no way to know that is the plan limit rather than a bug. */}{!pro && <span className="pro-hint" id="alert-days-hint"><Lock/>{t("alerts.daysHint")}</span>}<div className="portal-days">{dayValues.map(([value,label]) => <label key={value}><input type="checkbox" name="days" value={value} defaultChecked={pro ? alertDays.includes(value) : alertDays[0] === value || (!alertDays.length && value === "1")} onChange={pro ? undefined : onFreeDayToggle}/><span>{label}</span></label>)}</div></fieldset>
        <label className="toggle wide" htmlFor="alerts-enabled-toggle" aria-label={t("alerts.emailRoundup")}><input id="alerts-enabled-toggle" type="checkbox" role="switch" aria-describedby="alerts-enabled-hint" name="enabled" defaultChecked={!!pref.enabled} disabled={!confirmed}/><span></span><div><b>{t("alerts.emailRoundup")}</b><small id="alerts-enabled-hint">{confirmed ? t("alerts.onlySelectedDays") : t("alerts.confirmationRequired")}</small></div></label>
        <button className="primary" disabled={busy === "preferences"}>{t("alerts.saveSettings")}</button>
      </form>
    </section>
    {confirmed && <section className="portal-card dash-step"><div className="portal-card-head"><div><h2>{t("alerts.verifyTitle")}</h2><p className="dash-card-note"><span className="dash-step-number">3</span>{t("alerts.verifyBody")}</p></div></div><button onClick={() => mutate({action:"send_test_email"},t("alerts.testSent"))} disabled={busy === "send_test_email"}>{t("alerts.sendTest")}</button><p className="dash-card-note">{t("alerts.stopHint")} <Link href="/dashboard/privacy">{t("alerts.stopLink")}</Link></p></section>}
  </>;
}
