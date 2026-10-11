"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Tells /api/pageview that a page was opened, so the Growth tab can say how many people came
// (app/pageview.ts). Mounted once in the locale layout, and keyed on the path, so a client-side
// navigation - which a signed-in reader's clicks all are, see ChromeLink - counts as the page view
// it is, and a re-render does not count twice.
//
// No cookie, no storage, nothing that identifies the reader. A browser that asks not to be tracked
// (Do Not Track, Global Privacy Control) is not counted at all, though nothing here could track it:
// the signal is honoured because it is cheap to, and a count that is slightly low is better than an
// argument about whether it should have been taken. A page loaded by an automated browser is not
// counted either.
export default function PageviewBeacon() {
  const pathname = usePathname();
  useEffect(() => {
    try {
      if (!pathname || navigator.webdriver) return;
      const asks = navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
      if (asks) return;
      const body = JSON.stringify({ path: pathname, referrer: document.referrer });
      // sendBeacon survives the page being left, which is when a bounce happens; fetch with
      // keepalive is the same promise for the browsers that do not have it.
      if (!navigator.sendBeacon?.("/api/pageview", new Blob([body], { type: "application/json" }))) {
        void fetch("/api/pageview", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
      }
    } catch {
      // A counter that cannot count is not worth an error.
    }
  }, [pathname]);
  return null;
}
