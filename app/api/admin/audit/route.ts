import { env } from "cloudflare:workers";
import { isAdminTier } from "../../../permissions";
import { requireStaff } from "../../../admin-guard";

// The audit log, searchable past the 400 rows the workspace payload carries.
//
// GET /api/admin returns the newest 400 events for the overview; the Audit log section reads this
// route instead, so a search or a filter finds an event from months ago rather than only whatever
// happens to be in the latest slice. It answers to the owner and admin roles, as the log always
// has (docs/ROLES.md): a custom role holding every permission still does not see it.
//
// It only reads. audit_log is append-only (drizzle/0071 aborts any UPDATE or DELETE), and nothing
// here, or anywhere else, offers a way to change an entry.
//
// Pages are keyed on id, not created_at: id is the insert order, unique, and the primary key, so
// "the 100 before this one" is a seek on the rowid with no ties to break, however many events
// landed in the same second.

const PAGE_SIZE = 100;

const clip = (value: string | null, max: number) => (value || "").trim().slice(0, max);
const isDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
// LIKE treats % and _ as wildcards; a search for "50%" means the text, not "50 then anything".
const likeText = (value: string) => `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;

export async function GET(request: Request) {
  const guard = await requireStaff(request, { allow: (user) => isAdminTier(user.role) });
  if (guard.response) return guard.response;
  const params = new URL(request.url).searchParams;

  const where: string[] = [];
  const bind: (string | number)[] = [];
  const actor = clip(params.get("actor"), 80);
  const action = clip(params.get("action"), 60);
  const target = clip(params.get("target"), 40);
  const from = clip(params.get("from"), 10);
  const to = clip(params.get("to"), 10);
  const q = clip(params.get("q"), 80);
  const before = Number(params.get("before"));
  if (actor) { where.push("a.actor_id=?"); bind.push(actor); }
  if (action) { where.push("a.action=?"); bind.push(action); }
  if (target) { where.push("a.target_type=?"); bind.push(target); }
  // Days are calendar days in UTC, which is how created_at is stored (CURRENT_TIMESTAMP). "To" is
  // inclusive: an event at 23:59 on the last day is in the range.
  if (from && isDay(from)) { where.push("a.created_at>=?"); bind.push(from); }
  if (to && isDay(to)) { where.push("a.created_at<date(?,'+1 day')"); bind.push(to); }
  if (Number.isSafeInteger(before) && before > 0) { where.push("a.id<?"); bind.push(before); }
  if (q) {
    const text = likeText(q);
    where.push(
      "(a.action LIKE ? ESCAPE '\\' OR a.target_type LIKE ? ESCAPE '\\' OR a.target_id LIKE ? ESCAPE '\\' OR a.reason LIKE ? ESCAPE '\\'" +
      " OR a.details LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')",
    );
    bind.push(text, text, text, text, text, text, text);
  }

  // One more than a page, so the response can say whether there is another without a COUNT over
  // the whole log. The deal join is a primary-key lookup per row, for the sentence and the link.
  const { results } = await env.DB.prepare(
    `SELECT a.id,a.actor_id,a.actor_role,a.action,a.target_type,a.target_id,a.reason,a.details,a.request_id,
            a.before_values,a.after_values,a.created_at,
            u.name actor_name,u.email actor_email,d.title deal_title,d.restaurant deal_restaurant
       FROM audit_log a
       LEFT JOIN users u ON u.id=a.actor_id
       LEFT JOIN deals d ON a.target_type='deal' AND d.id=a.target_id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY a.id DESC LIMIT ${PAGE_SIZE + 1}`,
  ).bind(...bind).all<Record<string, unknown> & { id: number }>();
  const events = results.slice(0, PAGE_SIZE);
  const nextCursor = results.length > PAGE_SIZE ? events[events.length - 1].id : null;

  // The filter menus, on the first page only: a "load more" does not need them again. Each is a
  // short distinct list; action and actor read their own indexes (idx_audit_action, idx_audit_actor).
  let facets: { actions: string[]; targetTypes: string[]; actors: { id: string; name: string | null; role: string | null }[] } | undefined;
  if (!(Number.isSafeInteger(before) && before > 0)) {
    const [actions, targetTypes, actors] = await Promise.all([
      env.DB.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action LIMIT 200").all<{ action: string }>(),
      env.DB.prepare("SELECT DISTINCT target_type FROM audit_log ORDER BY target_type LIMIT 100").all<{ target_type: string }>(),
      env.DB.prepare(
        `SELECT x.actor_id id,COALESCE(u.name,u.email) name,u.role role
           FROM (SELECT DISTINCT actor_id FROM audit_log LIMIT 300) x LEFT JOIN users u ON u.id=x.actor_id
          ORDER BY COALESCE(u.name,u.email,x.actor_id)`,
      ).all<{ id: string; name: string | null; role: string | null }>(),
    ]);
    facets = {
      actions: actions.results.map((row) => row.action),
      targetTypes: targetTypes.results.map((row) => row.target_type),
      actors: actors.results,
    };
  }

  return Response.json({ events, nextCursor, facets }, { headers: { "cache-control": "no-store" } });
}
