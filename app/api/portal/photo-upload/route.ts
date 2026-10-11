import { env } from "cloudflare:workers";
import { getAppUser } from "../../../auth";
import { apiError, requireSameOrigin } from "../../../api-utils";
import { savePhoto } from "../../../photo-storage";

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const managed = await env.DB.prepare("SELECT 1 FROM restaurant_managers WHERE user_id=? AND restaurant_id=? AND status='active' LIMIT 1").bind(user.userId, restaurantId).first();
  if (!managed) return apiError(403, "NOT_YOUR_RESTAURANT", "You do not manage this restaurant.");
  let result: { url: string };
  try { result = await savePhoto("restaurants", restaurantId, request); }
  catch (cause) { return apiError(422, "INVALID_IMAGE", cause instanceof Error ? cause.message : "The image could not be saved."); }
  await env.DB.prepare("UPDATE restaurants SET photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.url, restaurantId).run();
  await env.DB.prepare(
    "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,details) VALUES(?,?,?,?,?,?,?)",
  ).bind(user.userId, user.role, "portal_photo_uploaded", "restaurant", restaurantId, crypto.randomUUID(), JSON.stringify({ url: result.url })).run();
  return Response.json({ ok: true, url: result.url });
}
