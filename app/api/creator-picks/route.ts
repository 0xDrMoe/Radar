import { env } from "cloudflare:workers";
import { apiError } from "../../api-utils";
import { publicDealPredicate } from "../../deal-lifecycle";

// What a creator recommends, for anyone who followed their link.
//
// Public and unauthenticated on purpose: this is the reader's half of the picks feature, and the
// reader is by definition somebody who has not signed up yet. There is nothing here that is not
// already on a deal page — a handle, a display name, and a short list of live deals — so the
// route returns only what a byline would show anyway.
//
// Its own route rather than a branch of /api/deals. The deals endpoint is the search surface and
// carries facets, coverage, location resolution and a cursor; a rail of at most twelve editorial
// picks needs none of that, and putting it there would make every ordinary search pay for a join
// nobody asked for.

// Same shape the tracker accepts, deliberately. A handle that would never have been recorded as a
// visit should not resolve to a profile here either, and validating before the query keeps a
// pathological string out of an indexed lookup.
const HANDLE = /^[a-z0-9][a-z0-9-]{1,31}$/;

interface PickRow {
  deal_id: string;
  note: string | null;
  slug: string | null;
  emoji: string | null;
  restaurant: string;
  title: string;
  city: string;
  price: string;
}

export async function GET(request: Request) {
  const handle = (new URL(request.url).searchParams.get("c") || "").trim().toLowerCase();
  if (!HANDLE.test(handle)) return apiError(400, "INVALID_HANDLE", "Unknown creator.");

  // The profile is read first and separately because its `status` is the switch that takes a
  // creator's picks off the site. Pausing a profile has to hide the rail immediately, without
  // anyone having to delete rows a reinstated creator would then have to rebuild by hand.
  const profile = await env.DB.prepare(
    "SELECT handle,display_name FROM creator_profiles WHERE handle=? AND status='active'",
  ).bind(handle).first<{ handle: string; display_name: string | null }>();
  // A 404 rather than an empty list: "this creator does not exist" and "this creator has not
  // picked anything yet" are different answers, and the rail should only be absent for the first.
  if (!profile) return apiError(404, "CREATOR_NOT_FOUND", "Unknown creator.");

  const picks = await env.DB.prepare(
    `SELECT p.deal_id,p.note,d.slug,d.emoji,d.restaurant,d.title,d.city,d.price
       FROM creator_picks p
       JOIN deals d ON d.id=p.deal_id
      WHERE p.handle=? AND ${publicDealPredicate}
      ORDER BY p.position,p.created_at
      LIMIT 12`,
  ).bind(handle).all<PickRow>();

  return Response.json(
    {
      // The name a reader would recognize, falling back to the handle. Never the account's real
      // name: a creator chose what to be called here, and the display name is that choice.
      creator: { handle: profile.handle, name: profile.display_name || profile.handle },
      picks: (picks.results || []).map((row) => ({
        id: row.deal_id,
        slug: row.slug || row.deal_id,
        emoji: row.emoji || "\u{1F37D}\u{FE0F}",
        restaurant: row.restaurant,
        title: row.title,
        city: row.city,
        price: row.price,
        note: row.note,
      })),
    },
    // Longer than the deals endpoint's minute. A picks list is edited by hand a few times a
    // month, and the rail sits on the busiest page on the site.
    //
    // The refusals above carry no cache header, so pausing a creator starts returning 404 at
    // once. What lingers is a 200 already in somebody's own browser: for up to five minutes a
    // reader who loaded the rail before the pause still has it. The byline on the deal page is
    // server-rendered and goes immediately, which is the copy that matters - a rail in one
    // person's cache is a stale list of links, not a credit.
    { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } },
  );
}
