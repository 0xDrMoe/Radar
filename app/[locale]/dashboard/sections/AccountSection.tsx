"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { SignOutButton, UserButton } from "@clerk/react";
import { ChevronRight, Lock } from "lucide-react";
import { onRadioGroupKey, radioTabIndex } from "../../../radio-group-keys";
import ThemeMenu, { type Theme } from "../../../ThemeMenu";
import { applyAccent, storeAccent } from "../../../applyAccent";
import { ACCENTS, ACCENT_KEYS, isAccentKey } from "../../../theme-accents";
import { ProBadge } from "../../../ProBadge";
import { DEFAULT_TIMEZONE, timezoneChoices } from "../../../timezones";
import { Link } from "../../../../i18n/navigation";
import type { SectionProps } from "../dashboard-shared";

// Who the reader is to Radar: their name, language, country, units and clock, how the site looks,
// and how they sign in. The plan and the account's data each have their own section now (Plan &
// billing, Privacy & data); this one says which plan they are on and links there.
export default function AccountSection({ data, pro, busy, mutate, reload, upgrade }: SectionProps) {
  const t = useTranslations("dashboard"), tTheme = useTranslations("theme");
  const p = data.profile;
  const [theme,setTheme] = useState<Theme>(p.theme === "light" || p.theme === "dark" || p.theme === "system" ? p.theme : "dark");
  const [accent,setAccent] = useState(isAccentKey(p.accent_color) ? p.accent_color : "coral");
  async function persistAppearance(nextTheme:Theme,nextAccent:string) {
    storeAccent(nextAccent);
    const resolved = nextTheme === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : nextTheme;
    // Applied to the document here, in the event handler, rather than in an effect, so clicking a
    // theme or accent feels instant instead of lagging a render behind.
    document.documentElement.dataset.theme = resolved;
    applyAccent(nextAccent,resolved);
    setTheme(nextTheme); setAccent(nextAccent);
    await mutate({action:"theme",theme:nextTheme,accentColor:nextAccent},t("account.appearanceUpdated"));
  }
  async function saveProfile(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    if (await mutate({action:"profile",name:values.get("name"),language:values.get("language"),country:values.get("country"),distanceUnit:values.get("distanceUnit"),timezone:values.get("timezone")},t("account.profileUpdated"))) await reload();
  }
  return <>
    <section className="portal-card account-settings"><div className="portal-card-head"><div><span className="kicker">{t("account.kicker")}</span><h2>{t("account.heading")}</h2></div><span className="status on">{t("account.signedIn")}</span></div>
      <form className="preferences" onSubmit={saveProfile}><label>{t("account.displayName")}<input name="name" autoComplete="name" defaultValue={p.name || ""} required/></label><label>{t("account.language")}<select name="language" defaultValue={p.language || "en"}><option value="en">{t("account.english")}</option><option value="fr">{t("account.french")}</option><option value="es">{t("account.spanish")}</option></select></label><label>{t("account.country")}<select name="country" defaultValue={p.country || "CA"}><option value="CA">{t("account.canada")}</option><option value="US">{t("account.unitedStates")}</option></select></label><label>{t("account.distanceUnits")}<select name="distanceUnit" defaultValue={p.distance_unit || "km"}><option value="km">{t("account.kilometers")}</option><option value="mi">{t("account.miles")}</option></select></label><label className="wide">{t("account.timezone")}<select name="timezone" defaultValue={p.timezone?.trim() || DEFAULT_TIMEZONE}>{timezoneChoices(p.timezone).map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_"," ")}</option>)}</select><small className="dash-field-note">{t("account.timezoneHint")}</small></label><button className="primary" disabled={busy === "profile"}>{t("account.saveProfile")}</button></form>
    </section>
    <section className="portal-card"><div className="portal-card-head"><div><h2>{t("account.appearance")}</h2></div></div><div className="appearance-settings"><div className="appearance-row"><span>{t("account.theme")}</span><ThemeMenu inline onThemeChange={(value) => persistAppearance(value,accent)} labels={{ colorTheme: tTheme("colorTheme"), light: tTheme("light"), system: tTheme("system"), dark: tTheme("dark") }}/></div><div className="appearance-row"><span className="pro-field-label">{t("account.accentColor")}{!pro && <ProBadge label={t("account.proBadge")} title={t("account.accentLockTitle")}/>}</span><div className="accent-picker" role="radiogroup" aria-label={t("account.accentColor")}>{ACCENT_KEYS.map((key, index) => { const def = ACCENTS[key], locked = def.pro && !pro, name = t(`account.accentNames.${key}`), label = locked ? t("account.accentLocked",{name}) : name; return <button key={key} type="button" role="radio" aria-checked={accent === key} tabIndex={radioTabIndex(accent === key, index, ACCENT_KEYS.includes(accent))} onKeyDown={onRadioGroupKey} data-arrow-skip={locked || undefined} aria-label={label} title={label} className={`${accent === key ? "active" : ""} ${locked ? "locked" : ""}`} style={{background:def.dark}} onClick={() => { if (busy === "theme") return; if (locked) upgrade(); else persistAppearance(theme,key); }} aria-disabled={busy === "theme" || undefined}>{locked && <Lock/>}</button>; })}</div></div></div></section>
    <section className="portal-card"><div className="portal-card-head"><div><h2>{t("account.signInHeading")}</h2></div></div><div className="account-settings-grid"><div><b>{p.name || p.email.split("@")[0]}</b><span>{p.email}</span><small>{t("account.manageProviders")}</small></div><div className="dashboard-account-actions"><UserButton/><SignOutButton redirectUrl="/"><button type="button">{t("account.signOut")}</button></SignOutButton></div></div>
      <div className="appearance-row dash-plan-summary"><span>{t("account.plan")}: <b>{pro ? t("account.radarPro") : t("account.freePlan")}</b></span><Link href="/dashboard/billing">{t("account.planLink")} <ChevronRight aria-hidden="true"/></Link></div>
    </section>
  </>;
}
