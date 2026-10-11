import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { canAdminister, requireAppUser } from "../../../auth";
import AdminClient from "../AdminClient";
import { adminPageTitle, canOpenTab, tabFromPath } from "../sections";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }:{ params:Promise<{section:string}> }): Promise<Metadata> {
  const tab = tabFromPath((await params).section);
  return { title: adminPageTitle(tab || "overview"), robots: { index: false, follow: false } };
}

// A tab somebody may not open sends them to the overview rather than to a page of empty panels.
// The same rule builds the sidebar (canOpenTab), and every read behind the tab checks its own
// permission again on the server, so this redirect is courtesy, not the protection.
export default async function AdminSection({ params }:{ params:Promise<{section:string}> }) {
  const segment = (await params).section;
  const tab = tabFromPath(segment);
  if (!tab) redirect("/admin");
  const user = await requireAppUser(`/admin/${segment}`);
  if (!canAdminister(user)) redirect("/dashboard");
  if (!canOpenTab(tab, { role: user.role, permissions: user.permissions })) redirect("/admin");
  return <AdminClient initialTab={tab}/>;
}
