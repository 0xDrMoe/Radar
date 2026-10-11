import { ACCENTS, isAccentKey, readableOn } from "./theme-accents";

const ACCENT_STORAGE_KEY = "radar-accent";

export function storedAccent(): string {
  if (typeof localStorage === "undefined") return "coral";
  const stored = localStorage.getItem(ACCENT_STORAGE_KEY);
  return isAccentKey(stored) ? stored : "coral";
}

export function storeAccent(key: string) {
  localStorage.setItem(ACCENT_STORAGE_KEY, isAccentKey(key) ? key : "coral");
}

export function applyAccent(accentKey: string, resolvedTheme: "light" | "dark") {
  const accent = ACCENTS[isAccentKey(accentKey) ? accentKey : "coral"];
  const dark = resolvedTheme === "dark";
  // Two tokens, because one hex cannot both sit behind white and be read on cream. --coral is the
  // brand color and fills things; --coral-strong is what text is written in. Setting only the
  // first would leave every accent but Coral writing in Coral.
  const strong = dark ? accent.dark : accent.strong;
  document.documentElement.style.setProperty("--coral", dark ? accent.dark : accent.light);
  document.documentElement.style.setProperty("--coral-strong", strong);
  document.documentElement.style.setProperty("--on-coral", readableOn(strong));
}
