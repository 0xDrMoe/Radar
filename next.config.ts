import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Metadata in <head>, for every reader.
  //
  // By default the framework streams generateMetadata's output after the page shell, into a hidden
  // div in <body>, and only waits for it for a list of "HTML-limited" bots. Radar's pages are served
  // to nobody that way on purpose: deal pages are baked once by scripts/prerender-deals.mjs and
  // other pages are held in the colo cache (worker/index.ts), and both store whichever variant the
  // first render produced - the streamed one - for every visitor after, bots included. Googlebot,
  // which is not on the list at all, got the canonical and hreflang in <body> on every page, where
  // Google documents that it ignores them. Matching every user agent makes the metadata blocking
  // everywhere. A request with no User-Agent is still streamed by the framework whatever this says,
  // which is why renderPage in worker/index.ts gives one to a request that arrives without.
  htmlLimitedBots: /.*/,
};

export default nextConfig;
