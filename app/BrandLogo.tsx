"use client";
import { useState } from "react";
import { photoSrc } from "./photo-url";
// Only the restaurant's own website names its mark. The deal's source_url used to stand in when no
// website was on file, and for some deals that source is a third-party deal listing site, so the
// card carried the listing site's favicon as though it were the restaurant's logo. A page that
// lists the offer is not the restaurant; with no website of its own the card shows the
// restaurant's initial instead, which is at least true.
function faviconUrl(website?: string | null) {
  if (!website) return null;
  try {
    return `https://www.google.com/s2/favicons?sz=128&domain=${new URL(website).hostname}`;
  } catch {
    return null;
  }
}
/**
 * The brand's mark: its own logo when Radar stored one (restaurants.logo_url, served from R2), else
 * the favicon of the restaurant's own website, else its initial. Each step is taken only when the
 * one before it failed to load, so a stored logo that has gone missing falls back rather than
 * leaving a broken image.
 *
 * `source` is accepted and ignored. It was the deal's source page, used as a stand-in website; it
 * stays in the type only so a caller still passing it keeps compiling while it is taken out.
 */
export default function BrandLogo({ name, website, logoUrl, className }: {
  name: string;
  website?: string | null;
  /** @deprecated Ignored. A deal's source page is not the restaurant's website; pass `website`. */
  source?: string | null;
  logoUrl?: string | null;
  className?: string;
}) {
  const candidates = [logoUrl, faviconUrl(website)].filter((url): url is string => Boolean(url));
  const [failed, setFailed] = useState<string[]>([]);
  const url = candidates.find((candidate) => !failed.includes(candidate));
  const cls = `brand-logo${className ? ` ${className}` : ""}${url && url === logoUrl ? " brand-logo-stored" : ""}`;
  if (!url) {
    return (
      <span className={`${cls} brand-logo-fallback`} aria-hidden="true">
        {(name || "?").trim()[0]?.toUpperCase() || "?"}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a stored logo or an external favicon, sized by CSS
    <img
      key={url}
      className={cls}
      src={photoSrc(url)}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      onError={() => setFailed((list) => [...list, url])}
    />
  );
}
