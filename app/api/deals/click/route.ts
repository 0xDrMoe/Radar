import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin } from "../../../api-utils";

interface DealClickBody {
  dealId?: unknown;
  kind?: unknown;
}

// Two clicks worth counting, and only two.
//
//   "view"  — the deal's page was opened. Deliberately recorded on the page itself rather than on
//             the card that leads to it, so it counts every arrival: a shared link, a search
//             result and a tap in the grid all land here, and a creator posting a direct link is
//             the normal case, not the exception.
//   "offer" — someone left Radar for the restaurant's own offer page. Intent, and the number a
//             creator or a restaurant actually wants: it is the closest thing the site records to
//             someone going to claim the deal.
//
// Kept apart rather than summed into one "click" because they mean different things, and because
// the pair is a click-through rate — folded together, the interesting number would disappear into
// the noisy one.
//
// Follows app/api/deals/feedback's precedent: product_events, not a new table. High-volume,
// low-stakes, aggregated with a GROUP BY like every other event type.
const CLICK_KINDS = new Set(["view", "offer"]);
const HANDLE = /^[a-z0-9][a-z0-9-]{1,31}$/;

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403, "INVALID_ORIGIN", "This request could not be verified.");
  // Higher than the feedback route's 30: a browsing session opens many deals, and a click that is
  // dropped is a number quietly missing from someone's payout conversation rather than a failed
  // action they can retry.
  if (!(await rateLimit(await clientKey("deal_click"), 120, 60))) return apiError(429, "RATE_LIMITED", "Too many clicks.");
  let body: DealClickBody;
  try { body = await readJson<DealClickBody>(request, 1_000); } catch { return apiError(400, "INVALID_REQUEST", "The click could not be read."); }
  const dealId = cleanText(body.dealId, 64);
  const kind = cleanText(body.kind, 16);
  if (!dealId) return apiError(422, "DEAL_ID_REQUIRED", "A deal is required.");
  if (!CLICK_KINDS.has(kind)) return apiError(422, "INVALID_KIND", "Unknown click kind.");
  const deal = await env.DB.prepare("SELECT id FROM deals WHERE id=? AND deleted_at IS NULL").bind(dealId).first();
  if (!deal) return apiError(404, "DEAL_NOT_FOUND", "That deal could not be found.");

  // Read server-side from the cookie rather than trusting a handle in the body, and resolve it
  // against a real active creator before storing it — the same guard sign-up attribution uses. A
  // reader can still edit their own cookie, but they cannot invent a creator that does not exist,
  // and nothing here is authorization: it only decides whose column a number lands in.
  const cookieHandle = ((await cookies()).get("radar_creator")?.value || "").trim().toLowerCase();
  const creator = HANDLE.test(cookieHandle)
    ? (await env.DB.prepare("SELECT handle FROM creator_profiles WHERE handle=? AND status='active'").bind(cookieHandle).first<{ handle: string }>())?.handle || null
    : null;

  await env.DB.prepare("INSERT INTO product_events(id,type,entity_id,properties) VALUES(?,?,?,?)")
    .bind(crypto.randomUUID(), "deal_click", dealId, JSON.stringify({ kind, creator })).run();
  return Response.json({ ok: true }, { status: 201 });
}
