"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, Flag, Image as ImageIcon, MapPin, Pencil, Store, Upload, X } from "lucide-react";
import { DialogFocus } from "../DialogFocus";
import { GatedButton } from "../admin/GatedButton";
import { ownerConfirmationBlocked, ownerConfirmationCurrent, OWNER_CONFIRMATION_DAYS, reportCategoryLabel } from "../../owner-confirmation";
import { parseSqlTimestamp } from "../../verification";
import RadarMark from "../../RadarMark";
import { shrinkPhotoForUpload } from "../../photo-resize";
import { photoSrc } from "../../photo-url";
import RadarScan from "../../RadarScan";

interface PortalRestaurant {
  id: string;
  name: string;
  website: string | null;
  cuisine: string;
  photo_url: string | null;
}

interface PortalDeal {
  id: string;
  restaurant_id: string;
  title: string;
  price: string;
  schedule: string;
  description: string | null;
  terms: string | null;
  status: string;
  active: number;
  city: string;
  address: string;
  views: number;
  offers: number;
  // When a manager last said the deal is still running (drizzle/0069). Theirs, not a Radar check.
  owner_confirmed_at: string | null;
  // An edit waiting for Radar staff. The live listing still shows the fields above until it is
  // approved, so the editor opens on this instead.
  pending_change: { title: string; price: string; schedule: string; description: string | null; terms: string | null; created_at: string } | null;
  // The latest edit staff have decided, when nothing newer is waiting.
  last_review: { status: "approved" | "rejected"; note: string | null; reviewed_at: string | null } | null;
}

type ReviewOutcome = "submitted" | "unchanged" | "withdrawn" | "none";

const SAVED_NOTICE: Record<ReviewOutcome, string> = {
  submitted: "Sent to Radar for review. Your listing shows the change once it is approved.",
  unchanged: "Saved. Your change is still waiting for review.",
  withdrawn: "Saved. Your pending change was withdrawn.",
  none: "Changes saved.",
};

// A reader's report on one of these deals that Radar staff have not closed. Never who sent it.
interface PortalReport {
  id: number;
  deal_id: string;
  category: string;
  notes: string | null;
  status: string;
  created_at: string;
}

interface PortalData {
  restaurants: PortalRestaurant[];
  deals: PortalDeal[];
  reports: PortalReport[];
}

