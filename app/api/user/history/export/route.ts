import { env } from "cloudflare:workers";
import { getAppUser, isPro } from "../../../../auth";
import { apiError } from "../../../../api-utils";

interface DeliveryRow {
  id: string;
  status: string;
  sent_at: string | null;
  created_at: string;
  error_code: string | null;
}

function csvField(value: string | null) {
  const text = value ?? "";
  return /[",\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
}

export async function GET() {
  const user = await getAppUser();
  if (!user) return apiError(401,"AUTH_REQUIRED","Sign in required.");
  if (!isPro(user)) return apiError(403,"PRO_REQUIRED","Notification history export is a Radar Pro feature.");
  const deliveries = await env.DB.prepare(
    "SELECT id,status,sent_at,created_at,error_code FROM email_deliveries WHERE user_id=? ORDER BY created_at DESC LIMIT 500",
  ).bind(user.userId).all<DeliveryRow>();
  const rows = [
    "id,status,sent_at,created_at,error_code",
    ...deliveries.results.map((row) => [row.id,row.status,row.sent_at,row.created_at,row.error_code].map(csvField).join(",")),
  ];
  return new Response(rows.join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="radar-notification-history-${new Date().toISOString().slice(0,10)}.csv"`,
    },
  });
}
