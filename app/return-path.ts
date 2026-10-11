// Where "Back to results" on a deal page goes.
//
// It used to travel in the deal link as `?return=`, which made every link from the homepage a URL
// with a parameter the deal page's server render reads - and any such parameter sends a deal page
// past its prerendered copy to a full render on the Worker (see SERVER_READ_PARAMS in
// worker/index.ts). So the homepage writes the search it was showing here, per tab, and the deal
// page's back link reads it once it is in the browser. The prerendered page's own link, before
// that, is the deal's city.
export const RETURN_STORAGE_KEY = "radar:return";

// The postal or ZIP code the reader last searched with, for the same reason: a deal link carrying
// `?postal=` would narrow a national chain's locations to the reader's state, and would also skip
// the prerendered page for a render on the Worker at every click from a postal search. The deal
// page fills its postal form from this instead, and narrowing is one tap the reader chooses.
export const POSTAL_STORAGE_KEY = "radar:postal";

/**
 * Only a path on this site: never a protocol-relative "//host", never an absolute URL - checked on
 * the resolved path as well as the raw one, since resolving "/.//host" produces "//host".
 */
export function storedReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return null;
  try {
    const url = new URL(value, "https://radar.invalid");
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (url.origin !== "https://radar.invalid" || path.startsWith("//") || path.startsWith("/\\")) return null;
    return path;
  } catch {
    return null;
  }
}
