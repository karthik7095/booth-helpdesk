import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const [file, ...pageArgs] = process.argv.slice(2);
const doc = await getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true, disableFontFace: true }).promise;
console.log("pages", doc.numPages);
for (const pn of pageArgs.map(Number)) {
  const page = await doc.getPage(pn);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  console.log(`--- page ${pn} size ${vp.width}x${vp.height} items ${tc.items.length}`);
  // group into lines by y
  const items = tc.items.filter((i) => i.str.trim()).map((i) => ({ x: Math.round(i.transform[4]), y: Math.round(vp.height - i.transform[5]), w: Math.round(i.width), s: i.str }));
  items.sort((a, b) => a.y - b.y || a.x - b.x);
  let lines = []; let cur = null;
  for (const it of items) { if (!cur || Math.abs(it.y - cur.y) > 3) { cur = { y: it.y, parts: [] }; lines.push(cur); } cur.parts.push(it); }
  for (const l of lines.slice(0, Number(process.env.LINES ?? 60))) console.log(String(l.y).padStart(4), l.parts.map((p) => `[${p.x}]${p.s}`).join("  "));
}
