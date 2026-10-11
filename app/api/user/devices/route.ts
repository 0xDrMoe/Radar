import { env } from "cloudflare:workers";
import { getAppUser } from "../../../auth";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin } from "../../../api-utils";

// Where the mobile app registers for push, and unregisters on sign-out.
//
// Kept out of /api/user's action switch because this is the one endpoint on the site that only a
// native client ever calls, and because it has a rule none of those actions have: a token is
// claimed, not created. The same handset can be handed to a different person, so a registration
// re-points an existing token at whoever is signed in now rather than leaving a second row that
// would send someone else's alerts to this phone.
//
// Signing out revokes only the device doing it. Every other device stays registered, which is why
// the token is required on the way out as well as in.

interface DeviceBody {
  action?: unknown;
  token?: unknown;
  platform?: unknown;
}

const PLATFORMS = new Set(["ios", "android"]);
// Expo's token shape. Checked because a malformed token is a row that can never deliver and will
// be retried on every digest run until someone notices.
const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]\s]+\]$/;

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  if (!(await rateLimit(await clientKey("devices"), 30, 60))) return apiError(429, "RATE_LIMITED", "Too many registrations.");
  let body: DeviceBody;
  try { body = await readJson<DeviceBody>(request, 2_000); } catch { return apiError(400, "INVALID_REQUEST", "The request body is invalid."); }

  const token = cleanText(body.token, 200);
  if (!token || !EXPO_TOKEN.test(token)) return apiError(422, "INVALID_TOKEN", "That is not a valid push token.");

  if (body.action === "unregister") {
    await env.DB.prepare("DELETE FROM device_tokens WHERE token=? AND user_id=?").bind(token, user.userId).run();
    return Response.json({ ok: true });
  }

  if (body.action === "register") {
    const platform = cleanText(body.platform, 16).toLowerCase();
    if (!PLATFORMS.has(platform)) return apiError(422, "INVALID_PLATFORM", "Unknown platform.");
    // The conflict target is the token, so re-registering the same device moves it to the current
    // account and brings a previously revoked one back rather than failing or duplicating.
    await env.DB.prepare(
      `INSERT INTO device_tokens(id,user_id,token,platform,status) VALUES(?,?,?,?,'active')
       ON CONFLICT(token) DO UPDATE SET user_id=excluded.user_id,platform=excluded.platform,status='active',last_seen_at=CURRENT_TIMESTAMP`,
    ).bind(`device:${crypto.randomUUID()}`, user.userId, token, platform).run();
    return Response.json({ ok: true }, { status: 201 });
  }

  return apiError(400, "UNKNOWN_ACTION", "Unknown action.");
}
