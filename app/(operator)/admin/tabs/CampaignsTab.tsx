"use client";
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Link2,
  Megaphone,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { DialogFocus } from "../../DialogFocus";
import { ListCount, ListToolbar, Pager, pageRows, selectRows } from "../../ListScope";
import {
  CAMPAIGN_STATUSES,
  CampaignRequestError,
  STATUS_LABEL,
  campaignLink,
  linkLabel,
  postCampaign,
  shortDate,
  useCampaignDetail,
  useCampaignList,
  type CampaignRecord,
} from "../campaign-records";
import { PanelHeader, StatePanel } from "../ui";
import { useListScope, useTabState, useWorkspace } from "../workspace";

// Tracked campaigns: every tagged link, who owns it, what it is for and what it brought in.
//
// The records and their figures come from /api/admin/campaigns, which matches each record to its
// campaign_visit events by the link itself. Reading is open to campaign, analytics and finance
// staff; the create, edit and status controls are drawn only for manage_campaigns, and the route
// refuses everyone else whatever the screen shows.

/** The form's values. Strings throughout, as inputs hold them; the route does the converting. */
type CampaignForm = {
  id?: string;
  name: string;
  source: string;
  campaign: string;
  medium: string;
  landingCity: string;
  creatorHandle: string;
  ownerId: string;
  status: string;
  startsAt: string;
  endsAt: string;
  notes: string;
};

const EMPTY_FORM: CampaignForm = {
  name: "", source: "", campaign: "", medium: "", landingCity: "", creatorHandle: "", ownerId: "", status: "active", startsAt: "", endsAt: "", notes: "",
};

const formFor = (record: CampaignRecord | CampaignFormSeed): CampaignForm => ({
  ...EMPTY_FORM,
  id: "id" in record ? record.id : undefined,
  name: record.name || "",
  source: record.source || "",
  campaign: record.campaign || "",
  medium: record.medium || "",
  landingCity: record.landing_city || "",
  creatorHandle: record.creator_handle || "",
  ownerId: ("owner_id" in record && record.owner_id) || "",
  status: ("status" in record && record.status) || "active",
  startsAt: ("starts_at" in record && record.starts_at) || "",
  endsAt: ("ends_at" in record && record.ends_at) || "",
  notes: ("notes" in record && record.notes) || "",
});

type CampaignFormSeed = Pick<CampaignRecord, "name" | "source" | "campaign" | "medium" | "landing_city" | "creator_handle">;

/** The rules the route enforces, checked as the form is filled so most mistakes never reach it. */
function formErrors(form: CampaignForm) {
  const errors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "Give the campaign a name.";
  else if (form.name.trim().length > 80) errors.name = "Keep the name to 80 characters.";
  if (!form.creatorHandle.trim()) {
    if (!form.source.trim()) errors.source = "A source is required, e.g. instagram or newsletter.";
    else if (!/^[a-z0-9][a-z0-9._-]{0,39}$/.test(form.source.trim().toLowerCase())) errors.source = "Lowercase letters, numbers, dots, dashes and underscores only.";
  }
  if (form.startsAt && form.endsAt && form.endsAt < form.startsAt) errors.endsAt = "The end date cannot be before the start date.";
  return errors;
}

