import { requirePortalUser } from "./gate";
import AffiliatePortalClient from "./AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Affiliate portal — Radar", robots: { index: false, follow: false } };

export default async function AffiliateDashboardPage() {
  await requirePortalUser("/affiliate");
  return <AffiliatePortalClient section="dashboard" />;
}
