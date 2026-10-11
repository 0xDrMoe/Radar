import { env } from "cloudflare:workers";
import { getAppUser } from "../../../auth";
import { apiError, cleanText, readJson, requireSameOrigin } from "../../../api-utils";
import { createPortalSession, stripeConfigured } from "../../../stripe";

/**
 * The reasons offered in the cancellation survey, and the only ones accepted.
 *
 * A closed list rather than free text, because the point is a table that can be counted. The
 * optional `detail` field is where anything not on the list goes, and it is read by a person rather
 * than grouped.
 *
 * Kept deliberately short. Exit surveys lose answers with every extra question, and one question
 * with six options collects enough to tell "too expensive" from "nothing near me" - which is the
 * distinction that decides whether the fix is pricing or inventory.
 */
const CANCEL_REASONS = new Set(["price", "deals", "unused", "missing", "temporary", "other"]);

interface PortalBody {
  cancelReason?: unknown;
  cancelDetail?: unknown;
}

export async function POST(request: Request) {
  const user = await getAppUser();
  if (!user) return apiError(401,"AUTH_REQUIRED","Sign in required.");
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!stripeConfigured()) return apiError(503,"BILLING_UNAVAILABLE","Billing is not available right now.");
  const existing = await env.DB.prepare("SELECT stripe_customer_id,plan_status FROM users WHERE id=?").bind(user.userId).first<{stripe_customer_id:string|null;plan_status:string}>();
  if (!existing?.stripe_customer_id) return apiError(404,"NO_SUBSCRIPTION","You do not have a billing account yet.");

  // The survey answer rides along with the request that opens the portal, so the reason is recorded
  // at the moment somebody decides to leave rather than asked for afterwards, when they are gone and
  // will not answer.
  //
  // This records an *intent* to cancel, not a cancellation: the portal is Stripe's and they may well
  // change their mind once they are in it. The Growth tab reads these against the
  // `subscription_canceled` events to see which reasons actually followed through.
  //
  // Body is optional throughout. "Manage billing" and "Cancel subscription" are the same call, and a
  // request with no reason is the ordinary case.
  let body: PortalBody = {};
  try { body = await readJson<PortalBody>(request, 2_000); } catch { /* an empty body is normal here */ }
  const reason = cleanText(body.cancelReason, 20).toLowerCase();
  if (CANCEL_REASONS.has(reason)) {
    const detail = cleanText(body.cancelDetail, 500) || null;
    // plan_status is stamped on the row so a reason given while a payment was failing can be told
    // apart from one given by a customer in good standing. They mean different things: the first is
    // often a card problem wearing a cancellation's clothes.
    await env.DB.prepare("INSERT INTO cancellation_reasons(user_id,reason,detail,plan_status) VALUES(?,?,?,?)")
      .bind(user.userId, reason, detail, existing.plan_status).run();
  }

  const runtime = env as unknown as Record<string,string>,origin = runtime.PUBLIC_APP_URL || "https://radar.cheap";
  try {
    const url = await createPortalSession(existing.stripe_customer_id,`${origin}/dashboard/billing`);
    return Response.json({ url });
  } catch { return apiError(502,"STRIPE_ERROR","The billing portal could not be opened."); }
}
