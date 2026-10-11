"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { applyAccent, storedAccent } from "./applyAccent";
export type Theme = "system"|"light"|"dark";
export type ThemeLabels = { colorTheme: string; light: string; system: string; dark: string };
// English fallback for the two call sites that render this outside any locale context: the
// floating instance RootShell mounts unconditionally (shared by the English-only admin/portal
// root and, redundantly, by locale pages that already render their own inline instance) can't
// safely call useTranslations itself — RootShell sits outside NextIntlClientProvider on every
// route. Passing labels down as a prop (rather than reading them via a hook in here) keeps this
// component usable in both contexts without risking a "no intl context found" crash on /admin.
const defaultLabels: ThemeLabels = { colorTheme: "Color theme", light: "Light", system: "System", dark: "Dark" };
const options: { value: Theme; labelKey: keyof Omit<ThemeLabels,"colorTheme">; Icon: typeof Sun }[] = [
  { value: "light", labelKey: "light", Icon: Sun },
  { value: "system", labelKey: "system", Icon: Monitor },
  { value: "dark", labelKey: "dark", Icon: Moon },
];
function storedTheme():Theme {
  if (typeof localStorage === "undefined") return "dark";
  const stored = localStorage.getItem("radar-theme");
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "dark";
}
export default function ThemeMenu({inline,onThemeChange,labels = defaultLabels}:{inline?:boolean; onThemeChange?:(theme:Theme) => void; labels?:ThemeLabels} = {}) {
  const [theme,setTheme] = useState<Theme>("dark");
  useEffect(() => {
    // Reading the persisted theme choice on mount is a client-only sync with localStorage —
    // SSR has no localStorage, so a useState lazy initializer would incorrectly bake in
    // "system" from the server render and never re-run once hydrated on the client.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(storedTheme());
  },[]);
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
      // The browser bar's colour, from the meta RootShell's pre-paint script puts first in <head>.
      document.getElementById("radar-theme-color")?.setAttribute("content", resolved === "dark" ? "#070707" : "#f7f3e9");
      applyAccent(storedAccent(),resolved);
    };
    apply();
    if (theme !== "system") return;
    media.addEventListener("change",apply); return () => media.removeEventListener("change",apply);
  },[theme]);
  function choose(value:Theme) { setTheme(value); localStorage.setItem("radar-theme",value); onThemeChange?.(value); }
  // A radiogroup is one Tab stop whose arrow keys move and select, which is what a screen reader
  // announcing "radio, 1 of 3" tells its user to press.
  function onRadioKey(event:React.KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === theme);
    const next = options[(index + step + options.length) % options.length].value;
    choose(next);
    (event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-theme-value="${next}"]`))?.focus();
  }
  return (
    // The onClick below only stops bubbling for the inline placement; it isn't an interactive
    // affordance of its own, so it doesn't need keyboard parity — the actual keyboard/focus
    // support for this radiogroup lives on the child radio buttons, per ARIA authoring practice.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/interactive-supports-focus
    <div
      role="radiogroup"
      aria-label={labels.colorTheme}
      className={`theme-toggle${inline ? " theme-menu-inline" : ""}`}
      onClick={(event) => { if (inline) event.stopPropagation(); }}
    >
      {options.map(({ value, labelKey, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          tabIndex={theme === value ? 0 : -1}
          data-theme-value={value}
          onKeyDown={onRadioKey}
          aria-label={labels[labelKey]}
          title={labels[labelKey]}
          className={theme === value ? "active" : ""}
          onClick={() => choose(value)}
        >
          <Icon />
        </button>
      ))}
    </div>
  );
}
