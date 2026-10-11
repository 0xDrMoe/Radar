// Which parts of the message catalogue reach the browser.
//
// A client component reads its words from NextIntlClientProvider, and whatever a provider is handed
// is serialized into the page twice: once into the RSC flight data, and again, escaped, into the
// HTML that carries that data. The locale layout used to hand it the whole catalogue - 46 KB of
// English, 53 KB of French - on every page, so /en/unsubscribe was 87 KB of HTML for one form, and
// every server render paid to serialize, re-parse and re-escape all of it. That fixed cost is what
// much of each request's CPU allowance was being spent on.
//
// So the layout provides only SHARED_CLIENT_NAMESPACES, what the site's own chrome reads on every
// page, and a page whose client components read more wraps what it returns in <ClientMessages
// namespaces={[...]}> (i18n/ClientMessages.tsx) naming its own. A nested provider replaces the
// messages of the one above it rather than adding to them, which is why ClientMessages always adds
// the shared set back. Server components are unaffected: getTranslations reads the full catalogue
// on the server, and nothing it reads crosses to the browser unless a component passes it on.
//
// tests/client-messages.test.mjs follows every page's imports into its client components and fails
// when one of them reads a namespace its page does not provide, or a page provides one nothing reads.
//
// Kept free of imports so the test can load it on its own.

/** What SiteHeader, SiteFooter, the command palette, the theme menu and the cookie notice read. */
export const SHARED_CLIENT_NAMESPACES = ["nav", "theme", "commandPalette", "siteFooter", "home.cookieNotice"] as const;

type Messages = Record<string, unknown>;

/**
 * The parts of `messages` named by `paths`, each a namespace ("pro") or a namespace inside one
 * ("home.cookieNotice").
 *
 * Every namespace picked is the catalogue's own object, not a copy. React's flight serializer writes
 * an object it has already written as a reference to the first copy, so the layout's provider and a
 * page's provider naming the same namespace put its text in the page once.
 */
export function pickMessages(messages: Messages, paths: readonly string[]): Messages {
  const picked: Messages = {};
  // Shallowest first, so a namespace taken whole is never replaced by a part of itself.
  const ordered = [...paths].sort((a, b) => a.split(".").length - b.split(".").length);
  for (const path of ordered) {
    const keys = path.split(".");
    // A path the catalogue lacks adds nothing, not even an empty namespace.
    const value = keys.reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Messages)[key] : undefined), messages);
    if (value === undefined) continue;
    const leaf = keys.pop() as string;
    let source = messages;
    let target: Messages | null = picked;
    for (const key of keys) {
      source = source[key] as Messages;
      // Already taken whole: this part of it is in there too.
      if (target[key] === source) { target = null; break; }
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      target = target[key] as Messages;
    }
    if (target) target[leaf] = value;
  }
  return picked;
}
