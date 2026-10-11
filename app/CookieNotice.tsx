"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import ChromeLink from "./ChromeLink";

// Versioned, so a change to what the notice says reaches the people who dismissed the old one.
// The first version said Radar used no tracking cookies at all while a creator's link was setting
// two 30-day referral cookies that end up on the account; everyone who read that and pressed "Got
// it" should see the corrected sentence once.
const STORAGE_KEY = "radar:cookie-notice-dismissed:2";

export default function CookieNotice() {
  const t = useTranslations("home.cookieNotice");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {
      setVisible(true);
    }
  }, []);
  if (!visible) return null;
  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* private browsing / storage disabled — dismissal just won't persist */ }
  }
  return (
    <div className="cookie-notice" role="region" aria-label={t("label")}>
      <p>{t("body")}</p>
      <div className="cookie-notice-actions">
        {/* Never a prefetching <Link>: shown on every first visit, it was prefetched on every first
            visit, a render of the privacy page each time. A ChromeLink, as the header's links are
            (see SiteHeader): a page load of the baked page for a reader without a session cookie,
            a client-side navigation for one with it. */}
        <ChromeLink href="/privacy#storage">{t("learnMore")}</ChromeLink>
        <button type="button" onClick={dismiss}>{t("dismiss")}</button>
      </div>
    </div>
  );
}
