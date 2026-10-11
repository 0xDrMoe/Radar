import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin, validHttpUrl } from "../../api-utils";
import { MAX_OPEN_REPORTS_PER_USER, openReportStatusesSql, questionsDeal } from "../../accuracy-reports";

const categories = new Set(["deal_ended","incorrect_price","incorrect_schedule","restaurant_closed","wrong_location","misleading_terms","duplicate_listing"]);

interface ReportRequestBody {
  category?: unknown;
  dealId?: unknown;
  notes?: unknown;
  sourceUrl?: unknown;
  locationId?: unknown;
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!(await rateLimit(await clientKey("report"),8,60))) return apiError(429,"RATE_LIMITED","Too many reports were submitted. Please try again later.");
  let body:ReportRequestBody;
  try { body = await readJson<ReportRequestBody>(request,16_000); } catch { return apiError(400,"INVALID_REQUEST","The report could not be read."); }
  const category = cleanText(body.category,40), dealId = cleanText(body.dealId,120), notes = cleanText(body.notes,1200), sourceUrl = cleanText(body.sourceUrl,500);
  if (!categories.has(category)) return apiError(422,"INVALID_CATEGORY","Choose a valid report category.");
  if (!dealId) return apiError(422,"DEAL_REQUIRED","Choose the deal being reported.");
  if (sourceUrl && !validHttpUrl(sourceUrl)) return apiError(422,"INVALID_SOURCE","Enter a valid supporting URL.");
  const user = await getAppUser();
  if (!user) return apiError(401,"AUTH_REQUIRED","Sign in required.");
  const [deal, open] = await Promise.all([
    env.DB.prepare("SELECT id FROM deals WHERE id=?").bind(dealId).first(),
    env.DB.prepare(`SELECT COUNT(*) n,COALESCE(SUM(deal_id=? AND category=?),0) same FROM reports WHERE user_id=? AND status IN (${openReportStatusesSql})`)
      .bind(dealId,category,user.userId).first<{ n: number; same: number }>(),
  ]);
  if (!deal) return apiError(404,"DEAL_NOT_FOUND","That deal could not be found.");
  // An open report puts its deal under review: "Re-checking", and lower in search, until staff close
  // it (app/accuracy-reports.ts). The same person saying the same thing twice adds nothing to the
  // queue, and one account cannot hold more than a handful open, or it could push a whole area's
  // deals down the list.
  const underReview = questionsDeal(category);
  if (Number(open?.same) > 0) return Response.json({ ok:true, duplicate:true, underReview },{ status:200 });
  if (Number(open?.n) >= MAX_OPEN_REPORTS_PER_USER) return apiError(429,"TOO_MANY_OPEN_REPORTS","You have several reports waiting on our team. Please try again once they have been reviewed.");
  await env.DB.prepare("INSERT INTO reports(user_id,email,deal_id,location_id,category,notes,source_url,priority) VALUES(?,?,?,?,?,?,?,?)")
    .bind(user.userId,user.email,dealId,body.locationId ? cleanText(body.locationId,120) : null,category,notes || null,sourceUrl || null,["restaurant_closed","misleading_terms"].includes(category) ? "high" : "normal").run();
  return Response.json({ ok:true, underReview },{ status:201 });
}
