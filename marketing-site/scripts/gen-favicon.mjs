// Logo + Foundation slice — favicon ladder generator.
// Reads public/brand/astrant-mark-dark.png (the canonical 1254x1254 mark)
// and emits a standard favicon ladder into public/.
//
// Run: node scripts/gen-favicon.mjs
//
// Deliverables (per slice spec):
//   - public/favicon.ico             (multi-res ICO with 16/32/48 frames)
//   - public/favicon-16.png
//   - public/favicon-32.png
//   - public/favicon-48.png
//   - public/apple-touch-icon.png    (180x180)
//   - public/icon-192.png            (PWA / Android)
//   - public/icon-512.png            (PWA / Android)
//
// sharp is reachable as a transitive dep of next.js — no extra install needed.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "public/brand/astrant-mark-dark.png");
const PUB = resolve(ROOT, "public");

const PNG_SIZES = [
  { name: "favicon-16.png", size: 16 },
  { name: "favicon-32.png", size: 32 },
  { name: "favicon-48.png", size: 48 },
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
];

// Minimal multi-res ICO writer. Embeds PNG-encoded frames (Vista+ format,
// which every contemporary browser supports). Avoids pulling in another dep.
function buildIco(frames) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(frames.length, 4);

  const dirEntries = [];
  const dataChunks = [];
  let offset = 6 + 16 * frames.length;

  for (const f of frames) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(f.size === 256 ? 0 : f.size, 0); // width
    entry.writeUInt8(f.size === 256 ? 0 : f.size, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(f.png.length, 8); // size of bitmap data
    entry.writeUInt32LE(offset, 12); // offset of bitmap data
    dirEntries.push(entry);
    dataChunks.push(f.png);
    offset += f.png.length;
  }

  return Buffer.concat([header, ...dirEntries, ...dataChunks]);
}

async function main() {
  await mkdir(PUB, { recursive: true });

  for (const { name, size } of PNG_SIZES) {
    const buf = await sharp(SRC)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    await writeFile(resolve(PUB, name), buf);
    console.log(`wrote ${name} (${buf.length} bytes)`);
  }

  // Build favicon.ico from the 16/32/48 frames.
  const icoFrames = [];
  for (const size of [16, 32, 48]) {
    const png = await sharp(SRC)
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    icoFrames.push({ size, png });
  }
  const ico = buildIco(icoFrames);
  await writeFile(resolve(PUB, "favicon.ico"), ico);
  console.log(`wrote favicon.ico (${ico.length} bytes, ${icoFrames.length} frames)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
