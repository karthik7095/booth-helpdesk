// Pull every DCTDecode (JPEG) stream out of a PDF, in page order. No dependencies.
import { readFileSync } from "node:fs";

/** @returns {Buffer[]} one JPEG per page, in page order */
export function extractPageImages(src) {
const buf = readFileSync(src);
const out = [];

const latin = buf.toString("latin1");

// Map image object number -> JPEG bytes
const images = new Map();
const objRe = /(\d+) 0 obj\s*<<([^]*?)>>\s*stream\r?\n/g;
let m;
while ((m = objRe.exec(latin))) {
  const [, num, dict] = m;
  if (!/\/Subtype\s*\/Image/.test(dict) || !/\/DCTDecode/.test(dict)) continue;
  const len = Number(/\/Length\s+(\d+)/.exec(dict)?.[1]);
  const start = m.index + m[0].length;
  images.set(Number(num), buf.subarray(start, start + len));
}

if (!images.size) return out;

// Page order: /Kids [...] list, then each page's XObject reference
const kids = /\/Kids\s*\[([^\]]+)\]/.exec(latin)[1].match(/\d+(?= 0 R)/g).map(Number);
let page = 0;
for (const k of kids) {
  page++;
  const pm = new RegExp(`(?<!\\d)${k} 0 obj\\s*<<([^]*?)>>`).exec(latin);
  const dict = pm?.[1] ?? "";
  // XObject dictionary may be inline or a reference; collect any image objects referenced
  let refs = [...dict.matchAll(/\/Im\w*\s+(\d+) 0 R/g)].map((x) => Number(x[1]));
  if (!refs.length) {
    const res = /\/Resources\s+(\d+) 0 R/.exec(dict);
    if (res) {
      const rm = new RegExp(`(?<!\\d)${res[1]} 0 obj\\s*<<([^]*?)>>`).exec(latin);
      refs = [...(rm?.[1] ?? "").matchAll(/\/\w+\s+(\d+) 0 R/g)].map((x) => Number(x[1])).filter((n) => images.has(n));
    }
    if (!refs.length) {
      const xo = /\/XObject\s+(\d+) 0 R/.exec(dict);
      if (xo) {
        const xm = new RegExp(`(?<!\\d)${xo[1]} 0 obj\\s*<<([^]*?)>>`).exec(latin);
        refs = [...(xm?.[1] ?? "").matchAll(/\/\w+\s+(\d+) 0 R/g)].map((x) => Number(x[1])).filter((n) => images.has(n));
      }
    }
  }
  let jpg = refs.map((r) => images.get(r)).find(Boolean);
  if (!jpg) {
    // fall back to the Nth image object in file order
    const ordered = [...images.keys()].sort((a, b) => a - b);
    jpg = images.get(ordered[page - 1]);
  }
  out.push(jpg);
}
return out;
}
