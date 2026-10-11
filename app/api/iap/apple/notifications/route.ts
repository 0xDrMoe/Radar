import { env } from "cloudflare:workers";
import { transactionIdFromNotification } from "../../../../appstore";
import { applyAppleSubscription } from "../../../../apple-entitlement";
import { rateLimit, readTextCapped } from "../../../../api-utils";

// App Store Server Notifications V2.
//
// This is how a renewal, a cancellation, a refund or a billing failure reaches Radar — none of
// which involve the app being open, so without this a subscription would be granted once and never
// revised.
//
// The body is not verified, and does not need to be. Nothing in it is believed: the only thing
// taken from it is a transaction id, which is then looked up at Apple over TLS with our own key.
// A forged notification can therefore do exactly one thing — make Radar re-ask Apple about a real
// subscription and write down the answer Apple gave. See app/appstore.ts.
//
// It always answers 200. Apple retries a non-2xx for days, and a notification we cannot make sense
// of will not start making sense on the fifth attempt.

export async function POST(request: Request) {
  // Capped, since nothing here is authenticated. Apple's signed payloads are a few kilobytes.
  let body = "";
  try { body = await readTextCapped(request, 256_000); } catch { return Response.json({ ok: true, ignored: "too large" }); }
  let signedPayload: string | undefined;
  try { signedPayload = (JSON.parse(body) as { signedPayload?: string }).signedPayload; } catch { /* answered below */ }
  if (!signedPayload) return Response.json({ ok: true, ignored: "no payload" });

  const transactionId = transactionIdFromNotification(signedPayload);
  if (!transactionId) return Response.json({ ok: true, ignored: "no transaction" });

  // Only transactions Radar already knows about. A notification for one it has never seen has no
  // account to resolve to, and asking Apple about an arbitrary id a stranger posted is work done
  // on their say-so.
  const known = await env.DB.prepare("SELECT user_id FROM apple_subscriptions WHERE original_transaction_id=?")
    .bind(transactionId)
    .first<{ user_id: string }>();
  if (!known) return Response.json({ ok: true, ignored: "unknown transaction" });
  // Each one costs a signed call to Apple, and a stranger who learns a transaction id could repeat
  // it to spend the key's quota. Apple sends a handful per subscription per renewal, never dozens.
  if (!(await rateLimit(`apple-notification:${transactionId}`, 10, 60))) return Response.json({ ok: true, ignored: "rate limited" });

  await applyAppleSubscription(transactionId);
  return Response.json({ ok: true });
}
