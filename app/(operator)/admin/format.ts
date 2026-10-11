// Pure helpers the staff workspace's files share: formatting, the deal editor's parsing and time
// conversion, the inventory filter, and the label tables. Nothing here touches React state.
import { parseSqlTimestamp } from "../../verification";
import type { AdminDeal, AdminUser } from "./types";

export function isProUser(u: AdminUser) {
  return u.plan === "pro" && (u.plan_status === "active" || u.plan_status === "trialing");
}

// The survey stores a code; this is what it meant when it was asked. Kept beside the reader rather
// than in the database, so rewording a question never rewrites the history of answers to the old one.
// Spelled out next to the switch so nobody has to go and look up how long a trial is before
// deciding whether to turn one on. Mirrors TRIAL_DAYS in app/entitlement.ts.
export const TRIAL_DAYS_LABEL = "3 days, one per account";

export const SAVE_OFFER_LABELS: Record<string, string> = {
  pause: "Pause",
  discount: "Discount",
  feedback: "Asked what was missing",
};

export const CANCEL_REASON_LABELS: Record<string, string> = {
  price: "Too expensive",
  deals: "Not enough deals nearby",
  unused: "Wasn't using it",
  missing: "Something was missing",
  temporary: "Taking a break",
  other: "Something else",
};

// A rate over a zero denominator is not 0%, it is unknown. An em dash says so; "0%" would claim
// nobody converted when in fact nobody arrived, which is the kind of number people act on.
export function percent(part: number, whole: number) {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—";
}

