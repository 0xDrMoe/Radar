import { requirePortalUser } from "../gate";
import AffiliatePortalClient from "../AffiliatePortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payout settings — Radar", robots: { index: false, follow: false } };

export default async function AffiliateSettingsPage() {
  await requirePortalUser("/affiliate/settings");
  return <AffiliatePortalClient section="settings" />;
}
