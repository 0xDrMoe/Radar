import { requirePortalUser } from "../gate";
import AffiliatePortalClient from "../AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payouts — Radar", robots: { index: false, follow: false } };

export default async function AffiliatePayoutsPage() {
  await requirePortalUser("/affiliate/payouts");
  return <AffiliatePortalClient section="payouts" />;
}
