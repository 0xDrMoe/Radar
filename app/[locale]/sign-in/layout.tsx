import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import ClientMessages from "../../../i18n/ClientMessages";
import { pageMetadata } from "../../siteMetadata";

// The page itself is a client component, which cannot export metadata, so its title lived only in
// a document.title effect: the server sent the home page's title, no canonical and no robots tag,
// and a search engine indexed a Clerk form under the site's name. This layout says what the page
// is, keeps it out of search results, and gives every path the catch-all answers (Clerk's own
// /sign-in/factor-one and the like) the one canonical address.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  const meta = await getTranslations({ locale, namespace: "metadata" });
  return {
    ...pageMetadata({
      title: t("signInPageTitle"),
      description: meta("siteDescription"),
      alternates: { canonical: `/${locale}/sign-in` },
      imageAlt: meta("ogImageAlt"),
    }),
    robots: { index: false, follow: true },
  };
}

// The page is itself a client component, so its messages are provided here, around it. See
// i18n/client-messages.ts.
export default function SignInLayout({ children }: { children: React.ReactNode }) {
  return <ClientMessages namespaces={["auth"]}>{children}</ClientMessages>;
}
