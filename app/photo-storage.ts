import { env } from "cloudflare:workers";
import { isPayloadTooLarge, readStreamCapped } from "./body-limits";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 6_000_000;

// The type the file's own first bytes say it is, for the three formats stored. The declared
// Content-Type is the uploader's to choose, so it only decides whether to try; what is stored, and
// what /api/photo later serves the file as, comes from the bytes.
export function sniffPhotoType(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte)) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

export async function savePhoto(scope: string, id: string, request: Request): Promise<{ url: string }> {
  const declared = (request.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_TYPES.has(declared)) throw new Error("Only JPEG, PNG, or WebP images are supported.");
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) throw new Error("Images must be smaller than 6 MB.");
  let body: Uint8Array<ArrayBuffer>;
  try {
    body = await readStreamCapped(request.body, MAX_BYTES);
  } catch (error) {
    if (isPayloadTooLarge(error)) throw new Error("Images must be smaller than 6 MB.");
    throw error;
  }
  if (!body.byteLength) throw new Error("The uploaded file is empty.");
  const contentType = sniffPhotoType(body);
  if (!contentType) throw new Error("Only JPEG, PNG, or WebP images are supported.");
  const ext = contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
  const key = `${scope}/${id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  await env.PHOTOS.put(key, body, { httpMetadata: { contentType } });
  return { url: `/api/photo/${key}` };
}
