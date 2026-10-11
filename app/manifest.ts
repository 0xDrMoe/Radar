import type { MetadataRoute } from "next";

// Lets a visitor "Add to Home Screen" / install Radar like an app on Android and desktop Chrome.
//
// The raster icons are drawn from favicon.svg by scripts/app-icons.mjs, on the site's own dark
// background. Android wants a 192 and a 512 px PNG and a maskable one it can crop to its own shape;
// given only the SVG it drew thin 24 px rings on a transparent background as the app's icon. The
// SVG stays listed for engines that prefer a vector. iOS ignores this file entirely and reads
// apple-touch-icon.png from the page's metadata (app/siteMetadata.ts).
//
// `id` is what a browser uses to recognize an installed app across manifest changes. Left out, it
// defaults to start_url, so stating start_url's value keeps every existing install the same app
// rather than a new one.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/en",
    name: "Radar — Nearby restaurant deals & happy hours",
    short_name: "Radar",
    description: "Your radar for restaurant deals, daily specials, and happy hours near you.",
    start_url: "/en",
    display: "standalone",
    background_color: "#070707",
    theme_color: "#070707",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
