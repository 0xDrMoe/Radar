/**
 * Shrinks a photo in the browser before an admin or a restaurant manager uploads it.
 *
 * The same target as the scripts that store photos (scripts/photo-resize.mjs): 800 pixels wide,
 * WebP at quality 0.8. A card draws its photo about 362 CSS pixels wide, and a phone's camera roll
 * or a restaurant's press kit is 2,000 to 4,000. Uploaded as chosen, a single photo can be several
 * megabytes that every visitor then downloads to fill that box.
 *
 * It happens here rather than on the server because the Worker has no way to decode an image: the
 * Images binding is a paid feature and is deliberately not bound. The browser already has a
 * decoder and an encoder in <canvas>.
 *
 * Best effort by design. Anything that goes wrong (a browser that cannot decode the file, a canvas
 * that will not encode) hands back the original file, and the upload goes ahead as it always has,
 * within the server's own type and size checks. A photo that is too big is a smaller problem than
 * an upload that fails.
 */
export const UPLOAD_PHOTO_WIDTH = 800;
export const UPLOAD_PHOTO_QUALITY = 0.8;
const STORABLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/** The size to draw at: no wider than maxWidth, never enlarged, proportions kept. */
export function uploadSize(width: number, height: number, maxWidth = UPLOAD_PHOTO_WIDTH) {
  if (!(width > 0 && height > 0)) return null;
  if (width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

/**
 * Whether to send the re-encoded copy or the file as chosen. A photo wider than the target is
 * always sent re-encoded, when there is a usable copy to send. One already narrow enough is only
 * replaced when that makes it smaller, so a small, well-compressed JPEG is not made worse by a
 * second lossy pass for nothing.
 */
export function chooseUpload(
  original: { size: number; width: number },
  encoded: { size: number; type: string } | null,
  maxWidth = UPLOAD_PHOTO_WIDTH,
): "original" | "encoded" {
  if (!encoded || !encoded.size || !STORABLE_TYPES.has(encoded.type)) return "original";
  if (original.width > maxWidth) return "encoded";
  return encoded.size < original.size ? "encoded" : "original";
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

export async function shrinkPhotoForUpload(file: File): Promise<Blob> {
  let bitmap: ImageBitmap | null = null;
  try {
    // "from-image" turns a phone photo upright by its EXIF flag, as an <img> would show it.
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const size = uploadSize(bitmap.width, bitmap.height);
    if (!size) return file;
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    let encoded = await canvasBlob(canvas, "image/webp", UPLOAD_PHOTO_QUALITY);
    // Safari cannot encode WebP and quietly returns a PNG instead, which for a photo is larger than
    // what it started from. JPEG then, and JPEG has no transparency: without a white ground first,
    // a clear area would come out black.
    if (!encoded || encoded.type !== "image/webp") {
      context.globalCompositeOperation = "destination-over";
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
      encoded = await canvasBlob(canvas, "image/jpeg", UPLOAD_PHOTO_QUALITY);
    }
    return chooseUpload({ size: file.size, width: bitmap.width }, encoded) === "encoded" && encoded ? encoded : file;
  } catch {
    return file;
  } finally {
    bitmap?.close();
  }
}
