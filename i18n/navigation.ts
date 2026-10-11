import { createElement, type ComponentProps } from "react";
import { createNavigation } from "next-intl/navigation";
import { routing } from "./routing";

const navigation = createNavigation(routing);

export const { redirect, usePathname, useRouter, getPathname } = navigation;

/**
 * next-intl's <Link>, with prefetching off unless a caller turns it back on.
 *
 * The framework's default prefetches every link as it comes within 250 px of the viewport and again
 * when the pointer or a finger lands on it, and each prefetch is a request for the page's RSC
 * flight. The Worker cannot answer one of those from the colo cache or a baked file
 * (worker/index.ts serves those to document requests only), so every prefetch was a full server
 * render. Measured in a browser against the built Worker: a page scrolled to its footer sent 13 of
 * them within 65 ms, and with the pointer moved across the header and footer 25 to 36 per page
 * view, each a render of 1 to 6 ms of local CPU when timed alone (more in production). The same
 * page was prefetched as often as seven times in one view, and the click that followed still sent
 * its own navigation request, so the prefetches saved the reader nothing.
 *
 * `prefetch={false}` stops both kinds in vinext's App Router: the viewport observer is never set up
 * (canLinkPrefetch in node_modules/vinext/dist/shims/link-prefetch.js) and the hover and touch
 * handlers bail out (canLinkIntentPrefetch). null is treated as off too, because vinext reads it
 * as "auto", which prefetches.
 *
 * Every import of Link from this module gets this one; tests/link-prefetch.test.mjs fails when a
 * public page renders a link that can still prefetch.
 */
export function Link({ prefetch, ...props }: ComponentProps<typeof navigation.Link>) {
  return createElement(navigation.Link, { ...props, prefetch: prefetch ?? false });
}
