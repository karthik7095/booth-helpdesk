#!/usr/bin/env node
// roll2xlsx <roll.pdf> [more.pdf ...] [-o out.xlsx] [--workers N] [--debug DIR]
import { parseArgs } from "node:util";
import { existsSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { convert } from "./convert.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: "string", short: "o" },
    workers: { type: "string", short: "w", default: "4" },
    debug: { type: "string" },
    photos: { type: "string" },
    lang: { type: "string", short: "l", default: "auto" },
    "cloud-url": { type: "string" },
    secondary: { type: "string", short: "s" },
    "xlit-url": { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});

if (values.help || positionals.length === 0) {
  console.log(`Usage: roll2xlsx <roll.pdf> [more.pdf ...] [-o out.xlsx] [--workers N] [--debug DIR]

Converts ECI electoral roll PDFs (Marathi, English or Telugu) to Excel voter lists by OCR.
  -o, --output   output .xlsx (single input only; default: next to the PDF)
  -w, --workers  OCR worker processes (default 4)
  -l, --lang     roll language: auto (default), mar, eng or tel
      --cloud-url  OCR service base URL (services/ocr, e.g. through an SSH tunnel):
                   boxes the on-device OCR cannot read cleanly are re-read there
  -s, --secondary  English rolls: add name columns in tel, hin or tel,hin
      --xlit-url   transliteration service base URL for --secondary (services/xlit,
                   e.g. http://127.0.0.1:4600 or through an SSH tunnel)
      --debug    directory to dump crops and raw text for boxes that need review
      --photos   AP SEC photo lists: save voter photos as <EPIC>.jpg in this directory
                 (several PDFs share it; zip it for the dashboard's Voter photos upload)`);
  process.exit(positionals.length ? 0 : 1);
}

for (const input of positionals) {
  if (!existsSync(input)) {
    console.error(`not found: ${input}`);
    process.exitCode = 1;
    continue;
  }
  const output = positionals.length === 1 && values.output
    ? values.output
    : join(dirname(input), basename(input, extname(input)).replace(/ \(\d+\)$/, "") + ".xlsx");
  console.log(`\n${input} -> ${output}`);
  const cloud = values["cloud-url"]?.replace(/\/$/, "");
  const remoteOcr = cloud
    ? async (pngs) => {
        const res = await fetch(`${cloud}/recognize`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ images: pngs.map((b) => b.toString("base64")) }),
          signal: AbortSignal.timeout(300_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.texts)) throw new Error(data.message || `OCR service answered ${res.status}`);
        return data.texts;
      }
    : null;
  const xlit = values["xlit-url"]?.replace(/\/$/, "");
  const transliterate = xlit
    ? async (words, lang) => {
        const res = await fetch(`${xlit}/transliterate`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lang, words }),
          signal: AbortSignal.timeout(300_000),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data.words)) throw new Error(data.message || `transliteration service answered ${res.status}`);
        return data.words;
      }
    : null;
  const secondary = values.secondary ? values.secondary.split(",").map((s) => s.trim()) : [];
  await convert({ input, output, workers: Number(values.workers), debugDir: values.debug, photosDir: values.photos, lang: values.lang, remoteOcr, secondary, transliterate });
}
