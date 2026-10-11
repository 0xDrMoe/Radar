"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { useApiErrorText, type ApiErrorBody } from "../../api-error-text";
import Turnstile from "../../Turnstile";

type InquiryResult = { error?: string; fields?: Record<string, string>; reference?: string };
type SuggestionResponseBody = ApiErrorBody & { reference?: string };

export default function RestaurantInquiry({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const t = useTranslations("restaurantInquiry");
  // The server's refusals are English; these are the same refusals in the reader's language.
  const apiErrorText = useApiErrorText();
  const [busy,setBusy] = useState(false),[result,setResult] = useState<InquiryResult | null>(null);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setResult(null); const form = event.currentTarget,values = new FormData(form);
    let response: Response;
    try {
      response = await fetch("/api/suggestions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(Object.fromEntries(values))});
    } catch {
      // A dropped connection used to leave the button on "Submitting…" for good.
      setBusy(false); setResult({error:t("submissionFailed")}); return;
    }
    const body = await response.json().catch(() => ({})) as SuggestionResponseBody; setBusy(false);
    if (!response.ok) {
      const fields = apiErrorText.fields(body) || {};
      setResult({error:apiErrorText.message(body,t("submissionFailed")),fields});
      // Take the reader to the first field the server refused, once the render marks it invalid.
      if (Object.keys(fields).length) requestAnimationFrame(() => form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setResult({reference:body.reference || ""}); form.reset();
  }
  // Every field the API can refuse shows its own message and is marked invalid, not only the name:
  // the summary below says to review the highlighted fields, so they have to be highlighted.
  const fieldError = (name:string) => result?.fields?.[name];
  const invalid = (name:string) => fieldError(name) ? {"aria-invalid":true as const,"aria-describedby":`inquiry-${name}-error`} : {};
  const errorText = (name:string) => fieldError(name) && <small className="field-error" id={`inquiry-${name}-error`}>{fieldError(name)}</small>;
  return <form className="restaurant-inquiry" onSubmit={submit} noValidate>
    <label>{t("restaurantName")}<input name="restaurant" required maxLength={120} {...invalid("restaurant")}/>{errorText("restaurant")}</label>
    <label>{t("yourRelationship")}<select name="relationship" required defaultValue="" {...invalid("relationship")}><option value="" disabled>{t("chooseOne")}</option><option value="owner">{t("owner")}</option><option value="manager">{t("manager")}</option><option value="staff">{t("staffMember")}</option><option value="customer">{t("customer")}</option></select>{errorText("relationship")}</label>
    <label>{t("contactEmail")}<input name="email" type="email" autoComplete="email" required {...invalid("email")}/>{errorText("email")}</label>
    <label>{t("restaurantWebsite")}<input name="restaurantWebsite" type="url"/></label>
    <label className="wide">{t("streetAddress")}<input name="address" maxLength={240}/></label>
    <label>{t("postalOrZip")}<input name="postal" required {...invalid("postal")}/>{errorText("postal")}</label>
    <label>{t("offerTitle")}<input name="deal" required maxLength={180} {...invalid("deal")}/>{errorText("deal")}</label>
    <label>{t("priceOrSavings")}<input name="price" placeholder={t("priceOrSavingsPlaceholder")}/></label>
    <label>{t("schedule")}<input name="schedule" placeholder={t("schedulePlaceholder")} required {...invalid("schedule")}/>{errorText("schedule")}</label>
    <label className="wide">{t("officialSource")}<input name="source" type="url" required {...invalid("source")}/><small>{t("officialSourceHint")}</small>{errorText("source")}</label>
    <label className="wide">{t("descriptionAndTerms")}<textarea name="description" maxLength={1500}/></label>
    <label className="wide">{t("restrictions")}<textarea name="restrictions" maxLength={1000}/></label>
    <Turnstile siteKey={turnstileSiteKey} />
    <button className="primary" disabled={busy}>{busy ? t("submitting") : t("submit")}</button>
    {result?.error && <p className="form-error wide" role="alert">{result.error}</p>}
    {result?.reference && <p className="form-success wide" role="status">{t.rich("received",{reference:result.reference,b:(chunks) => <b>{chunks}</b>})}</p>}
  </form>;
}
