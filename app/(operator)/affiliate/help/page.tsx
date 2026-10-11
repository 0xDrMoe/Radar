import { requirePortalUser } from "../gate";
import AffiliatePortalClient from "../AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "How the affiliate program works — Radar", robots: { index: false, follow: false } };

export default async function AffiliateHelpPage() {
  await requirePortalUser("/affiliate/help");
  return <AffiliatePortalClient section="help" />;
}
