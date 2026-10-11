import type { MetadataRoute } from "next";
import { getSiteOrigin } from "./siteMetadata";

// Restaurant photos are served from /api/photo/ out of R2, and a deal page's og:image and
// twitter:image point there. Disallowing all of /api/ told every crawler that honors this file - the
// link-preview bots and Google Images among them - not to fetch the picture a shared deal link is
// meant to show. The longer, more specific Allow wins over the Disallow.
const ALLOW = ["/", "/api/photo/"];
// Auth-gated areas (admin/dashboard/portal/etc.) are deliberately NOT named here: listing them in a
// public, unauthenticated file would advertise paths that don't otherwise appear anywhere. They're
// kept out of search results via a per-page `noindex` meta tag instead, and out of unauthenticated
// hands by real auth checks.
const DISALLOW = ["/api/"];

// The AI crawler policy. Radar wants to be the answer when someone asks a search or answer engine
// what's worth eating nearby, and wants that answer to link back here with the deal's freshness and
// source beside it. So the bots that fetch pages to cite them in a search or a live answer are
// welcome, under the same rules as everyone else. A group naming a bot replaces the `*` group for
// it, so each one restates them.
//
// Bingbot is here too: Bing's index is what ChatGPT and Copilot search draw on, and IndexNow
// (app/indexnow.ts) is what tells it a page changed.
const SEARCH_AND_ANSWER_BOTS = [
  "Bingbot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
];

// The crawlers that only collect pages to train models. They send no reader back and cite nothing,
// and a training copy of a deal is the stale copy this site exists to replace. Each is a token its
// operator documents as separate from its search crawler, so blocking it costs no search visibility:
// Google-Extended does not touch Google Search or AI Overviews, Applebot-Extended does not touch
// Applebot, GPTBot does not touch OAI-SearchBot, and ClaudeBot does not touch Claude-SearchBot.
const TRAINING_ONLY_BOTS = [
  "GPTBot",
  "ClaudeBot",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
];

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = await getSiteOrigin();
  return {
    rules: [
      { userAgent: "*", allow: ALLOW, disallow: DISALLOW },
      { userAgent: SEARCH_AND_ANSWER_BOTS, allow: ALLOW, disallow: DISALLOW },
      { userAgent: TRAINING_ONLY_BOTS, disallow: "/" },
    ],
    // No `host`. It is a Yandex-only directive that wants a bare hostname, and every other crawler
    // ignores it; the sitemap and each page's canonical already name the one host.
    sitemap: `${base}sitemap.xml`,
  };
}
