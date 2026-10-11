import { getAppUser } from "../../../auth";
import { apiError } from "../../../api-utils";
import { buildAccountExport } from "../../../account-export";

export async function GET() {
  const user = await getAppUser(); if (!user) return apiError(401,"AUTH_REQUIRED","Sign in required.");
  const data = await buildAccountExport(user.userId);
  if (!data) return apiError(404,"ACCOUNT_NOT_FOUND","No account to export.");
  return new Response(JSON.stringify(data,null,2),{headers:{"content-type":"application/json; charset=utf-8","content-disposition":`attachment; filename="radar-account-export-${data.exportedAt.slice(0,10)}.json"`,"cache-control":"private, no-store"}});
}
