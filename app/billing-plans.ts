// The set of billing periods a customer may choose, and nothing else.
//
// Deliberately free of any `cloudflare:workers` import, unlike app/stripe.ts. Two things need that:
// UpgradeCta.tsx is a client component and should not reach into the Worker-bound module even for
// a type, and tests/billing-plans.test.mjs imports isBillingPlan to exercise it directly rather
// than pattern-matching the source — which matters, because this is the check standing between a
// request body and the price Stripe charges against.

/**
 * A plan is named by key, never by price id.
 *
 * `line_items[0][price]` is the field that decides what a customer is charged. If the browser
 * could name it, a caller could subscribe itself to any price on the account: a superseded cheaper
 * one, a C$0 test price, a price belonging to a different product. Nothing afterwards would look
 * wrong — the subscription is ordinary, `plan_status` is `active`, and the account has Pro. The
 * mapping from key to price lives server-side in app/stripe.ts.
 */
export const BILLING_PLANS = ["monthly", "yearly"] as const;
export type BillingPlan = (typeof BILLING_PLANS)[number];

export function isBillingPlan(value: unknown): value is BillingPlan {
  // `includes` on the array, not on a joined string: "month" is a substring of "monthly", so a
  // string-based check would accept keys that do not exist.
  return typeof value === "string" && (BILLING_PLANS as readonly string[]).includes(value);
}
