import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { readStreamCapped } from "./body-limits";

export function apiError(status: number, code: string, message: string, fields?: Record<string, string>) {
  return Response.json({ error: { code, message, fields: fields || undefined }, requestId: crypto.randomUUID() }, { status });
}

export async function readJson<T>(request: Request, maxBytes = 32_000): Promise<T> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return JSON.parse(await readBodyCapped(request, maxBytes)) as T;
}

/**
 * The raw body as text, refused past maxBytes. For webhooks, which have to verify a signature over
 * the exact bytes and so cannot use readJson. Throws PAYLOAD_TOO_LARGE.
 */
export async function readTextCapped(request: Request, maxBytes: number): Promise<string> {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("PAYLOAD_TOO_LARGE");
  return readBodyCapped(request, maxBytes);
}

// The body as text, read no further than maxBytes. A chunked request carries no Content-Length, so
// request.text() would buffer whatever was sent - up to the platform's own ceiling - before the
// size could be checked at all. Reading the stream lets an oversized body be refused at the cap.
async function readBodyCapped(request: Request, maxBytes: number): Promise<string> {
  return new TextDecoder().decode(await readStreamCapped(request.body, maxBytes));
}

/** Constant-time string equality, for comparing a presented secret with the configured one. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let index = 0; index < a.length; index++) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return mismatch === 0;
}

/** Whether a job request carries `Authorization: Bearer <secret>`. Refuses when the secret is unset. */
export function hasJobSecret(request: Request, secret: string | undefined) {
  if (!secret) return false;
  const provided = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "")?.[1] || "";
  return safeEqual(provided, secret);
}

export async function requireSameOrigin(request: Request) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host") || new URL(request.url).host;
  // A request authenticated by an Authorization header is not a CSRF candidate, so it does not
  // need an origin to match. CSRF exists because a browser attaches cookies to cross-site
  // requests on its own; it never attaches an Authorization header on its own, and a cross-origin
  // fetch that sets one is a preflighted request — Radar answers no CORS preflight, so it never
  // reaches this handler at all. The header's presence is therefore itself the proof this was not
  // a cross-site form post.
  //
  // This is what lets the mobile app write: it holds a Clerk token and sends no cookie, so it has
  // no Origin to offer and nothing to forge. app/auth.ts already reads the same header, so the
  // two halves agree on what "signed in" means.
  if (/^Bearer\s+\S/i.test(request.headers.get("authorization") || "")) return true;
  const origin = request.headers.get("origin");
  if (origin) { try { return new URL(origin).host === host; } catch { return false; } }
  // Real cross-origin (and same-origin, in current browsers) POST/PUT/DELETE requests always
  // carry Origin, so a request with neither Origin nor Referer at all isn't a normal browser
  // request this same-site page would ever produce — treat that as suspicious rather than as
  // "safe", which the previous `if (!origin) return true` effectively did.
  const referer = request.headers.get("referer");
  if (referer) { try { return new URL(referer).host === host; } catch { return false; } }
  return false;
}

export function normalizedPostal(value: unknown) {
  return String(value || "").trim().replace(/[\s-]/g, "").toUpperCase();
}

export function validPostal(value: string) {
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(value) || /^\d{5}(\d{4})?$/.test(value);
}

export function validHttpUrl(value: unknown, required = false) {
  const raw = String(value || "").trim();
  if (!raw) return !required;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export function cleanText(value: unknown, max: number) {
  return String(value || "").replace(/[<>]/g, "").trim().slice(0, max);
}

/** Weekday numbers (0 = Sunday) from a submitted list, deduplicated and sorted; anything else dropped. */
export function cleanWeekdays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<number>();
  for (const day of value.slice(0, 14)) {
    const text = String(day);
    if (/^[0-6]$/.test(text)) days.add(Number(text));
  }
  return Array.from(days).sort((a, b) => a - b);
}

/**
 * A submitted date or date-time, kept only when it is a real one in ISO form ("2026-10-31" or
 * "2026-10-31T18:00", optionally with seconds and a zone). Anything else - an object, free text,
 * "garbage" that makes `new Date()` NaN and so slips past a future-date check - is null.
 */
export function cleanIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (text.length > 30 || !/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) return null;
  return Number.isNaN(new Date(text).getTime()) ? null : text;
}

// One IPv6 subscriber is routinely handed a whole /64, so keying on the full address gave a single
// caller 2^64 separate rate limits. The /64 is what identifies them; IPv4 stays per address.
export function rateLimitSubject(ip: string) {
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export async function clientKey(prefix: string) {
  const requestHeaders = await headers();
  // CF-Connecting-IP only: Cloudflare sets it on every request and a client cannot override it.
  // X-Forwarded-For is whatever the client sends, so falling back to it would let a caller pick
  // its own rate-limit bucket.
  const ip = requestHeaders.get("cf-connecting-ip") || "unknown";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${prefix}:${rateLimitSubject(ip.trim())}`));
  return Array.from(new Uint8Array(digest)).slice(0, 12).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Verifies a Cloudflare Turnstile token server-side before a public form write lands in D1.
//
// Fails closed. With no TURNSTILE_SECRET_KEY every public form is refused, because skipping the
// check is what turns /api/email/capture into a way to mail any address from Radar's domain and
// the other forms into open spam targets. The one way to skip it is to say so explicitly with
// TURNSTILE_DISABLED="true", for local development and tests; scripts/check-worker-secrets.mjs
// warns at deploy when the secret is missing.
export async function verifyTurnstile(request: Request, token: unknown): Promise<boolean> {
  const runtime = env as unknown as Record<string, string>;
  const secret = runtime.TURNSTILE_SECRET_KEY;
  if (!secret) return runtime.TURNSTILE_DISABLED === "true";
  if (typeof token !== "string" || !token) return false;
  const requestHeaders = await headers();
  const ip = requestHeaders.get("cf-connecting-ip") || undefined;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
    const data = await result.json<{ success: boolean }>();
    return data.success === true;
  } catch {
    return false;
  }
}

export async function rateLimit(key: string, limit: number, windowMinutes: number) {
  const now = Date.now();
  const windowStart = new Date(Math.floor(now / (windowMinutes * 60_000)) * windowMinutes * 60_000).toISOString();
  // One statement: the count after this request comes back from the write itself. Old windows are
  // swept by the hourly cron in worker/index.ts; every window gets a row of its own, so nothing
  // else ever removes them.
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count",
  ).bind(`${key}:${windowStart}`, windowStart).first<{ count: number }>();
  return (row?.count || 0) <= limit;
}
