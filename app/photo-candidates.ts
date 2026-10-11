// Finding a usable photo on a restaurant's own web page, shared by the two places that do it:
// app/api/restaurant-photo/route.ts, which does it live for a visitor, and
// scripts/fetch-restaurant-photos.mjs, which does it ahead of time and stores the result.
//
// Shared rather than copied because the two must agree. The two run in different places, so a
// drift between them would show up as a photo that appears when the script runs and vanishes when
// it doesn't.
// Nothing here touches the network or cloudflare:workers, so plain Node can import it.

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Above this a card photo costs more than it earns. Measured across the catalog's restaurant
// sites: the median photo is a reasonable 168 KB, but p90 is 1.35 MB and the largest is 10.9 MB —
// almost all the weight sits in a handful of giants. So the ceiling goes where the tail starts,
// not near the median. A 200 KB cap would save a further tenth of the bytes while rejecting
// roughly three times as many photos, which is a bad trade for a card image.
//
// Neither caller can resize, because the image optimizer's `images` binding is not configured and
// /_vinext/image returns identical bytes at w=64 and w=1200. Enabling it would make this ceiling
// unnecessary — resize instead of reject — and is the better fix whenever it becomes worth its
// cost.
export const MAX_PHOTO_BYTES = 750 * 1024;

// A page's own images, tried in order when the first is too heavy. Bounded because each one costs
// a request, and past the first few a page is offering decoration rather than a photo of the room.
export const MAX_CANDIDATES = 4;

// Words that mark an <img> as furniture rather than a photograph of the place.
const SKIP_HINTS = ["logo", "icon", "sprite", "favicon", "arrow", "map", "avatar", "placeholder"];

