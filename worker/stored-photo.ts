// A stored photo, answered by the Worker's entry instead of the app.
//
// /api/photo/<key> is the most-asked address on the site: a page of cards asks for one per card,
// where it asks for the deals once. Each went through the framework's router to reach
// app/api/photo, which costs more CPU than the photo does - 0.5 ms a request in local Node against
// 0.1 for this, and production runs about four times local - to hand back bytes that never change.
// So the entry answers a GET for one itself: from the colo's cache when it has the photo, else from
// R2, and the framework is not involved.
//
// The answer is the route's, header for header (tests/stored-photo.test.mjs holds the two
// together): the whole object or nothing, with its length declared, a year of immutable caching on
// a 200, a day on a 404, and a 503 marked no-store for a read that came up short. app/api/photo
// says why each of those is what it is. Anything this does not recognise - another method, a key
// the route would refuse - is left to the route, which still answers it.
//
// The colo's copy is kept under /__photo-cache/, a prefix worker/index.ts refuses to visitors, by
// the object's key alone: a key is written once, under a name that carries a timestamp or a hash of
// its bytes, so whatever query string a page adds to it names the same picture.

type PhotoObject = {
  size: number;
  httpEtag: string;
  writeHttpMetadata(headers: Headers): void;
  arrayBuffer(): Promise<ArrayBuffer>;
};

type PhotoBucket = { get(key: string): Promise<PhotoObject | null> };

const PHOTO_PATH = /^\/api\/photo\/([a-z0-9_/-]+\.(?:jpg|png|webp))$/i;

function incompleteRead(): Response {
  return new Response(null, { status: 503, headers: { "cache-control": "no-store", "retry-after": "1" } });
}

export async function storedPhoto(
  request: Request,
  url: URL,
  bucket: PhotoBucket | undefined,
  cache: Cache | null,
  waitUntil: (promise: Promise<unknown>) => void,
): Promise<Response | null> {
  if (request.method !== "GET" || !bucket || url.pathname.includes("//")) return null;
  const key = PHOTO_PATH.exec(url.pathname)?.[1];
  if (!key) return null;
  try {
    const cacheKey = new Request(`${url.origin}/__photo-cache/stored/${key}`, { method: "GET" });
    const hit = cache ? await cache.match(cacheKey).catch(() => undefined) : undefined;
    if (hit) {
      // Read in full and sent as bytes, so the length on the wire is the photo's.
      const bytes = await hit.arrayBuffer();
      if (bytes.byteLength && String(bytes.byteLength) === hit.headers.get("content-length")) {
        return new Response(bytes, { status: 200, headers: hit.headers });
      }
    }
    const object = await bucket.get(key);
    if (!object) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=86400" } });
    let bytes: ArrayBuffer;
    try {
      bytes = await object.arrayBuffer();
    } catch {
      return incompleteRead();
    }
    if (bytes.byteLength !== object.size) return incompleteRead();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("content-length", String(bytes.byteLength));
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("etag", object.httpEtag);
    // Only ever a complete read, so a copy the colo holds is a whole photo.
    if (cache) waitUntil(cache.put(cacheKey, new Response(bytes, { status: 200, headers })).catch(() => {}));
    return new Response(bytes, { status: 200, headers });
  } catch {
    // Left to the route, which answers as it always has.
    return null;
  }
}
