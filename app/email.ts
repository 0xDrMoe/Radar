import { env } from "cloudflare:workers";
import { SUPPORT_PHONE } from "./business-contact";

function runtime() { return env as unknown as Record<string,string>; }
export function emailConfiguration() {
  const value = runtime();
  return {
    pilotEnabled:value.EMAIL_PILOT_ENABLED === "true",
    killSwitch:value.EMAIL_KILL_SWITCH !== "false",
    providerConfigured:Boolean(value.RESEND_API_KEY && value.RESEND_FROM_EMAIL),
    token:value.RESEND_API_KEY,
    from:value.RESEND_FROM_EMAIL,
    allowlist:new Set((value.EMAIL_PILOT_ALLOWLIST || "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean)),
    // Every message we send carries a signed link — a consent confirmation or an unsubscribe.
    // Without this secret signEmailAction returns an empty token, so those links are dead on
    // arrival: confirmations can never complete and a digest would go out with an unsubscribe
    // link that does nothing. Treated as a hard requirement rather than an optional extra.
    signingConfigured:Boolean(value.EMAIL_UNSUBSCRIBE_SECRET),
  };
}

// Itemised readiness, so the admin workspace can name the missing piece instead of just
// reporting that delivery is off.
export function pilotReadiness() {
  const config = emailConfiguration();
  return {
    pilotEnabled:config.pilotEnabled,
    killSwitchClear:!config.killSwitch,
    providerConfigured:config.providerConfigured,
    signingConfigured:config.signingConfigured,
  };
}
// The global safety rails: the pilot has to be on, the kill switch off, a provider configured,
// and link signing available. Nothing below can bypass these.
export function pilotGatesOpen() {
  const config = emailConfiguration();
  return config.pilotEnabled && !config.killSwitch && config.providerConfigured && config.signingConfigured;
}

// Who counts as inside the controlled pilot. Two ways in: the static env allowlist (how the
// pilot was bootstrapped) or staff having accepted this person off the waitlist, which is
// recorded by moving their consent row out of 'waitlisted'. Only an admin action makes that
// move, so a visitor cannot promote themselves — request_email_consent can only ever write
// 'waitlisted' for someone who is not already admitted.
export async function admittedToPilot(email:string) {
  if (emailConfiguration().allowlist.has(email.toLowerCase())) return true;
  const admitted = await env.DB.prepare(
    "SELECT 1 ok FROM email_consents WHERE lower(email)=? AND status IN ('pending','confirmed') LIMIT 1",
  ).bind(email.toLowerCase()).first();
  return Boolean(admitted);
}

export async function canDeliverTo(email:string) {
  return pilotGatesOpen() && (await admittedToPilot(email));
}

// Which list a message belongs to, and therefore which consent lets it be sent.
//
// This exists because the two are genuinely different permissions and collapsing them would be a
// CASL problem, not a tidiness one. Someone in the pilot consented to deal mail. Someone who typed
// their address into the "tell me when the app is out" box consented to exactly one message about
// exactly that, and to nothing else — they have no account, no preferences, and never agreed to a
// weekly roundup.
//
// So `admittedToPilot` is deliberately NOT widened to include leads, which would have been the one
// small edit that made the launch send work. It would also have made every future sendEmail call
// treat a waitlist address as a consenting subscriber, and the only thing standing between that
// and a digest landing in their inbox would be the shape of a SELECT in another file.
export type EmailAudience = "pilot" | "app-waitlist" | "transactional";

/** Waitlist sources. Homepage leads asked about nearby deals, which is not this. */
export const WAITLIST_SOURCES = ["ios-waitlist"];

/**
 * Whether this address asked to be told when the app ships, confirmed it, and has not since opted out.
 *
 * Suppression is checked here rather than trusted to the caller's query. The job that sends the
 * launch mail excludes suppressed addresses in SQL too, and that belt-and-braces is on purpose:
 * this is the last line before a message actually leaves, and an unsubscribe that a later refactor
 * routes around stops being an unsubscribe.
 */
export async function admittedToWaitlist(email:string) {
  const row = await env.DB.prepare(
    `SELECT 1 ok FROM email_leads l
      WHERE lower(l.email)=? AND l.source IN (${WAITLIST_SOURCES.map(() => "?").join(",")})
        AND l.confirmed_at IS NOT NULL
        AND NOT EXISTS(SELECT 1 FROM email_suppressions s WHERE lower(s.email)=lower(l.email))
      LIMIT 1`,
  ).bind(email.toLowerCase(),...WAITLIST_SOURCES).first();
  return Boolean(row);
}

async function admittedFor(email:string,audience:EmailAudience) {
  // A transactional message is the reply to something this person just did on this address —
  // "your creator application was approved". It is a third permission again, and it is the one
  // case where there is no list to be on: consent is the act itself, and withholding the reply
  // would not be caution, it would be leaving someone waiting for an answer that never comes.
  // The global rails in pilotGatesOpen() still apply, so the kill switch still stops everything.
  if (audience === "transactional") return true;
  return audience === "app-waitlist" ? admittedToWaitlist(email) : admittedToPilot(email);
}

// A lead has no users row, so it has no user id to sign an unsubscribe token with. Its own id is
// used instead, behind a prefix the unsubscribe route branches on — rather than letting the route
// infer "no matching user, must be a lead", which would turn any future bug that loses a user row
// into a silent change of which table gets written.
export const LEAD_TOKEN_PREFIX = "lead:";
export const signLeadUnsubscribe = (leadId:string,email:string) => signUnsubscribe(`${LEAD_TOKEN_PREFIX}${leadId}`,email);
export async function signEmailAction(purpose:string,userId:string,email:string) {
  const secret = runtime().EMAIL_UNSUBSCRIBE_SECRET;
  if (!secret) return "";
  const payload = `${purpose}.${userId}.${email.toLowerCase()}`;
  const key = await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  const signature = await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(payload));
  const bytes = new Uint8Array(signature); const encoded = btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
  return `${encodeURIComponent(userId)}.${encoded}`;
}
export async function verifyEmailAction(purpose:string,token:string,email:string) {
  const dot = token.lastIndexOf("."); if (dot < 1) return null;
  const userId = decodeURIComponent(token.slice(0,dot)),expected = await signEmailAction(purpose,userId,email);
  if (!expected || expected.length !== token.length) return null;
  let mismatch = 0; for (let index=0;index<expected.length;index++) mismatch |= expected.charCodeAt(index) ^ token.charCodeAt(index);
  return mismatch === 0 ? userId : null;
}
export const signUnsubscribe = (userId:string,email:string) => signEmailAction("unsubscribe",userId,email);
// Its own purpose, so a confirmation link can never be replayed as an unsubscribe or the reverse.
export const signLeadConfirmation = (leadId:string,email:string) => signEmailAction("lead-confirm",`${LEAD_TOKEN_PREFIX}${leadId}`,email);
/** The lead id a confirmation token was signed for, or null. */
export async function verifyLeadConfirmation(token:string,email:string) {
  const subject = await verifyEmailAction("lead-confirm",token,email);
  return subject?.startsWith(LEAD_TOKEN_PREFIX) ? subject.slice(LEAD_TOKEN_PREFIX.length) : null;
}
export const verifyUnsubscribe = (token:string,email:string) => verifyEmailAction("unsubscribe",token,email);
function sanitizeTag(value:string) { return value.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,256); }
/**
 * The RFC 8058 one-click address for an unsubscribe page link: the same signed email and token,
 * posted straight to /api/email/unsubscribe by the mailbox provider's own "Unsubscribe" button.
 * Gmail, Yahoo and Outlook require it of bulk senders and show their button only when it is there.
 */
