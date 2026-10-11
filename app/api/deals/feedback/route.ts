import { env } from "cloudflare:workers";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin } from "../../../api-utils";

interface DealFeedbackBody {
  dealId?: unknown;
  helpful?: unknown;
}

// Deliberately not a new table: a thumbs up/down is exactly the kind of low-stakes, high-volume
// signal product_events already exists for (see app/api/track/route.ts's campaign_visit rows),
// and admin's overview can aggregate it with a GROUP BY same as any other event type — no
// migration needed to ship this.
export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!(await rateLimit(await clientKey("deal_feedback"),30,60))) return apiError(429,"RATE_LIMITED","Too many votes.");
  let body:DealFeedbackBody;
  try { body = await readJson<DealFeedbackBody>(request,1_000); } catch { return apiError(400,"INVALID_REQUEST","The vote could not be read."); }
  const dealId = cleanText(body.dealId,64);
  if (!dealId) return apiError(422,"DEAL_ID_REQUIRED","A deal is required.");
  if (typeof body.helpful !== "boolean") return apiError(422,"HELPFUL_REQUIRED","A vote is required.");
  const deal = await env.DB.prepare("SELECT id FROM deals WHERE id=? AND deleted_at IS NULL").bind(dealId).first();
  if (!deal) return apiError(404,"DEAL_NOT_FOUND","That deal could not be found.");
  await env.DB.prepare("INSERT INTO product_events(id,type,entity_id,properties) VALUES(?,?,?,?)")
    .bind(crypto.randomUUID(),"deal_feedback",dealId,JSON.stringify({helpful:body.helpful})).run();
  return Response.json({ ok:true },{ status:201 });
}
