// Pipeline: PDF -> page images -> cover metadata + per-box OCR -> workbook.
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { extractPageImages } from "./pdf-images.mjs";
import { detectGrid, boxRegions, innerFrame } from "./layout.mjs";
import { createOcr } from "./ocr.mjs";
import { parseCover, detectLanguage } from "./cover.mjs";
import { parseBody, cleanEpic, cleanSerial, repairSerials, asciiDigits } from "./parse.mjs";
import { writeWorkbook } from "./xlsx.mjs";
import { openPdf, renderPage } from "./pdf-render.mjs";
import { isApGpList, convertApGp } from "./formats/ap-gp.mjs";
import { isApUlbList, convertApUlb, AP_RELATION_EN, AP_GENDER_EN } from "./formats/ap-ulb.mjs";
import { addSecondary, SECONDARY } from "./secondary.mjs";

const LOW_CONFIDENCE = 70;

/** Crop + upscale a small line region for the English line OCR. */
async function lineCrop(page, region) {
  return sharp(page).extract(region).resize({ width: region.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer();
}
async function blockCrop(page, region) {
  return sharp(page).extract(region).png().toBuffer();
}

/** The header band above the boxes: section number and name, part number. */
function parseTopBand(text, lang) {
  const t = asciiDigits(text).replace(/\s+/g, " ");
  const out = {};
  if (lang === "tel") {
    // "శాసనసభ నియోజకవర్గం సంఖ్య మరియు పేరు : 126-కడప   భాగం సంఖ్య : : 6
    //  విభాగం సంఖ్య మరియు పేరు : 1-గూడూరు మజరా ఆలంఖాన్ పల్లి -5"
    let m = /విభాగం\s*సంఖ్య\s*మరియు\s*పేరు\s*[:;]?\s*(\d{1,3})\s*-\s*(.+?)\s*$/u.exec(t);
    if (m) {
      out.sectionNo = Number(m[1]);
      out.sectionName = m[2].trim();
    }
    m = /భాగం\s*సంఖ్య[\s:;]*(\d+)/u.exec(t);
    if (m) out.partNo = m[1];
    return out;
  }
  if (lang === "eng") {
    // "Assembly Constituency No and Name : 25-GAJUWAKA   Part Number : 4
    //  Section No and Name 1-Old Aganampudi Village ( 1-1 to 1-143 )"
    let m = /Section No\.? and Name\s*:?\s*(\d{1,3})\s*-\s*(.+?)\s*$/i.exec(t);
    if (m) {
      out.sectionNo = Number(m[1]);
      out.sectionName = m[2].replace(/\s*Part Number.*$/i, "").trim();
    }
    m = /Part Number\s*:?\s*(\d+)/i.exec(t);
    if (m) out.partNo = m[1];
    return out;
  }
  let m = /विभाग क्रमांक आणि नाव\s*:?\s*(\d{1,3})\s*-\s*(.+?)\s*$/u.exec(t);
  if (m) {
    out.sectionNo = Number(m[1]);
    out.sectionName = m[2].replace(/\s*यादी भाग.*$/u, "").trim();
  }
  m = /यादी भाग क्रमांक\s*:?\s*(\d+)/u.exec(t);
  if (m) out.partNo = m[1];
  return out;
}

const LANGUAGE_NAME = { mar: "Marathi", eng: "English", tel: "Telugu" };

/** Roll languages the converter reads, for pickers in the UI. */
export const LANGUAGES = Object.entries(LANGUAGE_NAME).map(([code, name]) => ({ code, name }));

/** The language named in an ECI file name (…-MAR-76-WI.pdf, …-TEL-153-WI.pdf), or null. */
export function languageFromFileName(fileName) {
  const token = /-EROLLGEN-S\d+-\d+-[A-Z]+-.+?-([A-Z]{3})-\d+-/.exec(fileName)?.[1];
  return { MAR: "mar", ENG: "eng", TEL: "tel" }[token] ?? null;
}

// Gender values per roll language, for the summary counts.
const GENDER_KEYS = {
  mar: { male: (g) => g === "पुरुष", female: (g) => g === "महिला", third: (g) => /तृतीय/u.test(g) },
  eng: { male: (g) => g === "Male", female: (g) => g === "Female", third: (g) => g === "Third Gender" },
  tel: { male: (g) => g === "పురుషుడు", female: (g) => g === "స్త్రీ", third: (g) => g === "ఇతరులు" },
};

/**
 * @param {object} opts
 * @param {string} opts.input  PDF path
 * @param {string} opts.output xlsx path
 * @param {number} [opts.workers]
 * @param {string} [opts.debugDir] write crops + raw OCR text for boxes with warnings
 * @param {string} [opts.photosDir] AP SEC photo lists: save each voter's photo there as <EPIC>.jpg
 * @param {"auto"|"mar"|"eng"|"tel"} [opts.lang] roll language; "auto" (default) detects it
 * @param {(pngs: Buffer[]) => Promise<string[]>} [opts.remoteOcr] cloud mode: re-reads the
 *   boxes the on-device OCR could not read cleanly (see cloudReread below)
 * @param {string[]} [opts.secondary] English rolls: languages to add name columns in ("tel", "hin")
 * @param {(words: string[], lang: string) => Promise<string[]>} [opts.transliterate] server call
 *   that writes English words in the secondary language (services/xlit); required with `secondary`
 * @param {(msg:string)=>void} [opts.log]
 */
export async function convert({ input, output, workers = 4, debugDir, photosDir = null, lang: requestedLang = "auto", remoteOcr = null, secondary = [], transliterate = null, log = console.log, onProgress = () => {} }) {
  const started = Date.now();
  // AP gram panchayat lists carry a voter photo per box (JPEGs), so they must
  // be recognised by their text layer before the scanned-roll check below.
  {
    const doc = await openPdf(input).catch(() => null);
    const gp = doc ? await isApGpList(doc).catch(() => false) : false;
    // AP ward lists too: printed from the browser they can run to hundreds of
    // MB, past what extractPageImages can hold as one string.
    const ulb = doc && !gp ? await isApUlbList(doc).catch(() => false) : false;
    await doc?.destroy().catch(() => {});
    if (ulb) {
      const ocr = await createOcr({ workers });
      try {
        return await convertApUlb({ input, output, ocr, workers, log, onProgress });
      } finally {
        await ocr.terminate();
      }
    }
    if (gp) {
      const ocr = await createOcr({ workers });
      try {
        return await convertApGp({ input, output, ocr, workers, photosDir, log, onProgress });
      } finally {
        await ocr.terminate();
      }
    }
  }
  let pages = extractPageImages(input);
  // A scanned roll has one JPEG per page. Text PDFs can still carry a stray
  // image (a logo or photo on the cover), which must not make them look scanned.
  if (pages.some((p) => !p)) pages = [];
  const ocr = await createOcr({ workers });
  if (!pages.length) {
    // No embedded page scans: a PDF with a text layer. Either the AP ward-list
    // format (its own pipeline) or a text version of the Marathi roll, which is
    // rendered to images and then goes through the usual box OCR below.
    const doc = await openPdf(input);
    if (await isApUlbList(doc)) {
      try {
        return await convertApUlb({ input, output, ocr, workers, log, onProgress });
      } finally {
        await ocr.terminate();
      }
    }
    log(`rendering ${doc.numPages} pages (no embedded scans)`);
    pages = [];
    for (let p = 1; p <= doc.numPages; p++) pages.push((await renderPage(doc, p, 3.4)).png);
    await doc.destroy().catch(() => {});
  }
  // Some rolls are scanned at ~150 dpi (a 1239 px wide page). At that size the
  // OCR reads colons as "+" and garbles labels, so bring small pages up to the
  // ~300 dpi the box regions and OCR were tuned on.
  const firstWidth = (await sharp(pages[0]).metadata()).width ?? 0;
  if (firstWidth && firstWidth < 1800) {
    const scale = 2480 / firstWidth;
    log(`upscaling ${firstWidth}px pages by ${scale.toFixed(2)}x for OCR`);
    pages = await Promise.all(
      pages.map(async (img) => {
        const { width } = await sharp(img).metadata();
        return sharp(img).resize({ width: Math.round(width * scale), kernel: "lanczos3" }).png().toBuffer();
      }),
    );
  }
  log(`pages: ${pages.length}`);
  onProgress({ stage: "start", pageNo: 0, totalPages: pages.length, voters: 0 });
  if (debugDir) mkdirSync(debugDir, { recursive: true });

  try {
    // --- cover page; it also tells us the roll's language
    const lang = LANGUAGE_NAME[requestedLang] ? requestedLang : await detectLanguage(pages[0], ocr, basename(input));
    const ocrText = lang === "eng" ? ocr.textEnglish : lang === "tel" ? ocr.teluguText : ocr.text;
    log(`language: ${LANGUAGE_NAME[lang]}${LANGUAGE_NAME[requestedLang] ? " (chosen)" : " (detected)"}`);
    const cover = await parseCover(pages[0], ocr, lang);
    log(`cover: ${cover.meta.AssemblyConstituency ?? "?"} part ${cover.meta.PartNo ?? "?"}, expected total ${cover.expected.Total ?? "?"}`);
    if (debugDir) writeFileSync(join(debugDir, "cover.txt"), cover.text);

    // --- voter pages
    const voters = [];
    const cloudStats = { boxes: 0, fields: 0 };
    const pageRows = [];
    const review = [];
    let ocrSeconds = 0;
    let section = { sectionNo: cover.sections[0]?.no ?? 1, sectionName: cover.sections[0]?.name ?? "" };

    for (let p = 1; p < pages.length; p++) {
      const pageNo = p + 1;
      const page = pages[p];
      const t0 = Date.now();
      const grid = await detectGrid(page);
      if (grid.boxes.length < 1 || grid.xs.length > 3) continue; // cover/maps/summary pages

      // section header band above the first row
      const bandH = Math.max(40, grid.ys[0][0] - 6);
      const band = await ocrText(await blockCrop(page, { left: 0, top: 0, width: grid.width, height: bandH }));
      const top = parseTopBand(band.text, lang);
      if (top.sectionNo) {
        // A Telugu header line sometimes picks up Latin junk inside the Telugu name
        // ("మజరా sword పల్లి"); the cover's section list then has the cleaner spelling.
        // English section names ("HOUSE NO 2-6-1 TO 2-6-75") read better in the header.
        const garbled = lang === "tel" && /[\u0C00-\u0C7F]/u.test(top.sectionName) && /[A-Za-z]{3,}/.test(top.sectionName);
        const fromCover = garbled ? cover.sections.find((x) => x.no === top.sectionNo)?.name : null;
        section = { sectionNo: top.sectionNo, sectionName: fromCover || top.sectionName };
      }

      // OCR every box on the page concurrently (the pools queue the work)
      const jobs = grid.boxes.map(async (box) => {
        const r = boxRegions(box);
        const serialRegion = (await innerFrame(page, r.serial)) ?? r.serial;
        const [serial, epic, body] = await Promise.all([
          ocr.line(await lineCrop(page, serialRegion)),
          ocr.line(await lineCrop(page, r.epic)),
          ocrText(await blockCrop(page, r.body)),
        ]);
        return { box, serial, epic, body };
      });
      const results = await jobs.reduce(async (acc, j) => [...(await acc), await j], Promise.resolve([]));

      let rows = 0;
      const flagged = [];
      for (const { box, serial, epic, body: firstBody } of results) {
        let body = firstBody;
        let epicNote = "";
        let fields = parseBody(body.text, lang);
        const isEmpty = !fields.name && !(lang === "eng" ? /[A-Za-z]{3,}/ : lang === "tel" ? /[\u0C00-\u0C7F]{3,}/u : /[ऀ-ॿ]{3,}/u).test(body.text);
        if (isEmpty) continue;

        // Latin letters inside a Devanagari name mean the mixed model guessed English;
        // the Marathi-only model usually reads such words correctly.
        const junk = (s) => /[A-Za-z]{2,}|[{}@#$%^*~<>]/.test(s);
        // A house number like "35अ" is often read as "3537"/"3531" by the mixed model.
        const suspectHouse = /\d(31|37|1)$/.test(fields.house) && fields.house.replace(/\D/g, "").length >= 3;
        // Telugu: a relation label read as Latin ("Sod పేరు:") is re-read with the
        // Telugu-only model, which cannot produce Latin letters.
        // The gender word ("పు", "స్త్రీ") is sometimes read as a digit by the mixed model.
        if (lang === "tel" && (!fields.relationType || !fields.gender || junk(fields.name) || junk(fields.relationName))) {
          const retry = parseBody((await ocr.teluguOnlyText(await blockCrop(page, boxRegions(box).body))).text, "tel");
          if (!fields.relationType && retry.relationType) {
            fields.relationType = retry.relationType;
            fields.warnings = fields.warnings.filter((w) => !w.startsWith("relation label unreadable"));
          }
          if (!fields.gender && retry.gender) {
            fields.gender = retry.gender;
            fields.warnings = fields.warnings.filter((w) => !/^gender (unreadable|missing)/.test(w));
          }
          if (junk(fields.name) && retry.name && !junk(retry.name)) fields.name = retry.name;
          if (junk(fields.relationName) && retry.relationName && !junk(retry.relationName)) fields.relationName = retry.relationName;
        }
        if (lang === "mar" && (junk(fields.name) || junk(fields.relationName) || suspectHouse)) {
          const retry = await ocr.textMarathi(await blockCrop(page, boxRegions(box).body));
          const f2 = parseBody(retry.text);
          if (junk(fields.name) || junk(fields.relationName)) {
            if (f2.name && !junk(f2.name) && !junk(f2.relationName)) {
              body = { ...retry, text: retry.text };
              fields = { ...f2, age: fields.age || f2.age, gender: fields.gender || f2.gender, house: fields.house || f2.house, warnings: [...f2.warnings, "name re-read with Marathi-only model"] };
            } else {
              fields.warnings.push("name contains non-Devanagari characters");
            }
          }
          if (suspectHouse && /[ऀ-ॿ]$/u.test(f2.house) && f2.house.replace(/\D/g, "").length < fields.house.replace(/\D/g, "").length) {
            fields.warnings.push(`house re-read as "${f2.house}" (was "${fields.house}")`);
            fields.house = f2.house;
          }
        }
        rows++;
        // EPIC: two independent reads (2x normalised, 3x thresholded). Digits 5/6 and 0/9
        // are confused occasionally by one preprocessing but rarely by both, so a
        // disagreement is flagged for review and the more confident read is kept.
        let ep = cleanEpic(epic.text);
        {
          const r = boxRegions(box).epic;
          const second = await ocr.line(await sharp(page).extract(r).resize({ width: r.width * 3, kernel: "lanczos3" }).greyscale().threshold(140).png().toBuffer());
          const ep2 = cleanEpic(second.text);
          if (ep2.valid && (!ep.valid || (ep2.epic !== ep.epic && second.confidence > epic.confidence))) {
            if (ep.valid) epicNote = `EPIC uncertain: "${ep.epic}" (${epic.confidence.toFixed(0)}) vs "${ep2.epic}" (${second.confidence.toFixed(0)}), kept the second`;
            ep = { ...ep2, repaired: !ep.valid || ep.repaired };
            epic.text = second.text;
            epic.confidence = second.confidence;
          } else if (ep.valid && ep2.valid && ep2.epic !== ep.epic) {
            epicNote = `EPIC uncertain: "${ep.epic}" (${epic.confidence.toFixed(0)}) vs "${ep2.epic}" (${second.confidence.toFixed(0)}), kept the first`;
          }
        }
        const voter = {
          pageNo,
          row: box.row,
          col: box.col,
          sectionNo: section.sectionNo,
          sectionName: section.sectionName,
          serialOcr: cleanSerial(serial.text),
          serial: null,
          epic: ep.epic,
          ...fields,
          confidence: Math.min(body.confidence, epic.confidence),
          warnings: [...fields.warnings],
          raw: { serial: serial.text, epic: epic.text, body: body.text },
        };
        if (!ep.valid) voter.warnings.push(`EPIC unreadable: "${epic.text.trim()}"`);
        else if (epicNote) voter.warnings.push(epicNote);
        else if (ep.repaired) voter.warnings.push(`EPIC cleaned from "${epic.text.trim()}" to ${ep.epic}`);
        if (body.confidence < LOW_CONFIDENCE) voter.warnings.push(`low text confidence ${body.confidence.toFixed(0)}`);
        voters.push(voter);
        if (remoteOcr && needsCloud(voter, lang)) flagged.push({ voter, box });

        if (debugDir && voter.warnings.length) {
          const stem = join(debugDir, `p${pageNo}-r${box.row}c${box.col}`);
          await sharp(page).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toFile(`${stem}.png`);
          writeFileSync(`${stem}.txt`, `${voter.warnings.join("\n")}\n---serial\n${serial.text}\n---epic\n${epic.text}\n---body\n${body.text}`);
        }
      }
      if (flagged.length) {
        const fixed = await cloudReread(flagged, page, lang, remoteOcr, log);
        cloudStats.boxes += flagged.length;
        cloudStats.fields += fixed;
      }
      const seconds = (Date.now() - t0) / 1000;
      ocrSeconds += seconds;
      pageRows.push({ pageNo, rows, seconds: Number(seconds.toFixed(2)), sectionNo: section.sectionNo, sectionName: section.sectionName });
      log(`page ${pageNo}: ${rows} voters, section ${section.sectionNo}, ${seconds.toFixed(1)}s`);
      onProgress({ stage: "page", pageNo, totalPages: pages.length, voters: voters.length });
    }

    // --- serial numbers: consecutive in reading order; repair OCR misses
    const { repaired, gaps } = repairSerials(voters);
    for (const g of gaps) {
      review.push({ serial: g.found, pageNo: g.pageNo, epic: "", name: "", issue: `page starts at serial ${g.found} but ${g.expected} was expected: ${g.found - g.expected} box(es) missed or duplicated before it`, confidence: "" });
      log(`WARNING page ${g.pageNo}: serial gap, expected ${g.expected} found ${g.found}`);
    }
    for (const v of voters) {
      if (v.serialOcr !== v.serial) v.warnings.push(`serial read as "${v.raw.serial.trim()}", set to ${v.serial}`);
      for (const w of v.warnings) review.push({ serial: v.serial, pageNo: v.pageNo, epic: v.epic, name: v.name, issue: w, confidence: Number(v.confidence.toFixed(0)) });
    }

    // duplicate EPICs are almost always OCR errors
    const seen = new Map();
    for (const v of voters) {
      if (seen.has(v.epic)) review.push({ serial: v.serial, pageNo: v.pageNo, epic: v.epic, name: v.name, issue: `duplicate EPIC (also serial ${seen.get(v.epic)})`, confidence: Number(v.confidence.toFixed(0)) });
      else seen.set(v.epic, v.serial);
    }

    const genderKeys = GENDER_KEYS[lang];
    const male = voters.filter((v) => genderKeys.male(v.gender)).length;
    const female = voters.filter((v) => genderKeys.female(v.gender)).length;
    const third = voters.filter((v) => genderKeys.third(v.gender)).length;
    const total = (Date.now() - started) / 1000;

    const sourceFile = basename(input);
    // e.g. 2026-EROLLGEN-S13-258-SIR-DraftRoll-Revision1-MAR-76-WI.pdf
    const parts = /(\d{4})-EROLLGEN-(S\d+)-(\d+)-([A-Z]+)-(.+?)-([A-Z]{3})-(\d+)-/.exec(sourceFile);
    const meta = {
      SourceFile: sourceFile,
      AssemblyConstituency: cover.meta.AssemblyConstituency ?? (parts ? parts[3] : ""),
      PartNo: cover.meta.PartNo ?? (parts ? parts[7] : ""),
      ElectoralRollType: parts ? parts[4] : "",
      Status: parts ? parts[5] : "",
      RollDescription: cover.meta.RollDescription ?? "",
      DeletionReasonCode: "",
      AgeAsOn: cover.meta.AgeAsOn ?? "",
      DateOfPublication: cover.meta.DateOfPublication ?? "",
      TotalPages: pages.length,
      PollingStation: cover.meta.PollingStation ?? "",
      PollingStationType: cover.meta.PollingStationType ?? "",
      PollingStationAddress: cover.meta.PollingStationAddress ?? "",
      LokSabhaConstituency: cover.meta.LokSabhaConstituency ?? "",
      RevisionYear: cover.meta.RevisionYear ?? "",
      RevisionType: cover.meta.RevisionType ?? "",
      Village: cover.meta.Village ?? "",
      PoliceStation: cover.meta.PoliceStation ?? "",
      Taluka: cover.meta.Taluka ?? "",
      District: cover.meta.District ?? "",
      PinCode: cover.meta.PinCode ?? "",
      PostOffice: cover.meta.PostOffice ?? "",
      Subdivision: cover.meta.Subdivision ?? "",
      // the names the voter rows carry (page headers, checked above), else the cover list
      Sections: (() => {
        const used = new Map();
        for (const v of voters) if (!used.has(v.sectionNo)) used.set(v.sectionNo, v.sectionName);
        const list = used.size ? [...used] : cover.sections.map((x) => [x.no, x.name]);
        return list.map(([no, name]) => `${no}-${name}`).join("; ");
      })(),
      ExpectedMale: cover.expected.Male ?? "",
      ExpectedFemale: cover.expected.Female ?? "",
      ExpectedThirdGender: cover.expected.ThirdGender ?? "",
      ExpectedTotalVoters: cover.expected.Total ?? "",
      RollLanguage: LANGUAGE_NAME[lang],
      OCRLanguage: { mar: "mar+eng", eng: "eng", tel: "tel+eng" }[lang],
      OCRMode: remoteOcr ? "cloud (on-device, with server re-reads)" : "local (on-device)",
      Workers: workers,
      ExtractedVoters: voters.length,
      ProcessingSeconds: Number(total.toFixed(2)),
      ProcessedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
      SerialNumbersRepaired: repaired,
      ReviewItems: review.length,
    };
    const summary = {
      SourceFile: sourceFile,
      TotalPages: pages.length,
      VoterPagesOCRed: pageRows.length,
      ExtractedVoters: voters.length,
      ExpectedMale: meta.ExpectedMale,
      ExpectedFemale: meta.ExpectedFemale,
      ExpectedThirdGender: meta.ExpectedThirdGender,
      ExpectedTotalVoters: meta.ExpectedTotalVoters,
      ExtractedMale: male,
      ExtractedFemale: female,
      ExtractedThirdGender: third,
      FirstSerialNo: voters[0]?.serial ?? "",
      LastSerialNo: voters.at(-1)?.serial ?? "",
      MatchesExpectedTotal: meta.ExpectedTotalVoters === "" ? "unknown" : meta.ExpectedTotalVoters === voters.length ? "yes" : "NO",
      TotalProcessingSeconds: Number(total.toFixed(2)),
      OCRPageSeconds: Number(ocrSeconds.toFixed(2)),
      AverageSecondsPerOCRPage: pageRows.length ? Number((ocrSeconds / pageRows.length).toFixed(2)) : "",
      SerialNumbersRepaired: repaired,
      ReviewItems: review.length,
      ...(remoteOcr ? { CloudBoxesSent: cloudStats.boxes, CloudFieldsReplaced: cloudStats.fields } : {}),
    };

    // --- secondary-language columns (English rolls only). A server failure
    // leaves them out rather than losing the OCR work; the summary says why.
    let extraColumns = [];
    const wanted = secondary.filter((c) => SECONDARY[c]);
    if (wanted.length && lang !== "eng") {
      log(`secondary language columns are for English rolls; this roll is ${LANGUAGE_NAME[lang]}`);
    } else if (wanted.length) {
      summary.SecondaryLanguages = wanted.map((c) => SECONDARY[c].name).join(", ");
      try {
        if (!transliterate) throw new Error("no transliteration service configured");
        onProgress({ stage: "secondary", pageNo: pages.length, totalPages: pages.length, voters: voters.length });
        const r = await addSecondary(voters, wanted, transliterate, { log });
        extraColumns = r.columns;
        summary.SecondaryWords = r.words;
      } catch (err) {
        summary.SecondaryLanguageError = err?.message || String(err);
        log(`WARNING secondary language columns left out: ${summary.SecondaryLanguageError}`);
      }
    }

    const labelsEn = lang === "tel" ? { relationEn: AP_RELATION_EN, genderEn: AP_GENDER_EN } : {};
    await writeWorkbook({ meta, voters, summary, pages: pageRows, review, out: output, extraColumns, ...labelsEn });
    log(`wrote ${output}: ${voters.length} voters (expected ${meta.ExpectedTotalVoters || "?"}), ${review.length} items to review, ${total.toFixed(0)}s`);
    onProgress({ stage: "done", pageNo: pages.length, totalPages: pages.length, voters: voters.length });
    return { meta, summary, voters, review };
  } finally {
    await ocr.terminate();
  }
}

// ---------------------------------------------------------------- cloud mode

const CLOUD_BATCH = 3;
const LATIN_JUNK = /[A-Za-z]{2,}|[{}@#$%^*~<>]/;
const FIELDS = ["name", "relationType", "relationName", "house", "age", "gender"];
/** Warnings that a successful cloud re-read of the field resolves. */
const RESOLVES = {
  name: /^name (missing|contains non-Devanagari)|"\[" read as "I"/,
  relationType: /^relation label unreadable/,
  relationName: /^relation missing/,
  house: /^house number missing/,
  age: /^age (unreadable|read as)/,
  gender: /^gender (unreadable|missing)/,
};

/** Fields of a parsed box that the on-device read got wrong or left empty. */
function badFields(v, lang) {
  const bad = new Set(FIELDS.filter((f) => !v[f]));
  if (lang !== "eng") for (const f of ["name", "relationName"]) if (LATIN_JUNK.test(v[f])) bad.add(f);
  for (const w of v.warnings) for (const [f, re] of Object.entries(RESOLVES)) if (re.test(w)) bad.add(f);
  return bad;
}

function needsCloud(voter, lang) {
  return badFields(voter, lang).size > 0;
}

/**
 * Sends the flagged boxes of one page to the server (3 per request: the CPU
 * server reads one box in ~20 s, and the proxy stops a request at two minutes) and replaces each bad field with the server's
 * reading when that reading is clean. Returns the number of fields replaced.
 * A failed request leaves the on-device reading in place and is logged.
 */
async function cloudReread(flagged, page, lang, remoteOcr, log) {
  let fixed = 0;
  for (let i = 0; i < flagged.length; i += CLOUD_BATCH) {
    const chunk = flagged.slice(i, i + CLOUD_BATCH);
    let texts;
    try {
      const pngs = await Promise.all(chunk.map(({ box }) => sharp(page).extract(boxRegions(box).body).png().toBuffer()));
      texts = await remoteOcr(pngs);
    } catch (error) {
      log(`cloud re-read failed: ${error.message || error}`);
      for (const { voter } of chunk) voter.warnings.push(`cloud re-read failed: ${error.message || error}`);
      continue;
    }
    chunk.forEach(({ voter }, k) => {
      const remote = parseBody(texts[k] ?? "", lang);
      const bad = badFields(voter, lang);
      const replaced = [];
      for (const f of bad) {
        const value = remote[f];
        if (!value || (lang !== "eng" && (f === "name" || f === "relationName") && LATIN_JUNK.test(value))) continue;
        voter[f] = value;
        replaced.push(f);
        voter.warnings = voter.warnings.filter((w) => !RESOLVES[f].test(w));
      }
      // The on-device read sometimes glues an unreadable relation line onto the
      // name ("మెరుగు దేవయ్య్ మెరుగు తాల మేర్లు శారద"); when the server separates
      // the two cleanly, its name is the right one.
      if (remote.name && remote.relationName && voter.name !== remote.name && voter.name.startsWith(remote.name) && !LATIN_JUNK.test(remote.name)) {
        voter.name = remote.name;
        replaced.push("name");
      }
      if (replaced.length) {
        fixed += replaced.length;
        voter.warnings.push(`read on the server: ${replaced.join(", ")}`);
      }
    });
  }
  return fixed;
}
