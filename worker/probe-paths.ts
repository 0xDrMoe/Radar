// Addresses no route of this site has ever served, and the page the Worker answers them with.
//
// Kept apart from worker/index.ts, and free of imports, so tests can load it on its own, like
// worker/render-watchdog.ts.
//
// Scanners walk every site on the internet asking for WordPress logins, PHP admin panels, .env
// files and .git directories. Each of those used to be a full render of the site's not-found page,
// header, footer and flight data included: a meaningful share of a request's CPU allowance - for
// an answer that is the same every time, to a client that reads nothing but the status. A burst of
// them also held admission slots that real readers were waiting for. These are answered from here
// instead, before the admission gate and anything that renders, with a small page in the address's
// language.
//
// What counts as a probe has to be narrow enough that no real page ever matches it, because a real
// page that matched would answer 404 to everyone. tests/probe-paths.test.mjs walks every route under
// app/ and every file the deploy uploads and fails if one of them does.

// Extensions of server-side scripts, configuration, dumps and backups: things this site has no
// route for and no file under (pages have no extension, and the only files it serves are images,
// scripts, styles, fonts, robots.txt, sitemap.xml and the web app manifest).
const PROBE_EXTENSION = /\.(?:php\d?|phtml|phar|asp|aspx|ashx|asmx|jsp|jspx|cgi|env|git|svn|sql|sqlite|db|mdb|bak|backup|old|orig|save|swp|ini|cfg|conf|config|log|tar|tgz|gz|zip|rar|7z)$/i;

/**
 * True for an address only a scanner asks for.
 *
 * - Any segment that starts with a dot: /.env, /.git/config, /.aws/credentials, /.DS_Store. Nothing
 *   here is served from a dotted name; Cloudflare's asset layer would have answered such a file
 *   before the Worker ran, if one existed.
 * - A last segment with one of the extensions above: /wp-login.php, /xmlrpc.php, /admin.aspx,
 *   /backup.sql, /web.config.
 * - WordPress's own directories and xmlrpc at the top of the site, or right under a locale:
 *   /wp-admin, /wp-content/..., /en/wp-includes/.... Only there: a deal's slug is made from a
 *   restaurant's name, so "/en/deals/wp-..." is a slug that could exist one day, and it is
 *   deliberately left alone.
 */
export function isProbePath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.some((segment) => segment.startsWith("."))) return true;
  if (segments.length && PROBE_EXTENSION.test(segments[segments.length - 1])) return true;
  const first = segments[0] === "en" || segments[0] === "fr" || segments[0] === "es" ? segments[1] : segments[0];
  return typeof first === "string" && /^(?:wp-|xmlrpc)/i.test(first);
}

// Inline, not from messages/*.json, for the reason render-watchdog.ts gives for its own page: the
// Worker entry keeps next-intl and the catalogues out of itself.
const COPY = {
  en: { title: "Page not found", heading: "There is nothing here.", body: "This address is not a page on Radar.", action: "Go to Radar" },
  fr: { title: "Page introuvable", heading: "Il n'y a rien ici.", body: "Cette adresse n'est pas une page de Radar.", action: "Aller sur Radar" },
  es: { title: "Página no encontrada", heading: "Aquí no hay nada.", body: "Esta dirección no es una página de Radar.", action: "Ir a Radar" },
} as const;

/**
 * The 404 for a probe: no script, no stylesheet, no image and no framework, so it costs the Worker
 * a string, and noindex so it never stands in for anything in a search result. Its language is the
 * address's own locale when it has one, else English, with a plain link to that locale's home page.
 *
 * Cacheable for five minutes in the browser: the answer cannot change within a deploy, and a
 * scanner that does keep a cache asks again less. Nothing here is personal.
 */
export function probeNotFoundResponse(request: Request, url: URL): Response {
  const segment = url.pathname.split("/").filter(Boolean)[0];
  const lang = segment === "fr" || segment === "es" ? segment : "en";
  const copy = COPY[lang];
  const headers = new Headers({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" });
  const html = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${copy.title}</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070707;color:#f5f5f5;font:17px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;padding:24px 16px}
h1{font-size:1.4rem;line-height:1.25;margin:0 0 .75rem}
p{margin:0 0 .75rem;color:#c9c9c9}
a{color:#ff6f4a;font-weight:600}
</style>
</head>
<body>
<main>
<h1>${copy.heading}</h1>
<p>${copy.body}</p>
<p><a href="/${lang}">${copy.action}</a></p>
</main>
</body>
</html>
`;
  return new Response(request.method === "HEAD" ? null : html, { status: 404, headers });
}
