import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Everything except: /admin, /affiliate, /api, /creator, /portal(-invite), Next/vinext
  // internals, and any request for a file with an extension (static assets, favicon, og image,
  // etc.).
  // Every route under app/(operator) has to be listed here. They are English-only and live
  // outside the [locale] tree, so a locale prefix sends them to a page that does not exist —
  // which is exactly what /creator did until it was added. tests/creator.test.mjs reads the
  // directory and fails if one is missing.
  matcher: ["/((?!admin|affiliate|api|creator|portal-invite|portal|_next|_vinext|.*\\..*).*)"],
};
