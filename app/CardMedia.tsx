"use client";
import { useEffect, useRef, useState } from "react";
import { photoSrc } from "./photo-url";
import { CARD_PHOTO_SIZES, responsivePhotoProps } from "./photo-srcset";

/**
 * The picture at the top of a card, tried in order until one loads:
 *
 *   1. the photos Radar stored - the offer's own, then the restaurant's, then its gallery;
 *   2. the brand's stored logo, when there is one, drawn whole rather than cropped;
 *   3. only when neither exists, the live search of the restaurant's own website;
 *   4. the emoji.
 *
 * The logo goes ahead of the live search on purpose. A national chain's homepage is a carousel of
 * whatever it is selling this week, and the search takes the first large image it finds; the
 * chain's own mark is what a reader recognises the card by. For a restaurant with no logo on file
 * - most independents - nothing changes.
 *
 * The live search runs only against the restaurant's own website. It used to fall back to the
 * deal's source page, and when a restaurant has no website on file that page is usually a
 * third-party deal listing site: the photo route refuses those, so every such card spent a Worker
 * request on a 404 before showing the emoji it was always going to show.
 * `source` is still accepted so existing callers compile, and is ignored.
 */
export default function CardMedia({
  website,
  photoUrl,
  extraPhotoUrls,
  logoUrl,
  emoji,
  emojiClassName,
  className,
  sizes = CARD_PHOTO_SIZES,
  priority = false,
  alt,
  children,
}: {
  website?: string | null;
  /** @deprecated Ignored. A deal's source page is not the restaurant's website; pass `website`. */
  source?: string | null;
  photoUrl?: string | null;
  extraPhotoUrls?: ReadonlyArray<string | null | undefined>;
  logoUrl?: string | null;
  emoji?: string;
  emojiClassName?: string;
  className?: string;
  /** The rendered width of the photo slot, for srcset. Cards by default. */
  sizes?: string;
  /** The page's main image, above the fold: fetched at once and first, not lazily (the page's LCP). */
  priority?: boolean;
  /** What the photo shows, when it says something the text beside it does not. Decorative otherwise. */
  alt?: string;
  children?: React.ReactNode;
}) {
  const stored = [photoUrl, ...(extraPhotoUrls || [])].filter((url): url is string => Boolean(url));
  const candidates: Array<{ src: string; logo: boolean }> = [...new Set(stored)].map((src) => ({ src, logo: false }));
  if (logoUrl) candidates.push({ src: logoUrl, logo: true });
  else if (!stored.length && website) candidates.push({ src: `/api/restaurant-photo?url=${encodeURIComponent(website)}`, logo: false });
  const key = candidates.map((candidate) => candidate.src).join("|");

  const [attempt, setAttempt] = useState({ key, index: 0, status: "loading" as "loading" | "loaded" | "error" });
  // A new set of candidates - the card now shows another deal - starts again from the first,
  // compared during render rather than reset in an effect.
  if (attempt.key !== key) setAttempt({ key, index: 0, status: "loading" });
  const index = attempt.key === key ? attempt.index : 0;
  const status = attempt.key === key ? attempt.status : "loading";
  const current = candidates[index];
  const imgRef = useRef<HTMLImageElement>(null);
  const fail = () => setAttempt((state) => state.key !== key ? state
    : state.index + 1 < candidates.length ? { key, index: state.index + 1, status: "loading" }
    : { key, index: state.index, status: "error" });
  useEffect(() => {
    // On server-rendered pages the browser can finish loading a cached image before React
    // hydrates and attaches onLoad, so the event fires too early to be caught - check the
    // element's own completion state as a fallback.
    const img = imgRef.current;
    if (!img || !img.complete) return;
    if (img.naturalWidth > 0) setAttempt((state) => state.key === key ? { ...state, status: "loaded" } : state);
    else fail();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `fail` closes over `key`, listed here
  }, [current?.src, key]);
  const loaded = status === "loaded";
  const showPhoto = Boolean(current) && status !== "error";
  return (
    <div className={`${className || ""}${loaded ? " has-photo" : ""}${loaded && current?.logo ? " has-logo" : ""}`}>
      {emoji && !loaded && (emojiClassName ? <div className={emojiClassName}>{emoji}</div> : emoji)}
      {showPhoto && current && (
        // eslint-disable-next-line @next/next/no-img-element -- arbitrary external restaurant photo URL with CSS-driven (not fixed) sizing
        <img
          key={current.src}
          ref={imgRef}
          className={`card-media-img${current.logo ? " card-media-logo" : ""} ${loaded ? "loaded" : "pending"}`}
          src={photoSrc(current.src)}
          {...(current.logo ? {} : responsivePhotoProps(photoSrc(current.src), sizes))}
          alt={current.logo ? "" : alt ?? ""}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
          onLoad={() => setAttempt((state) => state.key === key ? { ...state, status: "loaded" } : state)}
          onError={fail}
        />
      )}
      {children}
    </div>
  );
}
