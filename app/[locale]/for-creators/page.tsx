import type { Metadata } from "next";
import { localizedAlternates } from "../../alternates";
import { pageMetadata } from "../../siteMetadata";
import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../../i18n/ClientMessages";
import CreatorApplication from "./CreatorApplication";
import PublicPage from "../../PublicPage";

export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata> {
  const {locale} = await params;
  const t = await getTranslations({locale,namespace:"forCreators"});
  const meta = await getTranslations({locale,namespace:"metadata"});
  return pageMetadata({title:t("pageTitle"),description:t("pageDescription"),alternates:localizedAlternates(locale,"/for-creators"),imageAlt:meta("ogImageAlt")});
}

export default async function ForCreators({params}:{params:Promise<{locale:string}>}) {
  const {locale} = await params;
  setRequestLocale(locale);
  const t = await getTranslations("forCreators");
  // Same source the home page reads it from, so the challenge renders wherever it is configured
  // and the form works unchanged where it is not.
  const turnstileSiteKey = (await headers()).get("x-turnstile-site-key") || undefined;
  // CreatorApplication's messages; see i18n/client-messages.ts.
  return (
    <ClientMessages namespaces={["creatorApplication", "apiErrors"]}><PublicPage className="restaurant-page">
      <header>
        <span className="kicker">{t("kicker")}</span>
        <h1>{t("heading")}</h1>
        <p>{t("intro")}</p>
      </header>
      <section className="restaurant-process">
        <article><b>01</b><h2>{t("step1Title")}</h2><p>{t("step1Body")}</p></article>
        <article><b>02</b><h2>{t("step2Title")}</h2><p>{t("step2Body")}</p></article>
        <article><b>03</b><h2>{t("step3Title")}</h2><p>{t("step3Body")}</p></article>
      </section>
      {/* The numbers somebody decides to apply on, before the form rather than after it. The App
          Store line is here for the same reason it is on the dashboard: a creator who sends their
          audience to the App Store earns nothing and gets no error telling them so. */}
      <section className="creator-terms">
        <span className="kicker">{t("termsKicker")}</span>
        <h2>{t("termsHeading")}</h2>
        <p>{t("termsRates")}</p>
        <p>{t("termsHold")}</p>
        {/* The disclosure duty and the check behind it are terms, not advice: the FTC Endorsement
            Guides (16 CFR 255) and the Competition Bureau's influencer guidance hold the advertiser
            responsible for a paid partner's undisclosed post, and expect it to monitor them. */}
        <p>{t("termsDisclosure")}</p>
        <p>{t("termsMonitoring")}</p>
        <p className="creator-terms-note">{t("termsAppStore")}</p>
      </section>
      <section className="restaurant-page-grid">
        <div>
          <span className="kicker">{t("formKicker")}</span>
          <h2>{t("formHeading")}</h2>
          <p>{t("formIntro")}</p>
          <ul>
            <li>{t("bullet1")}</li>
            <li>{t("bullet2")}</li>
            <li>{t("bullet3")}</li>
          </ul>
        </div>
        <CreatorApplication turnstileSiteKey={turnstileSiteKey} />
      </section>
    </PublicPage></ClientMessages>
  );
}
