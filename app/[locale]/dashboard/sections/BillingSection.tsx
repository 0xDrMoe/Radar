"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { graceDaysLeft, isPaused, isPaymentFailing } from "../../../entitlement";
import { billingControls } from "../../../billing-controls";
import { onRadioGroupKey, radioTabIndex } from "../../../radio-group-keys";
import { ACCENTS, ACCENT_KEYS } from "../../../theme-accents";
import { FREE_ALERT_DAYS, FREE_ALERT_TIME, FREE_AREA_LIMIT, HISTORY_ROWS } from "../../../plan-limits";
import { maxRadiusKm } from "../../../radius";
import { useApiErrorText, type ApiErrorBody } from "../../../api-error-text";
import type { DiscountTerms, PauseTerms } from "../../../save-offers";
import { formatDay, formatDiscount, type SectionProps } from "../dashboard-shared";

// The plan, what it includes, and every billing control, in one place rather than halfway down the
// account page under the profile form. Each control follows what bills the account rather than
// whether it is on Pro (app/billing-controls.ts): Stripe's for a web subscription, the App Store's
// note for an Apple one, the upgrade for nobody. Stripe Checkout, the portal and the billing emails
// all return here (/dashboard/billing).
//
// The plan table is drawn from app/plan-limits.ts and app/radius.ts, the same numbers /api/user and
// the digest job enforce, so the page cannot promise a limit the server does not keep.
export default function BillingSection({ data, pro, setNotice, reload, upgrade }: SectionProps) {
  const t = useTranslations("dashboard"), locale = useLocale();
  const apiErrorText = useApiErrorText();
  const p = data.profile;
  const [busy,setBusy] = useState("");
  // The cancellation survey. `canceling` opens it, `cancelReason` is the one answer it asks for.
  // Both reset when the dialog closes, so reopening it never shows a stale choice.
  const [canceling,setCanceling] = useState(false),[cancelReason,setCancelReason] = useState("");
  // The offer the server matched to their reason, and the pause length they picked. Held apart from
  // `cancelReason` because the offer is the server's answer, not their input - the browser never
  // decides which offer it is allowed to take.
  // `pauses` and `discount` are the offer's terms as the server worked them out from Stripe, shown
  // word for word: what the discount is and for how long, and for each pause length the day Pro
  // comes back and the day the next charge lands.
  const [saveOffer,setSaveOffer] = useState<{ offer:string|null; pauseMonths:number[]; pauses:PauseTerms[]; discount:DiscountTerms|null }|null>(null);
  const [pauseMonths,setPauseMonths] = useState(1);
  // A pause is not a lapse. It has its own copy and its own way back, and showing the upgrade
  // pitch to somebody who deliberately paused would be telling them to buy what they already own.
  const paused = isPaused(p.paused_until);
  // True at the same time as `pro`, deliberately: the product keeps working while the banner
  // asks them to fix the card.
  const paymentFailing = isPaymentFailing(p.plan_status);
  const controls = billingControls({ pro, paused, billing: p.billing, webSubscription: p.web_subscription });
  const freeAccents = ACCENT_KEYS.filter((key) => !ACCENTS[key].pro).length;
  // What each plan includes, row by row. The first row is the point of the free plan: finding,
  // saving and hiding deals is never behind Pro.
  const rows: Array<[string,string,string]> = [
    [t("billing.rowDiscovery"), t("billing.included"), t("billing.included")],
    [t("billing.rowAreas"), t("billing.areasFree",{count:FREE_AREA_LIMIT}), t("billing.unlimited")],
    [t("billing.rowRadius"), t("billing.upToKm",{km:maxRadiusKm(false)}), t("billing.upToKm",{km:maxRadiusKm(true)})],
    [t("billing.rowAlertDays"), t("billing.alertDaysFree",{count:FREE_ALERT_DAYS}), t("billing.alertDaysPro")],
    [t("billing.rowAlertTime"), t("billing.alertTimeFree",{time:FREE_ALERT_TIME}), t("billing.alertTimePro")],
    [t("billing.rowHistory"), t("billing.historyRows",{count:HISTORY_ROWS.free}), t("billing.historyRowsExport",{count:HISTORY_ROWS.pro})],
    [t("billing.rowAccents"), t("billing.accents",{count:freeAccents}), t("billing.accents",{count:ACCENT_KEYS.length})],
  ];
  // The cancellation flow, in the three steps the server splits it into: say why, hear the offer,
  // take it or go. Each is its own request, and `decline` always returns a portal link — a retention
  // flow that can trap somebody converts a cancellation into a chargeback and a review.
  async function retention(payload: Record<string,unknown>) {
    setBusy("billing");
    try {
      const response = await fetch("/api/stripe/retention",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({})) as Record<string,unknown> & ApiErrorBody;
      if (!response.ok) { setNotice(apiErrorText.message(result,t("couldNotOpenBilling"))); return null; }
      return result;
    } catch { setNotice(t("couldNotOpenBilling")); return null; }
    finally { setBusy(""); }
  }

  async function submitSurvey(detail: string) {
    const result = await retention({ step:"survey", reason:cancelReason, detail });
    if (!result) return;
    const pauses = Array.isArray(result.pauses) ? result.pauses as PauseTerms[] : [];
    const months = pauses.length ? pauses.map((pause) => pause.months) : Array.isArray(result.pauseMonths) ? result.pauseMonths as number[] : [1,2,3];
    setPauseMonths(months[0] ?? 1);
    // No offer to make means no reason to keep them in a dialog. Straight to the portal.
    if (!result.offer) { await goToPortal(); return; }
    // The survey closes as the offer opens. Both blocks render on their own state, so leaving
    // `canceling` set put the reason buttons on screen underneath the offer - two decisions at
    // once, on the screen where somebody is already halfway out of the door.
    setCanceling(false);
    setSaveOffer({ offer: String(result.offer), pauseMonths: months, pauses, discount: (result.discount as DiscountTerms | null) ?? null });
  }

  async function goToPortal() {
    const result = await retention({ step:"decline" });
    if (result?.url) window.location.href = String(result.url);
  }

  async function acceptOffer(offer: string) {
    const result = await retention({ step:"accept", offer, months: pauseMonths });
    if (!result) return;
    // An answer that still carries a portal link is a cancellation going ahead, not a save.
    if (result.url) { window.location.href = String(result.url); return; }
    const chosen = saveOffer?.pauses.find((pause) => pause.months === pauseMonths);
    setSaveOffer(null); setCanceling(false); setCancelReason("");
    if (offer === "pause" && result.pausedUntil)
      setNotice(`${t("account.offerPaused",{ date: formatDay(locale, String(result.pausedUntil)) })}${chosen ? ` ${t("account.offerPausedNextCharge",{ date: formatDay(locale, chosen.nextChargeOn) })}` : ""}`);
    else if (offer === "discount") setNotice(t("account.offerDiscounted"));
    else setNotice(t("account.offerFeedbackSent"));
    await reload();
  }

  async function resumeSubscription() {
    const result = await retention({ step:"resume" });
    if (!result) return;
    setNotice(t("account.pausedResumed"));
    await reload();
  }

  // Opening the billing portal, with or without a cancellation reason attached.
  //
  // One call for both, so the answer is recorded in the same request that sends somebody to Stripe
  // rather than in a separate one the browser might never make. A reason is an *intent* to cancel:
  // the portal is Stripe's and they may still change their mind in it, which is exactly what the
  // Growth tab compares these against.
  async function manageBilling(survey?: { reason: string; detail: string }) {
    setBusy("billing");
    try {
      const response = await fetch("/api/stripe/portal",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body: JSON.stringify(survey ? { cancelReason: survey.reason, cancelDetail: survey.detail } : {}),
      });
      const result = await response.json().catch(() => ({})) as {url?:string} & ApiErrorBody;
      if (response.ok && result.url) { window.location.href = result.url; return; }
      setNotice(apiErrorText.message(result,t("couldNotOpenBilling")));
    } catch { setNotice(t("couldNotOpenBilling")); }
    finally { setBusy(""); }
  }
  return <>
    <section className="portal-card account-settings"><div className="portal-card-head"><div><span className="kicker">{t("billing.kicker")}</span><h2>{t("billing.heading")}</h2></div></div>
      <div className="appearance-settings"><div className="appearance-row"><span>{pro ? t("account.radarPro") : t("account.freePlan")}</span><span style={{display:"flex",alignItems:"center",gap:10}}>{pro ? <span className="sponsor-status">{t("account.proBadge")}</span> : <span className="status on">{t("account.free")}</span>}{controls.manage && <button disabled={busy === "billing"} onClick={() => manageBilling()}>{t("account.manageBilling")}</button>}{controls.upgrade && <button className="primary purchase-cta" disabled={busy === "upgrade"} onClick={upgrade}>{t("account.upgradeToPro")}</button>}</span></div>{/* An App Store subscription is managed where it was bought, which is what the app's Pro screen says too. Stripe's portal has never heard of it. */}{controls.appStore && <p className="billing-note">{t("account.billedByAppStore")} <a href="https://apps.apple.com/account/subscriptions" target="_blank" rel="noreferrer noopener">{t("account.manageInAppStore")}</a></p>}{/* A declined card does not switch Pro off. Radar retries once a day for three days and then cancels — GRACE_DAYS in app/entitlement.ts, enforced by the billing job rather than by Stripe's retry schedule. Saying the number out loud is the difference between somebody updating a card and somebody assuming they have already lost the thing they paid for. */}{paymentFailing && <div className="billing-alert" role="status"><b>{t("account.paymentFailedTitle")}</b><span>{t("account.paymentFailedBody")} {t("account.paymentFailedDays",{ days: graceDaysLeft(p.past_due_since) })}</span><button className="primary" disabled={busy === "billing"} onClick={() => manageBilling()}>{t("account.paymentFailedAction")}</button></div>}{/* A pause is not a lapse and does not get the upgrade pitch. It has its own copy, its own date, and a one-click way back. */}{paused && <div className="billing-alert paused" role="status"><b>{t("account.pausedTitle")}</b><span>{t("account.pausedBody",{ date: formatDay(locale, String(p.paused_until)) })}</span><button className="primary" disabled={busy === "billing"} onClick={resumeSubscription}>{t("account.pausedAction")}</button></div>}{controls.cancel && <div className="appearance-row"><span/><button type="button" className="linklike" onClick={() => { setCancelReason(""); setSaveOffer(null); setCanceling(true); }}>{t("account.cancelPlan")}</button></div>}</div>{/* "You can cancel at any time" comes first, before anything else is asked (Connecticut, from July 1, 2026). One question, six options, and a free-text box, none of which anybody has to answer: with no reason picked, Continue goes straight to the cancellation, so leaving is never harder than joining was. Every question after the first costs answers, and the only distinction that changes what Radar should do is "too expensive" versus "nothing near me" — pricing or inventory. The reason is recorded on the way to Stripe's portal, so it is captured even when they go through with it. */}{canceling && !saveOffer?.offer && <div className="cancel-survey"><h3>{t("account.cancelTitle")}</h3><p className="offer-terms">{t("account.cancelAnytime")}</p><p>{t("account.cancelPrompt")}</p><div className="cancel-reasons" role="radiogroup" aria-label={t("account.cancelPrompt")}>{([["price","cancelReasonPrice"],["deals","cancelReasonDeals"],["unused","cancelReasonUnused"],["missing","cancelReasonMissing"],["temporary","cancelReasonTemporary"],["other","cancelReasonOther"]] as const).map(([value,key], index, all) => (<button key={value} type="button" role="radio" aria-checked={cancelReason === value} tabIndex={radioTabIndex(cancelReason === value, index, all.some(([option]) => option === cancelReason))} onKeyDown={onRadioGroupKey} className={cancelReason === value ? "active" : ""} onClick={() => setCancelReason(value)}>{t(`account.${key}`)}</button>))}</div><label className="wide">{t("account.cancelDetail")}<textarea id="cancel-detail" rows={3} maxLength={500}/></label><div className="cancel-actions"><button type="button" className="primary" onClick={() => setCanceling(false)}>{t("account.cancelKeep")}</button><button type="button" disabled={busy === "billing"} onClick={() => { const detail = (document.getElementById("cancel-detail") as HTMLTextAreaElement | null)?.value || ""; if (cancelReason) submitSurvey(detail); else goToPortal(); }}>{t("account.cancelContinue")}</button></div></div>}{/* The offer, matched to the reason by the server. Shown in place of the survey, never alongside it, so there is one decision on screen at a time. */}{saveOffer?.offer && <div className="cancel-survey save-offer">{saveOffer.offer === "pause" && <><h3>{t("account.offerPauseTitle")}</h3><p>{t("account.offerPauseBody")}</p><div className="cancel-reasons" role="radiogroup" aria-label={t("account.offerPauseTitle")}>{saveOffer.pauseMonths.map((months, index) => (<button key={months} type="button" role="radio" aria-checked={pauseMonths === months} tabIndex={radioTabIndex(pauseMonths === months, index, saveOffer.pauseMonths.includes(pauseMonths))} onKeyDown={onRadioGroupKey} className={pauseMonths === months ? "active" : ""} onClick={() => setPauseMonths(months)}>{t("account.offerPauseMonths",{ months })}</button>))}</div>{(() => { const terms = saveOffer.pauses.find((pause) => pause.months === pauseMonths); return terms && <p className="offer-terms" aria-live="polite">{t("account.offerPauseTerms",{ resumes: formatDay(locale, terms.resumesOn), charge: formatDay(locale, terms.nextChargeOn) })}</p>; })()}</>}{saveOffer.offer === "discount" && <><h3>{t("account.offerDiscountTitle")}</h3><p>{t("account.offerDiscountBody")}</p>{saveOffer.discount && <p className="offer-terms">{saveOffer.discount.duration === "once" ? t("account.offerDiscountOnce",{ discount: formatDiscount(locale, saveOffer.discount) }) : saveOffer.discount.duration === "repeating" ? t("account.offerDiscountRepeating",{ discount: formatDiscount(locale, saveOffer.discount), months: saveOffer.discount.months ?? 1 }) : t("account.offerDiscountForever",{ discount: formatDiscount(locale, saveOffer.discount) })}</p>}</>}{saveOffer.offer === "feedback" && <><h3>{t("account.offerFeedbackTitle")}</h3><p>{t("account.offerFeedbackBody")}</p></>}<div className="cancel-actions"><button type="button" className="primary" disabled={busy === "billing"} onClick={() => acceptOffer(saveOffer.offer!)}>{saveOffer.offer === "pause" ? t("account.offerPauseConfirm") : saveOffer.offer === "discount" ? t("account.offerDiscountConfirm") : t("account.offerFeedbackConfirm")}</button><button type="button" disabled={busy === "billing"} onClick={() => { setSaveOffer(null); setCanceling(false); goToPortal(); }}>{t("account.offerNoThanks")}</button></div></div>}
    </section>
    <section className="portal-card"><div className="portal-card-head"><div><h2>{t("billing.compareHeading")}</h2><p className="dash-card-note">{t("billing.compareNote")}</p></div></div>
      <div className="dash-table-wrap"><table className="dash-plan-table"><thead><tr><th scope="col"><span className="sr-only">{t("billing.feature")}</span></th><th scope="col" className={pro ? "" : "current"}>{t("account.freePlan")}</th><th scope="col" className={pro ? "current" : ""}>{t("account.radarPro")}</th></tr></thead><tbody>{rows.map(([label,free,proValue]) => <tr key={label}><th scope="row">{label}</th><td className={pro ? "" : "current"}>{free === t("billing.included") ? <><Check aria-hidden="true"/>{free}</> : free}</td><td className={pro ? "current" : ""}>{proValue === t("billing.included") ? <><Check aria-hidden="true"/>{proValue}</> : proValue}</td></tr>)}</tbody></table></div>
      <p className="dash-card-note">{t("billing.freeForever")}</p>
    </section>
  </>;
}
