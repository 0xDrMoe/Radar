import { env } from "cloudflare:workers";
import { hasPermission, type AppUser, type Permission } from "../../../auth";
import { apiError } from "../../../api-utils";
import { isAdminTier } from "../../../permissions";
import { requireStaff, writeAudit } from "../../../admin-guard";

// Every CSV the staff workspace can produce, built here and nowhere else.
//
// Exports used to be assembled in the browser from whatever the workspace payload held, so the
// only thing standing between a role and a spreadsheet of its data was whether the button was
// drawn. Now the file is made on the server, for a person holding export_data (a grant only the
// developer role and the owner can hold - see ROLE_LOCKED_PERMISSIONS), who must also be allowed to
// read the dataset itself: exporting is a way of reading, never a way around the rule for reading.
// Each export leaves an audit row naming the dataset, the filters and how many rows went out.

type Dataset = {
  /** What else, beyond export_data, reading this dataset takes. */
  allowed: (user: AppUser) => boolean;
  filename: string;
  columns: readonly string[];
  read: (params: URLSearchParams, user: AppUser) => Promise<Record<string, unknown>[]>;
};

// Rows per file. A CSV of the whole catalog is a few thousand rows at most, and the Worker's CPU
// budget is the real ceiling: past this, ask for a narrower filter.
const MAX_ROWS = 2000;

const has = (permission: Permission) => (user: AppUser) => hasPermission(user, permission);
const clip = (value: string | null, max = 60) => (value || "").trim().slice(0, max);

const DATASETS: Record<string, Dataset> = {
  deals: {
    allowed: () => true,
    filename: "radar-deals",
    columns: ["id", "restaurant", "title", "city", "region", "country", "cuisine", "status", "verification_status", "price", "schedule", "expires_at", "source_url", "created_at", "updated_at"],
    async read(params) {
      const where: string[] = ["d.deleted_at IS NULL"];
      const bind: string[] = [];
      const status = clip(params.get("status"), 20);
      const city = clip(params.get("city"));
      const region = clip(params.get("region"), 40);
      const country = clip(params.get("country"), 2).toUpperCase();
      if (status) { where.push("d.status=?"); bind.push(status); }
      if (city) { where.push("d.city=?"); bind.push(city); }
      if (region) { where.push("l.region=?"); bind.push(region); }
      if (country) { where.push("COALESCE(l.country,r.country)=?"); bind.push(country); }
      const { results } = await env.DB.prepare(
        `SELECT d.id,d.restaurant,d.title,d.city,l.region region,COALESCE(l.country,r.country) country,d.cuisine,d.status,d.verification_status,
                d.price,d.schedule,d.expires_at,d.source_url,d.created_at,d.updated_at
           FROM deals d LEFT JOIN restaurants r ON r.id=d.restaurant_id LEFT JOIN restaurant_locations l ON l.id=d.location_id
          WHERE ${where.join(" AND ")} ORDER BY d.city,d.restaurant LIMIT ${MAX_ROWS}`,
      ).bind(...bind).all<Record<string, unknown>>();
      return results;
    },
  },
  restaurants: {
    allowed: () => true,
    filename: "radar-restaurants",
    columns: ["id", "name", "website", "city", "region", "country", "status", "has_photo", "created_at"],
    async read() {
      const { results } = await env.DB.prepare(
        `SELECT id,name,website,city,region,country,status,CASE WHEN photo_url IS NULL OR photo_url='' THEN 'No' ELSE 'Yes' END has_photo,created_at
           FROM restaurants ORDER BY name LIMIT ${MAX_ROWS}`,
      ).all<Record<string, unknown>>();
      return results;
    },
  },
  users: {
    allowed: has("manage_users"),
    filename: "radar-users",
    columns: ["name", "email", "role", "status", "plan", "plan_status", "country", "home_postal", "created_at"],
    async read(_params, user) {
      // Hidden accounts stay with the owner and admin roles here exactly as on the Users tab.
      const { results } = await env.DB.prepare(
        `SELECT name,email,role,status,plan,plan_status,country,home_postal,created_at FROM users
          ${isAdminTier(user.role) ? "" : "WHERE hidden=0"} ORDER BY created_at DESC LIMIT ${MAX_ROWS}`,
      ).all<Record<string, unknown>>();
      return results;
    },
  },
  subscribers: {
    allowed: has("manage_email"),
    filename: "radar-subscribers",
    columns: ["name", "email", "home_postal", "alert_days", "alert_time"],
    async read() {
      // The same rule the Mailing list tab used: alerts on, a confirmed consent as the latest
      // word, and not suppressed.
      const { results } = await env.DB.prepare(
        `SELECT u.name,u.email,u.home_postal,u.alert_days,COALESCE(u.alert_time,'08:00') alert_time
           FROM users u
          WHERE u.alerts_enabled=1
            AND (SELECT c.status FROM email_consents c WHERE c.user_id=u.id ORDER BY c.id DESC LIMIT 1)='confirmed'
            AND NOT EXISTS (SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(u.email))
          ORDER BY u.created_at LIMIT ${MAX_ROWS}`,
      ).all<Record<string, unknown>>();
      return results;
    },
  },
  audit: {
    allowed: (user) => isAdminTier(user.role),
    filename: "radar-audit-log",
    columns: ["created_at", "actor_id", "actor_role", "action", "target_type", "target_id", "reason"],
    async read(params) {
      const action = clip(params.get("action"), 60);
      const { results } = await env.DB.prepare(
        `SELECT created_at,actor_id,actor_role,action,target_type,target_id,reason FROM audit_log
          ${action ? "WHERE action=?" : ""} ORDER BY created_at DESC LIMIT ${MAX_ROWS}`,
      ).bind(...(action ? [action] : [])).all<Record<string, unknown>>();
      return results;
    },
  },
};

/**
 * One CSV cell. A value a spreadsheet would read as a formula (=, +, -, @, tab, return) is
 * prefixed with an apostrophe, so a deal title someone typed as "=HYPERLINK(...)" opens as text.
 */
function csvCell(value: unknown) {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  const guard = await requireStaff(request, { permission: "export_data" });
  if (guard.response) return guard.response;
  const user = guard.user;
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") || "";
  const dataset = Object.hasOwn(DATASETS, kind) ? DATASETS[kind] : undefined;
  if (!dataset) return apiError(400, "UNKNOWN_EXPORT", "Choose what to export.");
  if (!dataset.allowed(user)) return apiError(403, "PERMISSION_DENIED", "Your role cannot read this data, so it cannot export it either.");
  const rows = await dataset.read(params, user);
  const filters = Object.fromEntries([...params.entries()].filter(([key]) => key !== "kind").map(([key, value]) => [key, value.slice(0, 60)]));
  await writeAudit(user, { action: "export_data", targetType: "export", targetId: kind, details: { rows: rows.length, filters, truncated: rows.length >= MAX_ROWS } });
  const body = [dataset.columns.join(","), ...rows.map((row) => dataset.columns.map((column) => csvCell(row[column])).join(","))].join("\r\n");
  return new Response(`\uFEFF${body}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${dataset.filename}-${new Date().toISOString().slice(0, 10)}.csv"`,
      "cache-control": "no-store",
      "x-export-rows": String(rows.length),
    },
  });
}
