export const EXPIRY_GRACE_PERIOD_DAYS = 2;

export const publicDealPredicate =
  "d.active=1 AND d.status='live' AND d.deleted_at IS NULL AND (d.publish_at IS NULL OR datetime(d.publish_at)<=datetime('now'))";

/**
 * What a deal's own page is, as a SQL expression over `deals d`:
 *
 *   'public'  - the deal is public (publicDealPredicate). An ordinary page.
 *   'retired' - it was public and has ended or been pulled: archived, expired, or paused. The page
 *               stays, with its "no longer available" banner, so links already saved and shared
 *               keep working - but it is noindex and out of the sitemap.
 *   'hidden'  - anything else: a draft, a deal scheduled for later, a soft-deleted row. There is no
 *               page. It answers 404, the same answer /api/deals/[slug] gives, so the page cannot
 *               be used to find out which drafts exist any more than the API can.
 *
 * Built on publicDealPredicate rather than restating it, so the two cannot disagree about what is
 * public.
 */
export const dealPageVisibility =
  `CASE WHEN ${publicDealPredicate} THEN 'public' WHEN d.deleted_at IS NULL AND d.status IN ('archived','expired','paused') THEN 'retired' ELSE 'hidden' END`;

export const expireDealsStatement =
  `UPDATE deals SET status='expired',active=0,updated_at=CURRENT_TIMESTAMP WHERE status='live' AND expires_at IS NOT NULL AND datetime(expires_at)<=datetime('now','-${EXPIRY_GRACE_PERIOD_DAYS} days')`;
