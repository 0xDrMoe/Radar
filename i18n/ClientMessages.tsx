import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { SHARED_CLIENT_NAMESPACES, pickMessages } from "./client-messages";

/**
 * The only NextIntlClientProvider in the app: the shared namespaces plus `namespaces`, and nothing
 * else of the catalogue. See i18n/client-messages.ts.
 *
 * A page whose client components read their own namespaces wraps everything it returns in one of
 * these, since a nested provider replaces the messages of the one above it. `locale` is for the
 * not-found page, which can render with no locale layout around it.
 */
export default async function ClientMessages({
  namespaces = [],
  locale,
  children,
}: {
  namespaces?: readonly string[];
  locale?: string;
  children: React.ReactNode;
}) {
  const messages = await getMessages(locale ? { locale } : undefined);
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, [...SHARED_CLIENT_NAMESPACES, ...namespaces])}>
      {children}
    </NextIntlClientProvider>
  );
}
