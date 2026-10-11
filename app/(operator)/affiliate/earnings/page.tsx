import { requirePortalUser } from "../gate";
import AffiliatePortalClient from "../AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Earnings — Radar", robots: { index: false, follow: false } };

export default async function AffiliateEarningsPage() {
  await requirePortalUser("/affiliate/earnings");
  return <AffiliatePortalClient section="earnings" />;
}
