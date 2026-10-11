"use client";
import { useEffect, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { trackDealClick } from "../../../trackDealClick";

// Records the two things a creator or a restaurant is actually asking about: how many people
// looked at this deal, and how many of them went on to the restaurant's own offer.
//
// The view is recorded here, on the deal page, rather than on the cards that link to it, so it
// counts every arrival — a link in a creator's post, a search result and a tap in the grid all
// land on this page, and for a creator the direct link is the normal case.

export function DealView({ dealId }: { dealId: string }) {
  // Strict Mode mounts effects twice in development, and a double-counted view is a wrong number
  // rather than a visible bug — the kind that gets believed. A ref is enough: this fires once per
  // page, and a genuine second view means a fresh navigation and a fresh component.
  const recorded = useRef(false);
  useEffect(() => {
    if (recorded.current) return;
    recorded.current = true;
    trackDealClick(dealId, "view");
  }, [dealId]);
  return null;
}

// The outbound link, which has to stay a plain anchor: middle-click, long-press and "open in new
// tab" are how people actually use it, and none of those fire a click handler that then navigates.
// Recording alongside the browser's own navigation rather than in place of it means the link
// behaves exactly as it did before this existed.
export function OfferLink({ dealId, href, label }: { dealId: string; href: string; label: string }) {
  return (
    <a
      className="source-button"
      href={href}
      target="_blank"
      rel="noreferrer"
      onAuxClick={(event) => { if (event.button === 1) trackDealClick(dealId, "offer"); }}
      onClick={() => trackDealClick(dealId, "offer")}
    >
      <ExternalLink /> {label}
    </a>
  );
}
