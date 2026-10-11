import { env } from "cloudflare:workers";

// Serves a stored photo from R2 with a year of immutable caching, which is only safe if every 200
// this route sends is the whole photo.
//
// It used to hand R2's body stream straight to the Response. The runtime sends a stream it cannot
// size with chunked encoding and no Content-Length, and a chunked body that stops early still ends
// with a clean terminator. Measured on production: 16 of 18 fetches of the same photos came back
// short (a 741,846-byte PNG as 266,240 bytes, a 689,706-byte WebP as 167,936), every one a 200 that
// closed normally. A browser has no way to tell such a body from a complete one, so it kept the top
// fifth of a photo, grey below it, for the year the header promised.
//
// So the object is read in full first and measured against the size R2 recorded for it. Only a
// complete read is sent, as bytes, with its Content-Length declared. With the length declared, a
// body cut off on its way to the visitor no longer looks finished. The browser sees a network
// error, and it does not cache one. A read that comes up short here gets a 503 marked no-store, so
// nothing between R2 and the visitor keeps it, and the next request tries again.
//
// Sending bytes is not enough by itself. The framework re-streams every route handler's body on
// its way out, and the runtime ignores a Content-Length header written onto a stream, so until
// worker/index.ts (bodyKeepingLength) put the declared length back on the wire, every GET of a
// photo still went out chunked with no length; only HEAD showed one.
//
// Holding the whole photo in memory is affordable because these are small. The fetch script caps a
// download at 750 KB, uploads are capped at 6 MB, and both now shrink a photo to 800 pixels wide
// before it is stored (scripts/photo-resize.mjs, app/photo-resize.ts), which is well under 200 KB.
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!/^[a-z0-9_/-]+\.(jpg|png|webp)$/i.test(key)) return new Response(null, { status: 400 });
  const object = await env.PHOTOS.get(key);
  // Kept by the browser for a day, the way app/api/restaurant-photo keeps its "no": a card whose
  // stored photo is missing falls back to its next picture, and without a lifetime it asked for the
  // missing one again on every view. Every key is written once under a new name (a timestamp or a
  // hash of the bytes), so one that is absent now is not about to appear.
  if (!object) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=86400" } });
  let bytes: ArrayBuffer;
  try {
    bytes = await object.arrayBuffer();
  } catch {
    return incompleteRead();
  }
  if (bytes.byteLength !== object.size) return incompleteRead();
  const responseHeaders = new Headers();
  object.writeHttpMetadata(responseHeaders);
  // What worker/index.ts sends as the length on the wire. It cannot come from the body: by the time
  // the response leaves the Worker the framework has turned the bytes back into a stream.
  responseHeaders.set("content-length", String(bytes.byteLength));
  responseHeaders.set("cache-control", "public, max-age=31536000, immutable");
  responseHeaders.set("etag", object.httpEtag);
  return new Response(bytes, { headers: responseHeaders });
}

function incompleteRead() {
  return new Response(null, { status: 503, headers: { "cache-control": "no-store", "retry-after": "1" } });
}
