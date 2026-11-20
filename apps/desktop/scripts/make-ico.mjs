// Builds build/icon.ico from build/icon.png: one PNG-compressed entry per
// size (Windows Vista and later read PNG entries, and 256 px must be PNG).
//
//   node apps/desktop/scripts/make-ico.mjs apps/desktop/build/icon.png apps/desktop/build/icon.ico
import { writeFileSync } from "node:fs";
import sharp from "sharp";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: make-ico.mjs <icon.png> <icon.ico>");
  process.exit(1);
}

const SIZES = [256, 128, 64, 48, 32, 24, 16];
const images = await Promise.all(SIZES.map((s) => sharp(src).resize(s, s).png().toBuffer()));

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(SIZES.length, 4);

const dir = Buffer.alloc(16 * SIZES.length);
let offset = header.length + dir.length;
SIZES.forEach((s, i) => {
  const e = i * 16;
  dir.writeUInt8(s === 256 ? 0 : s, e); // width, 0 means 256
  dir.writeUInt8(s === 256 ? 0 : s, e + 1); // height
  dir.writeUInt8(0, e + 2); // palette
  dir.writeUInt8(0, e + 3); // reserved
  dir.writeUInt16LE(1, e + 4); // colour planes
  dir.writeUInt16LE(32, e + 6); // bits per pixel
  dir.writeUInt32LE(images[i].length, e + 8);
  dir.writeUInt32LE(offset, e + 12);
  offset += images[i].length;
});

writeFileSync(out, Buffer.concat([header, dir, ...images]));
console.log(`wrote ${out} (${SIZES.join(", ")} px)`);
