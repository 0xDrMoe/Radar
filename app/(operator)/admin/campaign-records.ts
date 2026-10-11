"use client";
import { useCallback, useEffect, useState } from "react";

// The campaign records (GET/POST /api/admin/campaigns), shared by the Campaigns tab and the
// Affiliates tab. An affiliate's labeled links are campaign rows with their handle on them, so
// both tabs read the same records from the same route rather than each keeping a copy.

export const CAMPAIGN_STATUSES = ["draft", "active", "paused", "ended"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const STATUS_LABEL: Record<string, string> = { draft: "Draft", active: "Active", paused: "Paused", ended: "Ended" };

export interface CampaignRecord {
  id: string;
  name: string;
  source: string;
  campaign: string | null;
  medium: string | null;
  landing_city: string | null;
  creator_handle: string | null;
  owner_id: string | null;
  owner_name: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  notes: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
  visits: number;
  visits30: number;
  first_seen: string | null;
  last_seen: string | null;
  /** Null for a utm link: a sign-up is only attributable to an affiliate's link. */
  signups: number | null;
}

export interface UntrackedTraffic {
  creator: string | null;
  source: string | null;
  campaign: string | null;
  visits: number;
  visits30: number;
  first_seen: string;
  last_seen: string;
}

export interface CampaignList {
  windowDays: number;
  truncated: boolean;
  canEdit: boolean;
  campaigns: CampaignRecord[];
  untracked: UntrackedTraffic[];
}

export interface CampaignDetail {
  windowDays: number;
  campaign: Omit<CampaignRecord, "visits" | "visits30" | "first_seen" | "last_seen" | "signups">;
  trend: { day: string; visits: number; signups: number }[];
  markets: { market: string | null; visits: number; last_seen: string }[];
  totals: { visits: number; signups: number | null };
}

/** What a failed request said, with the per-field messages the form shows beside each input. */
export class CampaignRequestError extends Error {
  constructor(message: string, readonly fields: Record<string, string> = {}, readonly status = 0) {
    super(message);
  }
}

async function readResponse<T>(response: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An HTML error page from the platform: the status line below is all there is to say.
  }
  if (!response.ok) {
    const error = (body as { error?: { message?: string; fields?: Record<string, string> } } | null)?.error;
    throw new CampaignRequestError(error?.message || `The request failed (${response.status}).`, error?.fields || {}, response.status);
  }
  return body as T;
}

type Loaded<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T };

function useLoaded<T>(url: string | null) {
  // Each answer remembers the address it came from, so switching to another campaign shows a
  // loading state rather than the previous campaign's figures under the new one's name.
  const [state, setState] = useState<{ url: string; loaded: Loaded<T> } | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!url) return;
    let current = true;
    fetch(url, { headers: { accept: "application/json" } })
      .then((response) => readResponse<T>(response))
      .then((data) => { if (current) setState({ url, loaded: { status: "ready", data } }); })
      .catch((cause) => { if (current) setState({ url, loaded: { status: "error", error: cause instanceof Error ? cause.message : "Could not load campaigns." } }); });
    return () => { current = false; };
  }, [url, version]);
  // A reload keeps what is on screen until the fresh answer arrives; only a first load spins.
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  const loaded: Loaded<T> = state && state.url === url ? state.loaded : { status: "loading" };
  return { state: loaded, reload };
}

export function useCampaignList(enabled = true) {
  return useLoaded<CampaignList>(enabled ? "/api/admin/campaigns" : null);
}

export function useCampaignDetail(id: string) {
  return useLoaded<CampaignDetail>(id ? `/api/admin/campaigns?id=${encodeURIComponent(id)}` : null);
}

export async function postCampaign(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return readResponse<{ ok: true; id: string }>(response);
}

/** The link a record stands for: an affiliate's ?c= link, or a utm link. */
export function campaignLink(
  record: Pick<CampaignRecord, "creator_handle" | "source" | "campaign" | "medium" | "landing_city">,
  origin = typeof window !== "undefined" ? window.location.origin : "https://radar.cheap",
) {
  const params = new URLSearchParams();
  if (record.creator_handle) {
    params.set("c", record.creator_handle);
    if (record.campaign) params.set("camp", record.campaign);
  } else {
    params.set("utm_source", record.source);
    if (record.campaign) params.set("utm_campaign", record.campaign);
    if (record.medium) params.set("utm_medium", record.medium);
  }
  if (record.landing_city) params.set("city", record.landing_city);
  return `${origin}/?${params.toString()}`;
}

/** "instagram · summer-patio", or "@maya · tiktok-1" for an affiliate's link. */
export function linkLabel(record: { creator_handle?: string | null; creator?: string | null; source: string | null; campaign: string | null }) {
  const handle = record.creator_handle ?? record.creator;
  if (handle) return `@${handle}${record.campaign ? ` · ${record.campaign}` : " · main link"}`;
  return `${record.source || "unknown source"}${record.campaign ? ` · ${record.campaign}` : ""}`;
}

export const shortDate = (value: string | null | undefined) => (value ? value.slice(0, 10) : "");
