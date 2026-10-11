import type { ComponentType, ReactNode } from "react";
import { Compass } from "lucide-react";

type Copy = { title: string; body: string; home: string; browse: string };

// English, for the operator area, which sits outside the locale layout and so has no messages to
// read. The public pages pass their own copy in; see app/[locale]/not-found.tsx.
const ENGLISH: Copy = {
  title: "This page wandered off.",
  body: "The link may be outdated, or the offer it pointed to is no longer available.",
  home: "Back to deals",
  browse: "Browse what's available near you",
};

type HomeLink = ComponentType<{ href: `/${string}`; className?: string; children: ReactNode }>;

// The English-only operator area's links: plain, to "/", which the middleware sends on to the
// reader's language. That area has no locale to write in, and no next-intl to ask for one.
function PlainLink({ href, className, children }: { href: `/${string}`; className?: string; children: ReactNode }) {
  return <a className={className} href={href}>{children}</a>;
}

// Never next/link's prefetching links: as those, both were prefetched the moment a browser showed
// them, two renders of the home page on top of the 404's own every time a reader followed a dead
// link. The public pages pass ChromeLink (app/[locale]/NotFoundPage.tsx), which writes the home
// page in the reader's language and picks the kind of link by whether they carry a session cookie:
// a page load of the baked home page without one, a client-side navigation with one (see
// app/ChromeLink.tsx). The operator area keeps the plain links above.
export default function NotFoundContent({ copy = ENGLISH, LinkTo = PlainLink }: { copy?: Copy; LinkTo?: HomeLink }) {
  return (
    <div className="portal-loading portal-error">
      <Compass aria-hidden="true" />
      <h1>{copy.title}</h1>
      <p>{copy.body}</p>
      <LinkTo className="primary" href="/">{copy.home}</LinkTo>
      <LinkTo href="/#results">{copy.browse}</LinkTo>
    </div>
  );
}
