import { env } from "cloudflare:workers";
import { apiError, cleanText, clientKey, rateLimit, readJson, requireSameOrigin } from "../../api-utils";

interface TrackEventBody {
  source?: unknown;
  campaign?: unknown;
  medium?: unknown;
  path?: unknown;
  city?: unknown;
  creator?: unknown;
  creatorCampaign?: unknown;
}

export async function POST(request: Request) {
  if (!(await requireSameOrigin(request))) return apiError(403,"INVALID_ORIGIN","This request could not be verified.");
  if (!(await rateLimit(await clientKey("track"),20,60))) return apiError(429,"RATE_LIMITED","Too many events.");
  let body:TrackEventBody;
  try { body = await readJson<TrackEventBody>(request,4_000); } catch { return apiError(400,"INVALID_REQUEST","The event could not be read."); }
  const source = cleanText(body.source,40).toLowerCase();
  if (!source) return apiError(422,"SOURCE_REQUIRED","A source is required.");
  const campaign = cleanText(body.campaign,60).toLowerCase();
  const medium = cleanText(body.medium,40).toLowerCase();
  const path = cleanText(body.path,200) || "/";
  const market = cleanText(body.city,100) || null;
  // A creator handle is stored as its own property rather than folded into `campaign`, which is
  // free text anyone can send. The creator workspace reads this key and only this key, so a visit
  // can only be attributed to a handle that exists — see the join in app/api/creator/route.ts.
  const creatorHandle = cleanText(body.creator,32).toLowerCase();
  const creator = /^[a-z0-9][a-z0-9-]{1,31}$/.test(creatorHandle) ? creatorHandle : null;
  // Validated the same way the handle is, and kept as its own property rather than folded into
  // `campaign` — that field is free text from any caller, while this one is only ever read back
  // for a creator's own breakdown and has to be as trustworthy as the handle beside it.
  const campaignLabel = cleanText(body.creatorCampaign,48).toLowerCase();
  const creatorCampaign = creator && /^[a-z0-9][a-z0-9-]{1,47}$/.test(campaignLabel) ? campaignLabel : null;
  await env.DB.prepare("INSERT INTO product_events(id,type,market,properties) VALUES(?,?,?,?)")
    .bind(crypto.randomUUID(),"campaign_visit",market,JSON.stringify({source,campaign:campaign || null,medium:medium || null,path,creator,creatorCampaign})).run();
  return Response.json({ ok:true },{ status:201 });
}
