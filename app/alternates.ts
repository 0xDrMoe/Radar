import { routing } from "../i18n/routing";

// A page's own address and its translations, for <link rel="canonical"> and hreflang. Public pages
// other than the home page used to have neither, so a search engine met /en/pro, /fr/pro and
// /es/pro as three unrelated pages saying similar things. The home page and every deal page use
// this too now, so the four places that spelled the map out cannot drift apart.
//
// x-default names the English page as the one for a reader whose language is none of the three,
// which is what the bare, locale-less path does anyway: it redirects there.
export function localizedAlternates(locale: string, path: string) {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((loc) => [loc, `/${loc}${path}`])),
      "x-default": `/${routing.defaultLocale}${path}`,
    },
  };
}

// The pages whose prose is English in every locale (age suitability, the city guides). Only the
// chrome around them is translated, so the three addresses are one document, and the English one is the address to index.
export function englishOnlyAlternates(path: string) {
  return { canonical: `/en${path}` };
}

// A page that exists in every locale but whose own words exist only in some: a deal translated into
// French and not Spanish, or not at all. Each page that is in its own language is canonical and
// names the others that are; a page that is only translated chrome around English is a copy of the
// English one, and says so with its canonical, as englishOnlyAlternates does.
export function translatedAlternates(locale: string, path: string, available: readonly string[]) {
  const languages = routing.locales.filter((loc) => loc === routing.defaultLocale || available.includes(loc));
  if (languages.length < 2) return englishOnlyAlternates(path);
  const own = languages.includes(locale as (typeof routing.locales)[number]) ? locale : routing.defaultLocale;
  return {
    canonical: `/${own}${path}`,
    languages: {
      ...Object.fromEntries(languages.map((loc) => [loc, `/${loc}${path}`])),
      "x-default": `/${routing.defaultLocale}${path}`,
    },
  };
}
