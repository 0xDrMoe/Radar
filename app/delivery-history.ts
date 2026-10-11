// How a delivery record is described to the person who received it.
//
// email_deliveries.status is a provider-shaped enum and error_code is whatever string the provider
// threw, stored verbatim. Both are the right thing to keep — the CSV export hands them over as-is,
// which is the place exactness belongs — but neither is something to put in front of someone
// reading their own notification history. "failed / Error: 422 recipient domain not found" tells
// them nothing they can act on, and leaks how the plumbing is wired.
//
// So this module maps both onto a small closed vocabulary the UI can translate. Every branch is
// deliberately coarse: the history should say more about what happened than it used to, without
// claiming more precision than the underlying record actually has.

// Ordered roughly by how far the message got.
export type DeliveryState = "queued" | "sent" | "delivered" | "delayed" | "bounced" | "complained" | "failed";

const STATES = new Set<DeliveryState>(["queued", "sent", "delivered", "delayed", "bounced", "complained", "failed"]);

export function deliveryState(status: string | null | undefined): DeliveryState {
  const normalized = String(status || "").toLowerCase();
  // An unrecognised status is reported as "sent", not as a failure: the row exists because the
  // send path ran, and inventing a scary label for a status we simply do not have a mapping for
  // would be worse than the mild understatement.
  return STATES.has(normalized as DeliveryState) ? (normalized as DeliveryState) : "sent";
}

// Whether the state means the message is still in flight, arrived, or did not arrive. Drives the
// color of the row, so it stays separate from the label itself.
export function deliveryTone(state: DeliveryState) {
  if (state === "delivered") return "good" as const;
  if (state === "bounced" || state === "complained" || state === "failed") return "bad" as const;
  if (state === "delayed") return "warn" as const;
  return "pending" as const;
}

export type DeliveryReason = "suppressed" | "rejected" | "throttled" | "unreachable" | "unknown";

// Buckets the raw provider error. Matched on substrings rather than codes because the string comes
// from two different places — a thrown Error's message and the provider's own body — and neither
// promises a stable shape. A bucket that is occasionally "unknown" is fine; that is still more
// than the previous UI said, which was to print the raw string.
export function deliveryReason(errorCode: string | null | undefined): DeliveryReason | null {
  if (!errorCode) return null;
  const text = errorCode.toLowerCase();
  if (/suppress|unsubscrib|opt.?out|complain/.test(text)) return "suppressed";
  if (/bounce|not found|does not exist|invalid|no such|recipient|mailbox|rejected|550|551|553/.test(text)) return "rejected";
  if (/rate|throttl|quota|too many|429/.test(text)) return "throttled";
  if (/timeout|timed out|network|unreachable|connect|fetch failed|50[0234]/.test(text)) return "unreachable";
  return "unknown";
}
