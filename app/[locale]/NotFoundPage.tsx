"use client";
import { useTranslations } from "next-intl";
import ChromeLink from "../ChromeLink";
import NotFoundContent from "../NotFoundContent";
import PublicPage from "../PublicPage";

// A missing page under a locale keeps the site around it — the header to search from and the
// footer's exits — and speaks the reader's language, rather than a bare card with one way out.
// Its two links are ChromeLinks, which write the reader's locale into the home page's address.
export default function NotFoundPage() {
  const t = useTranslations("notFound");
  return (
    <PublicPage className="not-found-page">
      <NotFoundContent copy={{ title: t("title"), body: t("body"), home: t("home"), browse: t("browse") }} LinkTo={ChromeLink} />
    </PublicPage>
  );
}
