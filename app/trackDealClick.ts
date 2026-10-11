// Fire-and-forget click recording, safe to call immediately before a navigation.
//
// sendBeacon is the right primitive here and fetch is not: both of these fire as the page is
// being torn down (a router.push, or following a link to another origin), and a normal fetch is
// canceled when that happens. sendBeacon hands the request to the browser to deliver
// independently of the page, which is exactly the guarantee this needs.
//
// It falls back to keepalive fetch where sendBeacon is missing or refuses (it returns false when
// the browser's queue is full), and swallows everything: a dropped click is a number missing from
// a report, never a broken navigation.
export type DealClickKind = "view" | "offer";

export function trackDealClick(dealId: string, kind: DealClickKind) {
  if (!dealId) return;
  const body = JSON.stringify({ dealId, kind });
  try {
    // Blob rather than a bare string so the request carries application/json — the route reads
    // JSON, and sendBeacon otherwise sends text/plain.
    if (navigator.sendBeacon?.("/api/deals/click", new Blob([body], { type: "application/json" }))) return;
  } catch { /* fall through to fetch */ }
  try {
    fetch("/api/deals/click", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch { /* nothing to do — this is telemetry, not the user's task */ }
}
