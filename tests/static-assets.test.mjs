import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crc32 } from "node:zlib";
import ts from "typescript";

// Files the asset layer serves, by itself or handed back through the Worker's ASSETS binding, which
// applies the same rules: their headers (public/_headers) and the install icons the manifest points
// at.

// The asset layer's responses — bundles, icons, /sw.js, og.png, the baked sitemap — used to carry
// neither nosniff nor HSTS, since withSecurityHeaders only ever sees what the Worker answers.
// vinext writes its own dist/client/_headers only when public/ has none, and that file held the one
// rule that makes hashed bundles immutable; replacing it without restating that rule would have
// every bundle revalidated on every page load.
test("public/_headers keeps vinext's immutable rule and adds nosniff and HSTS to everything", () => {
  const headers = readFileSync(new URL("../public/_headers", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  const rules = new Map();
  let current = null;
  for (const line of headers.split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = line.trim();
      rules.set(current, []);
    } else {
      rules.get(current).push(line.trim());
    }
  }
  assert.deepEqual(rules.get("/_next/static/*"), ["Cache-Control: public, max-age=31536000, immutable"]);
  // Resolved rather than joined onto a path, since a worktree finds node_modules by parent lookup.
  const vinext = readFileSync(new URL(import.meta.resolve("vinext")), "utf8");
  assert.ok(vinext.includes('"  Cache-Control: public, max-age=31536000, immutable"'), "vinext's own rule changed; restate the new one");
  assert.ok(vinext.includes('if (!fs.existsSync(headersPath))'), "vinext still defers to a _headers file in public/");
  const everything = rules.get("/*") || [];
  assert.ok(everything.includes("X-Content-Type-Options: nosniff"));
  assert.ok(everything.includes("Strict-Transport-Security: max-age=31536000; includeSubDomains"));
  assert.ok(!everything.some((header) => /preload/i.test(header)), "no preload");
  // The same HSTS value the Worker sends, so a file and a page never disagree.
  assert.ok(readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8").includes('"max-age=31536000; includeSubDomains"'));
});

// Walks a PNG's chunks, checking each CRC, and returns its width, height and colour type. The
// apple-touch-icon.png that shipped had a chunk named "IDAU" and no IEND: libpng refused it, and so
// did iOS. A header check alone had called it a 180x180 PNG.
function png(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", `${path} is not a PNG`);
  let offset = 8;
  let header = null;
  for (;;) {
    assert.ok(offset + 12 <= bytes.length, `${path} ends before its IEND chunk`);
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString("latin1");
    assert.ok(offset + 12 + length <= bytes.length, `${path}: ${type} runs past the end of the file`);
    const crc = bytes.readUInt32BE(offset + 8 + length);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + length)), crc, `${path}: bad CRC on ${type}`);
    if (type === "IHDR") header = { width: bytes.readUInt32BE(offset + 8), height: bytes.readUInt32BE(offset + 12), colorType: bytes[offset + 17] };
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return header;
}

// The manifest used to offer Android only the 24-px-design SVG and a 180 px PNG, with no maskable
// icon, so a launcher drew thin rings on transparency or a letterboxed square as the app's icon.
test("the manifest lists 192 and 512 px icons, a maskable one, and an id", async () => {
  const source = readFileSync(new URL("../app/manifest.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
  const { default: manifest } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
  const value = manifest();
  // start_url's own value, so every install made before `id` existed is still the same app.
  assert.equal(value.id, value.start_url);
  const pngs = value.icons.filter((icon) => icon.type === "image/png");
  const find = (sizes, purpose) => pngs.find((icon) => icon.sizes === sizes && icon.purpose === purpose);
  assert.ok(find("192x192", "any"), "a 192 px icon");
  assert.ok(find("512x512", "any"), "a 512 px icon");
  assert.ok(find("512x512", "maskable"), "a maskable icon");
  for (const icon of pngs) {
    const { width, height, colorType } = png(`../public${icon.src}`);
    assert.equal(`${width}x${height}`, icon.sizes, `${icon.src} is not the size the manifest says`);
    // Opaque: colour type 2 is RGB with no alpha. A launcher fills transparency however it likes.
    assert.equal(colorType, 2, `${icon.src} must be opaque`);
  }
});

test("the iOS home-screen icon is a whole, opaque 180 px PNG", () => {
  const { width, height, colorType } = png("../public/apple-touch-icon.png");
  assert.equal(width, 180);
  assert.equal(height, 180);
  assert.equal(colorType, 2);
});
