import { createTranslator } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";
import en from "../messages/en.json";
import fr from "../messages/fr.json";
import es from "../messages/es.json";

// Static imports, not `await import(`../messages/${locale}.json`)` per request.
//
// The dynamic form split each catalogue into its own lazily loaded chunk, which every locale render
// awaited — the not-found page included — while this module itself is part of what the Worker loads
// at startup. A lazy load left pending for good by a request the runtime killed mid-load hangs every
// later locale render on that isolate, which awaits it, while routes with no catalogue keep
// answering (see "The render watchdog" in worker/index.ts). Imported statically, the catalogues are
// evaluated once, when the isolate starts, outside any request that can be killed, and a render no
// longer waits on a load at all.
//
// All three are held by every isolate, which is about 130 KB of already-parsed JSON: a small price
// for a render path with no load in it.
const catalogues = { en, fr, es } as const;

// The zone a Worker's clock reports. See the config below.
const SERVER_TIME_ZONE = "UTC";

// The one-time Intl setup, done here while the isolate starts rather than inside its first request.
//
// The first Intl call a V8 isolate makes, whichever call it is, pays for loading and indexing ICU's
// locale data: 11 to 13 ms in a fresh Node process, against a few hundredths of a millisecond for
// the same call afterwards (2026-09-30). On the Worker that first call came from next-intl, when
// the first message with a placeholder was formatted: IntlMessageFormat resolving its locale was
// 11.5 ms of a cold render's profile. It landed inside the first request each new isolate serves,
// which is the request most likely to run out of CPU, and that is how a wedged isolate begins (see
// "The render watchdog" in worker/index.ts). This module is evaluated at startup, the catalogues
// above with it, so the setup is done here instead, once, outside any request.
//
// What is formatted is what next-intl does with the catalogues: a plural with its count (the
// locale lookup IntlMessageFormat does first, then Intl.PluralRules and Intl.NumberFormat) and a
// {count, number}, in each locale the site serves, through next-intl itself so the path is exactly
// the one a render takes. Then a date in the zone the config below names: no message formats one,
// but the pages format dates in their own code, and the first DateTimeFormat has its own setup to
// pay. Every result is thrown away and nothing here is kept, so no output changes; and if any of
// it throws, the first render is simply left to do the setup itself, as it always had.
//
// What it moves, measured in workerd itself (Miniflare 5, a fresh process per run, V8's sampling
// profiler, median active CPU, 2026-10-01): startup takes about 16 ms more (36 against 20); the
// first server-rendered document an isolate serves takes about 9 ms less (72 against 81 for
// /en/terms); and the first RSC flight (33 against 32) and the first /api/deals call (106 against
// 111, inside the noise of runs that spread from 85 to 367) take the same. So the renders that gain
// are an isolate's first full HTML render - a document that is not baked or in the colo cache, or a
// background refresh of one - which is where the formatting through next-intl happens; a flight and
// the API format little or nothing on their first call, and pay no setup they would not have paid
// anyway. Node's profiles (Intl's share of a first render from 12 ms to under 0.5) put a bigger
// number on it than workerd does; the workerd figures are the ones that apply. Of the startup cost,
// most is the first message in English (the setup itself), about 3 ms the first DateTimeFormat, and
// under 2 ms French and Spanish together: English alone measured 37.3 ms of startup against 38.5
// for all three, with the same gain on the first document.
//
// It is worth having only because the startup is not the first request's to pay: code at a
// module's top level runs while the Worker's global scope is evaluated, which Cloudflare holds to
// its own startup limit (the documented 1 s for a Worker's startup), apart from the per-request CPU
// allowance a first request is held to. That was read from Cloudflare's limits documentation and
// not confirmed against production's CPU figures; if those ever show a first request paying for
// startup, this loop is a cost with no gain, and should go.
const INTL_WARM_UP = { message: "{count, plural, one {# x} other {# x}} {count, number}" } as const;
for (const locale of routing.locales) {
  try {
    createTranslator({ locale, messages: INTL_WARM_UP, timeZone: SERVER_TIME_ZONE })("message", { count: 2 });
    new Intl.DateTimeFormat(locale, { timeZone: SERVER_TIME_ZONE }).format(0);
  } catch {
    // Never worth failing the Worker's startup over.
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && routing.locales.includes(requested as (typeof routing.locales)[number])
    ? (requested as (typeof routing.locales)[number])
    : routing.defaultLocale;

  return {
    locale,
    messages: catalogues[locale],
    // Named rather than left to next-intl, which otherwise works it out as
    // `Intl.DateTimeFormat().resolvedOptions().timeZone` each time it builds its config. That is
    // meant to happen once per request, but most of its calls here (every generateMetadata among
    // them) land outside React's request cache, so a page built nine new DateTimeFormats to learn,
    // nine times over, the zone the Worker always runs in. UTC is that zone, so nothing a reader
    // sees changes: no message formats a date or time (tests/client-messages.test.mjs checks), and
    // every date on the site is formatted in its own place's zone by code that names it.
    timeZone: SERVER_TIME_ZONE,
  };
});
