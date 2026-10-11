import { env } from "cloudflare:workers";
import { apiError, readJson, requireSameOrigin } from "../../../api-utils";
import { LEAD_TOKEN_PREFIX, verifyUnsubscribe } from "../../../email";

interface UnsubscribeBody {
  email?: unknown;
  token?: unknown;
}

// Two callers. The unsubscribe page posts JSON from the site, and is held to the site's origin like
// every other form. A mailbox provider's own Unsubscribe button posts the RFC 8058 one-click body,
// "List-Unsubscribe=One-Click", to the address in the message's List-Unsubscribe header, with the
// email and token in its query string (listUnsubscribeHeaders in app/email.ts). That request comes
// from Google's or Yahoo's servers with no Origin, and the signed token is its authentication: it is
// an HMAC over this one address, which a cross-site forger does not have.
function isOneClick(request:Request) {
  const url = new URL(request.url);
  return url.searchParams.has("token") && url.searchParams.has("email")
    && /^(?:application\/x-www-form-urlencoded|multipart\/form-data)/i.test(request.headers.get("content-type") || "");
}

export async function POST(request:Request) {
  let body:UnsubscribeBody;
  if (isOneClick(request)) {
    let form:FormData; try { form = await request.formData(); } catch { return apiError(400,"INVALID_REQUEST","The unsubscribe request is invalid."); }
    if (form.get("List-Unsubscribe") !== "One-Click") return apiError(400,"INVALID_REQUEST","The unsubscribe request is invalid.");
    const url = new URL(request.url);
    body = { email: url.searchParams.get("email"), token: url.searchParams.get("token") };
  } else {
    if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
    try { body = await readJson<UnsubscribeBody>(request,8_000); } catch { return apiError(400,"INVALID_REQUEST","The unsubscribe request is invalid."); }
  }
  const email = String(body.email || "").trim().toLowerCase(),userId = await verifyUnsubscribe(String(body.token || ""),email);
  if (!userId) return apiError(400,"INVALID_UNSUBSCRIBE","This unsubscribe link is invalid or incomplete.");

  // A waitlist lead has no users row, so the lookup below would 404 and their unsubscribe link
  // would be decorative — which, on a message sent under CASL, is worse than having no link at
  // all. The lead row is kept rather than deleted: email_suppressions is what actually stops the
  // send, and keeping the row means a later signup cannot quietly resurrect them past it.
  if (userId.startsWith(LEAD_TOKEN_PREFIX)) {
    const leadId = userId.slice(LEAD_TOKEN_PREFIX.length);
    const lead = await env.DB.prepare("SELECT id FROM email_leads WHERE id=? AND lower(email)=?").bind(leadId,email).first();
    if (!lead) return apiError(404,"ACCOUNT_NOT_FOUND","This subscription could not be found.");
    await env.DB.prepare("INSERT OR IGNORE INTO email_suppressions(email,reason) VALUES(?,'user_unsubscribe')").bind(email).run();
    return Response.json({ok:true});
  }

  const user = await env.DB.prepare("SELECT id FROM users WHERE id=? AND lower(email)=?").bind(userId,email).first();
  if (!user) return apiError(404,"ACCOUNT_NOT_FOUND","This subscription could not be found.");
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO email_suppressions(email,reason) VALUES(?,'user_unsubscribe')").bind(email),
    env.DB.prepare("UPDATE email_consents SET status='revoked',revoked_at=CURRENT_TIMESTAMP WHERE user_id=? AND status IN ('confirmed','pending')").bind(userId),
    env.DB.prepare("UPDATE notification_preferences SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=?").bind(userId),
    env.DB.prepare("UPDATE users SET alerts_enabled=0 WHERE id=?").bind(userId),
  ]);
  return Response.json({ok:true});
}
