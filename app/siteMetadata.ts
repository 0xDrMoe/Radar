import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { routing } from "../i18n/routing";

// Any URL that goes into a <link>, a meta tag, or JSON-LD is built from the *actual* request
// host rather than a hardcoded domain, so canonical tags, og:url, sitemap entries and the
// Organization/WebSite JSON-LD point at the page the visitor is actually on. Production is
// radar.cheap alone now that the previous host is retired, but localhost and preview hosts
// still need this, and a second custom domain would otherwise reintroduce the old bug.
export async function getSiteOrigin(): Promise<URL> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  return new URL(`${protocol}://${host}`);
}

// `viewport-fit: cover` lets the page paint under a notch/home indicator, which is what makes
// the env(safe-area-inset-*) padding in refinements.css do anything. themeColor paints the
// mobile browser chrome to match the page instead of leaving a bright bar above a dark app —
// two entries (one per prefers-color-scheme) so that match happens from first paint, before
// the app's own dark-by-default script in RootShell.tsx has a chance to run.
export const siteViewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3e9" },
    { media: "(prefers-color-scheme: dark)", color: "#070707" },
  ],
};

// 1200x630, the size the deal pages' own cards are drawn at (scripts/deal-og.mjs), so a deal page
// that falls back to this card (a deal published since the last deploy) declares the right size.
const OG_IMAGE = { url: "/og.png", width: 1200, height: 630 };

// The site's own title, description and preview, in the reader's language. /fr and /es used to
// carry the English ones in every <title>, description and og: tag while the page below them was
// in French or Spanish. The operator console, which is English-only, calls this with no locale.
export async function buildSiteMetadata(locale: string = routing.defaultLocale): Promise<Metadata> {
  const base = await getSiteOrigin();
  // A path the locale layout is about to reject (/wp-login.php arrives as locale "wp-login.php")
  // still resolves its metadata first, and has to get the default's rather than an error.
  const known = routing.locales.includes(locale as (typeof routing.locales)[number]) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: known, namespace: "metadata" });
  const title = t("siteTitle");
  const description = t("siteDescription");
  return {
    metadataBase: base,
    title,
    description,
    applicationName: "Radar",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg", apple: "/apple-touch-icon.png" },
    // No og:url here. This is the fallback for a page that sets none of its own, and the site's
    // root was the wrong answer for every one of them: a shared /en/pro link previewed as the home
    // page. Pages that are meant to be shared set their own through pageMetadata below.
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "Radar",
      images: [{ ...OG_IMAGE, alt: t("ogImageAlt") }],
    },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}

/**
 * A page's title and description, and the same in its link preview.
 *
 * openGraph and twitter are replaced whole by a page that sets them, not merged with the layout's,
 * so a page that set only its title used to preview with the site's title, description and URL.
 * Every shareable page goes through this so the three always say the same thing. The image and its
 * size are restated for the same reason; relative URLs resolve against the layout's metadataBase.
 */
export function pageMetadata({ title, description, alternates, imageAlt = "Radar — nearby restaurant deals and happy hours" }: {
  title: string;
  description: string;
  alternates: { canonical: string; languages?: Record<string, string> };
  /** Translated where the page is; the English-only pages take the English default. */
  imageAlt?: string;
}): Metadata {
  return {
    title,
    description,
    alternates,
    openGraph: { title, description, type: "website", siteName: "Radar", url: alternates.canonical, images: [{ ...OG_IMAGE, alt: imageAlt }] },
    twitter: { card: "summary_large_image", title, description, images: [OG_IMAGE.url] },
  };
}
