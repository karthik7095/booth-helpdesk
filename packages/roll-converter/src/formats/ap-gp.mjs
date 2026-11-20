// Andhra Pradesh State Election Commission gram panchayat voter lists
// (sec-ems.ap.gov.in "draftCreateViewInTeluguReport", Telugu, printed to PDF
// from the browser, with voter photos).
//
// One PDF is one panchayat. Its pages are grouped by ward ("వార్డు నెంబరు : N"
// in each page header) and every voter box carries both the panchayat serial
// ("గ్రా.పం.ఓ.జా.వ.సం. 12") and the assembly roll reference
// ("అ.ఓ.జా.వ.సం. 123 - 27 - 187" = AC 123, part (booth) 27, serial 187).
// So each voter gets a ward and a booth.
//
// Municipal ward lists with photos (e.g. "శ్రీకాకుళం నగర పాలక సంస్థ ఫోటో ఓటరు
// జాబితా") use the same page layout with a ward serial ("వార్డు.ఓ.జా.వ.సం. . 12")
// in place of the panchayat serial and slightly smaller boxes; they go through
// this pipeline too, with their own geometry (WARD below).
//
// As with the ULB lists, the text layer is exact for numbers, EPICs and house
// numbers but drops Telugu conjuncts, so names are OCR'd from a 4x render.
import { existsSync, mkdirSync } from "node:fs";
import { basename, join } from "node:path";
import sharp from "sharp";
import { openPdf, pageImages, pageText, renderPage } from "../pdf-render.mjs";
import { writeWorkbook } from "../xlsx.mjs";
import { transliterate } from "../translit.mjs";
import { cleanEpic } from "../parse.mjs";
import {
  AP_RELATION_EN, AP_GENDER_EN, cleanTelugu, hasLatinJunk, dropTrailingJunk,
  parseGender, parseRelation, parseRelationLayer, mode,
} from "./ap-ulb.mjs";

// Box geometry in points, relative to the box's label column (x) and the
// serial line's baseline (y). Tuned on a Chrome print of an A4 page.
const GP = {
  kind: "gp",
  LABEL_FROM_SERIAL: 57.8, // label column starts this far left of the panchayat serial
  BOX_W: 172, // label column to the box's right border
  VALUE_X: 45.5, // values start after the ":" at 43.3
  PHOTO_X: 125, // the photo frame's left edge (relation, age and house lines stop here)
  LINE: 12.3, // line pitch
  GENDER_X0: 104,
  GENDER_X1: 125,
};
// Municipal ward list with photos (Srikakulam corporation, 2026 print)
const WARD = {
  kind: "ward",
  LABEL_FROM_SERIAL: 52,
  BOX_W: 158,
  VALUE_X: 43,
  PHOTO_X: 118,
  LINE: 11.4,
  GENDER_X0: 95,
  GENDER_X1: 118,
};
// The same ward list in a wider print (Srikakulam wards 3, 17, 20): labels
// sit ~42 pt left of the serial instead of 52, lines ~10.5 pt apart.
const WARD_WIDE = {
  kind: "ward",
  LABEL_FROM_SERIAL: 41.6,
  BOX_W: 172,
  VALUE_X: 45.5,
  PHOTO_X: 128,
  LINE: 10.5,
  GENDER_X0: 102,
  GENDER_X1: 128,
};
// "గ్రా.పం.ఓ.జా.వ.సం." or "వార్డు.ఓ.జా.వ.సం." on a line that also has "అ.ఓ.జా.వ.సం."
const GP_LABEL = /పం\.ఓ\.జా\.వ\.సం/u;
// Some prints drop the "వా"/"ు" and the "ా" from the text layer: "ార.ఓ.జ.వ.సం" … "అ.ఓ.జ.వ.సం".
const WARD_LABEL = /(?:వారు|ార)\.ఓ\.జా?\.వ\.సం.*అ\.ఓ\.జా?\.వ\.సం/u;

export const GP_EXTRA_COLUMNS = [
  { header: "WardNo", key: "wardNo", width: 9 },
  { header: "BoothNo", key: "acPart", width: 9 },
  { header: "ACNo", key: "acNo", width: 7 },
  { header: "ACPartSerial", key: "acSerial", width: 12 },
  { header: "Panchayat", key: "panchayat", width: 22 },
];

