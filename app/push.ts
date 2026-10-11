import { env } from "cloudflare:workers";

// Sending to Expo's push service, and keeping device_tokens honest about what is still reachable.
//
// Modeled on app/geocode.ts's graceful degradation: nothing here throws. A push that fails is a
// notification someone did not get, never a digest run that dies partway through and leaves half
// the mailing list without their email.

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// Expo's documented cap per request. Exceeding it is rejected outright, so the chunking is not an
// optimization — it is the contract.
const MAX_PER_REQUEST = 100;

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  /** Read by the app to open the right screen when someone taps the notification. */
  data?: Record<string, string>;
}

interface ExpoTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

export interface PushOutcome {
  sent: number;
  failed: number;
  /** Tokens the service says are gone. Marked revoked so they are never retried. */
  revoked: string[];
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export async function sendExpoPush(messages: PushMessage[]): Promise<PushOutcome> {
  const outcome: PushOutcome = { sent: 0, failed: 0, revoked: [] };
  if (!messages.length) return outcome;
  const runtime = env as unknown as Record<string, string>;
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json" };
  // Only needed when the Expo project has enhanced security turned on. Absent is the normal case.
  if (runtime.EXPO_ACCESS_TOKEN) headers.authorization = `Bearer ${runtime.EXPO_ACCESS_TOKEN}`;

  for (const batch of chunk(messages, MAX_PER_REQUEST)) {
    let tickets: ExpoTicket[] = [];
    try {
      const response = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers,
        body: JSON.stringify(batch.map((message) => ({ ...message, sound: "default", channelId: "deals" }))),
      });
      if (!response.ok) { outcome.failed += batch.length; continue; }
      const payload = await response.json() as { data?: ExpoTicket[] };
      tickets = payload.data || [];
    } catch {
      // The whole batch is unaccounted for rather than silently counted as delivered.
      outcome.failed += batch.length;
      continue;
    }
    tickets.forEach((ticket, index) => {
      if (ticket.status === "ok") { outcome.sent++; return; }
      outcome.failed++;
      // The one error worth acting on: the app was deleted, or the token was reissued. Every
      // other error is transient and the token stays active.
      if (ticket.details?.error === "DeviceNotRegistered") outcome.revoked.push(batch[index].to);
    });
  }
  return outcome;
}

// Revoked rather than deleted, so a device that went quiet stays distinguishable from one that was
// never registered — and so re-installing the app revives the row instead of racing a delete.
export async function revokeTokens(tokens: string[]) {
  if (!tokens.length) return;
  const placeholders = tokens.map(() => "?").join(",");
  await env.DB.prepare(`UPDATE device_tokens SET status='revoked' WHERE token IN (${placeholders})`).bind(...tokens).run();
}

// What a roundup says on a lock screen. The title carries the count and the place, because that is
// the whole decision about whether to open it; the body names actual restaurants, because "3 new
// deals" with no nouns in it is indistinguishable from every other app's nudge.
export function digestNotification(deals: Array<{ restaurant: string; title: string }>, place: string | null) {
  const where = place ? ` near ${place}` : "";
  const title = deals.length === 1 ? `A new deal${where}` : `${deals.length} deals${where}`;
  const named = deals.slice(0, 2).map((deal) => `${deal.title} at ${deal.restaurant}`);
  const rest = deals.length - named.length;
  return { title, body: rest > 0 ? `${named.join(", ")} and ${rest} more` : named.join(", ") };
}
