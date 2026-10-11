import { requirePortalUser } from "../gate";
import AffiliatePortalClient from "../AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Referrals — Radar", robots: { index: false, follow: false } };

export default async function AffiliateReferralsPage() {
  await requirePortalUser("/affiliate/referrals");
  return <AffiliatePortalClient section="referrals" />;
}
