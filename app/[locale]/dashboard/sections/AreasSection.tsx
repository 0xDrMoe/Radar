"use client";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Lock, MapPin, X } from "lucide-react";
import ChromeLink from "../../../ChromeLink";
import { ProLock } from "../../../ProBadge";
import { allowedRadii, DEFAULT_RADIUS_KM, maxRadiusKm, RADIUS_OPTIONS } from "../../../radius";
import { FREE_AREA_LIMIT } from "../../../plan-limits";
import { MAIN_CONTENT_ID } from "../../../main-content";
import { GatedButton } from "../../../(operator)/admin/GatedButton";
import { Empty, ProUpsell, type SavedLocation, type SectionProps } from "../dashboard-shared";

// The places Radar watches for the reader. The default area is the one the overview's local feed
// and the alert roundup cover; the others are there to explore. Every change here is one field at a
// time (/api/user update_location takes only what it is sent), so pausing an area can never fail on
// a radius the plan no longer allows.
export default function AreasSection({ data, pro, busy, mutate, reload, onRemoved }: SectionProps & { onRemoved: (area: SavedLocation) => void }) {
  const t = useTranslations("dashboard");
  const [pendingRemoval,setPendingRemoval] = useState<SavedLocation|null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const areas = data.locations || [];
  const atAreaLimit = !pro && areas.length >= FREE_AREA_LIMIT;
  const reach = maxRadiusKm(pro), radii = allowedRadii(pro);
  const activeCount = areas.filter((area) => area.active).length;
  useEffect(() => {
    if (!pendingRemoval) return;
    const previous = document.activeElement as HTMLElement | null; document.body.style.overflow = "hidden"; dialogRef.current?.focus();
    const onKey = (event:KeyboardEvent) => {
      if (event.key === "Escape") setPendingRemoval(null);
      if (event.key === "Tab" && dialogRef.current) {
        const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')).filter((node) => !node.hasAttribute("disabled"));
        if (!controls.length) return; const first = controls[0],last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown",onKey);
    return () => { document.body.style.overflow = ""; document.removeEventListener("keydown",onKey); (previous?.isConnected ? previous : document.getElementById(MAIN_CONTENT_ID))?.focus(); };
  },[pendingRemoval]);
  async function addArea(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget,values = new FormData(form);
    if (await mutate({action:"location",label:values.get("label"),postal:values.get("postal"),radius:Number(values.get("radius"))},t("areas.areaAdded"))) { form.reset(); await reload(); }
  }
  async function confirmRemoval() {
    if (!pendingRemoval) return; const result = await mutate({action:"remove_location",id:pendingRemoval.id},t("areas.areaRemoved"));
    if (result) { if (result.removed) onRemoved(result.removed); setPendingRemoval(null); await reload(); }
  }
  async function update(area:SavedLocation,change:{active?:boolean;radius?:number},message:string) { if (await mutate({action:"update_location",id:area.id,...change},message)) await reload(); }
  return <>
    <section className="portal-card"><div className="portal-card-head"><div><span className="kicker">{t("areas.kicker")}</span><h2>{t("areas.heading")}</h2></div><span className="status on">{pro ? t("areas.savedCount",{count:areas.length}) : t("areas.savedCountFree",{count:areas.length,limit:FREE_AREA_LIMIT})}</span></div>
      {/* An account that left Pro keeps every area it made. Only one works on Free; saying so here
          is what explains the 402 the server answers when a second is switched back on. */}
      {!pro && areas.length > FREE_AREA_LIMIT && <p className="dash-card-note">{t("areas.freeActiveNote",{limit:FREE_AREA_LIMIT})}</p>}
      <div className="tracked-locations">{areas.map((area) => {
        const options = Array.from(new Set([...radii, area.radius])).sort((a,b) => a - b);
        const capped = area.radius > reach;
        return <article key={area.id} className={!area.active ? "inactive" : ""}><span className="area-ring"><MapPin/></span>
          <div><b>{area.label}</b><small>{area.postal}{area.city ? ` · ${area.city}` : ""}{area.is_default ? ` ${t("areas.default")}` : ""}{!area.active ? ` ${t("areas.pausedTag")}` : ""}</small>{capped && <small className="dash-field-note"><Lock aria-hidden="true"/>{t("areas.radiusCapped",{radius:reach})}</small>}</div>
          <label className="dash-inline-select"><span className="sr-only">{t("areas.radiusFor",{label:area.label})}</span><select value={area.radius} disabled={busy === `update_location-${area.id}`} onChange={(event) => update(area,{radius:Number(event.target.value)},t("areas.radiusUpdated",{label:area.label}))}>{options.map((value) => <option key={value} value={value} disabled={!radii.includes(value) && value !== area.radius}>{radii.includes(value) ? t("areas.km",{value}) : t("areas.kmPro",{value})}</option>)}</select></label>
          <ChromeLink href={`/?postal=${encodeURIComponent(area.postal)}&radius=${Math.min(area.radius,reach)}`}>{t("areas.explore")}</ChromeLink>
          {!area.is_default && <button onClick={async () => { if (await mutate({action:"set_default_location",id:area.id},t("areas.defaultUpdated"))) await reload(); }}>{t("areas.setDefault")}</button>}
          <GatedButton blocked={!area.active && !pro && activeCount >= FREE_AREA_LIMIT ? t("areas.resumeLimited") : null} disabled={busy === `update_location-${area.id}`} onClick={() => update(area,{active:!area.active},t("areas.areaUpdated"))}>{area.active ? t("areas.pause") : t("areas.resume")}</GatedButton>
          <button aria-label={t("areas.removeAria",{label:area.label})} onClick={() => setPendingRemoval(area)}><X/></button>
        </article>;
      })}</div>
      {!areas.length && <Empty title={t("areas.emptyTitle")} message={t("areas.emptyMessage")} action={<span/>}/>}
    </section>
    <section className="portal-card"><div className="portal-card-head"><div><h2>{t("areas.addHeading")}</h2><p className="dash-card-note">{t("areas.addNote")}</p></div>{!pro && <span className="status">{t("areas.savedCountFree",{count:areas.length,limit:FREE_AREA_LIMIT})}</span>}</div>
      {atAreaLimit ? <ProUpsell icon={MapPin} title={t("areas.limitTitle")} body={t("areas.limitBody")} cta={t("areas.upgrade")}/> : <form className="location-form" onSubmit={addArea}><label>{t("areas.labelField")}<input name="label" placeholder={t("areas.labelPlaceholder")} maxLength={40} required/></label><label>{t("areas.postalField")}<input name="postal" autoComplete="postal-code" placeholder={t("areas.postalPlaceholder")} required/></label><label><span className="pro-field-label">{t("areas.radiusField")}{!pro && <ProLock title={t("areas.radiusLockTitle")}/>}</span><select name="radius" defaultValue={String(DEFAULT_RADIUS_KM)}>{RADIUS_OPTIONS.map((value) => <option key={value} value={value}>{t("areas.km",{value})}</option>)}{/* The Pro-only radii stay in the list, disabled and tagged, rather than being dropped: a free user should be able to see where the ceiling is instead of guessing it. */}{[75,100].map((value) => <option key={value} value={value} disabled={!pro}>{pro ? t("areas.km",{value}) : t("areas.kmPro",{value})}</option>)}</select>{!pro && <span className="pro-hint"><Lock/>{t("areas.radiusHint")}</span>}</label><button className="primary" disabled={busy === "location"}>{t("areas.addArea")}</button></form>}
    </section>
    {pendingRemoval && <div className="overlay" onMouseDown={() => setPendingRemoval(null)}><div className="modal confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="remove-area-title" tabIndex={-1} ref={dialogRef} onMouseDown={(event) => event.stopPropagation()}><button className="close" aria-label={t("close")} onClick={() => setPendingRemoval(null)}><X/></button><span className="kicker">{t("areas.confirmRemoval")}</span><h2 id="remove-area-title">{t("areas.removeTitle",{label:pendingRemoval.label})}</h2><p>{t("areas.removeBody")}</p><div className="editor-actions"><button onClick={() => setPendingRemoval(null)}>{t("areas.keepArea")}</button><button className="destructive" disabled={busy === `remove_location-${pendingRemoval.id}`} onClick={confirmRemoval}>{t("saved.remove")}</button></div></div></div>}{/* eslint-disable-line jsx-a11y/no-static-element-interactions, jsx-a11y/no-noninteractive-element-interactions -- backdrop click is a mouse convenience; full keyboard access (focus trap, Escape, focus restore) is implemented in the effect above */}
  </>;
}
