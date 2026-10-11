import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import ClientMessages from "../../i18n/ClientMessages";
import NotFoundPage from "./NotFoundPage";

// The title in the reader's language, like the page under it. No robots entry: the framework
// already writes <meta name="robots" content="noindex"> on every not-found render, and a second
// one here put two robots tags that disagreed about "nofollow" on every 404.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations({ locale: await getLocale(), namespace: "metadata" });
  return { title: t("notFoundTitle") };
}

// Its own provider, because this page is not always rendered inside the layout's. A path the locale
// layout rejects outright (/wp-login.php: the dot keeps the middleware from prefixing it, so the
// layout sees "wp-login.php" as the locale and calls notFound() itself) renders this page with no
// layout around it at all, and the header's translations would throw there instead of a 404. The
// header and footer read the shared namespaces ClientMessages always includes; the card reads
// notFound.
export default async function LocaleNotFound() {
  const locale = await getLocale();
  return (
    <ClientMessages locale={locale} namespaces={["notFound"]}>
      <NotFoundPage />
    </ClientMessages>
  );
}
