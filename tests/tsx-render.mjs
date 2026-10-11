/**
 * Renders the app's own components in plain Node, with react-dom/server, for the tests that need to
 * see what a component actually puts on the page rather than what its source says
 * (tests/chrome-links.test.mjs, tests/link-prefetch.test.mjs).
 *
 * What it takes to load them outside the build:
 *
 *   - .tsx is compiled with the TypeScript the project already type-checks with (transpileModule,
 *     React's automatic JSX runtime), and an import written without its extension, the way the app
 *     writes them, is found as .ts or .tsx.
 *   - i18n/routing.ts reads import.meta.env.PROD, which only the build defines: here it is false,
 *     as in `vinext dev`. Nothing else in that file changes, so next-intl is configured exactly as
 *     the site configures it.
 *   - next/link and next/navigation are vinext's to provide, and exist only inside its build. They
 *     are stood in for: next/link by NEXT_LINK below, which renders an <a> marked data-next-link and
 *     records the props it was given, so a test can tell a client-side link from a plain one and
 *     see what reached next/link; next/navigation by the few hooks next-intl calls during a render.
 *   - A stylesheet import is an empty module.
 *
 * next-intl itself, React and react-dom are the installed packages, unchanged.
 */
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = new URL("../", import.meta.url);

// Every next/link the render reached, with its props, most recent last. Reset per render.
globalThis.__nextLinks = [];
globalThis.__pathname = "/en";

const NEXT_LINK = `data:text/javascript,${encodeURIComponent(`
  import { createElement, forwardRef } from "react";
  const Link = forwardRef(function NextLink({ href, prefetch, locale, children, ...rest }, ref) {
    const target = typeof href === "string" ? href : (href.pathname || "") + (href.search || "") + (href.hash || "");
    globalThis.__nextLinks.push({ href: target, prefetch, locale });
    return createElement("a", { ...rest, ref, href: target, "data-next-link": prefetch === undefined ? "default" : String(prefetch) }, children);
  });
  export default Link;
`)}`;
const NEXT_NAVIGATION = `data:text/javascript,${encodeURIComponent(`
  const router = { push(href) { globalThis.__routerPush?.(href); }, replace() {}, prefetch() {}, back() {}, forward() {}, refresh() {} };
  export const useRouter = () => router;
  export const usePathname = () => globalThis.__pathname;
  export const useParams = () => ({ locale: globalThis.__pathname.split("/")[1] });
  export const useSearchParams = () => new URLSearchParams();
  export const useSelectedLayoutSegment = () => null;
  export function redirect(path) { throw new Error("redirect " + path); }
  export function permanentRedirect(path) { throw new Error("permanentRedirect " + path); }
  export function notFound() { throw new Error("notFound"); }
  export const RedirectType = { push: "push", replace: "replace" };
`)}`;
const EMPTY = "data:text/javascript,export default {};";

const fromApp = (parentURL) => Boolean(parentURL?.startsWith(ROOT.href)) && !parentURL.includes("/node_modules/");

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/link" || specifier === "next/link.js") return { url: NEXT_LINK, shortCircuit: true };
    if (specifier === "next/navigation" || specifier === "next/navigation.js") return { url: NEXT_NAVIGATION, shortCircuit: true };
    if (/\.css$/.test(specifier)) return { url: EMPTY, shortCircuit: true };
    // The stand-ins import React like anything else; a data: URL has no folder to resolve it from.
    if (context.parentURL?.startsWith("data:")) return nextResolve(specifier, { ...context, parentURL: import.meta.url });
    if (fromApp(context.parentURL) && /^\.\.?\//.test(specifier) && !/\.[cm]?[jt]sx?$|\.json$/.test(specifier)) {
      for (const extension of [".ts", ".tsx"]) {
        const url = new URL(`${specifier}${extension}`, context.parentURL);
        if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith(ROOT.href) && !url.includes("/node_modules/")) {
      const path = fileURLToPath(url.split("?")[0]);
      if (path.endsWith(".tsx")) {
        const { outputText } = ts.transpileModule(readFileSync(path, "utf8"), {
          fileName: path,
          compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false },
        });
        return { format: "module", source: outputText, shortCircuit: true };
      }
      if (/[\\/]i18n[\\/]routing\.ts$/.test(path)) {
        const loaded = nextLoad(url, context);
        return { ...loaded, source: String(loaded.source).replaceAll("import.meta.env.PROD", "false") };
      }
    }
    return nextLoad(url, context);
  },
});

const { createElement } = await import("react");
const { renderToString } = await import("react-dom/server");
const { NextIntlClientProvider } = await import("next-intl");

/** The English, French or Spanish catalogue, as the site ships it. */
export function messages(locale) {
  return JSON.parse(readFileSync(new URL(`messages/${locale}.json`, ROOT), "utf8"));
}

/** A module under the repository root, loaded through the hooks above. */
export function load(path) {
  return import(new URL(path, ROOT).href);
}

/**
 * `element` rendered to HTML inside next-intl's provider, as a page at `pathname` in `locale` would
 * render it, and the next/link elements the render reached.
 */
export function render(element, { locale = "en", pathname = `/${locale}`, wrap = (child) => child } = {}) {
  globalThis.__nextLinks = [];
  globalThis.__pathname = pathname;
  const html = renderToString(createElement(NextIntlClientProvider, { locale, messages: messages(locale), timeZone: "UTC" }, wrap(element)));
  return { html, nextLinks: globalThis.__nextLinks };
}

/** Every <a> in `html`: its href, and whether it was rendered by next/link (and with what prefetch). */
export function anchors(html) {
  return [...html.matchAll(/<a\b([^>]*)>/g)].map(([, attributes]) => ({
    href: /\shref="([^"]*)"/.exec(attributes)?.[1]?.replaceAll("&amp;", "&") ?? null,
    nextLink: /\sdata-next-link="([^"]*)"/.exec(attributes)?.[1] ?? null,
  }));
}

export { createElement, pathToFileURL };
