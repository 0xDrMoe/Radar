import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../../i18n/ClientMessages";
import ConfirmEmail from "./ConfirmEmail";

export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata> {
  const t = await getTranslations({locale:(await params).locale,namespace:"confirmEmail"});
  return {title:t("pageTitle"),robots:{index:false,follow:false}};
}

export default async function ConfirmEmailPage({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{email?:string;token?:string}>}) {
  setRequestLocale((await params).locale);
  const values = await searchParams;
  // ConfirmEmail's messages; see i18n/client-messages.ts.
  return <ClientMessages namespaces={["confirmEmail", "apiErrors"]}><main className="unsubscribe-page"><ConfirmEmail email={values.email || ""} token={values.token || ""}/></main></ClientMessages>;
}
