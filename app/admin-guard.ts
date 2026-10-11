import { env } from "cloudflare:workers";
import { getAppUser, hasPermission, type AppUser, type Permission } from "./auth";
import { apiError, requireSameOrigin } from "./api-utils";

// The front door every staff-workspace API route shares, so a new route cannot forget a step.
//
// /api/admin grew one handler per concern inside a single file; the routes beside it
// (/api/admin/export, /api/admin/audit, /api/admin/growth, ...) each need the same three checks in
// the same order - signed in, allowed into the workspace, holding the permission this route is
// about - and a write needs the same-origin check on top. Written once here, a route states what
// it needs and gets a user or the response to send back.
//
// `allow` is for the rules that are not one permission: the audit log answers to the owner and
// admin roles, and some routes accept any of several grants. It runs after read_admin, so it never
// has to repeat that.

type Guard =
  | { user: AppUser; response?: undefined }
  | { user?: undefined; response: Response };

export async function requireStaff(
  request: Request,
  options: { permission?: Permission; allow?: (user: AppUser) => boolean; write?: boolean } = {},
): Promise<Guard> {
  const user = await getAppUser();
  if (!user) return { response: apiError(401, "AUTH_REQUIRED", "Sign in required.") };
  if (!hasPermission(user, "read_admin")) return { response: apiError(403, "ADMIN_REQUIRED", "Administrative access required.") };
  if (options.write && !(await requireSameOrigin(request))) return { response: apiError(403, "INVALID_ORIGIN", "This request could not be verified.") };
  if (options.permission && !hasPermission(user, options.permission))
    return { response: apiError(403, "PERMISSION_DENIED", "Your role does not allow this.") };
  if (options.allow && !options.allow(user)) return { response: apiError(403, "PERMISSION_DENIED", "Your role does not allow this.") };
  return { user };
}

/** One audit row, in the shape /api/admin writes its own. Details are capped like there. */
export async function writeAudit(
  user: Pick<AppUser, "userId" | "role">,
  entry: { action: string; targetType: string; targetId: string; reason?: string | null; details?: Record<string, unknown> },
) {
  await env.DB.prepare(
    "INSERT INTO audit_log(actor_id,actor_role,action,target_type,target_id,request_id,reason,details) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      user.userId,
      user.role,
      entry.action,
      entry.targetType,
      entry.targetId,
      crypto.randomUUID(),
      entry.reason || null,
      JSON.stringify(entry.details || {}).slice(0, 1500),
    )
    .run();
}
