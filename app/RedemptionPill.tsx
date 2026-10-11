"use client";
import { useTranslations } from "next-intl";
import { displayPromoCode, parseRedemption, redemptionBadge } from "./redemption";

/**
 * The one-line answer a card gives to "how do I get this?": App only, a named code, No app needed,
 * or Online. Nothing at all when the deal makes no claim - an unclassified offer is not "no app
 * needed", and saying so would be the one wrong answer this badge exists to prevent.
 */
export default function RedemptionPill({ redemption, promoCode, note }: { redemption?: string | null; promoCode?: string | null; note?: string | null }) {
  const t = useTranslations("redemption");
  const badge = redemptionBadge(parseRedemption(redemption));
  if (!badge) return null;
  const code = displayPromoCode(promoCode);
  const label = badge === "appOnly" ? t("badgeAppOnly")
    : badge === "code" ? (code ? t("badgeCodeNamed", { code }) : t("badgeCode"))
    : badge === "inStore" ? t("badgeInStore")
    : t("badgeOnline");
  return <span className={`redemption-pill redemption-pill-${badge}`} title={note || undefined}>{label}</span>;
}
