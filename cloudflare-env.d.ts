/// <reference types="@cloudflare/workers-types" />
/// <reference types="vite/client" />

// Every name the app reads from the Worker's env, in one place.
//
// Most of the app still reads env through `env as unknown as Record<string, string>`, so a
// misspelled name compiles and reads undefined. That is why the list is kept here at all: it is
// the one place to check that a name the code reads is a name somebody has actually set
// (tests/env-names.test.mjs fails on a name read in app/ that is missing here). Each is optional
// because the code reads each as possibly unset, and the comment says where the value comes from:
//
//   var     in wrangler.jsonc "vars", committed
//   secret  `wrangler secret put NAME`, never committed; `wrangler secret list` shows what is set
//   build   set by a script for one run, never in production
//
// worker/index.ts hand-writes its own Env for the entry point (ASSETS, IMAGES, CF_VERSION and the
// job secrets it forwards); keep the two in step.
declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    PHOTOS: R2Bucket;

    // Site
    /** var. The public origin links in emails and the affiliate portal point at. */
    PUBLIC_APP_URL?: string;
    /** var. The pinned owner's sign-in address (isProtectedOwner in app/auth.ts). Unset pins nobody. */
    OWNER_EMAIL?: string;

    // Sign-in
    /** secret. Verifies Clerk session tokens and deletes the Clerk user on account deletion. */
    CLERK_SECRET_KEY?: string;
    /** var. Public half of the Turnstile widget. */
    TURNSTILE_SITE_KEY?: string;
    /** secret. Without it every public form is refused, unless TURNSTILE_DISABLED is "true". */
    TURNSTILE_SECRET_KEY?: string;
    /** var. "true" skips the Turnstile check when no secret is set. Local development and tests only. */
    TURNSTILE_DISABLED?: string;

    // Email
    /** var. "true" opens the pilot gate. */
    EMAIL_PILOT_ENABLED?: string;
    /** var. Stops every send unless it is exactly "false". */
    EMAIL_KILL_SWITCH?: string;
    /** secret. Comma-separated addresses admitted to the pilot without a consent row. */
    EMAIL_PILOT_ALLOWLIST?: string;
    /** var. The From: identity; its domain must be verified in Resend. */
    RESEND_FROM_EMAIL?: string;
    /** secret. The Resend API key. */
    RESEND_API_KEY?: string;
    /** secret. Verifies the signature on Resend's delivery webhooks. */
    RESEND_WEBHOOK_SECRET?: string;
    /** secret. Signs unsubscribe and confirmation links. */
    EMAIL_UNSUBSCRIBE_SECRET?: string;

    // Scheduled jobs. Each job refuses a request without its secret, and the cron skips it silently when unset.
    /** secret. /api/jobs/digests, and /api/jobs/launch-email. */
    EMAIL_JOB_SECRET?: string;
    /** secret. /api/jobs/billing: dunning cutoff, pauses, grant expiry, win-backs. */
    BILLING_JOB_SECRET?: string;
    /** secret. /api/jobs/translate. */
    TRANSLATE_JOB_SECRET?: string;
    /** secret. /api/jobs/geocode. */
    GEOCODE_JOB_SECRET?: string;
    /** secret. Deal translation; without it /fr and /es deal text stays English. */
    DEEPL_API_KEY?: string;

    // Stripe
    /** secret. The live key matching the price ids below. */
    STRIPE_SECRET_KEY?: string;
    /** secret. Verifies Stripe webhook signatures. */
    STRIPE_WEBHOOK_SECRET?: string;
    /** var. The monthly Radar Pro price, and the default. */
    STRIPE_PRICE_ID?: string;
    /** var. The yearly price; unset withdraws the annual plan. */
    STRIPE_PRICE_ID_YEARLY?: string;
    /** secret. The coupon behind the cancellation flow's discount offer; unset withdraws the offer. */
    STRIPE_SAVE_COUPON_ID?: string;
    /** var. "true" is the second switch on affiliate payouts, beside a live Stripe key. */
    STRIPE_CONNECT_ENABLED?: string;

    // App Store
    /** var. The app's bundle id. */
    APPLE_IAP_BUNDLE_ID?: string;
    /** var. Kept for reference only; the server never reads it (see wrangler.jsonc). */
    APPLE_IAP_PRODUCT_ID?: string;
    /** secret. App Store Connect API key id. Not secret in itself, but not in wrangler.jsonc either. */
    APPLE_IAP_KEY_ID?: string;
    /** secret. App Store Connect issuer id. Not secret in itself, but not in wrangler.jsonc either. */
    APPLE_IAP_ISSUER_ID?: string;
    /** secret. The .p8 signing key for the App Store Server API. */
    APPLE_IAP_PRIVATE_KEY?: string;
    /** secret. The apps.apple.com link; /launch 404s and the launch email refuses to send until it is set. */
    APP_STORE_URL?: string;
    /** secret. Optional access token for Expo's push service. */
    EXPO_ACCESS_TOKEN?: string;

    // Geocoding
    /** secret. Mapbox token; Mapbox is used only while MAPBOX_PERMANENT_GEOCODING is "true". */
    MAPBOX_ACCESS_TOKEN?: string;
    /** secret. "true" says the account holds Mapbox's permanent-geocoding entitlement, which storing its results requires. */
    MAPBOX_PERMANENT_GEOCODING?: string;

    /** build. "1" while scripts/prerender-deals.mjs renders deal pages. */
    RADAR_PRERENDER?: string;
  }
}
