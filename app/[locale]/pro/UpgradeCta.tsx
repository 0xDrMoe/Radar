"use client";
import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check } from "lucide-react";
import { useRouter } from "../../../i18n/navigation";
import type { BillingPlan } from "../../billing-plans";
import { appStoreComparison, formatPrice, yearlySavingPercent, type PlanPrice } from "../../pricing";
import InfoTip from "../../InfoTip";
import { appContext, purchaseHidden } from "../../app-context";
import { useApiErrorText, type ApiErrorBody } from "../../api-error-text";

export type PlanPrices = Partial<Record<BillingPlan, PlanPrice>>;

export default function UpgradeCta({ pro, plans, prices }: { pro: boolean; plans: BillingPlan[]; prices: PlanPrices }) {
  const t = useTranslations("pro");
  const locale = useLocale();
  const router = useRouter();
  const apiErrorText = useApiErrorText();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Monthly is the default even when it somehow is not on offer, because the checkout route falls
  // back to it too — the two ends agreeing matters more than either being clever.
  const [plan, setPlan] = useState<BillingPlan>("monthly");

  async function upgrade() {
    // A tab the iOS app opened outside the US storefront never starts a checkout, whatever reached
    // this button (app/app-context.ts). The button itself is hidden there before the first paint.
    if (purchaseHidden()) return;
    setBusy(true); setNotice("");
    try {
      // Marked when the app sent the reader here on the US storefront, where Apple allows the link,
      // so the subscription records that it came through the app.
      const source = appContext() === "ios-us" ? "ios_app" : undefined;
      const response = await fetch("/api/stripe/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, source, locale }) });
      // Back to this page as it was asked for, tag and all, once they have signed in. A page load,
      // like the site header's sign-in link for a signed-out reader: whoever gets a 401 here is
      // signed out, and a client-side push would fetch sign-in's flight, which the Worker renders for
      // every request, where the page load is answered by the baked sign-in page (app/ChromeLink.tsx).
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a document load on purpose, as above
      if (response.status === 401) { window.location.assign(`/${locale}/sign-in?redirect_url=${encodeURIComponent(`/${locale}/pro${window.location.search}`)}`); return; }
      const result = await response.json().catch(() => ({})) as { url?: string } & ApiErrorBody;
      if (response.ok && result.url) { window.location.href = result.url; return; }
      // The checkout route explains itself in English; the reader gets the same meaning in their
      // language, chosen by the error's code (app/api-error-text.ts).
      setNotice(apiErrorText.message(result, t("couldNotStartCheckout")));
    } catch { setNotice(t("couldNotStartCheckout")); }
    finally { setBusy(false); }
  }

  if (pro) {
    return <div className="pro-cta pro-cta-active"><Check /><span>{t("ctaCurrentPlan")}</span><button className="primary" onClick={() => router.push("/dashboard/billing")}>{t("ctaManageBilling")}</button></div>;
  }

  const selected = prices[plan];
  // Only ever drawn when both plans are priced in the same currency — see yearlySavingPercent.
  const saving = yearlySavingPercent(prices.monthly ?? null, prices.yearly ?? null);
  // What the same subscription costs through the App Store, struck through beside the web
  // price. Null whenever there is no honest comparison to draw - Apple sells no yearly
  // product, and its price is only written down in Canadian dollars. See appStoreComparison.
  const appStore = appStoreComparison(selected);

  // Two siblings, one of them always hidden by the stylesheet: the purchase controls, or - in a tab
  // the iOS app opened outside the US storefront - a line saying where Pro can be had instead.
  // Decided by CSS rather than by rendering one or the other, so the server's HTML and the first
  // paint are already right; see app/app-context.ts.
  return <>
  <p className="purchase-hidden-note pro-cta-app-note">{t("appOnlyNote")}</p>
  <div className="pro-cta purchase-cta">
    {/* Only drawn when there is a genuine choice. With one configured price this is a control that
        does nothing, and a picker with a single option reads as a loading state. */}
    {plans.length > 1 && <div className="plan-switch" role="group" aria-label={t("planSwitchLabel")}>
      {plans.map((option) => <button
        key={option}
        type="button"
        className={option === plan ? "on" : ""}
        aria-pressed={option === plan}
        onClick={() => setPlan(option)}
      >
        {t(option === "yearly" ? "planYearly" : "planMonthly")}
        {option === "yearly" && saving !== null && <span className="plan-save">{t("planSave", { percent: saving })}</span>}
      </button>)}
    </div>}
    {/* Absent rather than blank when Stripe could not be reached: the page then reads exactly as it
        did before prices were shown at all, instead of holding an empty space where a number goes. */}
    {selected && <p className="pro-cta-price">
      {/* Labelled, not struck through. A struck-out price reads as the price this one used to be,
          and it never was: it is what the same plan costs through Apple (Competition Act s.74.01 and
          the FTC's former-price guides are about exactly that impression). */}
      {appStore && <span className="pro-cta-was">
        {t("iosPriceWas")}: {formatPrice(locale, appStore.currency, appStore.amount)}
      </span>}
      {t(selected.interval === "year" ? "priceYearly" : "priceMonthly", { price: formatPrice(locale, selected.currency, selected.amount) })}
      {appStore && <InfoTip text={t("iosPriceNote", { price: formatPrice(locale, appStore.currency, appStore.amount) })}/>}
    </p>}
    <button className="primary pro-cta-button" onClick={upgrade} disabled={busy}>{busy ? t("ctaStarting") : t("ctaUpgrade")} <ArrowRight/></button>
    {/* The renewal terms beside the button that agrees to them, in the reader's currency and period:
        auto-renewal laws (California's as amended by AB 2863, Quebec's and Ontario's consumer
        protection acts, the FTC under ROSCA) want them clear and next to the consent, not only in
        the Terms. */}
    <p className="pro-cta-footnote">{selected
      ? t(selected.interval === "year" ? "ctaRenewalYearly" : "ctaRenewalMonthly", { price: formatPrice(locale, selected.currency, selected.amount) })
      : t("ctaFootnote")}</p>
    {/* Mounted empty so the checkout error is announced when it arrives; it is an error, so assertive. */}
    <p className="pro-cta-notice" role="alert">{notice}</p>
  </div>
  </>;
}
