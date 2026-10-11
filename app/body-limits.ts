// Reading a body no further than a byte limit.
//
// arrayBuffer() and text() buffer whatever arrives before anything can measure it, and a body with
// no Content-Length (chunked, or a server that simply leaves it out) says nothing in advance. Reading
// the stream lets an oversized body be stopped at the limit instead of after it has filled memory.
// No cloudflare:workers import, so plain Node tests can load it.

/**
 * The stream's bytes, up to maxBytes inclusive. Past that the stream is canceled and, with
 * "refuse", PAYLOAD_TOO_LARGE is thrown; with "truncate" the first maxBytes come back, for callers
 * that only need the start of a body.
 */
export async function readStreamCapped(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  overflow: "refuse" | "truncate" = "refuse",
): Promise<Uint8Array<ArrayBuffer>> {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {});
      if (overflow === "refuse") throw new Error("PAYLOAD_TOO_LARGE");
      chunks.push(value.subarray(0, maxBytes - received));
      received = maxBytes;
      break;
    }
    received += value.byteLength;
    chunks.push(value);
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function isPayloadTooLarge(error: unknown) {
  return error instanceof Error && error.message === "PAYLOAD_TOO_LARGE";
}
