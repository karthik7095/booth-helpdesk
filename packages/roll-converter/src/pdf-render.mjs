// Rasterises PDF pages with pdf.js (used when a roll PDF has no embedded page
// images, e.g. lists printed to PDF from a browser).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let pdfjs = null;
async function lib() {
  if (!pdfjs) {
    // pdf.js draws glyphs as paths in Node; it expects the browser globals below.
    const canvas = require("@napi-rs/canvas");
    globalThis.Path2D ??= canvas.Path2D;
    globalThis.DOMMatrix ??= canvas.DOMMatrix;
    globalThis.ImageData ??= canvas.ImageData;
    pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  }
  return pdfjs;
}

/** Open a PDF; returns the pdf.js document. */
export async function openPdf(path) {
  const { getDocument } = await lib();
  return getDocument({ data: new Uint8Array(readFileSync(path)), useSystemFonts: true, disableFontFace: true, verbosity: 0 }).promise;
}

/**
 * Render one page to a PNG buffer.
 * @param {import("pdfjs-dist").PDFDocumentProxy} doc
 * @param {number} pageNo 1-based
 * @param {number} scale 1 = 72 dpi; 4 ≈ 288 dpi
 */
export async function renderPage(doc, pageNo, scale = 4) {
  const { createCanvas } = require("@napi-rs/canvas");
  const page = await doc.getPage(pageNo);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  const png = canvas.toBuffer("image/png");
  page.cleanup();
  return { png, width: canvas.width, height: canvas.height, scale };
}

/** Positioned text items of a page in PDF points (origin top-left). */
export async function pageText(doc, pageNo) {
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items = tc.items
    .filter((i) => i.str !== undefined)
    .map((i) => ({ x: i.transform[4], y: vp.height - i.transform[5], w: i.width, h: i.height, s: i.str }));
  return { width: vp.width, height: vp.height, items };
}

/**
 * The images painted on a page (voter photos on AP SEC lists), each with where
 * it sits in PDF points (origin top-left) and its decoded pixels.
 * @returns {Promise<{x:number,y:number,w:number,h:number,width:number,height:number,channels:number,data:Uint8Array|Uint8ClampedArray}[]>}
 */
export async function pageImages(doc, pageNo) {
  const { OPS } = await lib();
  const page = await doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  const mul = (a, b) => [
    a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
  ];
  const stack = [[1, 0, 0, 1, 0, 0]];
  const placed = [];
  ops.fnArray.forEach((fn, i) => {
    if (fn === OPS.save) stack.push(stack.at(-1));
    else if (fn === OPS.restore) stack.length > 1 && stack.pop();
    else if (fn === OPS.transform) stack[stack.length - 1] = mul(stack.at(-1), ops.argsArray[i]);
    else if (fn === OPS.paintImageXObject) {
      // the image fills the unit square under the current matrix
      const m = stack.at(-1);
      const xs = [m[4], m[4] + m[0], m[4] + m[2], m[4] + m[0] + m[2]];
      const ys = [m[5], m[5] + m[1], m[5] + m[3], m[5] + m[1] + m[3]].map((y) => vp.height - y);
      placed.push({ id: ops.argsArray[i][0], x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    }
  });
  const out = [];
  for (const p of placed) {
    const store = p.id.startsWith("g_") ? page.commonObjs : page.objs;
    const img = await new Promise((resolve) => store.get(p.id, resolve)).catch(() => null);
    if (!img?.data || !img.width || !img.height) continue;
    // pdf.js ImageKind: 1 = 1-bit grey (packed rows), 2 = RGB, 3 = RGBA
    let { data } = img;
    let channels = img.kind === 3 ? 4 : 3;
    if (img.kind === 1) {
      const row = (img.width + 7) >> 3;
      const grey = new Uint8Array(img.width * img.height * 3);
      for (let y = 0; y < img.height; y++)
        for (let x = 0; x < img.width; x++) {
          const v = (data[y * row + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0;
          grey.set([v, v, v], (y * img.width + x) * 3);
        }
      data = grey;
      channels = 3;
    }
    out.push({ ...p, width: img.width, height: img.height, channels, data });
  }
  page.cleanup();
  return out;
}
