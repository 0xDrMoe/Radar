import { env } from "cloudflare:workers";
import { apiError, readJson, requireSameOrigin } from "../../../api-utils";
import { verifyEmailAction, verifyLeadConfirmation } from "../../../email";

interface ConfirmEmailBody {
  email?: unknown;
  token?: unknown;
}

export async function POST(request:Request) {
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  let body:ConfirmEmailBody; try { body = await readJson<ConfirmEmailBody>(request,8_000); } catch { return apiError(400,"INVALID_REQUEST","The confirmation request is invalid."); }
  const email = String(body.email || "").trim().toLowerCase(),token = String(body.token || "");
  // A waitlist lead's link (app/api/email/capture). Signed for its own purpose, so it can only ever
  // confirm the lead it names, at the address it names.
  const leadId = await verifyLeadConfirmation(token,email);
  if (leadId) {
    const lead = await env.DB.prepare("SELECT id FROM email_leads WHERE id=? AND lower(email)=?").bind(leadId,email).first();
    if (!lead) return apiError(404,"PENDING_CONSENT_NOT_FOUND","No pending email confirmation was found.");
    await env.DB.prepare("UPDATE email_leads SET confirmed_at=COALESCE(confirmed_at,CURRENT_TIMESTAMP),consent_method=COALESCE(consent_method,'double_opt_in') WHERE id=?").bind(leadId).run();
    return Response.json({ok:true,kind:"waitlist"});
  }
  const userId = await verifyEmailAction("consent",token,email);
  if (!userId) return apiError(400,"INVALID_CONFIRMATION","This confirmation link is invalid or incomplete.");
  const pending = await env.DB.prepare("SELECT id FROM email_consents WHERE user_id=? AND lower(email)=? AND status='pending' ORDER BY id DESC LIMIT 1").bind(userId,email).first<{id:number}>();
  if (!pending) {
    const confirmed = await env.DB.prepare("SELECT id FROM email_consents WHERE user_id=? AND lower(email)=? AND status='confirmed' ORDER BY id DESC LIMIT 1").bind(userId,email).first();
    if (confirmed) return Response.json({ok:true,alreadyConfirmed:true});
    return apiError(404,"PENDING_CONSENT_NOT_FOUND","No pending email confirmation was found.");
  }
  // A fresh, confirmed request is newer consent than an earlier unsubscribe, so the suppression that
  // unsubscribe wrote is lifted with it. Without this, somebody who unsubscribed and later turned
  // alerts back on from the dashboard was shown "Confirmed" and never sent anything: the digest
  // job skips every suppressed address. Only their own unsubscribe is lifted; a bounce or a spam
  // complaint stays, because those are the mail provider's word, not the person's.
  await env.DB.batch([
    env.DB.prepare("UPDATE email_consents SET status='confirmed',consented_at=CURRENT_TIMESTAMP WHERE id=?").bind(pending.id),
    env.DB.prepare("DELETE FROM email_suppressions WHERE lower(email)=? AND reason='user_unsubscribe'").bind(email),
  ]);
  return Response.json({ok:true});
}
