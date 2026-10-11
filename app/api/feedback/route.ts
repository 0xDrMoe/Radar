import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin, verifyTurnstile } from "../../api-utils";

interface FeedbackRequestBody {
  type?: unknown;
  message?: unknown;
  dealId?: unknown;
  market?: unknown;
  page?: unknown;
  "cf-turnstile-response"?: unknown;
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!(await rateLimit(await clientKey("feedback"),10,60))) return apiError(429,"RATE_LIMITED","Too much feedback was submitted. Please try again later.");
  let body:FeedbackRequestBody;
  try { body = await readJson<FeedbackRequestBody>(request,16_000); } catch { return apiError(400,"INVALID_REQUEST","The feedback could not be read."); }
  if (!(await verifyTurnstile(request,body["cf-turnstile-response"]))) return apiError(403,"CHALLENGE_FAILED","Please complete the verification and try again.");
  const type = cleanText(body.type,40), message = cleanText(body.message,2000);
  if (!["bug","confusing","incorrect_deal","feature"].includes(type) || message.length < 10) return apiError(422,"INVALID_FEEDBACK","Choose a category and enter at least 10 characters.");
  const user = await getAppUser();
  await env.DB.prepare("INSERT INTO feedback(user_id,email,type,message,deal_id,market,page,priority) VALUES(?,?,?,?,?,?,?,?)")
    .bind(user?.userId || null,user?.email || null,type,message,body.dealId ? cleanText(body.dealId,120) : null,body.market ? cleanText(body.market,120) : null,cleanText(body.page || "/",300),type === "incorrect_deal" ? "high" : "normal").run();
  return Response.json({ ok:true },{ status:201 });
}
