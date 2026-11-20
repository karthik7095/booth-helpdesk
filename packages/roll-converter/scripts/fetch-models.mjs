// Downloads the Tesseract language models used by the converter into the tessdata
// directory (or TESSDATA_DIR), so conversions and the desktop app work offline.
import { createWriteStream, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { tessdataDir } from "../src/ocr.mjs";

const BASE = "https://cdn.jsdelivr.net/npm/@tesseract.js-data";
const LANGS = ["mar", "tel", "eng"];

const dir = tessdataDir();
for (const lang of LANGS) {
  const target = join(dir, `${lang}.traineddata`);
  if (existsSync(target) && statSync(target).size > 1_000_000) {
    console.log(`${lang}: already present (${(statSync(target).size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  const url = `${BASE}/${lang}/4.0.0_best_int/${lang}.traineddata.gz`;
  console.log(`${lang}: downloading ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(target));
  console.log(`${lang}: saved ${target} (${(statSync(target).size / 1e6).toFixed(1)} MB)`);
}
