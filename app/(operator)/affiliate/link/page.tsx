import { requirePortalUser } from "../gate";
import AffiliatePortalClient from "../AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your referral link — Radar", robots: { index: false, follow: false } };

export default async function AffiliateLinkPage() {
  await requirePortalUser("/affiliate/link");
  return <AffiliatePortalClient section="link" />;
}
