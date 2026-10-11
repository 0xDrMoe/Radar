"use client";
import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import ChromeLink from "../../../ChromeLink";
import { RETURN_STORAGE_KEY, storedReturnPath } from "../../../return-path";

/**
 * The deal page's way back to the search that led here. Server-rendered with the deal's city (or a
 * legacy `?return=`), then pointed at the reader's own search once the browser can say what it was.
 * A link that arrived with `?return=` keeps it: that is the older, explicit form of the same thing.
 *
 * A ChromeLink when the search is in this page's language (app/ChromeLink.tsx): a page load of the
 * baked home page for a reader without a session cookie, a client-side navigation for one with it,
 * whose pages are rendered either way. Anywhere else - a stored search in another language, a
 * legacy return to some other page - it stays the plain link it always was.
 */
export default function BackToResults({ href, label, preferStored }: { href: string; label: string; preferStored: boolean }) {
  const [target, setTarget] = useState(href);
  const locale = useLocale();
  useEffect(() => {
    if (!preferStored) return;
    try {
      const stored = storedReturnPath(sessionStorage.getItem(RETURN_STORAGE_KEY));
      // Reading browser storage once after hydration - the one thing the server could not know.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setTarget(stored);
    } catch {
      // Storage refused (private mode, blocked site data): the city link stands.
    }
  }, [preferStored]);
  const home = homeSearch(target, locale);
  return home ? <ChromeLink href={home}>{label}</ChromeLink> : <a href={target}>{label}</a>;
}

/**
 * `target` as the locale-less address ChromeLink takes, when it is this locale's home page with its
 * search ("/fr?city=Ottawa" in fr is "/?city=Ottawa"); null for any other address.
 */
function homeSearch(target: string, locale: string): `/${string}` | null {
  const home = `/${locale}`;
  if (target === home) return "/";
  if (target.startsWith(`${home}?`) || target.startsWith(`${home}#`)) return `/${target.slice(home.length)}`;
  return null;
}
