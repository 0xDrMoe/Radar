import { Lock, Sparkles } from "lucide-react";
import ChromeLink from "./ChromeLink";

// Tier badges, following the convention every mature freemium product converged on (GitLab's
// feature-management guidance, Nielsen's "inactive controls must not be a communication dead
// end"):
//
//   1. The badge sits next to the *individual* control it gates, never on a section heading — a
//      "PRO" tag on a whole panel makes free users think the panel is closed to them, which is
//      precisely the confusion we're trying to avoid.
//   2. It only renders for users whose plan is below the feature's tier. Pro users see the plain
//      control with no ornament.
//   3. It is always a live link to /pro. A locked control that can't be clicked teaches nothing;
//      one that explains itself in a tooltip and links to the comparison is a working upsell.
//
// Both take their copy as props so the same component works from server pages and from the
// client dashboard without either one owning a translation namespace.
//
// Both are purchase links, so both carry `purchase-cta` and vanish in a tab the iOS app opened
// outside the US storefront, where the app may not lead anyone to a purchase (app/app-context.ts).
// The control they sit beside keeps its own lock.
//
// ChromeLinks, like the site header's link to /pro (app/ChromeLink.tsx), which choose the kind of
// link by whether the reader carries Clerk's session cookie. Today these only show on the
// dashboard, whose readers always do, so they render as client-side navigations, unprefetched: a
// signed-in reader's requests are rendered every time (worker/index.ts keeps them out of the bake
// and the colo cache), and the flight is the cheaper of the two renders. Shown to a signed-out
// reader anywhere, they would be plain page loads of the colo's copy of /pro instead.

export function ProBadge({ label, title }: { label: string; title: string }) {
  return (
    <ChromeLink className="pro-badge purchase-cta" href="/pro" title={title} aria-label={title}>
      <Sparkles />
      {label}
    </ChromeLink>
  );
}

// The icon-only variant, for rows where a full badge would not fit.
export function ProLock({ title }: { title: string }) {
  return (
    <ChromeLink className="pro-lock purchase-cta" href="/pro" title={title} aria-label={title}>
      <Lock />
    </ChromeLink>
  );
}
