import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { requireAppUser } from "../../auth";
import CreatorWorkspaceClient from "./CreatorWorkspaceClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Creator workspace — Radar", robots: { index: false, follow: false } };

// The same two conditions /api/creator enforces, checked again here so the shell never renders for
// someone every panel inside it would refuse. The page is the convenience; the API is the rule.
export default async function CreatorPage() {
  const user = await requireAppUser("/creator");
  if (user.role !== "creator") redirect("/dashboard");
  const profile = await env.DB.prepare("SELECT handle FROM creator_profiles WHERE user_id=? AND status='active'")
    .bind(user.userId).first<{ handle: string }>();
  if (!profile) redirect("/dashboard");
  return <CreatorWorkspaceClient />;
}
