import { env } from "cloudflare:workers";
import { getAppUser } from "../../auth";

// The columns the browser is allowed to see, named one by one.
//
// This used to be `SELECT *`, which handed every reader their whole users row: stripe_customer_id
// and stripe_subscription_id, the internal `hidden` staff flag, `referred_by`, `status`. None of
// it is used by any caller — the client contract is the `Session` type in app/HomeClient.tsx, and
// it lists exactly these twelve — and none of it should be sitting in a JSON response that any
// script on the page can read. It is the reader's own data rather than someone else's, so this is
// not a leak between accounts; it is the difference between an injected script learning a billing
// customer id and learning nothing.
//
// An allowlist rather than a denylist on purpose: the next column added to `users` should have to
// be named here before it reaches a browser, instead of shipping by default and being noticed
// later. Adding one means adding it to `Session` too, which is what makes this list checkable.
const SESSION_COLUMNS = [
  "id",
  "email",
  "name",
  "role",
  "plan",
  "plan_status",
  "past_due_since",
  "paused_until",
  "home_postal",
  "alerts_enabled",
  "alert_days",
  "alert_time",
  "distance_unit",
  "country",
] as const;

export async function GET() {
  const user = await getAppUser();
  if (!user) return Response.json({ user: null });
  const profile = await env.DB.prepare(`SELECT ${SESSION_COLUMNS.join(",")} FROM users WHERE id=?`)
    .bind(user.userId)
    .first();
  return Response.json({
    user: profile,
    authentication: { provider: "clerk" },
  });
}
