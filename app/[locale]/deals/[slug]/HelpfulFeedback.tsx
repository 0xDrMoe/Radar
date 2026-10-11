"use client";
import { useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "../../../Toast";

// A one-click quality signal that costs the visitor nothing (no sign-in, no form) — sits
// alongside the existing full accuracy-report flow in DetailActions for anyone who has more to
// say than a thumbs-up. Votes land in product_events (see app/api/deals/feedback/route.ts) so
// admin's overview can surface "least helpful" deals without a schema migration.
export default function HelpfulFeedback({ dealId }: { dealId: string }) {
  const t = useTranslations("helpfulFeedback");
  const toast = useToast();
  const [voted, setVoted] = useState<"yes" | "no" | null>(null);
  const [busy, setBusy] = useState(false);

  async function vote(helpful: boolean) {
    if (busy || voted) return;
    setBusy(true);
    const response = await fetch("/api/deals/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealId, helpful }),
    });
    setBusy(false);
    if (!response.ok) { toast(t("couldNotSend"), "error"); return; }
    setVoted(helpful ? "yes" : "no");
    toast(t("thanks"), "success");
  }

  // A <section>, like every other block in the deal card, so it picks up the card's own
  // `.deal-page-card>section` gutter and divider. As a bare <div> it matched neither: it sat
  // flush against the card's inner edge while every neighbor was inset 38px, and drew its own
  // full-bleed rule that lined up with nothing.
  if (voted) return <section className="helpful-feedback voted"><span>{t("thanks")}</span></section>;

  return (
    <section className="helpful-feedback">
      <span>{t("prompt")}</span>
      <button type="button" disabled={busy} onClick={() => vote(true)} aria-label={t("yes")}><ThumbsUp /></button>
      <button type="button" disabled={busy} onClick={() => vote(false)} aria-label={t("no")}><ThumbsDown /></button>
    </section>
  );
}
