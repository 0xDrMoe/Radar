"use client";
import { useEffect } from "react";
import { SignIn } from "@clerk/react";
import { useLocale, useTranslations } from "next-intl";
import ClerkClientProvider from "../../../ClerkClientProvider";
import { safeAuthRedirect } from "../../../auth-redirect";
import RadarMark from "../../../RadarMark";
import ChromeLink from "../../../ChromeLink";
// ChromeLinks, not next-intl's <Link> (app/ChromeLink.tsx): for a reader without a session cookie a
// plain page load, which the Worker answers without a render - whoever reads this page is signed
// out, and the home page and the legal pages are baked - where a client-side link's flight is a
// render every time. For a reader with the cookie, a client-side navigation.

export default function SignInPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const redirectUrl = safeAuthRedirect(
    typeof window === "undefined" ? "" : window.location.search,
    "/dashboard",
    locale,
  );
  useEffect(() => {
    document.title = t("signInPageTitle");
  }, [t]);

  // Clerk is not loaded for signed-out readers - see app/ClerkClientProvider.tsx - and on this
  // page nobody is signed in yet, so the page mounts it for itself. A reader who IS signed in
  // already has RootShell's provider above this one, which makes this one a pass-through
  // rather than a second Clerk instance.
  return (
    <ClerkClientProvider active locale={locale}>
      <main className="auth-shell">
        <section className="auth-panel" aria-labelledby="auth-heading">
          <header className="auth-header">
            <ChromeLink href="/" className="auth-brand"><RadarMark />Radar.</ChromeLink>
            <span className="auth-kicker">{t("signInKicker")}</span>
            <h1 id="auth-heading">{t("signInHeading")}</h1>
            <p>{t("signInSubtitle")}</p>
          </header>
          <SignIn
            path={`/${locale}/sign-in`}
            routing="path"
            signUpUrl={`/${locale}/sign-up`}
            forceRedirectUrl={redirectUrl}
            appearance={{
              elements: {
                headerTitle: "hidden",
                headerSubtitle: "hidden",
                card: "auth-clerk-card",
              },
            }}
          />
          <p className="auth-legal">
            {t.rich("legal",{terms:(chunks) => <ChromeLink href="/terms">{chunks}</ChromeLink>,privacy:(chunks) => <ChromeLink href="/privacy">{chunks}</ChromeLink>})}
          </p>
        </section>
      </main>
    </ClerkClientProvider>
  );
}
