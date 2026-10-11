import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import ClientMessages from "../../../i18n/ClientMessages";
import { pageMetadata } from "../../siteMetadata";

// See app/[locale]/sign-in/layout.tsx: the same reasons, for the other half of the auth shell.
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "auth" });
  const meta = await getTranslations({ locale, namespace: "metadata" });
  return {
    ...pageMetadata({
      title: t("signUpPageTitle"),
      description: meta("siteDescription"),
      alternates: { canonical: `/${locale}/sign-up` },
      imageAlt: meta("ogImageAlt"),
    }),
    robots: { index: false, follow: true },
  };
}

// The page is itself a client component, so its messages are provided here, around it. See
// i18n/client-messages.ts.
export default function SignUpLayout({ children }: { children: React.ReactNode }) {
  return <ClientMessages namespaces={["auth"]}>{children}</ClientMessages>;
}
