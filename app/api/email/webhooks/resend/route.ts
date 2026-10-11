import { env } from "cloudflare:workers";
import { apiError, readTextCapped } from "../../../../api-utils";

interface ResendWebhookEvent {
  type?: string;
  data?: { email_id?: string; to?: string[] };
}

function base64Decode(value:string) { return Uint8Array.from(atob(value),(c) => c.charCodeAt(0)); }
function base64Encode(bytes:Uint8Array) { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary); }

async function verifySvixSignature(secret:string,id:string,timestamp:string,body:string,signatureHeader:string) {
  const secretBytes = base64Decode(secret.startsWith("whsec_") ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey("raw",secretBytes,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const mac = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  const expected = base64Encode(new Uint8Array(mac));
  return signatureHeader.split(" ").some((entry) => {
    const [version,signature] = entry.split(",");
    if (version !== "v1" || !signature || signature.length !== expected.length) return false;
    let mismatch = 0; for (let index=0;index<expected.length;index++) mismatch |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
    return mismatch === 0;
  });
}

export async function POST(request:Request) {
  const runtime = env as unknown as Record<string,string>;
  const secret = runtime.RESEND_WEBHOOK_SECRET;
  const svixId = request.headers.get("svix-id"),svixTimestamp = request.headers.get("svix-timestamp"),svixSignature = request.headers.get("svix-signature");
  if (!secret || !svixId || !svixTimestamp || !svixSignature) return apiError(401,"INVALID_WEBHOOK","Webhook authentication failed.");
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return apiError(401,"INVALID_WEBHOOK","Webhook timestamp out of range.");
  // Capped before the signature is checked, as the Stripe webhook is: the timestamp above is the
  // sender's to choose, so it is no barrier.
  let rawBody:string; try { rawBody = await readTextCapped(request,256_000); } catch { return apiError(413,"PAYLOAD_TOO_LARGE","Webhook body is too large."); }
  if (!(await verifySvixSignature(secret,svixId,svixTimestamp,rawBody,svixSignature))) return apiError(401,"INVALID_WEBHOOK","Webhook authentication failed.");
  let event:ResendWebhookEvent; try { event = JSON.parse(rawBody); } catch { return apiError(400,"INVALID_WEBHOOK_BODY","Webhook body is invalid."); }
  const messageId = String(event.data?.email_id || ""),type = String(event.type || "unknown"),eventKey = `resend:${messageId}:${type}:${svixId}`;
  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO mutation_keys(key,actor_id,action,response) VALUES(?,'resend','email_webhook','processing')").bind(eventKey).run();
  if (!claimed.meta.changes) return Response.json({ok:true,duplicate:true});
  // See app/api/stripe/webhook/route.ts: a claim kept after a failure turns the retry into a no-op.
  try {
    const email = String(event.data?.to?.[0] || "").trim().toLowerCase();
    const delivery = messageId ? await env.DB.prepare("SELECT id,user_id FROM email_deliveries WHERE provider_message_id=?").bind(messageId).first<{ id: string; user_id: string }>() : null;
    if (delivery) {
      const status = type === "email.delivered" ? "delivered" : type === "email.bounced" ? "bounced" : type === "email.complained" ? "complained" : type === "email.delivery_delayed" ? "delayed" : "sent";
      await env.DB.batch([
        env.DB.prepare("INSERT INTO email_events(id,delivery_id,provider_event_id,type,payload) VALUES(?,?,?,?,?)").bind(crypto.randomUUID(),delivery.id,eventKey,type,JSON.stringify(event.data || {}).slice(0,2000)),
        env.DB.prepare("UPDATE email_deliveries SET status=? WHERE id=?").bind(status,delivery.id),
      ]);
    }
    if (email && (type === "email.complained" || type === "email.bounced")) {
      await env.DB.prepare("INSERT OR IGNORE INTO email_suppressions(email,reason,provider_event_id) VALUES(?,?,?)").bind(email,type,eventKey).run();
      await env.DB.prepare("UPDATE notification_preferences SET enabled=0,updated_at=CURRENT_TIMESTAMP WHERE user_id=(SELECT id FROM users WHERE lower(email)=?)").bind(email).run();
    }
  } catch (error) {
    // Give the claim back so the provider's retry applies the event instead of reading it as a
    // duplicate. The state writes are safe to repeat (plan and payout updates set a value, and
    // commissions are unique per invoice); at worst a retry logs an analytics event twice, which
    // is a far smaller cost than a paid plan that never turns on or a cancellation that never lands.
    await env.DB.prepare("DELETE FROM mutation_keys WHERE key=? AND response='processing'").bind(eventKey).run();
    throw error;
  }
  await env.DB.prepare("UPDATE mutation_keys SET response='processed' WHERE key=?").bind(eventKey).run();
  return Response.json({ok:true});
}
