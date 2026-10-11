// The deal inventory's and the suggestions queue's rules that are not rendering: where a deal is,
// what a deep link asks for, and which existing deals a suggestion may duplicate.
//
// Pure and import-free (types aside), so tests load it directly and the tabs stay about layout.

/** The fields of a deal row these rules read. AdminDeal satisfies it; location_scope is optional there. */
export interface PlacedDeal {
  id: string;
  restaurant: string;
  city: string;
  status: string;
  full_postal?: string | null;
  postal_prefix?: string | null;
  location_region?: string | null;
  location_country?: string | null;
  location_scope?: string | null;
}

/**
 * A brand-wide or national offer runs at every branch, or across a country, so it has no single
 * place. Its `city` column still holds whatever the row was created with, which must never be shown
 * or filtered as if it were where the offer is.
 */
export function placeless(deal: Pick<PlacedDeal, "location_scope">): "brand" | "national" | null {
  return deal.location_scope === "brand" ? "brand" : deal.location_scope === "national" ? "national" : null;
}

/** Where a deal is, for matchesGeo: a placeless offer is in its country and nowhere narrower. */
export function dealGeoPlace(deal: PlacedDeal) {
  if (placeless(deal)) return { country: deal.location_country || null, region: null, city: null, postal: null };
  return { country: deal.location_country || null, region: deal.location_region || null, city: deal.city || null, postal: deal.full_postal || deal.postal_prefix || null };
}

/** The Market column: "Brand-wide" or "National" for a placeless offer, else the city and its area. */
export function dealPlaceLabel(deal: PlacedDeal): { primary: string; secondary: string } {
  const scope = placeless(deal);
  if (scope === "brand") return { primary: "Brand-wide", secondary: `Every ${deal.restaurant} branch` };
  if (scope === "national") return { primary: "National", secondary: deal.location_country ? `Across ${deal.location_country === "CA" ? "Canada" : deal.location_country === "US" ? "the United States" : deal.location_country}` : "No single place" };
  return {
    primary: deal.city || "No city recorded",
    secondary: [deal.location_region, deal.full_postal || deal.postal_prefix].filter(Boolean).join(" · "),
  };
}

/** What "Ended & archived" lists: every deal that is not public and is not on its way to being. */
export const ENDED_STATUSES = ["expired", "archived", "paused"] as const;
export const isEndedStatus = (status: string) => (ENDED_STATUSES as readonly string[]).includes(status);

export const INVENTORY_STATUSES = ["draft", "scheduled", "live", "paused", "expired", "archived"] as const;

/** The deal a deep link points at, and the status it filters to: /admin/deals?deal=<id>&status=live. */
export function inventoryLink(search: string): { deal: string; status: string } {
  const params = new URLSearchParams(search);
  const status = params.get("status") || "";
  return {
    deal: (params.get("deal") || "").slice(0, 200),
    status: (INVENTORY_STATUSES as readonly string[]).includes(status) ? status : "",
  };
}

/**
 * A word to put in the inventory search when a linked deal is not among the 500 loaded rows. The
 * server's search (deal_q) matches the restaurant, title and terms, not the id, but an id is a slug
 * that starts with the restaurant's name ("slaymaker-nichols-charlottetown-..."), so its first
 * real word finds the row, and the tab then picks it out of the results by id.
 */
export function searchTermForDealId(id: string): string {
  const words = id.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !/^\d+$/.test(word) && word !== "the" && word !== "suggestion");
  return words[0] || "";
}

/** Who sent a suggestion in: a creator through their workspace, a signed-in account, or the public form. */
export type SubmitterKind = "creator" | "account" | "public";
export function submitterKind(row: { relationship?: string | null; user_id?: string | null }): SubmitterKind {
  if (row.relationship === "creator") return "creator";
  return row.user_id ? "account" : "public";
}

export const SUBMITTER_LABEL: Record<SubmitterKind, string> = {
  creator: "Creator",
  account: "Signed-in account",
  public: "Public form",
};

/**
 * Whether the person who sent a suggestion can read why it was rejected. A creator's workspace lists
 * their submissions with the stored reason (app/api/creator/route.ts); nobody else is shown it, and
 * Radar sends no email about a suggestion's outcome.
 */
export const submitterSeesReason = (kind: SubmitterKind) => kind === "creator";

const normalName = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|restaurant|bar|grill|cafe|kitchen)\b/g, " ").replace(/\s+/g, " ").trim();

/**
 * Deals already in the inventory under the same restaurant name, for "is this a duplicate?" before
 * a suggestion is converted. Names are compared loosely (case, accents, "&", a leading "The"), and
 * an exact match on the loose name is required so "Pizza Pizza" does not match every pizzeria.
 * Only the loaded deals are searched, which the screen says.
 */
export function possibleDuplicates<T extends PlacedDeal & { title: string }>(restaurant: string, deals: readonly T[], limit = 5): T[] {
  const wanted = normalName(restaurant);
  if (!wanted) return [];
  return deals.filter((deal) => normalName(deal.restaurant) === wanted).slice(0, limit);
}
