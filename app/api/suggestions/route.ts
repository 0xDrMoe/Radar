import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";
import { apiError, cleanIsoDate, cleanText, cleanWeekdays, clientKey, normalizedPostal, rateLimit, readJson, requireSameOrigin, validHttpUrl, validPostal, verifyTurnstile } from "../../api-utils";

interface SuggestionRequestBody {
  restaurant?: unknown;
  deal?: unknown;
  title?: unknown;
  postal?: unknown;
  schedule?: unknown;
  email?: unknown;
  source?: unknown;
  relationship?: unknown;
  expiresAt?: unknown;
  restaurantWebsite?: unknown;
  address?: unknown;
  description?: unknown;
  price?: unknown;
  eligibleDays?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startsAt?: unknown;
  restrictions?: unknown;
  "cf-turnstile-response"?: unknown;
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!(await rateLimit(await clientKey("suggestion"),5,60))) return apiError(429,"RATE_LIMITED","Too many suggestions were submitted. Please try again later.");
  let body:SuggestionRequestBody;
  try { body = await readJson<SuggestionRequestBody>(request,24_000); } catch { return apiError(400,"INVALID_REQUEST","The suggestion could not be read."); }
  if (!(await verifyTurnstile(request,body["cf-turnstile-response"]))) return apiError(403,"CHALLENGE_FAILED","Please complete the verification and try again.");
  const restaurant = cleanText(body.restaurant,120), deal = cleanText(body.deal || body.title,180), postal = normalizedPostal(body.postal);
  const schedule = cleanText(body.schedule,160), email = cleanText(body.email,200).toLowerCase(), source = cleanText(body.source,500), relationship = cleanText(body.relationship,80);
  const fields:Record<string,string> = {};
  if (!restaurant) fields.restaurant = "Required";
  if (!deal) fields.deal = "Required";
  if (!validPostal(postal)) fields.postal = "Enter a complete postal or ZIP code";
  if (!schedule) fields.schedule = "Required";
  if (!/^\S+@\S+\.\S+$/.test(email)) fields.email = "Enter a valid email";
  if (!validHttpUrl(source,true)) fields.source = "Enter a valid official source URL";
  if (!relationship) fields.relationship = "Required";
  const startsAt = cleanIsoDate(body.startsAt), expiresAt = cleanIsoDate(body.expiresAt);
  if (body.startsAt && !startsAt) fields.startsAt = "Enter a valid date";
  if (body.expiresAt && !expiresAt) fields.expiresAt = "Enter a valid date";
  else if (expiresAt && new Date(expiresAt).getTime() < Date.now()) fields.expiresAt = "Expiry must be in the future";
  if (Object.keys(fields).length) return apiError(422,"INVALID_SUGGESTION","Review the highlighted fields.",fields);
  const duplicate = await env.DB.prepare("SELECT reference FROM suggestions WHERE lower(restaurant)=lower(?) AND replace(postal,' ','')=? AND source=? AND status IN ('pending','needs_information') AND datetime(created_at)>datetime('now','-30 days') LIMIT 1")
    .bind(restaurant,postal,source).first<{reference:string}>();
  if (duplicate) return apiError(409,"DUPLICATE_SUGGESTION",`This offer is already under review${duplicate.reference ? ` as ${duplicate.reference}` : ""}.`);
  const user = await getAppUser();
  const reference = `BL-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0,8).toUpperCase()}`;
  await env.DB.prepare(`INSERT INTO suggestions(restaurant,deal,postal,schedule,email,status,user_id,restaurant_website,address,title,description,price,eligible_days,start_time,end_time,starts_at,expires_at,restrictions,source,relationship,reference) VALUES(?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(restaurant,deal,postal,schedule,email,user?.userId || null,validHttpUrl(body.restaurantWebsite) ? cleanText(body.restaurantWebsite,500) : null,cleanText(body.address,240) || null,deal,cleanText(body.description,1500) || null,cleanText(body.price,120) || null,JSON.stringify(cleanWeekdays(body.eligibleDays)),cleanText(body.startTime,10) || null,cleanText(body.endTime,10) || null,startsAt,expiresAt,cleanText(body.restrictions,1000) || null,source,relationship,reference).run();
  return Response.json({ ok:true,reference },{ status:201 });
}
