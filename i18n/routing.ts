import { defineRouting } from "next-intl/routing";

// Admin (`/admin`), the public API (`/api`), and the restaurant-operator portal
// (`/portal`, `/portal-invite`) intentionally live outside this routing tree and stay
// English-only — see the multi-language plan for why. Only consumer-facing pages are
// locale-prefixed.
export const routing = defineRouting({
  locales: ["en", "fr", "es"],
  defaultLocale: "en",
  // NEXT_LOCALE holds only a language, but production has no reason to send it over plain http,
  // and every other cookie the site sets is Secure. Not in `vinext dev`, which serves plain
  // http://localhost, where some browsers refuse a Secure cookie. import.meta.env.PROD rather than
  // process.env.NODE_ENV because Vite replaces it in every build environment, the Worker's included,
  // where process.env holds the Worker's vars and nothing else. The name, path and SameSite stay
  // next-intl's defaults; worker/index.ts writes the same cookie by hand for prerendered pages
  // (prerenderedPage) and checks its prefix before caching a page (isStorable).
  localeCookie: { secure: import.meta.env.PROD },
  // No hreflang Link header. The middleware wrote one on every page it answered, naming the page in
  // all three locales with the bare, redirecting path as x-default - on the English-only pages and
  // the deal pages that have no translation too, whose HTML says the opposite (app/alternates.ts).
  // Baked pages never had it, so two copies of one URL disagreed. The HTML and the sitemap are the
  // one account of a page's languages.
  alternateLinks: false,
});
