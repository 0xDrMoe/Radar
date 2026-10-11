import { getAppUser } from "../../../auth";
import { apiError, rateLimit, readJson, requireSameOrigin } from "../../../api-utils";
import { appAccountTokenFor, appStoreConfigured } from "../../../appstore";
import { applyAppleSubscription } from "../../../apple-entitlement";

// Where the app reports a purchase.
//
// The body is one transaction id and nothing else. Deliberately: the device has no say in what the
// subscription is, only in which one to ask Apple about, and everything that decides whether Pro
// is granted comes back from Apple over TLS. See app/appstore.ts for why that is the shape.
//
// Called after buying and after restoring, which are the same request — restoring is just asking
// about a transaction the device already had.

interface Body { transactionId?: unknown }

// The token the app hands StoreKit when this account buys, so the purchase names the account it
// was made for (see appAccountTokenFor). Asked for just before a purchase starts.
export async function GET() {
  const user = await getAppUser();
  if (!user) return apiError(401, "SIGN_IN_REQUIRED", "Sign in to activate Radar Pro.");
  return Response.json({ appAccountToken: await appAccountTokenFor(user.userId) }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401, "SIGN_IN_REQUIRED", "Sign in to activate Radar Pro.");
  // The app sends a Bearer token, which passes this as it is; a browser carrying the session cookie
  // has to be on Radar's own origin, like every other signed-in write.
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  if (!appStoreConfigured()) return apiError(503, "IAP_UNAVAILABLE", "Purchases are not available just now.");
  // Every call signs a token and asks Apple up to twice, against a key whose hourly quota every
  // real purchase and renewal shares. A buy plus a few restores is single digits.
  if (!(await rateLimit(`apple-verify:${user.userId}`, 20, 60))) return apiError(429, "RATE_LIMITED", "Too many attempts. Try again in a little while.");

  // readJson throws on a body that is not JSON, or is too large. Uncaught, that became the
  // framework's empty 500, which reads to the app as the server being down rather than as a
  // request it should not retry.
  let body: Body;
  try { body = await readJson<Body>(request); } catch { return apiError(400, "INVALID_REQUEST", "The request body is invalid."); }
  const transactionId = typeof body?.transactionId === "string" ? body.transactionId.trim() : "";
  // Apple's ids are digits. Checked before it reaches a URL, not because the API would be fooled
  // but because an unbounded string does not belong in a path segment.
  if (!/^\d{1,30}$/.test(transactionId)) return apiError(422, "TRANSACTION_REQUIRED", "That purchase could not be read.");

  const subscription = await applyAppleSubscription(transactionId, user.userId);
  if (!subscription) return apiError(502, "APPLE_UNAVAILABLE", "The App Store could not confirm that purchase. Try again in a moment.");

  return Response.json({
    ok: true,
    pro: subscription.entitled,
    // Which of Apple's environments answered. Information only: a sandbox purchase unlocks Pro
    // like any other (see app/appstore.ts).
    environment: subscription.environment,
    expiresAt: subscription.expiresAt,
  });
}
