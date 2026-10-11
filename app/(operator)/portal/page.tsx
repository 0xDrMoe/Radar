import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { requireAppUser } from "../../auth";
import RestaurantPortalClient from "./RestaurantPortalClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Restaurant portal — Radar", robots: { index: false, follow: false } };

export default async function PortalPage() {
  const user = await requireAppUser("/portal");
  const manages = await env.DB.prepare("SELECT 1 FROM restaurant_managers WHERE user_id=? AND status='active' LIMIT 1").bind(user.userId).first();
  // The manager grant is the authority here, not the role — most managers predate the restaurant
  // account type and still hold role "user". The role only changes what happens when there is no
  // grant: a restaurant account is one staff has already decided belongs here, so it gets told it
  // is waiting on a restaurant rather than being bounced to the dashboard with no explanation.
  if (!manages && user.role !== "restaurant") redirect("/dashboard");
  return <RestaurantPortalClient />;
}