function shortDate(value: string) {
  const date = parseSqlTimestamp(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
}

interface PortalActionPayload {
  action: string;
  restaurantId?: string;
  photoUrl?: string;
  dealId?: string;
  title?: FormDataEntryValue | null;
  price?: FormDataEntryValue | null;
  schedule?: FormDataEntryValue | null;
  description?: FormDataEntryValue | null;
  terms?: FormDataEntryValue | null;
  active?: boolean;
}

interface ApiErrorBody {
  error?: { message?: string } | string;
  review?: ReviewOutcome;
  confirmed_at?: string | null;
}

function errorMessage(result: ApiErrorBody, fallback: string) { return (typeof result?.error === "object" ? result.error.message : result?.error) || fallback; }

export default function RestaurantPortalClient() {
  const [data, setData] = useState<PortalData | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [photoDialog, setPhotoDialog] = useState<PortalRestaurant | null>(null),
    [photoUploading, setPhotoUploading] = useState(false),
    [editor, setEditor] = useState<PortalDeal | null>(null),
    [confirming, setConfirming] = useState("");

  async function load() {
    try {
      const response = await fetch("/api/portal");
      const result = await response.json() as PortalData & ApiErrorBody;
      if (!response.ok) throw new Error(errorMessage(result, "The restaurant portal is unavailable."));
      setData(result);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The restaurant portal is unavailable.");
    }
  }
  useEffect(() => {
    // Data fetch on mount: setState happens after the awaited fetch resolves, not
    // synchronously in the effect body — a standard, legitimate data-loading effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, []);

  async function saveDeal(payload: PortalActionPayload) {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch("/api/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as ApiErrorBody;
      if (!response.ok) throw new Error(errorMessage(result, "The change could not be saved."));
      await load();
      setNotice(SAVED_NOTICE[result.review || "none"]);
      return true;
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The change could not be saved.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function confirmDeal(deal: PortalDeal) {
    setConfirming(deal.id);
    setNotice("");
    try {
      const response = await fetch("/api/portal", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "confirm_deal", dealId: deal.id }) });
      const result = await response.json() as ApiErrorBody;
      if (!response.ok) throw new Error(errorMessage(result, "The deal could not be confirmed."));
      await load();
      setNotice(`Thanks. ${deal.title} shows as confirmed by you${result.confirmed_at ? ` on ${shortDate(result.confirmed_at)}` : ""}.`);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "The deal could not be confirmed.");
    } finally {
      setConfirming("");
    }
  }
  async function uploadPhoto(restaurantId: string, file: File) {
    setPhotoUploading(true);
    setNotice("");
    try {
      // Stored at card size rather than as chosen; see app/photo-resize.ts.
      const photo = await shrinkPhotoForUpload(file);
      const response = await fetch(`/api/portal/photo-upload?restaurantId=${encodeURIComponent(restaurantId)}`, { method: "POST", headers: { "content-type": photo.type }, body: photo });
      const result = await response.json() as ApiErrorBody;
      if (!response.ok) throw new Error(errorMessage(result, "Photo upload failed."));
      await load();
      setNotice("Photo updated.");
      setPhotoDialog(null);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally {
      setPhotoUploading(false);
    }
  }

  // Group once instead of re-scanning every deal for each restaurant card — and again a second
  // time just to ask whether that same list was empty.
  const dealsByRestaurant = useMemo(() => {
    const map = new Map<string, PortalDeal[]>();
    for (const deal of data?.deals || []) {
      const list = map.get(deal.restaurant_id);
      if (list) list.push(deal);
      else map.set(deal.restaurant_id, [deal]);
    }
    return map;
  }, [data?.deals]);
  const reportsByDeal = useMemo(() => {
    const map = new Map<string, PortalReport[]>();
    for (const report of data?.reports || []) {
      const list = map.get(report.deal_id);
      if (list) list.push(report);
      else map.set(report.deal_id, [report]);
    }
    return map;
  }, [data?.reports]);

  if (error) return <div className="portal-loading portal-error"><Store /><h1>Portal took a detour.</h1><p>{error}</p><button onClick={load}>Try again</button><Link prefetch={false} href="/dashboard">Back to dashboard</Link></div>;
  if (!data) return <div className="portal-loading"><div className="portal-loading-body"><RadarScan /><p>Opening the restaurant portal…</p></div></div>;

  return (
    <main className="portal">
      <aside>
        <Link prefetch={false} className="brand" href="/"><RadarMark />Radar<i>.</i></Link>
        <div className="workspace-label">RESTAURANT PORTAL</div>
        <Link prefetch={false} className="backlink" href="/dashboard">← Personal dashboard</Link>
      </aside>
      <section className="portal-main">
        <header>
          <div><span className="kicker">YOUR RESTAURANTS</span><h1>Manage your listing</h1><p>Set your restaurant’s photo and keep your deals accurate. Radar reviews wording changes before they go live. When a deal is still running as listed, say so with <b>Still running</b>: readers see that you confirmed it.</p></div>
        </header>
        {/* Always mounted: a live region that arrives already holding its text is often not read. */}
        <div className="sr-only" role="status" aria-live="polite">{notice}</div>
        {notice && <div className="admin-notice">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
        {data.restaurants.map((r) => (
          <section className="portal-card" key={r.id}>
            <div className="portal-card-head">
              <div><span className="kicker">RESTAURANT</span><h2>{r.name}</h2></div>
              <button onClick={() => setPhotoDialog(r)}><Upload /> Set photo</button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary admin/manager-set external photo URL */}
            {r.photo_url ? <img className="restaurant-photo-preview" src={photoSrc(r.photo_url)} alt="" /> : <div className="portal-empty"><ImageIcon /><h3>No photo yet</h3><p>Set a photo so your restaurant looks its best on Radar.</p></div>}
            <div className="inventory-table restaurant-deal-table">
              {(dealsByRestaurant.get(r.id) || []).map((d) => {
                const openReports = reportsByDeal.get(d.id)?.length || 0;
                const confirmed = ownerConfirmationCurrent(d.owner_confirmed_at);
                return (
                  <article key={d.id}>
                    <div>
                      <b>{d.title}</b>
                      <small><MapPin /> {d.city} · {d.address}</small>
                      {d.pending_change ? (
                        <small className="portal-review-note"><Clock3 /> Change waiting for Radar review</small>
                      ) : d.last_review?.status === "rejected" ? (
                        <small className="portal-review-note">Last change not accepted{d.last_review.note ? `: ${d.last_review.note}` : "."}</small>
                      ) : null}
                      {openReports > 0 && <small className="portal-review-note portal-report-note"><Flag /> <a href={`#reports-${r.id}`}>{openReports === 1 ? "1 reader report" : `${openReports} reader reports`}</a></small>}
                    </div>
                    <div><b>{d.price}</b><small>{d.schedule}</small></div>
                    <div className="deal-activity">
                      <b>{d.views.toLocaleString()}</b>
                      <small>opened · {d.offers.toLocaleString()} came to you</small>
                    </div>
                    <div>
                      <span className={`status ${d.active ? "on" : ""}`}>{d.active ? "Live" : "Paused"}</span>
                      {d.status === "live" && (
                        <small className="portal-confirmed">
                          {confirmed && d.owner_confirmed_at ? `You confirmed it ${shortDate(d.owner_confirmed_at)}` : `Not confirmed in ${OWNER_CONFIRMATION_DAYS} days`}
                        </small>
                      )}
                    </div>
                    <div className="row-actions">
                      <GatedButton
                        type="button"
                        blocked={ownerConfirmationBlocked(d)}
                        disabled={confirming === d.id}
                        title="Tells readers this deal is still running as listed. Radar shows it as confirmed by you, separately from its own checks."
                        onClick={() => confirmDeal(d)}
                      >
                        <CheckCircle2 /> Still running<span className="sr-only">: {d.title}</span>
                      </GatedButton>
                      <button onClick={() => setEditor(d)}><Pencil /> Edit<span className="sr-only"> {d.title}</span></button>
                    </div>
                  </article>
                );
              })}
              {!dealsByRestaurant.get(r.id)?.length && <div className="portal-empty"><Store /><h3>No deals yet</h3><p>Ask an administrator to add a deal for this restaurant.</p></div>}
            </div>
            {(() => {
              const deals = dealsByRestaurant.get(r.id) || [];
              const reports = deals.flatMap((deal) => (reportsByDeal.get(deal.id) || []).map((report) => ({ report, deal })))
                .sort((a, b) => b.report.created_at.localeCompare(a.report.created_at) || b.report.id - a.report.id);
              if (!deals.length) return null;
              return (
                <section className="portal-reports" id={`reports-${r.id}`} aria-labelledby={`reports-title-${r.id}`}>
                  <h3 id={`reports-title-${r.id}`}><Flag /> Reader reports</h3>
                  {reports.length ? (
                    <>
                      <p>Readers told Radar something on these deals looks wrong. If they are right, edit the deal and Radar reviews the change. If the deal is still running as listed, press Still running.</p>
                      <ul>
                        {reports.map(({ report, deal }) => (
                          <li key={report.id}>
                            <b>{reportCategoryLabel(report.category)}</b>
                            <small>{deal.title} · {shortDate(report.created_at)} · {report.status === "reviewing" ? "Radar is looking into it" : "New"}</small>
                            {report.notes && <p>{report.notes}</p>}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p>No open reports. When a reader says something on one of your deals is wrong, it shows here.</p>
                  )}
                </section>
              );
            })()}
          </section>
        ))}
      </section>
      {photoDialog && (
        // Backdrop click-to-dismiss is a mouse-only convenience; the close button below
        // remains the fully keyboard-accessible way to dismiss this dialog.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="overlay" onMouseDown={() => setPhotoDialog(null)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
          <section className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="portal-photo-title" onMouseDown={(event) => event.stopPropagation()}>
            <DialogFocus onClose={() => setPhotoDialog(null)} />
            <button className="close" aria-label="Close" onClick={() => setPhotoDialog(null)}><X /></button>
            <span className="kicker">RESTAURANT PHOTO</span>
            <h2 id="portal-photo-title">{photoDialog.name}</h2>
            {/* eslint-disable-next-line @next/next/no-img-element -- arbitrary admin/manager-set external photo URL */}
            {photoDialog.photo_url && <img className="restaurant-photo-preview" src={photoSrc(photoDialog.photo_url)} alt="" />}
            <label className="typed-confirmation">Upload a photo<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadPhoto(photoDialog.id, file); }} disabled={photoUploading} /></label>
            <div className="editor-actions">
              <button onClick={() => setPhotoDialog(null)}>Cancel</button>
              {photoDialog.photo_url && <button disabled={busy} onClick={async () => { if (await saveDeal({ action: "update_photo", restaurantId: photoDialog.id, photoUrl: "" })) setPhotoDialog(null); }}>Remove photo</button>}
            </div>
          </section>
        </div>
      )}
      {editor && (
        // Backdrop click-to-dismiss is a mouse-only convenience; the close button below
        // remains the fully keyboard-accessible way to dismiss this dialog.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions
        <div className="overlay" onMouseDown={() => setEditor(null)}>
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- only stops backdrop clicks from closing when they originate inside the dialog */}
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="portal-deal-title" onMouseDown={(event) => event.stopPropagation()}>
            <DialogFocus onClose={() => setEditor(null)} />
            <button className="close" aria-label="Close" onClick={() => setEditor(null)}><X /></button>
            <span className="kicker">EDIT DEAL</span>
            <h2 id="portal-deal-title">{editor.title}</h2>
            <form
              className="preferences"
              onSubmit={async (event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                if (await saveDeal({
                  action: "update_deal",
                  dealId: editor.id,
                  title: values.get("title"),
                  price: values.get("price"),
                  schedule: values.get("schedule"),
                  description: values.get("description"),
                  terms: values.get("terms"),
                  active: values.get("active") === "on",
                })) setEditor(null);
              }}
            >
              <p className="wide">
                {editor.pending_change
                  ? "Your last change is still waiting for review. Saving again replaces it; putting back what the listing says withdraws it."
                  : "Changes to the wording go to Radar for a quick review before they appear. Pausing or resuming applies right away."}
              </p>
              <label>Title<input name="title" defaultValue={(editor.pending_change || editor).title} required /></label>
              <label>Price or savings<input name="price" defaultValue={(editor.pending_change || editor).price} required /></label>
              <label>Schedule<input name="schedule" defaultValue={(editor.pending_change || editor).schedule} required /></label>
              <label className="wide">Description<textarea name="description" defaultValue={(editor.pending_change || editor).description || ""} /></label>
              <label className="wide">Terms<textarea name="terms" defaultValue={(editor.pending_change || editor).terms || ""} /></label>
              <label className="toggle wide" htmlFor="portal-deal-active-toggle" aria-label="Deal is live"><input id="portal-deal-active-toggle" type="checkbox" name="active" defaultChecked={!!editor.active} /><span></span><div><b>Deal is live</b><small>Turn off to pause this deal without deleting it.</small></div></label>
              <button className="primary" disabled={busy}>Save deal</button>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
