import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin, validHttpUrl, verifyTurnstile } from "../../api-utils";

// Applying to become a Radar creator.
//
// Its own route rather than part of /api/creator, because /api/creator is gated on already being
// a creator — an applicant is by definition not one yet, and folding the two together would mean
// weakening that gate to let non-creators through it.
//
// Sign-in is required, and not for authorization: approval sets a role and creates a profile on a
// specific account, so an application from an email address nobody has verified is an application
// that cannot be approved without a second conversation. Requiring the account up front is what
// makes approval a single click later.
//
// The requested handle is a request, not a reservation. Nothing here writes to creator_profiles,
// so applying for "lobisme" does not take the name — staff assign the handle at approval, which
// is the guarantee creator_profiles has always made and the reason impersonating a known creator
// cannot be done from this form.

// Same shape the tracker accepts, so a handle cannot be requested that ?c= could never carry.
const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,31}$/;

interface ApplicationBody {
  handle?: unknown;
  channelUrl?: unknown;
  audience?: unknown;
  pitch?: unknown;
  "cf-turnstile-response"?: unknown;
}

export async function GET() {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in required.");
  const [application, profile] = await Promise.all([
    env.DB.prepare(
      "SELECT id,requested_handle,channel_url,status,rejection_reason,created_at FROM creator_applications WHERE user_id=? ORDER BY created_at DESC LIMIT 1",
    ).bind(user.userId).first<Record<string, unknown>>(),
    env.DB.prepare("SELECT handle,status FROM creator_profiles WHERE user_id=?")
      .bind(user.userId).first<{ handle: string; status: string }>(),
  ]);
  return Response.json({
    application: application || null,
    // Already a creator: the page sends them to the workspace instead of the form.
    creator: profile ? { handle: profile.handle, status: profile.status } : null,
  });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401, "AUTH_REQUIRED", "Sign in to apply.");
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  if (!(await rateLimit(await clientKey("creator-application"), 5, 60)))
    return apiError(429, "RATE_LIMITED", "Too many applications were submitted. Please try again later.");
  let body: ApplicationBody;
  try { body = await readJson<ApplicationBody>(request, 12_000); } catch { return apiError(400, "INVALID_REQUEST", "The application could not be read."); }
  if (!(await verifyTurnstile(request, body["cf-turnstile-response"])))
    return apiError(403, "CHALLENGE_FAILED", "Please complete the verification and try again.");

  const existingProfile = await env.DB.prepare("SELECT handle FROM creator_profiles WHERE user_id=?")
    .bind(user.userId).first<{ handle: string }>();
  if (existingProfile) return apiError(409, "ALREADY_A_CREATOR", "This account already has a creator profile.");

  const handle = cleanText(body.handle, 32).toLowerCase();
  const channelUrl = cleanText(body.channelUrl, 500);
  const audience = cleanText(body.audience, 600);
  const pitch = cleanText(body.pitch, 1500);
  const fields: Record<string, string> = {};
  if (!HANDLE_PATTERN.test(handle))
    fields.handle = "Use 2-32 characters: lowercase letters, numbers and hyphens, starting with a letter or number";
  if (!validHttpUrl(channelUrl, true)) fields.channelUrl = "Link your channel or profile";
  if (!audience) fields.audience = "Required";
  if (Object.keys(fields).length) return apiError(422, "INVALID_APPLICATION", "Review the highlighted fields.", fields);

  // Checked here for a useful message, and enforced by idx_creator_applications_open below —
  // between this read and that write, a double-submit would otherwise create two open rows.
  const open = await env.DB.prepare("SELECT id FROM creator_applications WHERE user_id=? AND status='pending'")
    .bind(user.userId).first<{ id: number }>();
  if (open) return apiError(409, "APPLICATION_PENDING", "You already have an application waiting for review.");

  try {
    const created = await env.DB.prepare(
      `INSERT INTO creator_applications(user_id,email,requested_handle,channel_url,audience,pitch)
       VALUES(?,?,?,?,?,?) RETURNING id`,
    ).bind(user.userId, user.email, handle, channelUrl, audience || null, pitch || null).first<{ id: number }>();
    return Response.json({ ok: true, id: created?.id }, { status: 201 });
  } catch {
    // The partial unique index rejecting a second open application is the expected failure here,
    // and it means the same thing as the check above.
    return apiError(409, "APPLICATION_PENDING", "You already have an application waiting for review.");
  }
}