export default function CampaignsTab() {
  const { data, canManageCampaigns, canManageFinance, openTab, setNotice } = useWorkspace();
  const { listQueryFor, setListQueryFor, pageFor, setPageFor } = useListScope();
  const { state: list, reload } = useCampaignList();
  const [selectedId, setSelectedId] = useTabState("campaigns.selected", "");
  const [statusFilter, setStatusFilter] = useTabState("campaigns.status", "");
  const [form, setForm] = useState<CampaignForm | null>(null);
  const [formFieldErrors, setFormFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  // Link builder state, kept as it was so a half-typed link survives a look at another tab.
  const [campaignSource, setCampaignSource] = useTabState("campaigns.source", ""),
    [campaignName, setCampaignName] = useTabState("campaigns.name", ""),
    [campaignMedium, setCampaignMedium] = useTabState("campaigns.medium", ""),
    [campaignCity, setCampaignCity] = useTabState("campaigns.city", ""),
    [copied, setCopied] = useState("");

  // A deep link (/admin/campaigns?campaign=<id>) opens that campaign, which is how the Affiliates
  // tab points at one of an affiliate's links.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("campaign");
    if (wanted) setSelectedId(wanted.slice(0, 80));
  }, [setSelectedId]);

  const builderRecord = {
    creator_handle: null,
    source: campaignSource.trim().toLowerCase(),
    campaign: campaignName.trim().toLowerCase() || null,
    medium: campaignMedium.trim().toLowerCase() || null,
    landing_city: campaignCity.trim() || null,
  };
  const builderLink = builderRecord.source ? campaignLink(builderRecord) : "";
  const records = list.status === "ready" ? list.data.campaigns : [];
  const builderTracked = builderRecord.source
    ? records.find((row) => !row.creator_handle && row.source === builderRecord.source && (row.campaign || "") === (builderRecord.campaign || ""))
    : undefined;

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      window.setTimeout(() => setCopied(""), 2000);
    } catch { setNotice("Couldn't copy — select and copy the link manually."); }
  }

  function openForm(seed: CampaignForm) {
    setFormFieldErrors({});
    setFormError("");
    setForm(seed);
  }

  async function save() {
    if (!form) return;
    const local = formErrors(form);
    setFormFieldErrors(local);
    if (Object.keys(local).length) return;
    setSaving(true);
    setFormError("");
    try {
      const result = await postCampaign({ op: form.id ? "update" : "create", ...form });
      setNotice(form.id ? `Saved “${form.name.trim()}”.` : `Now tracking “${form.name.trim()}”.`);
      setForm(null);
      setSelectedId(result.id);
      reload();
    } catch (cause) {
      if (cause instanceof CampaignRequestError) {
        setFormFieldErrors(cause.fields);
        setFormError(cause.message);
      } else setFormError("The campaign could not be saved. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const filtered = records.filter((row) => !statusFilter || row.status === statusFilter);
  const selection = selectRows(
    filtered,
    (row) => `${row.name} ${row.source} ${row.campaign || ""} ${row.creator_handle || ""} ${row.owner_name || ""} ${row.landing_city || ""}`,
    { query: listQueryFor("campaigns"), filtered: Boolean(statusFilter), showAll: true },
  );
  const campaignReset = `${listQueryFor("campaigns")}|${statusFilter}`;
  const campaignPage = pageRows(selection.matched, pageFor("campaigns", campaignReset));
  const untracked = list.status === "ready" ? list.data.untracked : [];
  const windowDays = list.status === "ready" ? list.data.windowDays : 180;
  const untrackedPage = pageRows(untracked, pageFor("campaigns.untracked"));
  const visitPage = pageRows(data.campaignVisits || [], pageFor("campaigns.visits"));

  if (selectedId)
    return (
      <>
        <CampaignDetailView
          id={selectedId}
          onBack={() => setSelectedId("")}
          canEdit={canManageCampaigns}
          canSeeAffiliates={canManageFinance}
          onEdit={(record) => openForm(formFor(record))}
          onChanged={reload}
          onOpenAffiliate={(handle) => openTab("affiliates", `?affiliate=${encodeURIComponent(handle)}`)}
          copy={copy}
          copied={copied}
        />
        {form && <CampaignFormDialog form={form} setForm={setForm} errors={formFieldErrors} error={formError} saving={saving} onSave={save} staff={data.staffDirectory || []} />}
      </>
    );

  return (
    <>
      <section className="portal-card">
        <PanelHeader title="Build a tagged link">
          Tag a link before you share it, so every visit through it is counted here. Track it to give it an owner, dates and notes.
        </PanelHeader>
        <div className="campaign-builder">
          <label>Source<input value={campaignSource} onChange={(e) => setCampaignSource(e.target.value)} placeholder="instagram, newsletter, partner-x" maxLength={40}/></label>
          <label>Campaign<input value={campaignName} onChange={(e) => setCampaignName(e.target.value)} placeholder="summer-patio (optional)" maxLength={60}/></label>
          <label>Medium<input value={campaignMedium} onChange={(e) => setCampaignMedium(e.target.value)} placeholder="social, email (optional)" maxLength={40}/></label>
          <label>City to land on<input value={campaignCity} onChange={(e) => setCampaignCity(e.target.value)} placeholder="Toronto (optional)" maxLength={100}/></label>
          <div className="campaign-link-out">
            <Link2 aria-hidden="true" />
            <span>{builderLink || "Enter a source to generate a link"}</span>
            <button type="button" className="primary" disabled={!builderLink} onClick={() => copy(builderLink, "builder")}>
              {copied === "builder" ? <><Check/> Copied</> : <><Copy/> Copy link</>}
            </button>
          </div>
        </div>
        {builderLink && (
          <div className="sw-camp-track-row">
            {builderTracked ? (
              <>
                <span>This link is tracked as <b>{builderTracked.name}</b>.</span>
                <button type="button" className="sw-link" onClick={() => setSelectedId(builderTracked.id)}>Open campaign</button>
              </>
            ) : canManageCampaigns ? (
              <>
                <span>Not tracked yet: its visits will show under untracked traffic.</span>
                <button
                  type="button"
                  onClick={() => openForm(formFor({ name: builderRecord.campaign || builderRecord.source, ...builderRecord }))}
                >
                  <Plus aria-hidden="true" /> Track this link
                </button>
              </>
            ) : (
              <span>Not tracked yet. Someone with campaign access can give it an owner and dates.</span>
            )}
          </div>
        )}
      </section>

      <section className="portal-card">
        <PanelHeader
          title="Tracked campaigns"
          actions={canManageCampaigns && (
            <button type="button" className="primary" onClick={() => openForm({ ...EMPTY_FORM })}>
              <Plus aria-hidden="true" /> New campaign
            </button>
          )}
        >
          Each link with its owner, status and dates, and the visits it brought in over the last {windowDays} days.
        </PanelHeader>
        {list.status === "loading" && <StatePanel kind="loading" title="Loading campaigns…" />}
        {list.status === "error" && (
          <StatePanel kind="error" title="Campaigns could not be loaded" action={<button type="button" onClick={reload}>Try again</button>}>
            {list.error}
          </StatePanel>
        )}
        {list.status === "ready" && (
          <>
            <ListToolbar query={listQueryFor("campaigns")} onQuery={setListQueryFor("campaigns")} placeholder="Search by name, source, affiliate or owner" label="Search campaigns">
              <label className="sw-camp-filter">
                <span className="sr-only">Status</span>
                <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                  <option value="">Every status</option>
                  {CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
                </select>
              </label>
            </ListToolbar>
            {records.length === 0 ? (
              <StatePanel kind="empty" title="No campaigns are tracked yet">
                {canManageCampaigns
                  ? "Build a link above and choose “Track this link”, or track one of the links under untracked traffic below."
                  : "Nobody has tracked a link yet. Visits to tagged links still appear under untracked traffic below."}
              </StatePanel>
            ) : selection.visible.length === 0 ? (
              <StatePanel kind="empty" title="No campaign matches">Clear the search or choose another status.</StatePanel>
            ) : (
              <ul className="sw-camp-list">
                {campaignPage.rows.map((row) => (
                  <li key={row.id}><button type="button" className="sw-camp-row" onClick={() => setSelectedId(row.id)}>
                    <span className="sw-camp-main">
                      <b>{row.name}</b>
                      <small>{linkLabel(row)}{row.landing_city ? ` · lands on ${row.landing_city}` : ""}</small>
                    </span>
                    <span className="sw-camp-meta">
                      <span className={`status${row.status === "active" ? " on" : ""}`}>{STATUS_LABEL[row.status] || row.status}</span>
                      <small>{row.owner_name || "No owner"}{dateRange(row) ? ` · ${dateRange(row)}` : ""}</small>
                    </span>
                    <span className="sw-camp-num"><b>{row.visits.toLocaleString()}</b><small>visits · {row.visits30.toLocaleString()} in 30d</small></span>
                    <span className="sw-camp-num"><b>{row.signups === null ? "—" : row.signups.toLocaleString()}</b><small>{row.signups === null ? "sign-ups not tracked" : "sign-ups"}</small></span>
                  </button></li>
                ))}
              </ul>
            )}
            <Pager paged={campaignPage} noun="campaign" onPage={setPageFor("campaigns", campaignReset)} />
          </>
        )}
      </section>

      <section className="portal-card">
        <PanelHeader title="Untracked traffic">
          Tagged visits in the last {windowDays} days that no campaign record claims. Nothing is lost: track a link to give it an owner and dates.
        </PanelHeader>
        {list.status === "loading" && <StatePanel kind="loading" title="Loading traffic…" />}
        {list.status === "error" && <StatePanel kind="error" title="Traffic could not be loaded">{list.error}</StatePanel>}
        {list.status === "ready" && (
          untracked.length === 0 ? (
            <StatePanel kind="empty" title="Every tagged visit belongs to a campaign">
              Visits to a link nobody has tracked appear here, with a button to track it.
            </StatePanel>
          ) : (
            <>
              {list.data.truncated && <ListCount>Showing the busiest links only: there were too many distinct tags to list them all.</ListCount>}
              <ul className="sw-camp-list">
                {untrackedPage.rows.map((row) => (
                  <li key={`${row.creator || ""}|${row.source || ""}|${row.campaign || ""}`} className="sw-camp-row sw-camp-row-static">
                    <span className="sw-camp-main">
                      <b>{linkLabel(row)}</b>
                      <small>first seen {shortDate(row.first_seen)} · last seen {shortDate(row.last_seen)}</small>
                    </span>
                    <span className="sw-camp-num"><b>{row.visits.toLocaleString()}</b><small>visits · {row.visits30.toLocaleString()} in 30d</small></span>
                    <span className="sw-camp-actions">
                      {canManageCampaigns && (
                        <button
                          type="button"
                          onClick={() => openForm(formFor({
                            name: row.creator ? `@${row.creator}${row.campaign ? ` ${row.campaign}` : ""}` : row.campaign || row.source || "",
                            source: row.creator ? "creator" : row.source || "",
                            campaign: row.campaign,
                            medium: row.creator ? "link" : null,
                            landing_city: null,
                            creator_handle: row.creator,
                          }))}
                        >
                          <Plus aria-hidden="true" /> Track<span className="sr-only"> {linkLabel(row)}</span>
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <Pager paged={untrackedPage} noun="link" onPage={setPageFor("campaigns.untracked")} />
            </>
          )
        )}
        {/* The all-time view the workspace payload has always carried, by link and city. Kept
            because the list above stops at the window, and a link from last year still has a
            history somebody may need. */}
        {(data.campaignVisits || []).length > 0 && (
          <details className="sw-camp-alltime">
            <summary>All-time tagged visits by link and city ({(data.campaignVisits || []).reduce((sum, row) => sum + row.hits, 0).toLocaleString()})</summary>
            <div className="audit-list">
              {visitPage.rows.map((row, index) => (
                <article key={visitPage.first + index}>
                  <Megaphone aria-hidden="true" />
                  <div>
                    <b>{row.source}{row.campaign ? ` · ${row.campaign}` : ""}</b>
                    <small>{row.market || "No city tag"} · {row.hits} visit{row.hits === 1 ? "" : "s"} · since {shortDate(row.first_seen)}</small>
                  </div>
                  <time>{shortDate(row.last_seen)}</time>
                </article>
              ))}
            </div>
            <Pager paged={visitPage} noun="link and city" plural="links and cities" onPage={setPageFor("campaigns.visits")} />
          </details>
        )}
      </section>
      {form && <CampaignFormDialog form={form} setForm={setForm} errors={formFieldErrors} error={formError} saving={saving} onSave={save} staff={data.staffDirectory || []} />}
    </>
  );
}

const dateRange = (row: { starts_at: string | null; ends_at: string | null }) =>
  row.starts_at && row.ends_at ? `${row.starts_at} → ${row.ends_at}` : row.starts_at ? `from ${row.starts_at}` : row.ends_at ? `until ${row.ends_at}` : "";

/** The last `days` days in UTC, oldest first, as the YYYY-MM-DD keys SQLite's date() produces. */
function lastDays(days: number) {
  const out: string[] = [];
  const today = new Date();
  for (let back = days - 1; back >= 0; back -= 1) {
    const day = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back));
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

const TREND_DAYS = 60;

function CampaignDetailView({ id, onBack, canEdit, canSeeAffiliates, onEdit, onChanged, onOpenAffiliate, copy, copied }: {
  id: string;
  onBack: () => void;
  canEdit: boolean;
  canSeeAffiliates: boolean;
  onEdit: (record: CampaignRecord) => void;
  onChanged: () => void;
  onOpenAffiliate: (handle: string) => void;
  copy: (text: string, key: string) => void;
  copied: string;
}) {
  const { setNotice } = useWorkspace();
  const { state, reload } = useCampaignDetail(id);
  const [statusBusy, setStatusBusy] = useState("");

  async function setStatus(status: string) {
    setStatusBusy(status);
    try {
      await postCampaign({ op: "status", id, status });
      setNotice(`Campaign marked ${STATUS_LABEL[status].toLowerCase()}.`);
      reload();
      onChanged();
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The status could not be changed.");
    } finally {
      setStatusBusy("");
    }
  }

  const back = (
    <button type="button" className="sw-link sw-camp-back" onClick={onBack}>
      <ArrowLeft aria-hidden="true" size={16} /> All campaigns
    </button>
  );
  if (state.status === "loading")
    return <section className="portal-card">{back}<StatePanel kind="loading" title="Loading the campaign…" /></section>;
  if (state.status === "error")
    return (
      <section className="portal-card">
        {back}
        <StatePanel kind="error" title="This campaign could not be loaded" action={<button type="button" onClick={reload}>Try again</button>}>{state.error}</StatePanel>
      </section>
    );

  const { campaign, trend, markets, totals, windowDays } = state.data;
  const link = campaignLink(campaign);
  const byDay = new Map(trend.map((day) => [day.day, day]));
  const days = lastDays(TREND_DAYS).map((day) => byDay.get(day) || { day, visits: 0, signups: 0 });
  const peak = Math.max(1, ...days.map((day) => day.visits));
  const recentVisits = days.reduce((sum, day) => sum + day.visits, 0);
  const pastEnd = campaign.ends_at && campaign.ends_at < new Date().toISOString().slice(0, 10) && campaign.status !== "ended";
  const record: CampaignRecord = { ...campaign, visits: totals.visits, visits30: 0, first_seen: null, last_seen: null, signups: totals.signups };

  return (
    <>
      <section className="portal-card">
        {back}
        <PanelHeader
          title={campaign.name}
          actions={canEdit && (
            <>
              <button type="button" onClick={() => onEdit(record)}><Pencil aria-hidden="true" /> Edit</button>
              {campaign.status !== "active" && <button type="button" disabled={Boolean(statusBusy)} onClick={() => setStatus("active")}>{campaign.status === "draft" ? "Start" : "Resume"}</button>}
              {campaign.status === "active" && <button type="button" disabled={Boolean(statusBusy)} onClick={() => setStatus("paused")}>Pause</button>}
              {campaign.status !== "ended" && <button type="button" disabled={Boolean(statusBusy)} onClick={() => setStatus("ended")}>End</button>}
            </>
          )}
        >
          <span className={`status${campaign.status === "active" ? " on" : ""}`}>{STATUS_LABEL[campaign.status] || campaign.status}</span>{" "}
          {linkLabel(campaign)}
        </PanelHeader>
        {pastEnd && (
          <StatePanel kind="empty" title="The end date has passed">
            This campaign is still marked {STATUS_LABEL[campaign.status]?.toLowerCase()}. {canEdit ? "End it, or move the end date if it is still running." : ""}
          </StatePanel>
        )}
        <div className="campaign-link-out sw-camp-detail-link">
          <Link2 aria-hidden="true" />
          <span>{link}</span>
          <button type="button" onClick={() => copy(link, "detail")}>{copied === "detail" ? <><Check/> Copied</> : <><Copy/> Copy link</>}</button>
        </div>
        <dl className="sw-camp-facts">
          <div><dt>Owner</dt><dd>{campaign.owner_name || "No owner"}</dd></div>
          <div><dt>Created by</dt><dd>{campaign.created_by_name || "Unknown"} · {shortDate(campaign.created_at)}</dd></div>
          <div><dt>Runs</dt><dd>{dateRange(campaign) || "No dates set"}</dd></div>
          <div><dt>Lands on</dt><dd>{campaign.landing_city || "The home page's own city"}</dd></div>
          {campaign.creator_handle && (
            <div>
              <dt>Affiliate</dt>
              <dd>
                {canSeeAffiliates
                  ? <button type="button" className="sw-link" onClick={() => onOpenAffiliate(campaign.creator_handle!)}>@{campaign.creator_handle}</button>
                  : `@${campaign.creator_handle}`}
              </dd>
            </div>
          )}
          <div><dt>Last changed</dt><dd>{shortDate(campaign.updated_at)}</dd></div>
        </dl>
        {campaign.notes ? <p className="sw-camp-notes">{campaign.notes}</p> : <p className="sw-camp-notes muted-note">No notes.</p>}
      </section>

      <section className="portal-card">
        <PanelHeader title="Performance">Visits through this link{campaign.creator_handle ? " and the accounts it brought in" : ""}, over the last {windowDays} days.</PanelHeader>
        <div className="portal-stats sw-camp-stats">
          <article><div><b>{totals.visits.toLocaleString()}</b><span>Visits ({windowDays} days)</span></div></article>
          <article><div><b>{recentVisits.toLocaleString()}</b><span>Visits ({TREND_DAYS} days)</span></div></article>
          <article>
            <div>
              <b>{totals.signups === null ? "—" : totals.signups.toLocaleString()}</b>
              <span>{totals.signups === null ? "Sign-ups are only attributed to affiliate links" : `Sign-ups (${windowDays} days)`}</span>
            </div>
          </article>
          <article><div><b>{markets.length}</b><span>Landing markets</span></div></article>
        </div>
        {totals.visits === 0 ? (
          <StatePanel kind="empty" title="No visits in this window">
            Nobody has opened this link in the last {windowDays} days. Copy the link above and check it is the one being shared.
          </StatePanel>
        ) : (
          <>
            <h3 className="sw-camp-subhead">By day, last {TREND_DAYS} days</h3>
            <div className="sw-camp-trend" role="img" aria-label={`Daily visits for the last ${TREND_DAYS} days, peaking at ${peak}`}>
              {days.map((day) => (
                <span key={day.day} title={`${day.day}: ${day.visits} visit${day.visits === 1 ? "" : "s"}${day.signups ? `, ${day.signups} sign-up${day.signups === 1 ? "" : "s"}` : ""}`}>
                  <i style={{ height: `${Math.max(day.visits ? 4 : 0, Math.round((day.visits / peak) * 100))}%` }} />
                </span>
              ))}
            </div>
            <div className="sw-camp-trend-axis"><small>{days[0].day}</small><small>{days[days.length - 1].day}</small></div>
            <h3 className="sw-camp-subhead">By landing market</h3>
            <div className="sw-camp-markets">
              {markets.map((row) => (
                <div key={row.market || "none"}>
                  <span>{row.market || "No city tag"}</span>
                  <span className="sw-camp-bar"><i style={{ width: `${Math.round((row.visits / Math.max(1, markets[0].visits)) * 100)}%` }} /></span>
                  <b>{row.visits.toLocaleString()}</b>
                </div>
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}

function CampaignFormDialog({ form, setForm, errors, error, saving, onSave, staff }: {
  form: CampaignForm;
  setForm: (next: CampaignForm | null) => void;
  errors: Record<string, string>;
  error: string;
  saving: boolean;
  onSave: () => void;
  staff: { id: string; name: string | null; role: string }[];
}) {
  const set = (key: keyof CampaignForm) => (event: { target: { value: string } }) => setForm({ ...form, [key]: event.target.value });
  const close = () => setForm(null);
  const isAffiliate = Boolean(form.creatorHandle.trim());
  const preview = (isAffiliate || form.source.trim())
    ? campaignLink({
        creator_handle: form.creatorHandle.trim().toLowerCase() || null,
        source: form.source.trim().toLowerCase(),
        campaign: form.campaign.trim().toLowerCase() || null,
        medium: form.medium.trim().toLowerCase() || null,
        landing_city: form.landingCity.trim() || null,
      })
    : "";
  const fieldError = (key: string) => errors[key] ? <small className="field-error" id={`campaign-${key}-error`}>{errors[key]}</small> : null;
  const described = (key: string) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `campaign-${key}-error` } : {});
  return (
    // Backdrop click-to-dismiss is a mouse convenience; the close button and Escape (DialogFocus)
    // are the keyboard ways out.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div className="overlay" onMouseDown={close}>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
      <section className="modal confirm-dialog sw-camp-dialog" role="dialog" aria-modal="true" aria-labelledby="campaign-form-title" onMouseDown={(event) => event.stopPropagation()}>
        <DialogFocus onClose={close} />
        <button className="close" aria-label="Close" onClick={close}><X /></button>
        <span className="kicker">{form.id ? "EDIT CAMPAIGN" : "TRACK A LINK"}</span>
        <h2 id="campaign-form-title">{form.id ? form.name || "Campaign" : "New campaign"}</h2>
        <form
          className="sw-camp-form"
          noValidate
          onSubmit={(event) => { event.preventDefault(); onSave(); }}
        >
          <label className="sw-camp-wide">Name
            <input value={form.name} onChange={set("name")} maxLength={80} required placeholder="Summer patio push" {...described("name")} />
            {fieldError("name")}
          </label>
          <label>Affiliate handle <small>(optional)</small>
            <input value={form.creatorHandle} onChange={set("creatorHandle")} maxLength={32} placeholder="maya" autoComplete="off" spellCheck={false} {...described("creatorHandle")} />
            {fieldError("creatorHandle")}
          </label>
          <label>Source
            <input value={isAffiliate ? "creator" : form.source} onChange={set("source")} disabled={isAffiliate} maxLength={40} placeholder="instagram" {...described("source")} />
            {isAffiliate ? <small>Affiliate links always record “creator”.</small> : fieldError("source")}
          </label>
          <label>{isAffiliate ? "Label" : "Campaign"} <small>(optional)</small>
            <input value={form.campaign} onChange={set("campaign")} maxLength={isAffiliate ? 48 : 60} placeholder={isAffiliate ? "tiktok-oct" : "summer-patio"} {...described("campaign")} />
            {fieldError("campaign")}
          </label>
          {!isAffiliate && (
            <label>Medium <small>(optional)</small>
              <input value={form.medium} onChange={set("medium")} maxLength={40} placeholder="social" {...described("medium")} />
              {fieldError("medium")}
            </label>
          )}
          <label>City to land on <small>(optional)</small>
            <input value={form.landingCity} onChange={set("landingCity")} maxLength={100} placeholder="Toronto" {...described("landingCity")} />
            {fieldError("landingCity")}
          </label>
          <label>Owner
            <select value={form.ownerId} onChange={set("ownerId")} {...described("ownerId")}>
              <option value="">{form.id ? "Keep the current owner" : "Me"}</option>
              {staff.map((member) => <option key={member.id} value={member.id}>{member.name || member.id}</option>)}
            </select>
            {fieldError("ownerId")}
          </label>
          <label>Status
            <select value={form.status} onChange={set("status")} {...described("status")}>
              {CAMPAIGN_STATUSES.map((status) => <option key={status} value={status}>{STATUS_LABEL[status]}</option>)}
            </select>
            {fieldError("status")}
          </label>
          <label>Starts <small>(optional)</small>
            <input type="date" value={form.startsAt} onChange={set("startsAt")} {...described("startsAt")} />
            {fieldError("startsAt")}
          </label>
          <label>Ends <small>(optional)</small>
            <input type="date" value={form.endsAt} min={form.startsAt || undefined} onChange={set("endsAt")} {...described("endsAt")} />
            {fieldError("endsAt")}
          </label>
          <label className="sw-camp-wide">Notes <small>(optional)</small>
            <textarea value={form.notes} onChange={set("notes")} maxLength={1000} rows={3} placeholder="What this link is for, where it was posted, what to compare it with." {...described("notes")} />
            {fieldError("notes")}
          </label>
          <p className="sw-camp-wide sw-camp-preview">
            <Link2 aria-hidden="true" size={14} /> {preview || "Enter a source or an affiliate handle to see the link."}
          </p>
          {error && <div className="sw-camp-wide"><StatePanel kind="error" title="Not saved">{error}</StatePanel></div>}
          <div className="editor-actions sw-camp-wide">
            <button type="button" onClick={close}>Cancel</button>
            <button type="submit" className="primary" disabled={saving}>{saving ? "Saving…" : form.id ? "Save changes" : "Track campaign"}</button>
          </div>
        </form>
      </section>
    </div>
  );
}
