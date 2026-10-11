"use client";
import { useEffect } from "react";

// Picks up a creator's tracked link (?c=<handle>, optionally &camp=<label>) on whatever page it
// lands on.
//
// Two things have to happen and they happen at very different times. The visit is recorded now,
// against the handle, so a creator can see traffic from people who never sign up — which is most
// of them. The sign-up is recorded whenever it eventually happens, which may be three pages and
// two days later, so the handle is parked in a cookie and read once by app/auth.ts at the moment
// an account is actually created. Nothing rewrites it afterwards: the first creator to bring
// someone here keeps the credit, and a later link cannot steal an account that already exists.
//
// The campaign is the same idea one level down. One creator has one handle, and posts many
// times; without a label every video is indistinguishable from every other, and "which one
// actually worked" is unanswerable. It travels beside the handle the whole way — recorded on the
// visit, parked in its own cookie, written onto the account, and copied onto the commission when
// that account pays — so the answer survives all the way to the payout.
//
// Deliberately last-touch-free and cookie-scoped rather than stored server-side against a device:
// this is attribution for a payout conversation, not identity, and it is worth nothing more than
// the reader's own browser is willing to remember.
export const CREATOR_COOKIE = "radar_creator";
export const CREATOR_CAMPAIGN_COOKIE = "radar_creator_campaign";
const HANDLE = /^[a-z0-9][a-z0-9-]{1,31}$/;
// Same alphabet as a handle but longer, because a label is written for a person to recognize in a
// list ("happy-hour-video"), not to be typed into a URL bar from memory.
export const CAMPAIGN = /^[a-z0-9][a-z0-9-]{1,47}$/;
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** The browser's Global Privacy Control signal (https://globalprivacycontrol.org). */
export function sendsGlobalPrivacyControl() {
  return (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

function setReferralCookies(handle: string, campaign: string, secure: string) {
  // Lax rather than Strict: the whole point is that the reader arrives from somewhere else.
  document.cookie = `${CREATOR_COOKIE}=${handle}; path=/; max-age=${THIRTY_DAYS}; samesite=lax${secure}`;
  // Cleared rather than left alone when the new link carries no label, so a campaign from an
  // older click cannot attach itself to a visit that was never part of it.
  document.cookie = campaign
    ? `${CREATOR_CAMPAIGN_COOKIE}=${campaign}; path=/; max-age=${THIRTY_DAYS}; samesite=lax${secure}`
    : `${CREATOR_CAMPAIGN_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

function clearReferralCookies(secure: string) {
  if (!document.cookie.includes(`${CREATOR_COOKIE}=`) && !document.cookie.includes(`${CREATOR_CAMPAIGN_COOKIE}=`)) return;
  document.cookie = `${CREATOR_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
  document.cookie = `${CREATOR_CAMPAIGN_COOKIE}=; path=/; max-age=0; samesite=lax${secure}`;
}

export default function CreatorLink() {
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    // A campaign link (?utm_source=) is recorded here as well, for the same reason the creator
    // link is: this mounts on every page. The home page used to be the only reader of it, so a
    // tagged link to a deal or a city guide - the pages a post actually points at, and where every
    // digest link lands - recorded nothing.
    const utmSource = params.get("utm_source");
    if (utmSource) {
      fetch("/api/track", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: utmSource,
          campaign: params.get("utm_campaign") || "",
          medium: params.get("utm_medium") || "",
          path: location.pathname,
          city: params.get("city") || "",
        }),
        keepalive: true,
      }).catch(() => {});
    }
    // Global Privacy Control is a legally binding opt-out in a dozen US states, and a creator's
    // commission is paid out of what these cookies later write onto an account. A browser that
    // sends it gets no referral cookies, and loses any it already had on whatever page it next
    // opens, so a sign-up from it is never attributed. The visit is still counted below: that count
    // names the creator, not the reader, the same kind of aggregate the page-view counter keeps.
    const secure = location.protocol === "https:" ? "; secure" : "";
    const optedOut = sendsGlobalPrivacyControl();
    if (optedOut) clearReferralCookies(secure);
    const handle = (params.get("c") || "").trim().toLowerCase();
    if (!handle || !HANDLE.test(handle)) return;
    // `utm_campaign` is accepted as well, because a creator pasting a link into a tool that
    // rewrites it into UTM parameters should not silently lose the label.
    const requested = (params.get("camp") || params.get("utm_campaign") || "").trim().toLowerCase();
    const campaign = CAMPAIGN.test(requested) ? requested : "";
    if (!optedOut) setReferralCookies(handle, campaign, secure);
    fetch("/api/track", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: "creator",
        // Unchanged when there is no label, so every visit recorded before campaigns existed
        // still reads the same way in the admin campaigns table.
        campaign: campaign || handle,
        medium: "link",
        creator: handle,
        creatorCampaign: campaign,
        path: location.pathname,
      }),
      keepalive: true,
    }).catch(() => {});
  }, []);
  return null;
}
