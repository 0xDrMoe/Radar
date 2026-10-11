import type { Metadata } from "next";
import { headers } from "next/headers";
import { localizedAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../../i18n/ClientMessages";
import RestaurantInquiry from "./RestaurantInquiry";
import PublicPage from "../../PublicPage";

export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata> {
  const {locale} = await params;
  const t = await getTranslations({locale,namespace:"forRestaurants"});
  const meta = await getTranslations({locale,namespace:"metadata"});
  return pageMetadata({title:t("pageTitle"),description:t("pageDescription"),alternates:localizedAlternates(locale,"/for-restaurants"),imageAlt:meta("ogImageAlt")});
}

export default async function ForRestaurants({params}:{params:Promise<{locale:string}>}) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations("forRestaurants");
  // The inquiry posts to /api/suggestions, which checks a Turnstile token whenever the secret is
  // configured. Without the widget here, every restaurant inquiry was refused once it was.
  const turnstileSiteKey = (await headers()).get("x-turnstile-site-key") || undefined;
  // RestaurantInquiry's messages; see i18n/client-messages.ts.
  return <ClientMessages namespaces={["restaurantInquiry", "apiErrors"]}><PublicPage className="restaurant-page"><header><span className="kicker">{t("kicker")}</span><h1>{t("heading")}</h1><p>{t("intro")}</p></header><section className="restaurant-process"><article><b>01</b><h2>{t("step1Title")}</h2><p>{t("step1Body")}</p></article><article><b>02</b><h2>{t("step2Title")}</h2><p>{t("step2Body")}</p></article><article><b>03</b><h2>{t("step3Title")}</h2><p>{t("step3Body")}</p></article></section><section className="restaurant-page-grid" id="inquiry"><div><span className="kicker">{t("formKicker")}</span><h2>{t("formHeading")}</h2><p>{t("formIntro")}</p><ul><li>{t("bullet1")}</li><li>{t("bullet2")}</li><li>{t("bullet3")}</li></ul></div><RestaurantInquiry turnstileSiteKey={turnstileSiteKey}/></section></PublicPage></ClientMessages>;
}