/** Items grouped into printed lines, each line's items left to right. */
function lines(items) {
  const out = [];
  for (const i of [...items].sort((a, b) => a.y - b.y)) {
    const l = out.find((r) => Math.abs(r.y - i.y) < 1.5);
    if (l) l.items.push(i);
    else out.push({ y: i.y, items: [i] });
  }
  for (const l of out) l.items.sort((a, b) => a.x - b.x);
  return out;
}

const squash = (s) => s.replace(/[\u0000\s]/g, "");

/** Does this pdf.js document look like an AP gram panchayat voter list? */
export async function isApGpList(doc) {
  // Ward lists can open with several pages of street/house-number index.
  for (let p = 1; p <= Math.min(12, doc.numPages); p++) {
    const { items } = await pageText(doc, p);
    if (lines(items).some((l) => {
      const t = squash(l.items.map((i) => i.s).join(""));
      return GP_LABEL.test(t) || WARD_LABEL.test(t);
    })) return true;
  }
  return false;
}

/**
 * Voter boxes of a page: the panchayat serial (the number after "...వ.సం.")
 * and the assembly reference after "అ.ఓ.జా.వ.సం.".
 */
function findBoxes(items) {
  const boxes = [];
  for (const l of lines(items)) {
    const its = l.items.filter((i) => i.s.trim());
    const g = WARD_LABEL.test(squash(l.items.map((i) => i.s).join(""))) ? WARD : GP;
    for (let n = 2; n < its.length; n++) {
      const s = its[n];
      // "సం" "." 12 on panchayat lists, "సం" ". ." 12 on ward lists
      if (!/^\d{1,5}$/.test(s.s.trim()) || !/^\.(\s*\.)?$/.test(its[n - 1].s.trim()) || !/సం$/u.test(its[n - 2].s.trim())) continue;
      // the GP serial is the first "సం." of the pair: the next label starts with "అ"
      if (!its[n + 1] || !/^అ/u.test(its[n + 1].s.trim())) continue;
      const code = [];
      for (let k = n + 2; k < its.length && code.length < 3; k++) {
        const t = its[k].s.trim();
        if (/^\d+$/.test(t)) code.push(t);
        else if (/గా$/u.test(t)) break; // the next box's label
      }
      boxes.push({ serial: s, x: s.x - g.LABEL_FROM_SERIAL, y: s.y, code, g });
    }
  }
  // Pick the ward print by where the name label ("ఓటరు పేరు") sits under the serial.
  for (const box of boxes) {
    if (box.g !== WARD) continue;
    const label = items.find((i) => i.y > box.y + 5 && i.y < box.y + 16 && /^ఓట/u.test(i.s.trim()) && i.x > box.serial.x - 60 && i.x < box.serial.x - 30);
    if (label && Math.abs(box.serial.x - label.x - WARD_WIDE.LABEL_FROM_SERIAL) < 4) {
      box.g = WARD_WIDE;
      box.x = box.serial.x - WARD_WIDE.LABEL_FROM_SERIAL;
    }
  }
  return boxes;
}

/** Ward number from the page header: ": N" right of "...బరు" ("౦బర" on prints with a garbled text layer). */
function wardOf(items, firstBoxY) {
  const label = items.find((i) => i.y < firstBoxY && /బరు|[౦ం]బర/u.test(i.s));
  if (!label) return "";
  const v = items.find((i) => Math.abs(i.y - label.y) < 2 && i.x > label.x && /^:\s*\d+\s*$/.test(i.s.trim()));
  return v ? v.s.replace(/\D/g, "") : "";
}

/**
 * Convert one AP gram panchayat list PDF to a workbook.
 * @param {object} o
 * @param {string} o.input
 * @param {string} o.output
 * @param {{teluguLine:Function, teluguOnlyLine:Function, teluguText:Function}} o.ocr
 */
/**
 * Saves a voter's photo as `<dir>/<EPIC>.jpg`: small (fits 150 x 190 px) and
 * plain JPEG, so a whole panchayat's photos stay a few MB on a phone.
 */
