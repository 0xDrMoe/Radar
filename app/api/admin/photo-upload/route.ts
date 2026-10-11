import { env } from "cloudflare:workers";
import { getAppUser, hasPermission } from "../../../auth";
import { apiError, requireSameOrigin } from "../../../api-utils";
import { savePhoto } from "../../../photo-storage";

export async function POST(request: Request) {
  const signedIn = await getAppUser();
  if (!signedIn) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  if (!hasPermission(signedIn, "manage_restaurant_photos")) return apiError(403, "PERMISSION_DENIED", "Your role does not allow this action.");
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const restaurant = await env.DB.prepare("SELECT id FROM restaurants WHERE id=?").bind(restaurantId).first();
  if (!restaurant) return apiError(404, "RESTAURANT_NOT_FOUND", "Restaurant not found.");
  let result: { url: string };
  try { result = await savePhoto("restaurants", restaurantId, request); }
  catch (cause) { return apiError(422, "INVALID_IMAGE", cause instanceof Error ? cause.message : "The image could not be saved."); }
  await env.DB.prepare("UPDATE restaurants SET photo_url=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(result.url, restaurantId).run();
  await env.DB.prepare(
    "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,details) VALUES(?,?,?,?,?,?,?)",
  ).bind(signedIn.userId, signedIn.role, "restaurant_photo_uploaded", "restaurant", restaurantId, crypto.randomUUID(), JSON.stringify({ url: result.url })).run();
  return Response.json({ ok: true, url: result.url });
}