// A raster extension anywhere in the URL, not only at the end of it. Image proxies carry the real
// file in a query parameter — JOEY's photo arrives as
// /_next/image?url=…%2FLocation-Burnaby_Hero.jpg&w=1920&q=75 — so a pattern anchored to the end of
// the string throws away the one picture on the page.
const RASTER_EXT = /\.(jpe?g|png|webp)([?&#]|$)/i;

// Extensions worth a fetch when one is present at the end of the path. Everything else with an
// extension is something we could not store even if it arrived: PHOTO_TYPES holds jpeg, png and
// webp alone, so an .svg or .avif is a wasted request rather than a candidate.
const STORABLE_EXT = new Set(["jpg", "jpeg", "png", "webp"]);

/** The extension at the end of the URL's path, or null when the last segment carries none. */
function pathExtension(src: string) {
  let pathname = src;
  try {
    pathname = new URL(src, "https://example.invalid").pathname;
  } catch {
    // Keep the raw string; a malformed URL is still worth the cheap suffix test below.
  }
  const last = pathname.split("/").pop() || "";
  const dot = last.lastIndexOf(".");
  if (dot <= 0 || dot === last.length - 1) return null;
  const ext = last.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
}

/**
 * Whether a URL is worth spending a fetch on, and how confident we are.
 *
 * "maybe" exists because a URL without an extension says nothing either way. White Spot's photos
 * are base64-encoded paths on its own CDN — craft-assets.whitespot.ca/eyJidWNrZXQiOiJ3aGl0ZXNwb3Q…
 * — with no extension anywhere, and the old end-anchored test discarded all twenty of them. The
 * content-type check at fetch time is the real gate in both callers, so the URL only has to decide
 * what is worth asking for.
 */
function candidateConfidence(src: string): "yes" | "maybe" | "no" {
  if (RASTER_EXT.test(src)) return "yes";
  const ext = pathExtension(src);
  if (ext === null) return "maybe";
  return STORABLE_EXT.has(ext) ? "yes" : "no";
}

// og:image gets a narrower version of the same test, against its filename alone. A venue's social
// share image is very often its logo — Boston Pizza's is literally seo-logo-1200x630.png, shared by
// every one of its locations, and La Cage's is logo-cage.jpeg — and a wall of identical brand marks
// is worse on a board of cards than the emoji each would otherwise show. Narrower and filename-only
// because og:image is the venue's deliberate choice and deserves the benefit of the doubt: "map" or
// "avatar" appearing somewhere in a long URL is not enough to throw it away.
const BRAND_FURNITURE = ["logo", "badge", "icon", "favicon", "sprite", "placeholder"];

function isBrandFurniture(url: string) {
  let filename = url;
  try {
    filename = new URL(url).pathname;
  } catch {
    // Keep the raw string; the check below is only a hint either way.
  }
  const last = filename.split("/").pop() || "";
  return BRAND_FURNITURE.some((hint) => last.toLowerCase().includes(hint));
}

// A card photo is drawn with object-fit: cover across a card at least 170px tall, so anything
// genuinely small arrives blurry or stretched. The test is on the shorter side rather than on width
// and height separately, because shape carries no information about quality here — measured across
// the catalog, the junk and the photographs separate cleanly and only on this number:
//
//   furniture   50x50, 67x139, 78x80, 138x109, 142x78, 180x89, 188x188, 196x196, 238x80,
//               278x239, 300x200, 345x230, 360x110      -> shorter side 50..239
//   photographs 500x300, 377x656, 450x450, 550x530, 800x450, 1200x630, 1500x450 -> 300 and up
//
// A width-based rule was tried first and was wrong: it discarded the 450x450 location photographs
// that Kelsey's, Montana's, Swiss Chalet, Harvey's and East Side Mario's publish, which are real
// pictures of the restaurant and perfectly good on a card — they are merely square.
export const MIN_PHOTO_SIDE = 300;

// The intrinsic size from the file header — a header read, not a decode, and only for the three
// formats we store. Returns null when the size cannot be read, which callers treat as "keep it":
// this rejects images known to be too small, never ones merely unrecognized.
export function imageSize(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const data = new DataView(view.buffer, view.byteOffset, view.byteLength);
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...view.subarray(start, end));

  if (view.length > 24 && view[0] === 0x89 && view[1] === 0x50) {
    return { width: data.getUint32(16), height: data.getUint32(20) };
  }
  if (view.length > 4 && view[0] === 0xff && view[1] === 0xd8) {
    let i = 2;
    while (i < view.length - 9) {
      if (view[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = view[i + 1];
      // A start-of-frame marker carries the size; the other 0xffCn markers do not.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.getUint16(i + 5), width: data.getUint16(i + 7) };
      }
      i += 2 + data.getUint16(i + 2);
    }
    return null;
  }
  if (view.length > 30 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    const format = ascii(12, 16);
    if (format === "VP8X") {
      const read24 = (at: number) => view[at] | (view[at + 1] << 8) | (view[at + 2] << 16);
      return { width: 1 + read24(24), height: 1 + read24(27) };
    }
    if (format === "VP8 ") return { width: data.getUint16(26, true) & 0x3fff, height: data.getUint16(28, true) & 0x3fff };
    if (format === "VP8L") {
      const bits = data.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

// True only when the header says it is too small to use. An unreadable header is not a rejection.
export function isTooSmall(bytes: ArrayBuffer | Uint8Array) {
  const size = imageSize(bytes);
  if (!size || !size.width || !size.height) return false;
  return Math.min(size.width, size.height) < MIN_PHOTO_SIDE;
}

export const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function extensionFor(contentType: string) {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/jpeg") return "jpg";
  return null;
}

function resolveUrl(candidate: string, base: string) {
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function extractOgImage(html: string, pageUrl: string) {
  const metaTags = html.match(/<meta[^>]+>/gi) || [];
  for (const tag of metaTags) {
    if (!/property=["']og:image["']|name=["']og:image["']/i.test(tag)) continue;
    const match = tag.match(/content=["']([^"']+)["']/i);
    if (match) return resolveUrl(match[1], pageUrl);
  }
  return null;
}

function extractContentImages(html: string, pageUrl: string) {
  // Kept apart and concatenated at the end, so a page that names its files properly behaves exactly
  // as it did before this split existed. Merging them in document order would let four extensionless
  // URLs fill MAX_CANDIDATES and crowd out a real photograph further down the same page — trading
  // one failure mode for another.
  const named: string[] = [];
  const unknown: string[] = [];
  const imgTags = html.match(/<img[^>]+src=["']([^"']+)["'][^>]*>/gi) || [];
  for (const tag of imgTags) {
    const match = tag.match(/src=["']([^"']+)["']/i);
    if (!match) continue;
    const src = match[1];
    const confidence = candidateConfidence(src);
    if (confidence === "no") continue;
    const lower = (tag + src).toLowerCase();
    if (SKIP_HINTS.some((hint) => lower.includes(hint))) continue;
    const resolved = resolveUrl(src, pageUrl);
    if (!resolved) continue;
    (confidence === "yes" ? named : unknown).push(resolved);
    if (named.length >= MAX_CANDIDATES) break;
  }
  return [...named, ...unknown].slice(0, MAX_CANDIDATES);
}

// og:image first — it is the picture the venue chose to represent itself — then whatever else the
// page offers, so an oversized hero does not cost the restaurant its photo when a usable one sits
// further down the same page.
export function photoCandidates(html: string, pageUrl: string) {
  const ordered = [extractOgImage(html, pageUrl), ...extractContentImages(html, pageUrl)];
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const candidate of ordered) {
    if (!candidate || seen.has(candidate) || isBrandFurniture(candidate)) continue;
    seen.add(candidate);
    candidates.push(candidate);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}