async function writePhoto(dir, epic, img) {
  await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: img.channels },
  })
    .removeAlpha()
    .resize(150, 190, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 72, mozjpeg: true })
    .toFile(join(dir, `${epic}.jpg`));
}

export async function convertApGp({ input, output, ocr, scale = 4, workers = 4, maxPages = Infinity, photosDir = null, log = console.log, onProgress = () => {} }) {
  const started = Date.now();
  const doc = await openPdf(input);
  const totalPages = Math.min(doc.numPages, maxPages);
  log(`pages: ${totalPages} (AP SEC photo list: gram panchayat or municipal ward, text + Telugu OCR)`);
  onProgress({ stage: "start", pageNo: 0, totalPages, voters: 0 });

  const voters = [];
  const pageRows = [];
  const review = [];
  const meta = { panchayat: "", ageAsOn: "", publishedOn: "" };
  let ocrSeconds = 0;
  // Voters whose box ran off the bottom of the last page: some prints split
  // the bottom row, the name on one page and the relation, age, house and
  // EPIC lines at the top of the next.
  let cut = [];
  if (photosDir) mkdirSync(photosDir, { recursive: true });
  let photos = 0;
  /** Each voter's photo, kept only until the EPIC is known and it is written. */
  const photoOf = new Map();
  const savePhotos = async (list) => {
    for (const v of list) {
      const img = photoOf.get(v);
      if (!img || !v.epic) continue;
      await writePhoto(photosDir, v.epic, img);
      photoOf.delete(v);
      photos++;
    }
  };

  for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
    const t0 = Date.now();
    const { items, height } = await pageText(doc, pageNo);
    const boxes = findBoxes(items);
    // the cut boxes' remaining lines: above this page's first box, or the whole
    // page when it has none, and only if they carry an age or EPIC line
    const tailItems = cut.length ? items.filter((i) => i.y < (boxes[0]?.y ?? height) - 8 && i.s.trim()) : [];
    const hasTail = tailItems.some((i) => /^వయ/u.test(i.s.trim()) || /[A-Z]{2,3}\d{6,7}/.test(i.s));
    if (!hasTail && cut.length) {
      for (const { voter } of cut) voter.warnings.push("box cut at the page end, rest not found");
      cut = [];
    }
    if (!boxes.length && !hasTail) {
      pageRows.push({ pageNo, rows: 0, seconds: 0, sectionNo: "", sectionName: "" });
      continue;
    }
    if (boxes.length && !meta.ageAsOn) {
      const dates = items.filter((i) => i.y > height * 0.5).map((i) => i.s).join(" ").match(/\d{2}-\d{2}-\d{4}/g) ?? [];
      if (dates[0]) meta.ageAsOn = dates[0];
      if (dates[1]) meta.publishedOn = dates[1];
    }
    const wardNo = boxes.length ? wardOf(items, boxes[0].y) : cut[0].voter.wardNo;
    const page = await renderPage(doc, pageNo, scale);
    // Clamped to the page: a box at the very bottom can reach past its edge.
    const crop = (box, dy, x0, x1, up = 8, down = 3.5) => {
      const left = Math.min(page.width - 1, Math.max(0, Math.round((box.x + x0) * scale)));
      const top = Math.min(page.height - 1, Math.max(0, Math.round((box.y + dy - up) * scale)));
      return sharp(page.png)
        .extract({
          left,
          top,
          width: Math.max(1, Math.min(Math.round((x1 - x0) * scale), page.width - left)),
          height: Math.max(1, Math.min(Math.round((up + down) * scale), page.height - top)),
        })
        .png()
        .toBuffer();
    };

    // Panchayat name, once: the header line "గ్రామ పంచాయతీ : <name>"
    // Ward list: the title "<corporation> ఫోటో ఓటరు జాబితా 2026", read up to "ఫోటో"
    if (boxes.length && !meta.panchayat && boxes[0].g.kind === "ward") {
      meta.kind = "ward";
      const photo = items.find((i) => i.y < boxes[0].y && /ఫోటో/u.test(i.s));
      const title = photo && items.filter((i) => Math.abs(i.y - photo.y) < 2 && i.x < photo.x && i.s.trim());
      if (title?.length) {
        const x0 = Math.min(...title.map((i) => i.x)) - 4;
        const img = await sharp(page.png)
          .extract({ left: Math.round(x0 * scale), top: Math.round((photo.y - 11) * scale), width: Math.round((photo.x - x0) * scale), height: Math.round(15 * scale) })
          .png()
          .toBuffer();
        meta.panchayat = cleanTelugu((await ocr.teluguOnlyLine(img)).text);
      }
    }
    if (boxes.length && !meta.panchayat) {
      const head = items.find((i) => /^:$/.test(i.s.trim()) && i.y < boxes[0].y - 15 && i.y > boxes[0].y - 35 && i.x < 150);
      if (head) {
        const img = await sharp(page.png)
          .extract({ left: Math.round((head.x + 4) * scale), top: Math.round((head.y - 10) * scale), width: Math.round(150 * scale), height: Math.round(14 * scale) })
          .png()
          .toBuffer();
        meta.panchayat = cleanTelugu((await ocr.teluguLine(img)).text);
      }
    }

    // tesseract can return nothing for a short word in a wide, mostly blank
    // crop; trimmed to the ink with a margin, it reads it
    const tight = async (img) => {
      const t = await sharp(img).trim({ threshold: 40 }).extend({ top: 12, bottom: 12, left: 16, right: 16, background: "#ffffff" }).png().toBuffer().catch(() => null);
      return t ?? img;
    };
    const readLine = async (img) => {
      let first = await ocr.teluguLine(img);
      if (!first.text.trim()) first = await ocr.teluguLine(await tight(img));
      if (!hasLatinJunk(first.text)) return first;
      const again = await ocr.teluguOnlyLine(img);
      return again.text.trim() && !hasLatinJunk(again.text) ? again : first;
    };

    // `scope` is the text to read the box from; a tail box (`box.tail`) is the
    // rest of a cut box at the top of this page, starting below its name line.
    const readBox = async (box, scope = items) => {
      const { BOX_W, VALUE_X, PHOTO_X, LINE, GENDER_X0, GENDER_X1 } = box.g;
      const inside = scope.filter((i) => i.x >= box.x - 2 && i.x < box.x + BOX_W && i.y > box.y + 4 && i.y < box.y + 66 && i.s.trim());
      const boxLines = lines(inside);
      // Field lines come from their labels in the left column: the name is the
      // first, age is "వయస్సు", house "ఇంటి సంఖ్య". The relation sits between
      // name and age; its label is blank on some boxes, and a long name or
      // relation name wraps onto an unlabelled line.
      const labelLine = (re) => boxLines.find((l) => l.items.some((i) => i.x < box.x + 2 && re.test(i.s.trim())));
      const dyOf = (l, fallback) => (l ? l.y - box.y : fallback);
      const nameDy = box.tail ? LINE : dyOf(boxLines.find((l) => l.items.some((i) => i.x < box.x + 2 && i.s.trim())), LINE);
      const ageDy = dyOf(labelLine(/^వయ/u), 3 * LINE);
      const houseDy = dyOf(labelLine(/^ఇం/u), ageDy + LINE);
      const between = boxLines.filter((l) => l.y - box.y > nameDy + 2 && l.y - box.y < ageDy - 2 && l.items.some((i) => i.x >= box.x + 40));
      const relLabelLine = between.find((l) => l.items.some((i) => i.x < box.x + 2 && i.s.trim()));
      const relLines = relLabelLine ? between.filter((l) => l.y >= relLabelLine.y - 0.5) : between;
      const nameWrap = between.filter((l) => !relLines.includes(l)).map((l) => l.y - box.y);
      const relDys = relLines.map((l) => l.y - box.y).filter((dy) => Math.abs(dy - ageDy) > 3);
      const relDy = relDys[0] ?? 2 * LINE;
      const near = (dy) => boxLines.filter((l) => Math.abs(l.y - box.y - dy) < 2).flatMap((l) => l.items);
      const lineText = near;
      const ageItem = lineText(ageDy).find((i) => i.x < box.x + 60 && /^:\s*\d{1,3}\s*$/.test(i.s.trim()));
      // A long house number wraps, pushing the EPIC line a line lower than
      // usual, still above the next row's serial line (about 76 pt down).
      // Some prints space rows wider (about 93 pt) and put a wrapped house's
      // EPIC line past 75 pt: there the search runs to the next box in the column.
      // A tail's scope is only the strip above this page's first box, so it can look further.
      const below = box.tail ? [] : boxes.filter((b) => Math.abs(b.x - box.x) < 20 && b.y > box.y + 10).map((b) => b.y);
      const epicTo = box.tail ? 100 : Math.max(75, below.length ? Math.min(...below) - box.y - 4 : Math.min(95, height - box.y));
      const epicItem = scope.find((i) => i.x >= box.x - 2 && i.x < box.x + BOX_W && i.y > box.y + 4 && i.y < box.y + epicTo && /[A-Z]{2,3}\d{6,7}/.test(i.s));
      // The house value, one line or two: a wrapped one starts above its label.
      const houseItems = boxLines
        .filter((l) => l.y - box.y > ageDy + 2 && l.y - box.y >= houseDy - LINE / 2 && (!epicItem || l.y < epicItem.y - 2))
        .flatMap((l) => l.items.filter((i) => i.x > box.x + 40 && i.x < box.x + PHOTO_X));
      // The layer keeps only the first glyph: "పు" (or "ప\0" on some prints) for
      // male, NULs (with a stray "ీ") for female.
      const genderItems = lineText(ageDy).filter((i) => i.x > box.x + GENDER_X0 - 4 && i.x < box.x + PHOTO_X).map((i) => i.s.trim());
      const genderFromLayer = genderItems.some((s) => /^పు?\u0000*$/u.test(s))
        ? "పురుషుడు"
        : genderItems.some((s) => /^(\u0000+|ీ)$/u.test(s)) ? "స్త్రీ" : "";
      const relLabel = relLabelLine ? relLabelLine.items.filter((i) => i.x < box.x + VALUE_X - 3).map((i) => i.s).join("") : "";
      let rel = relLabel ? parseRelationLayer(relLabel) : null;
      let relLabelOcr = "";
      if (relLabelLine && !rel) {
        relLabelOcr = cleanTelugu((await ocr.teluguLine(await crop(box, relDy, -2, VALUE_X - 3))).text);
        rel = parseRelation(relLabelOcr);
      }

      // a line squeezed against the age line (a wrapped relation name) keeps a short descent
      const downFor = (dy) => (ageDy - dy > 3 && ageDy - dy < 9 ? 1.5 : 3.5);
      const readField = async (dys, x1) => {
        const parts = await Promise.all(dys.map(async (dy) => readLine(await crop(box, dy, VALUE_X, x1, 8, downFor(dy))).catch(() => ({ text: "", confidence: 0 }))));
        const text = dropTrailingJunk(parts.map((p) => cleanTelugu(p.text)).filter(Boolean).join(" "));
        return { text, confidence: parts.length ? Math.min(...parts.map((p) => p.confidence)) : 100 };
      };
      // the name line runs above the photo; a wrapped second line is beside it
      const [name, relName, gender] = await Promise.all([
        box.tail ? { text: "", confidence: 100 } : (async () => {
          const extra = nameWrap;
          let first = await readField([nameDy], BOX_W);
          // a short name next to the box border can read as nothing: retry narrower
          for (const x1 of [PHOTO_X + 20, PHOTO_X]) if (!first.text) first = await readField([nameDy], x1);
          if (!extra.length) return first;
          const more = await readField(extra, PHOTO_X);
          return { text: `${first.text} ${more.text}`.trim(), confidence: Math.min(first.confidence, more.confidence) };
        })(),
        relDys.length ? readField(relDys, PHOTO_X) : { text: "", confidence: 100 },
        ocr.teluguLine(await crop(box, ageDy, GENDER_X0, GENDER_X1)),
      ]);
      const g = parseGender(gender.text) || genderFromLayer;
      const ep = epicItem ? cleanEpic(epicItem.s.replace(/^.*?(?=[A-Z]{2,3}\d)/, "")) : { epic: "", valid: false };
      const [acNo = "", acPart = "", acSerial = ""] = box.code;

      const voter = {
        pageNo,
        serial: Number(box.serial.s),
        serialOcr: Number(box.serial.s),
        wardNo,
        acNo,
        acPart,
        acSerial,
        panchayat: meta.panchayat,
        sectionNo: wardNo,
        sectionName: `Ward ${wardNo}`,
        name: name.text,
        relationType: rel?.type ?? relLabelOcr,
        relationName: relName.text,
        house: houseItems.map((i) => i.s.trim()).join(" ").replace(/^:\s*/, "").replace(/\s+/g, " ").trim(),
        age: ageItem ? ageItem.s.replace(/\D/g, "") : "",
        gender: g,
        epic: ep.epic,
        confidence: Math.min(name.confidence, relName.confidence),
        warnings: [],
      };
      if (!voter.name) voter.warnings.push("name unreadable");
      else if (hasLatinJunk(voter.name) || hasLatinJunk(voter.relationName)) voter.warnings.push("name contains non-Telugu characters");
      if (!relLabelLine) voter.warnings.push("relation label blank in the source");
      else if (!rel) voter.warnings.push(`relation label unreadable: "${relLabelOcr}"`);
      if (!g) voter.warnings.push(`gender unreadable: "${cleanTelugu(gender.text)}"`);
      else if (genderFromLayer && g !== genderFromLayer) voter.warnings.push(`gender OCR "${g}" disagrees with text layer "${genderFromLayer}"`);
      if (!ep.valid) voter.warnings.push(`EPIC ${epicItem ? `unusual: "${epicItem.s}"` : "missing"}`);
      if (!voter.age) voter.warnings.push("age missing");
      if (!acPart) voter.warnings.push("assembly part (booth) number missing");
      if (!wardNo) voter.warnings.push("ward number missing");
      if (name.confidence < 60) voter.warnings.push(`low name confidence ${name.confidence.toFixed(0)}`);
      return voter;
    };

    // The rest of the boxes cut at the end of the last page, column by column.
    const FIELD_WARNING = /^(relation|gender|EPIC|age)/;
    for (const { voter, box } of cut) {
      const inColumn = tailItems.filter((i) => i.x >= box.x - 2 && i.x < box.x + box.g.BOX_W);
      // From at most two lines (relation and its wrap) above the age line, or
      // three above the EPIC, so a page header above them is left out.
      const anchor = inColumn.find((i) => /^వయ/u.test(i.s.trim()));
      const epicLine = inColumn.find((i) => /[A-Z]{2,3}\d{6,7}/.test(i.s));
      const from = anchor ? anchor.y - 2.5 * box.g.LINE : epicLine ? epicLine.y - 3.5 * box.g.LINE : -Infinity;
      const column = inColumn.filter((i) => i.y > from);
      if (!column.length) {
        voter.warnings.push("box cut at the page end, rest not found");
        continue;
      }
      const top = Math.min(...column.map((i) => i.y));
      const tail = await readBox({ ...box, y: top - 2 * box.g.LINE, tail: true }, column);
      for (const key of ["relationType", "relationName", "age", "gender", "house", "epic"]) {
        if (!voter[key] && tail[key]) voter[key] = tail[key];
      }
      voter.confidence = Math.min(voter.confidence, tail.confidence);
      voter.warnings = [
        ...voter.warnings.filter((w) => !FIELD_WARNING.test(w)),
        ...tail.warnings.filter((w) => FIELD_WARNING.test(w)),
      ];
    }
    const tails = cut.length;
    // The photo sits beside the box's top lines, right of PHOTO_X: on this
    // page for its own boxes, at the top of it for a box cut on the last one.
    const images = photosDir ? await pageImages(doc, pageNo) : [];
    const used = new Set();
    const photoFor = (box, top, bottom) =>
      images.find((img) => !used.has(img) && img.x >= box.x + box.g.PHOTO_X - 10 && img.x < box.x + box.g.BOX_W + 5 && img.y + img.h / 2 > top && img.y + img.h / 2 < bottom);
    for (const { voter, box } of cut) {
      if (photoOf.has(voter) || !photosDir) continue;
      const img = photoFor(box, 0, boxes[0]?.y ?? height);
      if (img) (used.add(img), photoOf.set(voter, img));
    }
    if (photosDir) await savePhotos(cut.map((c) => c.voter));
    cut = [];

    const rows = await Promise.all(boxes.map((box) => readBox(box)));
    boxes.forEach((box, n) => {
      const img = photosDir && photoFor(box, box.y - 4, box.y + 70);
      if (img) (used.add(img), photoOf.set(rows[n], img));
    });
    // A box whose lines run past the page's end, with no EPIC on this page,
    // continues at the top of the next.
    boxes.forEach((box, n) => {
      // (rows ~93 pt apart can push just the EPIC line over: 7 lines, not 5)
      if (!rows[n].epic && box.y + 7 * box.g.LINE > height - 20) cut.push({ voter: rows[n], box });
    });
    voters.push(...rows);
    if (photosDir) await savePhotos(rows);
    const seconds = (Date.now() - t0) / 1000;
    ocrSeconds += seconds;
    pageRows.push({ pageNo, rows: rows.length, seconds: Number(seconds.toFixed(2)), sectionNo: wardNo, sectionName: `Ward ${wardNo}` });
    log(`page ${pageNo}: ward ${wardNo}, ${rows.length} voters${tails ? `, rest of ${tails} from the last page` : ""}, ${seconds.toFixed(1)}s`);
    onProgress({ stage: "page", pageNo, totalPages, voters: voters.length });
  }

  if (photosDir) {
    for (const v of voters) {
      if (!v.epic) continue;
      if (photoOf.has(v)) v.warnings.push("photo found but no EPIC to name it");
      else if (!existsSync(join(photosDir, `${v.epic}.jpg`))) v.warnings.push("photo missing");
    }
    log(`photos: ${photos} of ${voters.length} saved to ${photosDir}`);
  }

  // serial continuity: the panchayat serial runs on across wards
  for (let i = 1; i < voters.length; i++) {
    if (voters[i].serial !== voters[i - 1].serial + 1) {
      review.push({ serial: voters[i].serial, pageNo: voters[i].pageNo, epic: voters[i].epic, name: voters[i].name, issue: `serial jumps from ${voters[i - 1].serial} to ${voters[i].serial}`, confidence: "" });
    }
  }
  const seen = new Map();
  for (const v of voters) {
    for (const w of v.warnings) review.push({ serial: v.serial, pageNo: v.pageNo, epic: v.epic, name: v.name, issue: w, confidence: Number(v.confidence.toFixed(0)) });
    if (v.epic) {
      if (seen.has(v.epic)) review.push({ serial: v.serial, pageNo: v.pageNo, epic: v.epic, name: v.name, issue: `duplicate EPIC (also serial ${seen.get(v.epic)})`, confidence: "" });
      else seen.set(v.epic, v.serial);
    }
  }

  const isM = (v) => v.gender === "పురుషుడు";
  const isF = (v) => v.gender === "స్త్రీ";
  const count = (list) => ({ total: list.length, male: list.filter(isM).length, female: list.filter(isF).length, other: list.filter((v) => v.gender && !isM(v) && !isF(v)).length });
  const groupBy = (key) => {
    const m = new Map();
    for (const v of voters) {
      const k = v[key] || "?";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(v);
    }
    return [...m].sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[0]).localeCompare(String(b[0])));
  };
  const wards = groupBy("wardNo").map(([wardNo, list]) => ({
    WardNo: wardNo,
    ...Object.fromEntries(Object.entries(count(list)).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v])),
    Booths: [...new Set(list.map((v) => v.acPart))].sort((a, b) => a - b).join(", "),
    FirstSerial: list[0].serial,
    LastSerial: list.at(-1).serial,
    Pages: `${list[0].pageNo}-${list.at(-1).pageNo}`,
  }));
  const booths = groupBy("acPart").map(([booth, list]) => ({
    BoothNo: booth,
    ...Object.fromEntries(Object.entries(count(list)).map(([k, v]) => [k[0].toUpperCase() + k.slice(1), v])),
    Wards: [...new Set(list.map((v) => v.wardNo))].sort((a, b) => a - b).join(", "),
  }));
  const boothNos = booths.map((b) => b.BoothNo);
  const wardBooth = groupBy("wardNo").map(([wardNo, list]) => ({
    WardNo: wardNo,
    ...Object.fromEntries(boothNos.map((b) => [`Booth ${b}`, list.filter((v) => (v.acPart || "?") === b).length])),
    Total: list.length,
  }));

  const all = count(voters);
  const total = (Date.now() - started) / 1000;
  const acNo = mode(voters.map((v) => v.acNo));
  const sourceFile = basename(input);
  const metaOut = {
    SourceFile: sourceFile,
    ListType: meta.kind === "ward" ? "AP SEC municipal ward voter list (photo)" : "AP SEC gram panchayat voter list",
    Panchayat: meta.panchayat,
    Wards: wards.length,
    Booths: boothNos.join(", "),
    AssemblyConstituency: acNo,
    PartNo: "",
    ElectoralRollType: meta.kind === "ward" ? "ULB" : "GP",
    Status: "",
    RollDescription: meta.panchayat,
    DeletionReasonCode: "",
    AgeAsOn: meta.ageAsOn,
    DateOfPublication: meta.publishedOn,
    TotalPages: totalPages,
    OCRLanguage: "tel+eng (names) + PDF text layer (numbers)",
    Workers: workers,
    ExtractedVoters: voters.length,
    ProcessingSeconds: Number(total.toFixed(2)),
    ProcessedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    ReviewItems: review.length,
  };
  const summary = {
    SourceFile: sourceFile,
    TotalPages: totalPages,
    VoterPagesOCRed: pageRows.filter((p) => p.rows > 0).length,
    ExtractedVoters: voters.length,
    ExtractedMale: all.male,
    ExtractedFemale: all.female,
    ExtractedThirdGender: all.other,
    Wards: wards.length,
    Booths: boothNos.length,
    FirstSerialNo: voters[0]?.serial ?? "",
    LastSerialNo: voters.at(-1)?.serial ?? "",
    TotalProcessingSeconds: Number(total.toFixed(2)),
    ReviewItems: review.length,
  };

  // PartNo per row is the booth, so a booth-wise import works as for ECI rolls
  for (const v of voters) v.partNo = v.acPart;

  // The same voters under the roll's own headers, which is what the dashboard
  // import reads (PART_NO + SLNO, and WARD_NO for a panchayat). No AC_NO: the
  // panchayat is onboarded as its own constituency, not as AC ${acNo}.
  const relationCode = { "Father": "F", "Husband": "H", "Mother": "M", "Wife": "W", "Other": "O" };
  const sexCode = { "పురుషుడు": "M", "స్త్రీ": "F", "ఇతరులు": "O" };
  const village = transliterate(meta.panchayat);
  const importRows = voters.map((v) => ({
    PART_NO: Number(v.acPart) || "",
    SLNO: v.serial,
    WARD_NO: Number(v.wardNo) || "",
    SECTION_NO: Number(v.wardNo) || "",
    EPIC_NO: v.epic,
    ELECTOR_NAME: transliterate(v.name),
    ELECTOR_NAME_TEL: v.name,
    RELATION_TYPE: relationCode[AP_RELATION_EN[v.relationType]] ?? "",
    RELATION_NAME: transliterate(v.relationName),
    RELATION_NAME_TEL: v.relationName,
    SEX: sexCode[v.gender] ?? "",
    AGE: v.age === "" ? "" : Number(v.age),
    H_NO: v.house,
    VILLAGE: village,
  }));
  await writeWorkbook({
    meta: metaOut,
    voters,
    summary,
    pages: pageRows,
    review,
    out: output,
    extraColumns: GP_EXTRA_COLUMNS,
    relationEn: AP_RELATION_EN,
    genderEn: AP_GENDER_EN,
    extraSheets: [
      { name: "roll import", rows: importRows },
      { name: "wards", rows: wards },
      { name: "booths", rows: booths },
      { name: "ward x booth", rows: wardBooth },
    ],
  });
  log(`wrote ${output}: ${voters.length} voters in ${wards.length} wards / ${boothNos.length} booths, ${review.length} items to review, ${total.toFixed(0)}s`);
  onProgress({ stage: "done", pageNo: totalPages, totalPages, voters: voters.length });
  return { meta: metaOut, summary, voters, review, wards, booths };
}
