import { requireStaff } from "../../../admin-guard";
import { readableHandbook } from "../../../(operator)/admin/handbook";

// The staff handbook, served per reader.
//
// The handbook used to ship whole inside the workspace's JavaScript, so every account that could
// open /admin carried every article in its browser — the affiliate payout runbook included — and
// the page only chose the order. Articles are filed against a permission now, and this route is
// where that filing becomes a rule: it answers with the articles the signed-in person may read and
// nothing else. The handbook module is imported here and by the tests, never by a client
// component, so a restricted article's text is not in the bundle either.
//
// Any member of staff may ask (read_admin, checked by requireStaff): the role-less sections —
// orientation, the drink rules, troubleshooting — are everybody's. A read, so no audit row and no
// same-origin check. Pure in-memory work with no database read, so it costs nothing against the
// Worker's CPU budget.

export async function GET(request: Request) {
  const guard = await requireStaff(request);
  if (guard.response) return guard.response;
  const { user } = guard;
  return Response.json(readableHandbook({ role: user.role, permissions: user.permissions }), {
    // Different for every reader, and it changes the moment their permissions do, so nothing
    // between here and the browser may keep a copy.
    headers: { "cache-control": "private, no-store" },
  });
}