export function oneClickUnsubscribeUrl(unsubscribePageUrl:string) {
  const url = new URL(unsubscribePageUrl);
  url.pathname = "/api/email/unsubscribe";
  return url.toString();
}

/** List-Unsubscribe and List-Unsubscribe-Post, for a message that carries an unsubscribe link. */
export function listUnsubscribeHeaders(unsubscribePageUrl:string): Record<string,string> {
  return {
    "List-Unsubscribe":`<${oneClickUnsubscribeUrl(unsubscribePageUrl)}>`,
    "List-Unsubscribe-Post":"List-Unsubscribe=One-Click",
  };
}

export async function sendEmail(input:{to:string;subject:string;html:string;text:string;tag?:string;metadata?:Record<string,string>;audience?:EmailAudience;
  /** The message's own unsubscribe page link, for marketing mail. Adds the one-click headers. */
  unsubscribeUrl?:string}) {
  const config = emailConfiguration();
  // The global rails still apply to every audience — pilot on, kill switch off, provider and
  // signing configured. Only the per-recipient question changes, and it defaults to the pilot
  // check so no existing caller is quietly moved onto a looser one.
  if (!pilotGatesOpen() || !(await admittedFor(input.to,input.audience || "pilot"))) throw new Error("EMAIL_DELIVERY_BLOCKED");
  const tags = [
    ...(input.tag ? [{name:"category",value:sanitizeTag(input.tag)}] : []),
    ...Object.entries(input.metadata || {}).map(([key,value]) => ({name:sanitizeTag(key),value:sanitizeTag(value)})),
  ];
  const response = await fetch("https://api.resend.com/emails",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${config.token}`},body:JSON.stringify({from:config.from,to:input.to,subject:input.subject,html:input.html,text:input.text,tags,...(input.unsubscribeUrl ? {headers:listUnsubscribeHeaders(input.unsubscribeUrl)} : {})})});
  const result = await response.json() as {id?:string;name?:string};
  if (!response.ok || !result.id) throw new Error(`RESEND_${result.name || response.status}`);
  return result as {id:string};
}
// Who sent a marketing message, or a request to send them, and how to reach them, at the foot of
// every one: CASL s.6(2) and s.10(1), and CAN-SPAM. The postal address joins this line once there is one to publish.
export const SENDER_LINE = `Radar by Cedar Tech Solutions · support@cedartechsolutions.ca · ${SUPPORT_PHONE.display}`;

export function escapeHtml(value:string) { return String(value).replace(/[&<>"']/g,(character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"})[character]!); }

// Rotating pastel backgrounds for deal cards — the same six tones the site's own deal grid
// cycles through (see .peach/.yellow/.mint/.blue/.lilac/.rose in globals.css), so a digest email
// reads as an extension of the app rather than a generic templated blast.
const DEAL_CARD_COLORS = ["#f5c8aa","#efcf63","#a8d8bd","#a8cbd7","#c9b7d9","#e5a7a2"];

interface DigestEmailDeal {
  restaurant: string;
  title: string;
  price: string;
  schedule: string;
  emoji: string | null;
  category: string | null;
  url: string;
}

// Fixed, clearly-fictional deals for the "send test email" preview — never real scraped listings.
// Real deal data isn't a legitimate thing to hand out on demand: it would let anyone with an
// account repeatedly harvest the current live board (or just cost real Resend sends) by mashing
// a test button, which a rate limit alone doesn't fully close since a determined caller can still
// wait it out. The deal content itself carries no information worth harvesting once it's fixed.
export const SAMPLE_DIGEST_DEALS: DigestEmailDeal[] = [
  { restaurant:"The Corner Bistro", title:"Happy hour (sample)", price:"$8 house wine · $6 draft", schedule:"Mon–Fri 4–6 PM", emoji:"🍷", category:"Sample", url:"#" },
  { restaurant:"Sample Street Tacos", title:"Taco Tuesday (sample)", price:"$2 tacos", schedule:"Tue all day", emoji:"🌮", category:"Sample", url:"#" },
  { restaurant:"Test Kitchen Diner", title:"Weekday lunch special (sample)", price:"$12 lunch combo", schedule:"Mon–Fri 11 AM–2 PM", emoji:"🍔", category:"Sample", url:"#" },
];

// Builds the branded HTML/text pair for the recurring deal-roundup digest. Table-based layout
// with every style inlined (email clients — Outlook chief among them — strip <style> blocks and
// ignore flexbox/grid), a light-only palette pulled straight from globals.css's :root tokens
// (email dark-mode support is too inconsistent to design around), and Google Fonts loaded via a
// plain <link> as a progressive enhancement — clients that honor it get the real brand type,
// everything else falls back to the declared Arial/Helvetica stack cleanly.
export function buildDigestEmail(input:{recipientName:string | null;city:string | null;deals:DigestEmailDeal[];unsubscribeUrl:string;preferencesUrl:string;origin:string}) {
  const { recipientName, city, deals, unsubscribeUrl, preferencesUrl } = input;
  const greetingName = recipientName?.trim() ? escapeHtml(recipientName.trim().split(" ")[0]) : "there";
  const locationLabel = city?.trim() ? escapeHtml(city.trim()) : "your area";
  const todayLabel = new Intl.DateTimeFormat("en-CA",{month:"short",day:"numeric"}).format(new Date());

  const cards = deals.map((deal,index) => {
    const bg = DEAL_CARD_COLORS[index % DEAL_CARD_COLORS.length];
    const emoji = escapeHtml(deal.emoji?.trim() || "🍽️");
    const category = deal.category?.trim() ? escapeHtml(deal.category.trim().toUpperCase()) : "DEAL";
    return `
    <tr><td style="padding:0 0 14px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border-radius:16px">
        <tr>
          <td style="padding:20px 22px 18px">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="font-family:Karla,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:1.2px;color:#3a3226;text-transform:uppercase;vertical-align:top">${category}</td>
                <td align="right" style="font-size:26px;line-height:1;vertical-align:top" width="40">${emoji}</td>
              </tr>
            </table>
            <div style="font-family:Karla,Arial,sans-serif;font-size:11px;font-weight:800;letter-spacing:1px;color:#5c5344;text-transform:uppercase;margin-top:10px">${escapeHtml(deal.restaurant)}</div>
            <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:24px;font-weight:700;color:#17261e;line-height:1.15;margin-top:2px">${escapeHtml(deal.title)}</div>
            <div style="font-family:Karla,Arial,sans-serif;font-size:14px;color:#3a3226;margin-top:8px;line-height:1.5">${escapeHtml(deal.price)}</div>
            <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#5c5344;margin-top:4px">${escapeHtml(deal.schedule)}</div>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:14px">
              <tr><td style="background:#17261e;border-radius:999px">
                <a href="${escapeHtml(deal.url)}" style="display:inline-block;padding:11px 20px;font-family:Karla,Arial,sans-serif;font-size:13px;font-weight:800;color:#ffffff;text-decoration:none">View deal →</a>
              </td></tr>
            </table>
          </td>
        </tr>
      </table>
    </td></tr>`;
  }).join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>Your Radar deal roundup</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700;800&family=Big+Shoulders+Display:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${deals.length} fresh ${deals.length === 1 ? "deal" : "deals"} near ${locationLabel} — ${deals.slice(0,2).map((d) => escapeHtml(d.restaurant)).join(", ")}${deals.length > 2 ? " and more" : ""}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:0 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">

  <tr><td style="background:#e95f3b;border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <span style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-1px">Radar<span style="opacity:.75">.</span></span>
    <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#ffe4d9;margin-top:6px">Your weekly deal roundup · ${todayLabel}</div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:30px 32px 8px">
    <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#17261e;letter-spacing:-.5px">Hey ${greetingName} 👋</div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.55;margin:6px 0 20px">Here's what's on your radar this week near ${locationLabel}.</div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:8px 32px 4px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cards}</table>
  </td></tr>

  <tr><td style="background:#ffffff;padding:6px 32px 32px">
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr><td style="border:1px solid #e95f3b;border-radius:999px">
        <a href="${input.origin}/en" style="display:inline-block;padding:12px 24px;font-family:Karla,Arial,sans-serif;font-size:13px;font-weight:800;color:#e95f3b;text-decoration:none">See all deals on Radar →</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#17261e;border-radius:0 0 20px 20px;padding:26px 32px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:12px;color:#a9b3ac;line-height:1.7;text-align:center">
      You're getting this because you subscribed to Radar deal alerts for ${locationLabel}.<br>
      <a href="${preferencesUrl}" style="color:#ffd7c8;text-decoration:underline">Manage preferences</a>
      &nbsp;·&nbsp;
      <a href="${unsubscribeUrl}" style="color:#ffd7c8;text-decoration:underline">Unsubscribe</a><br>
      ${escapeHtml(SENDER_LINE)}
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    `Radar — your weekly deal roundup near ${city?.trim() || "your area"}`,
    "",
    ...deals.map((deal) => `${deal.restaurant} — ${deal.title}\n${deal.schedule} · ${deal.price}\n${deal.url}`),
    "",
    `Manage preferences: ${preferencesUrl}`,
    `Unsubscribe: ${unsubscribeUrl}`,
    SENDER_LINE,
  ].join("\n\n");

  return { html, text };
}

/**
 * The launch announcement — the one message a waitlist signup consented to.
 *
 * Written as the single email it is rather than as the first of a series: no preferences link,
 * because there are no preferences to manage, and nothing that implies more mail is coming. What
 * it does say plainly is why the person is receiving it and how to stop, which is what makes it a
 * compliant commercial message rather than a hopeful one.
 *
 * The App Store URL is a required argument with no default. There is no sensible fallback for it —
 * a launch email whose only button 404s is worse than no launch email — so the type makes it
 * impossible to build this without one, and the job refuses to run until it is configured.
 */
export function buildLaunchEmail(input:{appStoreUrl:string;unsubscribeUrl:string;origin:string}) {
  const { appStoreUrl, unsubscribeUrl, origin } = input;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>Radar is on the App Store</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700;800&family=Big+Shoulders+Display:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">You asked us to tell you when Radar hit the App Store. It has.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:0 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">

  <tr><td style="background:#e95f3b;border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <span style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-1px">Radar<span style="opacity:.75">.</span></span>
    <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#ffe4d9;margin-top:6px">It's here</div>
  </td></tr>

  <tr><td style="background:#ffffff;padding:34px 32px 8px">
    <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:34px;font-weight:700;color:#17261e;letter-spacing:-.5px;line-height:1.1">Radar is on the App&nbsp;Store.</div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 4px">
      You asked us to let you know when the iPhone app was ready. It is.
    </div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:0 0 22px">
      The map only pins deals that are running at that moment, so you're never walking to a happy
      hour that ended at six. Set an area and it tells you when something new lands in it.
    </div>
    <table role="presentation" cellpadding="0" cellspacing="0">
      <tr><td style="background:#17261e;border-radius:999px">
        <a href="${appStoreUrl}" style="display:inline-block;padding:14px 26px;font-family:Karla,Arial,sans-serif;font-size:14px;font-weight:800;color:#ffffff;text-decoration:none">Get Radar for iPhone →</a>
      </td></tr>
    </table>
  </td></tr>

  <tr><td style="background:#ffffff;padding:22px 32px 32px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#5d675f;line-height:1.6">
      No account needed to browse — <a href="${origin}/en" style="color:#e95f3b;text-decoration:underline">radar.cheap</a> still works the same.
    </div>
  </td></tr>

  <tr><td style="background:#17261e;border-radius:0 0 20px 20px;padding:26px 32px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:12px;color:#a9b3ac;line-height:1.7;text-align:center">
      You're getting this one message because you asked to be told when the Radar app launched.<br>
      We won't email you again unless you ask us to.<br>
      <a href="${unsubscribeUrl}" style="color:#ffd7c8;text-decoration:underline">Unsubscribe</a><br>
      ${escapeHtml(SENDER_LINE)}
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    "Radar is on the App Store.",
    "",
    "You asked us to let you know when the iPhone app was ready. It is.",
    "",
    "The map only pins deals that are running at that moment, so you're never walking to a happy hour that ended at six. Set an area and it tells you when something new lands in it.",
    "",
    `Get Radar for iPhone: ${appStoreUrl}`,
    "",
    `No account needed to browse — ${origin}/en still works the same.`,
    "",
    "You're getting this one message because you asked to be told when the Radar app launched. We won't email you again unless you ask us to.",
    `Unsubscribe: ${unsubscribeUrl}`,
    SENDER_LINE,
  ].join("\n");

  return { html, text };
}

export function localParts(date:Date,timezone:string) {
  const parts = new Intl.DateTimeFormat("en-CA",{timeZone:timezone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type,part.value]));
  const weekdays:Record<string,number> = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
  return {day:weekdays[value.weekday],time:`${value.hour}:${value.minute}`};
}

/**
 * The reply to a creator application, approved or not.
 *
 * One builder for both outcomes rather than two, because the difference between them is three
 * sentences and a button — splitting it would mean two templates drifting apart on everything
 * that is actually the same. A rejection still gets the Radar shell and a real reason: the worst
 * version of this email is a silent one, and the second worst is one that reads as automated
 * when someone has just been turned down.
 */
export function buildCreatorDecisionEmail(input:{approved:boolean;handle:string;link:string;ratePercent:string;reason:string | null;workspaceUrl:string}) {
  const { approved, handle, link, ratePercent, reason, workspaceUrl } = input;
  const title = approved ? "You're in" : "About your Radar application";
  const preheader = approved
    ? `Your creator link is live: ${link}`
    : "We could not approve this one, and here is why.";
  const body = approved
    ? `<div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 18px">
         You're set up as <strong style="color:#17261e">${escapeHtml(handle)}</strong>. Anyone who opens this link is
         attributed to you for 30 days, and you earn <strong style="color:#17261e">${escapeHtml(ratePercent)}%</strong>
         of every Radar Pro payment from anyone who subscribes through it, for as long as they stay subscribed.
       </div>
       <div style="font-family:Karla,Arial,sans-serif;font-size:14px;color:#17261e;background:#f7f3e9;border-radius:12px;padding:14px 16px;word-break:break-all;margin:0 0 18px">
         ${escapeHtml(link)}
       </div>
       <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:0 0 22px">
         Your workspace shows visits, sign-ups and what you've earned — the same numbers we see. You can also
         build a separate link per video there, so you can tell which one actually worked.
       </div>`
    : `<div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 22px">
         ${escapeHtml(reason || "We're not able to take this one on right now. If you think that's a mistake, just reply to this email.")}
       </div>`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700;800&family=Big+Shoulders+Display:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:0 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="background:#e95f3b;border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <span style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-1px">Radar<span style="opacity:.75">.</span></span>
    <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#ffe4d9;margin-top:6px">Creators</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 32px 8px">
    <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:34px;font-weight:700;color:#17261e;letter-spacing:-.5px;line-height:1.1">${escapeHtml(title)}.</div>
    ${body}
    ${approved ? `<a href="${escapeHtml(workspaceUrl)}" style="display:inline-block;background:#e95f3b;color:#ffffff;font-family:Karla,Arial,sans-serif;font-size:15px;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-bottom:26px">Open your workspace</a>` : ""}
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:0 32px 28px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:12px;color:#8a938c;line-height:1.6;border-top:1px solid #ece6d8;padding-top:16px">
      You're getting this because you applied to the Radar creator program. Just reply if you have questions.
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = approved
    ? `${title}.\n\nYou're set up as ${handle}. Your link:\n${link}\n\nYou earn ${ratePercent}% of every Radar Pro payment from anyone who subscribes through it, for as long as they stay subscribed.\n\nYour workspace: ${workspaceUrl}\n\nYou're getting this because you applied to the Radar creator program.`
    : `${title}.\n\n${reason || "We're not able to take this one on right now. If you think that's a mistake, just reply to this email."}\n\nYou're getting this because you applied to the Radar creator program.`;
  return { subject: approved ? "You're in — your Radar creator link is live" : "About your Radar creator application", html, text };
}

/**
 * "Your card was declined", sent the first time a renewal fails.
 *
 * Transactional: it is about money the recipient owes on a subscription they chose, so it does not
 * go through the pilot consent gate. Somebody who has opted out of everything still needs to be
 * told their payment failed.
 *
 * The tone matters more here than in most templates. The recipient has not done anything wrong -
 * cards expire - and they have not lost anything yet, which is the first thing the mail says. A
 * dunning email that leads with a threat gets a cancellation instead of a new card.
 */
export function buildPaymentFailedEmail(input:{recipientName:string | null;graceDays:number;billingUrl:string;amount:string | null}) {
  const { recipientName, graceDays, billingUrl, amount } = input;
  const greeting = recipientName ? `${recipientName}, your` : "Your";
  const title = "Your card was declined";
  const preheader = `Radar Pro is still on. Update your card within ${graceDays} days to keep it.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700;800&family=Big+Shoulders+Display:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:0 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="background:#e95f3b;border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <span style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-1px">Radar<span style="opacity:.75">.</span></span>
    <div style="font-family:Karla,Arial,sans-serif;font-size:13px;color:#ffe4d9;margin-top:6px">Billing</div>
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 32px 8px">
    <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:34px;font-weight:700;color:#17261e;letter-spacing:-.5px;line-height:1.1">${escapeHtml(title)}.</div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 18px">
      ${escapeHtml(greeting)} last Radar Pro payment${amount ? ` of <strong style="color:#17261e">${escapeHtml(amount)}</strong>` : ""} did not go through.
      This happens most often because a card expired or a bank held the charge.
    </div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#17261e;background:#f7f3e9;border-radius:12px;padding:16px 18px;line-height:1.6;margin:0 0 20px">
      <strong>Nothing has been switched off.</strong> Pro stays on while we retry, for up to ${escapeHtml(String(graceDays))} days.
      Updating your card is usually all it takes.
    </div>
    <a href="${escapeHtml(billingUrl)}" style="display:inline-block;background:#e95f3b;color:#ffffff;font-family:Karla,Arial,sans-serif;font-size:15px;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-bottom:26px">Update your card</a>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:0 32px 28px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:12px;color:#8a938c;line-height:1.6;border-top:1px solid #ece6d8;padding-top:16px">
      This is a billing notice for your Radar Pro subscription, so it is sent regardless of your email preferences.
      If you meant to cancel, you can do that from the same page and this will stop.
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    `${title}.`,
    "",
    `${greeting} last Radar Pro payment${amount ? ` of ${amount}` : ""} did not go through. This usually means a card expired or a bank held the charge.`,
    "",
    `Nothing has been switched off. Pro stays on while we retry, for up to ${graceDays} days.`,
    "",
    `Update your card: ${billingUrl}`,
    "",
    "This is a billing notice for your Radar Pro subscription, so it is sent regardless of your email preferences. If you meant to cancel, you can do that from the same page.",
  ].join("\n");
  return { subject: "Your Radar Pro payment did not go through", html, text };
}

/**
 * "Here is what changed since you left", sent once to somebody whose subscription lapsed.
 *
 * Marketing, not transactional: they are no longer a customer and nothing here is about money they
 * owe. It goes through the consent gate like any other campaign, which means most lapsed accounts
 * will never receive one - that is correct, and a win-back sent to somebody who opted out is worth
 * less than the complaint it earns.
 *
 * Leads with what is actually new rather than with an apology or a discount. The strongest reason to
 * come back to a deals catalog is that it has more deals in it than it did, and that is a fact
 * rather than a pitch. `newDeals` is counted since they left; when it is zero the mail is not sent
 * at all, because there would be nothing true to say.
 */
export function buildWinbackEmail(input:{recipientName:string | null;newDeals:number;city:string | null;proUrl:string;unsubscribeUrl:string}) {
  const { recipientName, newDeals, city, proUrl, unsubscribeUrl } = input;
  const greeting = recipientName ? `${recipientName}, there` : "There";
  const where = city ? ` in ${city}` : "";
  const title = "New since you left";
  const preheader = `${newDeals} deals${where} that were not there before.`;
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Karla:wght@400;700;800&family=Big+Shoulders+Display:wght@700;800&display=swap">
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:0 16px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px">
  <tr><td style="background:#e95f3b;border-radius:20px 20px 0 0;padding:28px 32px;text-align:center">
    <span style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:30px;font-weight:700;color:#ffffff;letter-spacing:-1px">Radar<span style="opacity:.75">.</span></span>
  </td></tr>
  <tr><td style="background:#ffffff;padding:34px 32px 8px">
    <div style="font-family:'Big Shoulders Display',Arial,sans-serif;font-size:34px;font-weight:700;color:#17261e;letter-spacing:-.5px;line-height:1.1">${escapeHtml(title)}.</div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 18px">
      ${escapeHtml(greeting)} are now <strong style="color:#17261e">${escapeHtml(String(newDeals))} deals${escapeHtml(where)}</strong>
      that were not on Radar when your subscription ended.
    </div>
    <div style="font-family:Karla,Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:0 0 22px">
      Your saved places and tracked areas are all still there. Nothing was deleted, so picking Pro back
      up puts everything exactly where you left it.
    </div>
    <a href="${escapeHtml(proUrl)}" style="display:inline-block;background:#e95f3b;color:#ffffff;font-family:Karla,Arial,sans-serif;font-size:15px;font-weight:800;text-decoration:none;padding:14px 26px;border-radius:999px;margin-bottom:26px">See what's new</a>
  </td></tr>
  <tr><td style="background:#ffffff;border-radius:0 0 20px 20px;padding:0 32px 28px">
    <div style="font-family:Karla,Arial,sans-serif;font-size:12px;color:#8a938c;line-height:1.6;border-top:1px solid #ece6d8;padding-top:16px">
      You are getting this once because you subscribed to Radar Pro in the past.
      <a href="${escapeHtml(unsubscribeUrl)}" style="color:#8a938c">Unsubscribe</a> and we will not write again.<br>
      ${escapeHtml(SENDER_LINE)}
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    `${title}.`,
    "",
    `${greeting} are now ${newDeals} deals${where} that were not on Radar when your subscription ended.`,
    "",
    "Your saved places and tracked areas are all still there. Nothing was deleted, so picking Pro back up puts everything exactly where you left it.",
    "",
    `See what's new: ${proUrl}`,
    "",
    `You are getting this once because you subscribed to Radar Pro in the past. Unsubscribe: ${unsubscribeUrl}`,
    "",
    SENDER_LINE,
  ].join("\n");
  return { subject: `${newDeals} new deals${where} since you left`, html, text };
}

