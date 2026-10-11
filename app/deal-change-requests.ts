// What a restaurant manager may propose for one of their deals, and how two versions compare.
//
// Shared by the portal, which turns a save into a request (app/api/portal/route.ts), and the staff
// workspace, which applies or turns one down (app/api/admin/route.ts). Pure, so the client can
// import it to show the same field-by-field difference the server judged by.

export const DEAL_CHANGE_FIELDS = ["title", "price", "schedule", "description", "terms"] as const;
export type DealChangeField = (typeof DEAL_CHANGE_FIELDS)[number];
export type DealContent = Record<DealChangeField, string | null>;

export const DEAL_CHANGE_LABELS: Record<DealChangeField, string> = {
  title: "Title",
  price: "Price or savings",
  schedule: "Schedule",
  description: "Description",
  terms: "Terms",
};

/** The proposable fields of any row that has them, blank text read as no text. */
export function dealContentOf(row: Partial<Record<DealChangeField, unknown>>): DealContent {
  const content = {} as DealContent;
  for (const field of DEAL_CHANGE_FIELDS) {
    const value = row[field];
    content[field] = typeof value === "string" && value.trim() ? value.trim() : null;
  }
  return content;
}

/** The fields whose text differs between two versions, in form order. */
export function changedDealFields(before: DealContent, after: DealContent): DealChangeField[] {
  return DEAL_CHANGE_FIELDS.filter((field) => (before[field] ?? null) !== (after[field] ?? null));
}

/** `previous` as stored, or an empty version when it cannot be read. */
export function parsePreviousContent(json: unknown): DealContent {
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : null;
    return dealContentOf(parsed && typeof parsed === "object" ? parsed : {});
  } catch {
    return dealContentOf({});
  }
}
