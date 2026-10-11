import { redirect } from "next/navigation";
import { canAdminister, requireAppUser } from "../../auth";
import AdminClient from "./AdminClient";
import { adminPageTitle, tabPath } from "./sections";
export const dynamic = "force-dynamic";
export const metadata = { title: adminPageTitle("overview"), robots: { index: false, follow: false } };
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ section?: string }>;
}) {
  const requested = (await searchParams).section;
  if (requested && requested !== "overview") redirect(tabPath(requested));
  const user = await requireAppUser("/admin");
  if (!canAdminister(user)) redirect("/dashboard");
  return <AdminClient initialTab="overview" />;
}
