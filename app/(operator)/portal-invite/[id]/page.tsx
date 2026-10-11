import { env } from "cloudflare:workers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAppUser } from "../../../auth";
import { verifyEmailAction } from "../../../email";
import RadarMark from "../../../RadarMark";

export const metadata = { title: "Restaurant invitation — Radar", robots: { index: false, follow: false } };

interface RestaurantManagerInviteRow {
  id: string;
  restaurant_id: string;
  invited_email: string;
  user_id: string | null;
  status: string;
  invited_by: string;
  created_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

function InviteMessage({ title, body }: { title: string; body: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-panel" aria-labelledby="invite-heading">
        <header className="auth-header">
          <Link prefetch={false} href="/" className="auth-brand"><RadarMark />Radar.</Link>
          <h1 id="invite-heading">{title}</h1>
          <p>{body}</p>
        </header>
        <Link prefetch={false} className="primary" href="/dashboard">Go to my dashboard</Link>
      </section>
    </main>
  );
}

export default async function PortalInvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const id = (await params).id;
  const token = (await searchParams).token || "";
  const invite = await env.DB.prepare("SELECT * FROM restaurant_managers WHERE id=?").bind(id).first<RestaurantManagerInviteRow>();
  if (!invite) return <InviteMessage title="Invitation not found" body="This invitation link is no longer valid." />;
  if (invite.status === "revoked") return <InviteMessage title="Invitation revoked" body="This invitation has been revoked by an administrator." />;

  const user = await requireAppUser(`/portal-invite/${id}?token=${encodeURIComponent(token)}`);

  const verifiedInviteId = await verifyEmailAction("restaurant_invite", token, invite.invited_email);
  if (verifiedInviteId !== id) return <InviteMessage title="Invalid invitation link" body="This invitation link is invalid or has expired." />;
  if (user.email.toLowerCase() !== String(invite.invited_email).toLowerCase()) {
    return <InviteMessage title="Sign in with the invited address" body={`This invitation was sent to ${invite.invited_email}. Sign out and sign back in with that address to accept it.`} />;
  }
  if (invite.status !== "active") {
    await env.DB.prepare("UPDATE restaurant_managers SET status='active',user_id=?,accepted_at=CURRENT_TIMESTAMP WHERE id=?").bind(user.userId, id).run();
  }
  redirect("/portal");
}
