import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";

// Who may open the affiliate portal, and where a stranger is sent.
//
// Sign-in is the only condition. Being an affiliate is NOT checked here, deliberately: a signed-in
// Radar user who has applied, been turned down, or never heard of the program gets the portal
// shell with the right invitation inside it, which is a better answer than a redirect that looks
// like the page does not exist. Everything that could leak — a balance, a ledger, a payout — comes
// from /api/affiliate, which resolves the handle from the session and returns nothing at all to
// someone without a profile. The page is the convenience; the API is the rule.
//
// WHY THE SIGN-IN URL IS COMPUTED RATHER THAN RELATIVE. The portal answers on two hosts:
// radar.cheap/affiliate, and affiliate.radar.cheap, which worker/index.ts rewrites onto the same
// routes. On the second, a relative redirect to /sign-in would be rewritten into /affiliate/sign-in
// and 404 — so from there the visitor is sent to the canonical site to sign in and returned to the
// portal at its canonical path. Everywhere else, including localhost, the redirect stays on the
// host the request arrived at.
//
// Radar has exactly one account system and this keeps it that way: there is no second sign-in to
// build, brand, or get wrong, and no password field anywhere in the portal.
export async function requirePortalUser(returnTo: string) {
  const user = await getAppUser();
  if (user) return user;
  redirect(`${await canonicalOrigin()}/sign-in?redirect_url=${encodeURIComponent(returnTo)}`);
}

/**
 * The origin a link out of the portal should point at.
 *
 * Empty for a request that already arrived on a host serving the whole site, which makes every
 * link relative — the right answer in development, in preview, and on radar.cheap itself. Only a
 * request on the affiliate subdomain, where the rest of the site is not reachable, gets an
 * absolute URL, and it comes from PUBLIC_APP_URL rather than from anything in the request.
 */
async function canonicalOrigin() {
  const host = (await headers()).get("host") || "";
  if (!host.startsWith("affiliate.")) return "";
  const runtime = env as unknown as Record<string, string>;
  return (runtime.PUBLIC_APP_URL || "https://radar.cheap").replace(/\/+$/, "");
}
