import { env } from "cloudflare:workers";
import { getAppUser } from "../../../auth";
import { apiError } from "../../../api-utils";

// What a signed-in reader has sent Radar: the deals they suggested and the deals they reported, with
// where each one stands. Before this a suggestion got a reference number on the form and a report
// got a toast, and neither was ever mentioned again, so nobody could tell whether sending one did
// anything. Read only when the dashboard's Contributions section is open, not on every dashboard
// load, and bounded to the most recent 50 of each (drizzle/0075 indexes both by user_id).
//
// Only what is the reader's own goes out. A rejected suggestion carries its reason, which is written
// to the person who sent it (app/suggestion-review.ts). A report's `resolution` is staff's working
// note and stays in the workspace; the reader gets the status. Nobody else's suggestions or reports,
// and no staff names, are in the answer.

interface SuggestionRow {
  reference: string | null;
  restaurant: string;
  deal: string;
  status: string;
  rejection_reason: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ReportRow {
  id: number;
  category: string;
  status: string;
  created_at: string;
  resolved_at: string | null;
  deal_slug: string | null;
  deal_id: string;
  deal_title: string | null;
  restaurant: string | null;
}

export async function GET() {
  const user = await getAppUser();
  if (!user) return apiError(401,"AUTH_REQUIRED","Sign in required.");
  const [suggestions,reports] = await Promise.all([
    env.DB.prepare("SELECT reference,restaurant,COALESCE(title,deal) deal,status,rejection_reason,created_at,NULLIF(updated_at,'1970-01-01 00:00:00') updated_at FROM suggestions WHERE user_id=? ORDER BY created_at DESC LIMIT 50")
      .bind(user.userId).all<SuggestionRow>(),
    // The deal is joined for its name and link only. A deal that has since been soft-deleted still
    // names what was reported, and is not linked (the dashboard links only a slug it was given).
    env.DB.prepare(`SELECT rp.id,rp.category,rp.status,rp.created_at,rp.resolved_at,rp.deal_id,
        CASE WHEN d.deleted_at IS NULL THEN d.slug END deal_slug,d.title deal_title,d.restaurant
      FROM reports rp LEFT JOIN deals d ON d.id=rp.deal_id WHERE rp.user_id=? ORDER BY rp.created_at DESC LIMIT 50`)
      .bind(user.userId).all<ReportRow>(),
  ]);
  return Response.json({
    suggestions: suggestions.results.map((row) => ({
      reference: row.reference,
      restaurant: row.restaurant,
      deal: row.deal,
      status: row.status,
      // Only a rejection has a reason worth showing; an approved or pending row's column is empty.
      reason: row.status === "rejected" ? row.rejection_reason : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    reports: reports.results.map((row) => ({
      id: row.id,
      category: row.category,
      status: row.status,
      created_at: row.created_at,
      resolved_at: row.resolved_at,
      deal: { id: row.deal_id, slug: row.deal_slug, title: row.deal_title, restaurant: row.restaurant },
    })),
  }, { headers: { "cache-control": "private, no-store" } });
}
