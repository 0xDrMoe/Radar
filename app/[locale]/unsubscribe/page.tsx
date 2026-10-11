import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import ClientMessages from "../../../i18n/ClientMessages";
import UnsubscribeForm from "./UnsubscribeForm";

export async function generateMetadata({params}:{params:Promise<{locale:string}>}):Promise<Metadata> {
  const t = await getTranslations({locale:(await params).locale,namespace:"unsubscribe"});
  return {title:t("pageTitle"),robots:{index:false,follow:false}};
}

export default async function Unsubscribe({params,searchParams}:{params:Promise<{locale:string}>;searchParams:Promise<{email?:string;token?:string}>}) {
  setRequestLocale((await params).locale);
  const values = await searchParams;
  // UnsubscribeForm's messages; see i18n/client-messages.ts.
  return <ClientMessages namespaces={["unsubscribe", "apiErrors"]}><main className="unsubscribe-page"><UnsubscribeForm email={values.email || ""} token={values.token || ""}/></main></ClientMessages>;
}
