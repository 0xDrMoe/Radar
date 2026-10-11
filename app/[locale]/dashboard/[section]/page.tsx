import { redirect } from "next/navigation";
import { env } from "cloudflare:workers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../../../i18n/ClientMessages";
import { canAdminister, requireAppUser } from "../../../auth";
import DashboardClient from "../DashboardClient";
import { dashboardSections, type DashboardSection } from "../sections";
import { localizedPath } from "../../../locale-path";

export const dynamic = "force-dynamic";
export async function generateMetadata({params}:{params:Promise<{locale:string}>}) {
  const t = await getTranslations({locale:(await params).locale,namespace:"dashboard"});
  return { title: t("pageTitle"), robots: { index: false, follow: false } };
}

export default async function DashboardSectionPage({ params }:{ params:Promise<{section:string;locale:string}> }) {
  const { section: rawSection, locale } = await params;
  setRequestLocale(locale);
  const section = rawSection as DashboardSection;
  // In the locale it was asked in - see the overview page.
  const home = localizedPath("/dashboard", locale);
  if (!(dashboardSections as readonly string[]).includes(section)) redirect(home);
  const user = await requireAppUser(`${home}/${section}`, localizedPath("/sign-in", locale));
  // Both workspace links in one round trip each: the restaurant portal follows the manager grant
  // (which is not a role, and predates these account types), the creator workspace follows an
  // active creator profile.
  const [manages, creates] = await Promise.all([
    env.DB.prepare("SELECT 1 FROM restaurant_managers WHERE user_id=? AND status='active' LIMIT 1").bind(user.userId).first(),
    user.role === "creator"
      ? env.DB.prepare("SELECT 1 FROM creator_profiles WHERE user_id=? AND status='active' LIMIT 1").bind(user.userId).first()
      : Promise.resolve(null),
  ]);
  // DashboardClient's messages; see i18n/client-messages.ts.
  return <ClientMessages namespaces={["dashboard", "apiErrors"]}><DashboardClient initialSection={section} canAdminister={canAdminister(user)} canManageRestaurant={Boolean(manages)} isCreator={Boolean(creates)}/></ClientMessages>;
}
