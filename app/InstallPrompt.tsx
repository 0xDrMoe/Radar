"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "radar:install-prompt-dismissed";
const VISITS_KEY = "radar:visits";
const SESSION_KEY = "radar:visit-counted";
// Whether the last page this browser loaded was signed in. See the service-worker effect below.
const SIGNED_IN_KEY = "radar:signed-in";

// This sits in RootShell, above the locale's message provider (and in the operator area, which has
// none), so it carries its own three lines and reads the language off <html lang>.
const COPY = {
  en: { body: "Install Radar for quicker access to nearby deals.", install: "Install", dismiss: "Dismiss" },
  fr: { body: "Installez Radar pour retrouver plus vite les offres près de chez vous.", install: "Installer", dismiss: "Fermer" },
  es: { body: "Instala Radar para ver más rápido las ofertas cerca de ti.", install: "Instalar", dismiss: "Cerrar" },
} as const;
type Lang = keyof typeof COPY;

// A visit is a browser session, counted once. The offer waits for the second one: on a first
// visit nobody yet knows whether Radar is worth a home-screen slot, and a banner asking before the
// page has shown them anything is the prompt most people learn to dismiss unread.
function countVisit(): number {
  try {
    let visits = Number(localStorage.getItem(VISITS_KEY)) || 0;
    if (!sessionStorage.getItem(SESSION_KEY)) {
      visits += 1;
      localStorage.setItem(VISITS_KEY, String(visits));
      sessionStorage.setItem(SESSION_KEY, "1");
    }
    return visits;
  } catch {
    return 0;
  }
}

// Registers the offline-shell service worker sitewide and, on browsers that support it (Chrome/
// Edge/Android — Safari has no `beforeinstallprompt`, so it simply never shows there), surfaces
// a small dismissible banner offering a real "Add to Home Screen" install instead of leaving it
// buried in the browser's own menu.
export default function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [lang, setLang] = useState<Lang>("en");

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    // Signing out happens in three places (two SignOutButtons and Clerk's own UserButton menu), and
    // every one of them ends in a page load with no session cookie. So this watches for that
    // instead: the first page after a signed-in one that has no __session tells the service worker
    // to drop its stored pages. Clerk's session cookie is readable from script by design. The
    // service worker never stores a signed-in page to begin with (public/sw.js); this makes sure.
    try {
      const signedIn = /(?:^|;\s*)__session=/.test(document.cookie);
      if (signedIn) {
        localStorage.setItem(SIGNED_IN_KEY, "1");
      } else if (localStorage.getItem(SIGNED_IN_KEY)) {
        localStorage.removeItem(SIGNED_IN_KEY);
        navigator.serviceWorker.ready
          .then((registration) => registration.active?.postMessage({ type: "radar:clear-pages" }))
          .catch(() => {});
      }
    } catch {
      /* storage blocked: nothing was recorded, so there is nothing to compare */
    }
  }, []);

  useEffect(() => {
    const returning = countVisit() >= 2;
    function onPrompt(event: Event) {
      // Left alone on a first visit, so the browser's own install affordance stays available.
      if (!returning) return;
      event.preventDefault();
      try { if (localStorage.getItem(DISMISSED_KEY)) return; } catch { /* ignore */ }
      const pageLang = document.documentElement.lang.slice(0, 2);
      setLang(pageLang in COPY ? (pageLang as Lang) : "en");
      setPromptEvent(event as BeforeInstallPromptEvent);
      setVisible(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!visible || !promptEvent) return null;

  async function install() {
    setVisible(false);
    await promptEvent!.prompt();
  }
  function dismiss() {
    setVisible(false);
    try { localStorage.setItem(DISMISSED_KEY, "1"); } catch { /* ignore */ }
  }

  const copy = COPY[lang];
  return (
    <div className="install-banner" role="status">
      <Download />
      <span>{copy.body}</span>
      <button type="button" className="primary" onClick={install}>{copy.install}</button>
      <button type="button" className="install-dismiss" aria-label={copy.dismiss} onClick={dismiss}><X /></button>
    </div>
  );
}