/**
 * The one message a new lead gets before anything else: confirm the address is yours.
 *
 * The forms take an address from anyone, so without this a stranger's address could be put on a
 * list and mailed. Two wordings, because the two lists promise different things (see
 * WAITLIST_SOURCES): the app waitlist is one message on launch, the homepage list is news about
 * deals nearby. Nothing is sent to either until the link here is followed.
 */
export function buildLeadConfirmationEmail(input:{confirmUrl:string;source:string}) {
  const { confirmUrl, source } = input;
  const waitlist = WAITLIST_SOURCES.includes(source);
  const promise = waitlist
    ? "Confirm it's you and we'll send one email when the Radar iPhone app is on the App Store. Nothing else."
    : "Confirm it's you and we'll keep you posted about worthwhile deals near you. You can unsubscribe from any message.";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Confirm your email for Radar</title>
</head>
<body style="margin:0;padding:0;background:#f7f3e9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f3e9">
<tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:20px">
  <tr><td style="padding:32px">
    <div style="font-family:Arial,sans-serif;font-size:26px;font-weight:700;color:#17261e">Confirm your email</div>
    <div style="font-family:Arial,sans-serif;font-size:15px;color:#5d675f;line-height:1.6;margin:12px 0 22px">${promise}</div>
    <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#17261e;border-radius:999px">
      <a href="${confirmUrl}" style="display:inline-block;padding:14px 26px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none">Confirm my email</a>
    </td></tr></table>
    <div style="font-family:Arial,sans-serif;font-size:12px;color:#8a938c;line-height:1.6;margin-top:24px">
      If you didn't ask for this, ignore it: without the confirmation we won't email this address again.<br>
      ${escapeHtml(SENDER_LINE)}
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  const text = [
    "Confirm your email for Radar",
    "",
    promise,
    "",
    `Confirm: ${confirmUrl}`,
    "",
    "If you didn't ask for this, ignore it: without the confirmation we won't email this address again.",
    "",
    SENDER_LINE,
  ].join("\n");
  return { html, text };
}
