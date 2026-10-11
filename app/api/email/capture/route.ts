import { env } from "cloudflare:workers";
import { apiError, clientKey, normalizedPostal, rateLimit, readJson, requireSameOrigin, verifyTurnstile } from "../../../api-utils";
import { buildLeadConfirmationEmail, pilotGatesOpen, sendEmail, signLeadConfirmation } from "../../../email";

interface CaptureRequestBody {
  email?: unknown;
  postal?: unknown;
  source?: unknown;
  "cf-turnstile-response"?: unknown;
}

// Where a lead came from, as a closed set rather than whatever the client sends.
//
// It matters because these lists get mailed separately and the promises differ: somebody who
// asked to hear about nearby deals did not ask to be told an iPhone app exists, and on launch day
// the difference between those two audiences is the difference between a welcome message and
// spam. An unknown value falls back to "homepage" instead of being stored, so a typo cannot
// quietly create a fourth list nobody remembers to mail — or to honor.
const SOURCES = new Set(["homepage", "ios-waitlist"]);

// A no-account "keep me posted" list for visitors who aren't ready to sign in yet — separate
// from notification_preferences/email_consents, which require a real Clerk user. This never
// sends anything itself; it's a lead list staff can invite into full digest signup later.
export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  if (!(await rateLimit(await clientKey("email-capture"), 5, 60))) return apiError(429, "RATE_LIMITED", "Too many requests. Please try again later.");
  let body: CaptureRequestBody;
  try { body = await readJson<CaptureRequestBody>(request, 4_000); } catch { return apiError(400, "INVALID_REQUEST", "The request could not be read."); }
  if (!(await verifyTurnstile(request, body["cf-turnstile-response"]))) return apiError(403, "CHALLENGE_FAILED", "Please complete the verification and try again.");
  const email = String(body.email || "").trim().toLowerCase();
  // 254 is the longest address SMTP will carry; anything past it is not an address, just storage.
  if (email.length > 254 || !/^[^\s<>]+@[^\s<>]+\.[^\s<>]+$/.test(email)) return apiError(422, "INVALID_EMAIL", "Enter a valid email address.");
  // The home page sends whatever area it is showing, a partial code included, so this is capped
  // rather than validated: the longest real one is a ZIP+4, and nothing longer is an area.
  const postal = body.postal ? normalizedPostal(body.postal).replace(/[^A-Z0-9]/g, "").slice(0, 9) || null : null;
  const source = SOURCES.has(String(body.source || "")) ? String(body.source) : "homepage";
  // The source is set on insert and deliberately left alone on conflict. Someone who joined the
  // app waitlist and later types their address into the homepage form has still asked to hear
  // about the app, and overwriting it would drop them off that list on the day it is sent.
  const lead = await env.DB.prepare("INSERT INTO email_leads(id,email,postal,source) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET postal=COALESCE(excluded.postal,email_leads.postal) RETURNING id,source,confirmed_at")
    .bind(crypto.randomUUID(), email, postal, source).first<{ id: string; source: string; confirmed_at: string | null }>();
  if (lead && !lead.confirmed_at) await sendConfirmation(lead.id, email, lead.source);
  // The same answer whether the address was new, already listed, confirmed or not, and whether a
  // message went out: the response must not tell a visitor anything about someone else's address.
  return Response.json({ ok: true }, { status: 201 });
}

// Nothing is mailed to a lead until it confirms (see drizzle/0064), so a new one is sent the link.
// At most one a day per address, claimed in the UPDATE so two submissions cannot both send: the
// form is open to anyone, and without the spacing it would be a way to mail someone repeatedly.
async function sendConfirmation(leadId: string, email: string, source: string) {
  if (!pilotGatesOpen()) return;
  const claimed = await env.DB.prepare(
    "UPDATE email_leads SET confirmation_sent_at=CURRENT_TIMESTAMP WHERE id=? AND confirmed_at IS NULL AND (confirmation_sent_at IS NULL OR datetime(confirmation_sent_at) < datetime('now','-1 day'))",
  ).bind(leadId).run();
  if (!claimed.meta.changes) return;
  const origin = (env as unknown as Record<string, string>).PUBLIC_APP_URL || "https://radar.cheap";
  const token = await signLeadConfirmation(leadId, email);
  const confirmUrl = `${origin}/confirm-email?email=${encodeURIComponent(email)}&token=${encodeURIComponent(token)}`;
  const { html, text } = buildLeadConfirmationEmail({ confirmUrl, source });
  try {
    await sendEmail({ to: email, subject: "Confirm your email for Radar", html, text, tag: "lead-confirm", metadata: { leadId }, audience: "transactional" });
  } catch {
    // Given back so the next submission can try again, rather than waiting out the day.
    await env.DB.prepare("UPDATE email_leads SET confirmation_sent_at=NULL WHERE id=?").bind(leadId).run();
  }
}