// Commission amounts are integer minor units in the invoice's own currency, exactly as Stripe
// reported them. Formatting is the only place they are ever divided.
export function money(minorUnits: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).format(minorUnits / 100);
  } catch {
    return `${(minorUnits / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export const EDITOR_STEPS = ["Basics", "Where & when", "Prove it", "Publish settings"] as const;
export const FIELD_STEP: Record<string, number> = {
  restaurant: 0, title: 0, category: 0, cuisine: 0, price: 0, emoji: 0,
  city: 1, postal_prefix: 1, address: 1, schedule: 1, start_time: 1, end_time: 1, location: 1,
  source_url: 2, verification: 2,
  status: 3, publish_at: 3, expires_at: 3, terms: 3, restrictions: 3, internal_notes: 3, curated_keywords: 3,
};
export const DAYS = [
  { key: "mon", label: "Mon" },
  { key: "tue", label: "Tue" },
  { key: "wed", label: "Wed" },
  { key: "thu", label: "Thu" },
  { key: "fri", label: "Fri" },
  { key: "sat", label: "Sat" },
  { key: "sun", label: "Sun" },
] as const;
export const PRESET_KEYWORDS = [
  "Italian", "Sushi", "BBQ", "Vegan", "Vegetarian", "Gluten-free",
  "Brunch", "Breakfast", "Date night", "Patio", "Late night",
  "Family-friendly", "Group dining", "Takeout", "Delivery", "Seafood",
  "Steakhouse", "Pizza", "Burgers", "Mexican", "Thai", "Indian",
  "Cocktails", "Wine bar",
] as const;
// Staleness has one definition, matching the rule the API applies: only a deal that is
// currently verified can go stale. An unverified deal is not stale, it is unverified — counting
// it as both put every old draft into the "Stale" figure as well as "Needs verification".
export function isStaleDeal(deal: AdminDeal, staleBefore: number) {
  return deal.verification_status === "stale"
    || (deal.verification_status === "verified" && sqlDate(deal.verified_at).getTime() < staleBefore);
}
// Pure inventory predicate, kept at module scope so the filter itself stays testable and
// the memo above reduces to a single call with an explicit argument list.
export type InventoryFilters = {
  city: string; tab: string; statusFilter: string; adminCuisine: string;
  verificationFilter: string; needle: string; staleBefore: number;
};
export function filterInventory(deals: AdminDeal[], f: InventoryFilters) {
  return deals.filter((d) => {
    if (f.city !== "All cities" && d.city !== f.city) return false;
    if (f.tab === "ended" ? d.status !== "expired" : f.statusFilter !== "All statuses" && d.status !== f.statusFilter) return false;
    if (f.adminCuisine !== "All cuisines" && d.cuisine !== f.adminCuisine) return false;
    if (f.verificationFilter !== "All verification") {
      const stale = isStaleDeal(d, f.staleBefore);
      if (f.verificationFilter === "Sponsored" ? !d.sponsored : f.verificationFilter === "Stale" ? !stale : d.verification_status !== f.verificationFilter) return false;
    }
    if (f.needle && !`${d.restaurant} ${d.title} ${d.cuisine}`.toLowerCase().includes(f.needle)) return false;
    return true;
  });
}
export function parseKeywords(value: string | null | undefined) {
  return Array.from(new Set(String(value || "").split(",").map((term) => term.trim()).filter(Boolean)));
}
export function parseDays(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((day): day is string => typeof day === "string") : [];
  } catch {
    return [];
  }
}
// DEAL TIMES ARE STORED AS ZONELESS UTC AND EDITED AS THE ADMIN'S OWN WALL CLOCK.
// publish_at and expires_at are "YYYY-MM-DD HH:MM:SS" with no zone marker, and everything that
// reads them takes that as UTC: parseSqlTimestamp in app/verification.ts appends the Z, and
// SQLite's datetime() in the expiry job and the public-deal predicate does the same. A
// datetime-local input speaks the other language, the admin's local time, also with no marker.
// This editor used to pass one straight through as the other, so an expiry typed as 11:59 PM in
// Toronto was stored as 23:59 UTC and ended the deal at 7:59 PM, and a stored time was shown with
// .slice(0, 16), which is UTC passed off as local. The browser is the only place that knows the
// admin's zone, so the conversion happens here, in both directions, and the API and the column
// stay exactly as they were.
export const pad2 = (n: number) => String(n).padStart(2, "0");
// Every other D1 timestamp this screen shows (CURRENT_TIMESTAMP rows: waitlist, reports,
// feedback, events, verified_at) is the same zoneless UTC, and a bare new Date() reads it as the
// browser's local time - hours off in Toronto. Missing reads as the epoch, as new Date(null) did.
export const sqlDate = (value: string | null | undefined) => (value ? parseSqlTimestamp(value) : new Date(0));
export function toLocalInput(stored: string | null | undefined) {
  if (!stored) return "";
  const at = parseSqlTimestamp(stored);
  if (Number.isNaN(at.getTime())) return "";
  return `${String(at.getFullYear()).padStart(4, "0")}-${pad2(at.getMonth() + 1)}-${pad2(at.getDate())}T${pad2(at.getHours())}:${pad2(at.getMinutes())}`;
}
// "" clears the column. null means the field held something that is not a date and time, which a
// datetime-local input never produces; only a browser that fell back to a plain text box can, and
// sending that through would store it raw, which is the bug this replaces.
// A field left as it was shown sends the stored value back byte for byte. The input has no
// seconds, so converting it anyway would turn an end-of-day 03:59:59 into 03:59:00 on every
// unrelated save, and would rewrite the few rows saved before this fix whenever someone fixed a
// typo in their title.
export function toStoredTimestamp(local: FormDataEntryValue | undefined, stored: string | null | undefined): string | null {
  const text = typeof local === "string" ? local.trim() : "";
  if (!text) return "";
  if (stored && text === toLocalInput(stored)) return stored;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (!parts) return null;
  const [, year, month, day, hour, minute, second] = parts;
  // The component constructor, not new Date(text): it reads the parts as local time by definition
  // rather than by a parsing rule that browsers have disagreed on before.
  const at = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second || 0));
  return Number.isNaN(at.getTime()) ? null : at.toISOString().slice(0, 19).replace("T", " ");
}
// Named beside the two inputs, so nobody has to wonder whose 11:59 PM they are typing.
export function editorTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}
export type EditorWindow = { days: string[]; start: string; end: string };
export const EMPTY_WINDOW: EditorWindow = { days: [], start: "", end: "" };
// A deal can have more than one time window ("3-6 PM & 9 PM-close"); schedule_windows carries
// all of them once loaded through the editor. schedule_days/start/end (a single window, the
// first one) covers a deal loaded elsewhere that hasn't gone through save_deal's current
// contract yet, and unstructuredFallback covers a deal whose only schedule data is the raw
// display_text a suggestion was approved with (no days/start/end at all) — surfaced as a single
// empty window rather than silently discarding that text.
export function parseEditorWindows(value: Partial<AdminDeal>): EditorWindow[] {
  if (value.schedule_windows?.length) {
    return value.schedule_windows.map((w) => ({ days: w.days, start: w.start_time, end: w.end_time }));
  }
  if (value.schedule_days) {
    return [{ days: parseDays(value.schedule_days), start: value.schedule_start || "", end: value.schedule_end || "" }];
  }
  return [{ ...EMPTY_WINDOW }];
}
export type EditorLocation = { id?: string; address: string; city: string; postal: string };
export const EMPTY_LOCATION: EditorLocation = { address: "", city: "", postal: "" };
// A deal can have more than one location (chains, or any restaurant with several branches
// offering the same deal). value.locations carries every deal_locations row once loaded through
// the editor; a deal loaded before that array existed falls back to its single denormalized
// address/city/postal_prefix, same fallback shape parseLocationInputs applies server-side.
export function parseEditorLocations(value: Partial<AdminDeal>): EditorLocation[] {
  if (value.locations?.length) {
    return value.locations.map((l) => ({ id: l.id, address: l.address, city: l.city, postal: l.full_postal || l.postal_prefix }));
  }
  if (value.address || value.city || value.postal_prefix) {
    return [{ address: value.address || "", city: value.city || "", postal: value.full_postal || value.postal_prefix || "" }];
  }
  return [{ ...EMPTY_LOCATION }];
}
export type EditorItem = { id?: number; name: string; original: string; discounted: string };
export const EMPTY_ITEM: EditorItem = { name: "", original: "", discounted: "" };
// Individual items priced within a deal ("Nachos: was $14, now $9") — unlike windows/locations
// there's no legacy singular field to fall back to, so an unloaded deal just starts with none.
export function parseEditorItems(value: Partial<AdminDeal>): EditorItem[] {
  return value.items?.length ? value.items.map((it) => ({ id: it.id, name: it.name, original: it.original_price || "", discounted: it.discounted_price })) : [];
}
export function setsEqual(a: Set<string>, b: Set<string>) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
}
// Shared by the three new CSV exports below (Users, Restaurants, Audit log) — the two
// pre-existing exports (exportDeals/exportSubscribers, above) build their own CSV strings
// inline; this isn't a refactor of those, just avoiding a third/fourth/fifth copy of the same
// quote-escaping logic for the exports this pass adds.
export function downloadCsv(filename: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const csv = [header, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
