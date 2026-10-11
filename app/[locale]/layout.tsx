import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { setRequestLocale } from "next-intl/server";
import ClientMessages from "../../i18n/ClientMessages";
import { PublicShell } from "../PublicShell";
import { APP_CONTEXT_SCRIPT } from "../app-context";
import CookieNotice from "../CookieNotice";
import CreatorLink from "../CreatorLink";
import PageviewBeacon from "../PageviewBeacon";
import { buildSiteMetadata, siteViewport } from "../siteMetadata";
import { routing } from "../../i18n/routing";

export const viewport = siteViewport;
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  return buildSiteMetadata((await params).locale);
}
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as (typeof routing.locales)[number])) notFound();
  setRequestLocale(locale);

  return (
    <PublicShell lang={locale}>
      {/* First in the body, so it has run before any page below it is parsed: a tab the iOS app
          opened outside the US storefront hides every way to buy Pro before the first paint.
          See app/app-context.ts. */}
      <script dangerouslySetInnerHTML={{ __html: APP_CONTEXT_SCRIPT }} />
      {/* Only the site chrome's messages, not the catalogue: a page whose own client components
          read more provides them itself. See i18n/client-messages.ts. */}
      <ClientMessages>
        {children}
        <CreatorLink />
        <CookieNotice />
        <PageviewBeacon />
      </ClientMessages>
    </PublicShell>
  );
}
