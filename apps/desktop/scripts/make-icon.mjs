// Builds build/icon.png (1024×1024) for electron-builder from the IRA Media
// Concepts wordmark: the mark on the left of the logo, centred on a white
// rounded plate with transparent margins, the shape macOS expects.
//
//   node apps/desktop/scripts/make-icon.mjs apps/mobile/assets/IMC_Logo_Transparent.png apps/desktop/build/icon.png
import sharp from "sharp";

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error("usage: make-icon.mjs <logo.png> <icon.png>");
  process.exit(1);
}

const SIZE = 1024;
const INSET = 100; // transparent margin around the plate
const RADIUS = 185; // plate corner radius
const MARK = 560; // longest side of the mark inside the plate

// Trim first so the crop is relative to the artwork, not the file's margins;
// the mark is the left ~19% of the wordmark. Separate sharp calls, because
// one pipeline always trims before it extracts.
const logo = await sharp(src).trim().toBuffer({ resolveWithObject: true });
const markWidth = Math.round(logo.info.width * 0.19);
const cropped = await sharp(logo.data).extract({ left: 0, top: 0, width: markWidth, height: logo.info.height }).toBuffer();
const mark = await sharp(cropped).trim().resize(MARK, MARK, { fit: "inside" }).toBuffer({ resolveWithObject: true });

const plate = Buffer.from(
  `<svg width="${SIZE}" height="${SIZE}"><rect x="${INSET}" y="${INSET}" width="${SIZE - 2 * INSET}" height="${SIZE - 2 * INSET}" rx="${RADIUS}" fill="#ffffff"/></svg>`,
);

await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([
    { input: plate },
    {
      input: mark.data,
      left: Math.round((SIZE - mark.info.width) / 2),
      top: Math.round((SIZE - mark.info.height) / 2),
    },
  ])
  .png()
  .toFile(out);

console.log(`wrote ${out} (mark ${mark.info.width}×${mark.info.height})`);
