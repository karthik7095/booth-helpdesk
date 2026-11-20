// Tesseract worker pools, created lazily per (languages, page-segmentation mode)
// because both are per-worker settings.
import { createScheduler, createWorker } from "tesseract.js";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Directory holding <lang>.traineddata. The desktop app points TESSDATA_DIR at
 * its bundled copy; otherwise models are cached in the package (downloaded on
 * first use, or pre-fetched with `npm run roll:models`).
 */
export function tessdataDir() {
  const dir = process.env.TESSDATA_DIR || fileURLToPath(new URL("../tessdata", import.meta.url));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * @param {{workers?:number}} opts
 */
export async function createOcr({ workers = 4 } = {}) {
  const cachePath = tessdataDir();
  const pools = new Map();

  async function pool(langs, psm, size) {
    const key = `${langs.join("+")}/${psm}`;
    if (!pools.has(key)) {
      pools.set(
        key,
        (async () => {
          const scheduler = createScheduler();
          for (let i = 0; i < size; i++) {
            const w = await createWorker(langs, 1, { cachePath });
            await w.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: "1" });
            scheduler.addWorker(w);
          }
          return scheduler;
        })(),
      );
    }
    return pools.get(key);
  }

  const run = async (scheduler, img) => {
    const { data } = await scheduler.addJob("recognize", img);
    return { text: data.text ?? "", confidence: data.confidence ?? 0 };
  };

  /**
   * @param {Buffer} img
   * @param {{langs?:string[], mode?:"block"|"line"}} [o]
   */
  async function recognize(img, { langs = ["mar", "eng"], mode = "block" } = {}) {
    const psm = mode === "line" ? "7" : "6";
    const size = mode === "line" ? Math.max(1, Math.ceil(workers / 2)) : workers;
    return run(await pool(langs, psm, size), img);
  }

  return {
    recognize,
    // ECI roll pipeline: Marathi rolls use the mixed model for the text block,
    // English rolls the English-only one; serial/EPIC lines are always English
    text: (img) => recognize(img, { langs: ["mar", "eng"], mode: "block" }),
    textMarathi: (img) => recognize(img, { langs: ["mar"], mode: "block" }),
    textEnglish: (img) => recognize(img, { langs: ["eng"], mode: "block" }),
    line: (img) => recognize(img, { langs: ["eng"], mode: "line" }),
    // Telugu ward-list pipeline
    teluguLine: (img) => recognize(img, { langs: ["tel", "eng"], mode: "line" }),
    teluguOnlyLine: (img) => recognize(img, { langs: ["tel"], mode: "line" }),
    teluguText: (img) => recognize(img, { langs: ["tel", "eng"], mode: "block" }),
    teluguOnlyText: (img) => recognize(img, { langs: ["tel"], mode: "block" }),
    terminate: async () => {
      for (const p of pools.values()) await (await p).terminate();
      pools.clear();
    },
  };
}
