// Andhra Pradesh State Election Commission urban-local-body ward voter lists
// (sec-ems.ap.gov.in, Telugu, printed to PDF from the browser).
//
// These PDFs carry a text layer, but the Telugu font's Unicode map drops
// conjunct consonants, so names are unreliable there. Numbers, EPICs and house
// numbers are exact. So: box positions and numeric fields come from the text
// layer; the Telugu fields are OCR'd from a 4x render of the page.
import { basename } from "node:path";
import sharp from "sharp";
import { openPdf, pageText, renderPage } from "../pdf-render.mjs";
import { writeWorkbook } from "../xlsx.mjs";
import { cleanEpic } from "../parse.mjs";
import { transliterate } from "../translit.mjs";

const BOX_W = 176; // points
const BOX_LEFT_FROM_SERIAL = 50; // the serial number sits ~50pt right of the box edge
// Field baselines relative to the serial line, and x ranges inside the box (points)
const LINES = {
  name: { dy: 11, x0: 46, x1: 138 },
  relLabel: { dy: 22, x0: 0, x1: 46 },
  relName: { dy: 22, x0: 46, x1: 138 },
  gender: { dy: 34, x0: 100, x1: 138 },
};
const LINE_H = 11;

export const AP_EXTRA_COLUMNS = [
  { header: "WardNo", key: "wardNo", width: 9 },
  { header: "ACNo", key: "acNo", width: 7 },
  { header: "ACPartNo", key: "acPart", width: 9 },
  { header: "ACPartSerial", key: "acSerial", width: 12 },
];

const RELATION = [
  { re: /^భ/u, type: "భర్త", en: "Husband" },
  { re: /^భా/u, type: "భార్య", en: "Wife" },
  { re: /^త[ంణడ]/u, type: "తండ్రి", en: "Father" },
  { re: /^తల/u, type: "తల్లి", en: "Mother" },
  { re: /^ఇ/u, type: "ఇతరులు", en: "Other" },
];
export const AP_RELATION_EN = Object.fromEntries(RELATION.map((r) => [r.type, r.en]));
export const AP_GENDER_EN = { "స్త్రీ": "Female", "పురుషుడు": "Male", "ఇతరులు": "Other" };

/** Does this pdf.js document look like an AP ULB ward list? */
export async function isApUlbList(doc) {
  const { items } = await pageText(doc, 1);
  const text = items.map((i) => i.s).join(" ");
  return /sec-ems\.ap\.gov\.in|getULGWise/.test(text) || (/వా\s*\.?\s*ఓ/u.test(text) && /ఓటరు/u.test(text));
}

/**
 * Serial-number text items of a page: digits right after the label's ".." token
 * (". ." in newer Chrome prints).
 */
function findSerials(items) {
  const out = items.filter(
    (i) =>
      /^\d{1,6}$/.test(i.s.trim()) &&
      items.some((j) => Math.abs(j.y - i.y) < 2 && /\.\s*\./.test(j.s) && i.x > j.x && i.x - (j.x + j.w) < 14),
  );
  // reading order: rows (y within a few points of each other), then left to right
  out.sort((a, b) => a.y - b.y);
  const rows = [];
  for (const s of out) {
    const row = rows.find((r) => Math.abs(r.y - s.y) < 8);
    if (row) row.items.push(s);
    else rows.push({ y: s.y, items: [s] });
  }
  return rows.flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}


/** Distance between neighbouring serials in a row (the box pitch), or the tuned width plus a gap. */
function rowPitch(serials) {
  const gaps = [];
  for (let i = 1; i < serials.length; i++) {
    const d = serials[i].x - serials[i - 1].x;
    if (Math.abs(serials[i].y - serials[i - 1].y) < 8 && d > 100 && d < 260) gaps.push(d);
  }
  if (!gaps.length) return BOX_W + 3;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

export const cleanTelugu = (s) =>
  (s || "")
    .replace(/[\u0000-\u001F​-‍]/g, "")
    .replace(/['"“”‘’`]/g, "")
    // OCR reads the top of శ్రీ as "(": "(శ్రీరాముల"
    .replace(/(^|\s)[(\[]+(?=[\u0C00-\u0C7F])/gu, "$1")
    // inside a word, the ra-vattu drawn left of its consonant reads as "(", "[" or "|":
    // "\u0C1A\u0C02(\u0C26" = \u0C1A\u0C02\u0C26\u0C4D\u0C30, "\u0C2D[\u0C26\u0C2E\u0C4D\u0C2E" = \u0C2D\u0C26\u0C4D\u0C30\u0C2E\u0C4D\u0C2E, "|\u0C2A\u0C15\u0C3E\u0C36" = \u0C2A\u0C4D\u0C30\u0C15\u0C3E\u0C36; "[\u0C26\u0C4D\u0C30" already has it
    .replace(/[(\[|]([\u0C15-\u0C39])(\u0C4D\u0C30)?/gu, "$1\u0C4D\u0C30")
    .replace(/\?/g, "")
    .replace(/^[\s:;.,(\[|_-]+/u, "")
    .replace(/[\s:;.,()\[\]|_-]+$/u, "")
    .replace(/\s+/g, " ")
    .trim();

export const hasLatinJunk = (s) => /[A-Za-z]{2,}|[{}@#$%^*~<>]/.test(s);

/**
 * Drop trailing tokens no name ends with: digits, a lone letter, Latin or
 * punctuation. They come from the tops of the line underneath ("ఆ", "౮", and
 * "౧. త్ర" from a tall స్త్రీ), so a digit token ends the name.
 */
export function dropTrailingJunk(s) {
  // OCR reads an anusvara as the Telugu digit zero: "వె౦కట"
  const words = s.replace(/(?<=[\u0C15-\u0C39\u0C3E-\u0C4C])\u0C66/gu, "\u0C02").split(" ");
  const digits = (w) => /^[\u0C66-\u0C6F]+[.,]*$/u.test(w);
  for (;;) {
    if (words.length > 1 && (/^[^\u0C05-\u0C39]*$/u.test(words.at(-1)) || /^[\u0C05-\u0C39][^\u0C00-\u0C7F]*$/u.test(words.at(-1)))) words.pop();
    else if (words.length > 2 && words.at(-1).length <= 4 && digits(words.at(-2))) words.length -= 2;
    else break;
  }
  return words.join(" ");
}

/** Letters as the text layer keeps them: no subscript consonants (it drops conjuncts), no viramas. */
const layerLetters = (ocrText) => ocrText.replace(/[\u200C\u200D\s]/g, "").replace(/\u0C4D[\u0C15-\u0C39]?/gu, "");

/**
 * Is `layer` (text-layer letters) the word read as `ocr`? The text layer may
 * file a leading syllable on the line above, so up to two of the OCR'd
 * letters can be missing from it, and one letter either way can be an OCR slip.
 */
function sameLetters(ocr, layer) {
  if (!ocr || layer.length < 3) return ocr === layer && !!ocr;
  const left = [...layer];
  let missing = 0;
  for (const ch of ocr) {
    const n = left.indexOf(ch);
    if (n < 0) missing++;
    else left.splice(n, 1);
  }
  const slip = left.length; // layer letters the OCR'd word lacks
  return slip <= 1 && missing - slip <= 2 && missing <= 3;
}

export function parseGender(ocr) {
  const t = cleanTelugu(ocr);
  if (/స్త|స్తీ|స్త్రీ|స్రీ|స్ర/u.test(t)) return "స్త్రీ";
  // "పురుషుడు" runs under the photo frame, so often only "పు"/"పుర" is readable
  if (/^పు|పురు|పుర|షుడు/u.test(t)) return "పురుషుడు";
  if (/ఇతర/u.test(t)) return "ఇతరులు";
  return "";
}

export function parseRelation(labelOcr) {
  const t = cleanTelugu(labelOcr).replace(/౦/g, "ం"); // Telugu digit zero read for anusvara
  if (/^భా/u.test(t)) return RELATION[1];
  if (/^భ/u.test(t)) return RELATION[0];
  if (/^తల/u.test(t)) return RELATION[3];
  if (/^త/u.test(t) || /డ్రి|డి/u.test(t)) return RELATION[2];
  if (/^ఇ/u.test(t)) return RELATION[4];
  return null;
}

/**
 * Relation label from the text layer. The font map drops conjuncts and the
 * glyph order is visual, so తండ్రి reads "తం\0డి", భర్త "ర\0భ", తల్లి "లిత\0".
 */
export function parseRelationLayer(label) {
  const t = label.replace(/[\u0000\s]/g, "");
  if (/భా/u.test(t)) return RELATION[1];
  if (/భ/u.test(t)) return RELATION[0];
  if (/తం/u.test(t)) return RELATION[2];
  if (/త/u.test(t) && /ల/u.test(t)) return RELATION[3];
  if (/ఇ/u.test(t)) return RELATION[4];
  return null;
}

/**
 * Convert one AP ULB ward list PDF to a workbook.
 * @param {object} o
 * @param {string} o.input
 * @param {string} o.output
 * @param {{teluguLine:Function, teluguText:Function}} o.ocr
 * @param {number} [o.scale]
 * @param {(m:string)=>void} [o.log]
 * @param {(p:object)=>void} [o.onProgress]
 */
export async function convertApUlb({ input, output, ocr, scale = 4, workers = 4, log = console.log, onProgress = () => {} }) {
  const started = Date.now();
  const doc = await openPdf(input);
  const totalPages = doc.numPages;
  log(`pages: ${totalPages} (AP ULB ward list, text + Telugu OCR)`);
  onProgress({ stage: "start", pageNo: 0, totalPages, voters: 0 });

  const voters = [];
  const pageRows = [];
  const review = [];
  const meta = { title: "", wardNo: "", ageAsOn: "", publishedOn: "" };
  let ocrSeconds = 0;

  for (let pageNo = 1; pageNo <= totalPages; pageNo++) {
    const t0 = Date.now();
    const { items, height } = await pageText(doc, pageNo);
    const serials = findSerials(items);

    // Dates in the footer are plain ASCII in the text layer.
    if (!meta.ageAsOn) {
      const footer = items.filter((i) => i.y > height * 0.8).map((i) => i.s).join(" ");
      const dates = footer.match(/\d{2}-\d{2}-\d{4}/g) ?? [];
      if (dates[0]) meta.ageAsOn = dates[0];
      if (dates[1]) meta.publishedOn = dates[1];
    }

    if (!serials.length) {
      pageRows.push({ pageNo, rows: 0, seconds: 0, sectionNo: "", sectionName: "" });
      continue;
    }

    const page = await renderPage(doc, pageNo, scale);
    // l.up / l.down: how far the crop reaches above and below the baseline
    const crop = (box, { dy, x0, x1, up = 7, down = LINE_H - 7 }) =>
      sharp(page.png)
        .extract({
          left: Math.max(0, Math.round((box.x + x0) * scale)),
          top: Math.max(0, Math.round((box.y + dy - up) * scale)),
          width: Math.round((x1 - x0) * scale),
          height: Math.round((up + down) * scale),
        })
        .png()
        .toBuffer();

    // Header: list title and ward number (OCR once; the text layer garbles the title)
    if (!meta.title) {
      const bandTop = Math.max(0, Math.round((serials[0].y - 34) * scale));
      const band = await sharp(page.png).extract({ left: 0, top: bandTop, width: page.width, height: Math.round(26 * scale) }).png().toBuffer();
      const head = (await ocr.teluguText(band)).text;
      const lines = head.split("\n").map(cleanTelugu).filter(Boolean);
      meta.title = lines[0] ?? "";
      // ward number: ": 65" in the text layer on the line under the title
      const wardItem = items.find((i) => i.y < serials[0].y - 4 && i.y > serials[0].y - 40 && /^:\s*\d+\s*$/.test(i.s));
      if (wardItem) meta.wardNo = wardItem.s.replace(/\D/g, "");
      else {
        const ward = /(\d+)\s*$/.exec(lines.find((l) => /వార|నెంబ/u.test(l)) ?? "");
        if (ward) meta.wardNo = ward[1];
      }
    }

    // Chrome versions lay the boxes out at slightly different widths (176pt in
    // the prints these offsets were tuned on, 163pt in newer ones), so the box
    // width comes from the spacing of the serials in a row, and the value and
    // gender columns from the ":" printed before them.
    const pitch = rowPitch(serials);
    const boxW = Math.min(BOX_W, pitch - 3);
    const k = boxW / BOX_W;

    const rows = [];
    for (const s of serials) {
      const box = { x: s.x - BOX_LEFT_FROM_SERIAL, y: s.y, w: boxW };
      const inBox = (i, dy, tol = 3) => i.x >= box.x && i.x < box.x + box.w && Math.abs(i.y - (box.y + dy)) <= tol;
      // everything printed inside this box below the serial line (a long house
      // address wraps and pushes the lines under it down, so no fixed offsets here)
      const inside = items
        .filter((i) => i.x >= box.x && i.x < box.x + box.w && i.y > box.y + 4 && i.y < box.y + 68 && i.s.trim())
        .sort((a, b) => a.y - b.y || a.x - b.x);
      // the ":" after the name label marks where values start
      const colonAt = (dy, from, to) =>
        items.find((i) => inBox(i, dy, 3) && /^:/.test(i.s.trim()) && i.x >= box.x + from && i.x <= box.x + to);
      const nameColon = colonAt(LINES.name.dy, 20 * k, 50 * k);
      const valueDx = nameColon ? nameColon.x - box.x + 2.5 : LINES.name.x0;
      const valueX = box.x + valueDx - 4; // values start right after the label column
      // the photo frame starts a little left of its "Photo Available" text; the
      // relation line runs beside it, so its crop must stop short of the frame
      const photo = items.find((i) => /^(Photo|Available)$/.test(i.s.trim()) && i.x > box.x + 90 * k && i.x < box.x + boxW && i.y > box.y && i.y < box.y + 60);
      const relX1 = Math.min(LINES.relName.x1 * k, photo ? photo.x - box.x - 6 : Infinity);
      // exact fields from the text layer
      const codeTokens = items.filter((i) => inBox(i, 0, 2) && i.x > s.x + s.w && /^\d+$/.test(i.s.trim())).map((i) => i.s.trim());
      const ageItem = inside.find((i) => i.x >= valueX && /^:\s*\d{1,3}\s*$/.test(i.s));
      const epicItem = inside.find((i) => /[A-Z]{2,3}\d{6,7}/.test(i.s));
      // the house number starts at its own ":" (a relation name can wrap below the age)
      const houseColon = ageItem && inside.find((i) => i.y > ageItem.y + 2 && /^:/.test(i.s.trim()) && i.x < box.x + valueDx + 2);
      let houseItem = null;
      if (ageItem) {
        const houseTop = houseColon ? houseColon.y - 2 : ageItem.y + 4;
        const houseLines = inside.filter((i) => i.x >= valueX && i.y > houseTop && (!epicItem || i.y < epicItem.y - 3) && !/^(Photo|Available)$/.test(i.s.trim()));
        if (houseLines.length) houseItem = { s: houseLines.map((i) => i.s.trim()).join(" ").replace(/\s+/g, " ") };
      }
      // the text layer carries "పు" (or "ప" plus unmapped glyphs) for male and
      // unmapped glyphs, sometimes around a "ీ", for female
      const genderLayer = ageItem ? inside.find((i) => Math.abs(i.y - ageItem.y) < 3 && i.x > ageItem.x + 40 && /^(ప[ు\u0000]*|[\u0000ీ]*\u0000[\u0000ీ]*)$/.test(i.s.trim())) : null;
      const genderFromLayer = genderLayer ? (genderLayer.s.trim().startsWith("ప") ? "పురుషుడు" : "స్త్రీ") : "";

      // Where the name and relation lines sit. A long name or relation name
      // wraps onto a second line 8pt lower and pushes the rest of the box down,
      // and a box whose relation label is blank in the source prints its
      // relation line squeezed against the age line, so the lines come from
      // the text layer: each field starts at a ":" in the value column.
      const ageDy = ageItem ? ageItem.y - box.y : LINES.gender.dy;
      // gender value: after the ":" that follows the gender label on the age line
      const genderColon = colonAt(ageDy, 75 * k, 110 * k);
      const genderDx = genderColon ? genderColon.x - box.x + 2.5 : LINES.gender.x0 * k;
      const valueLines = [];
      for (const i of inside) {
        if (i.x < valueX || Math.abs(i.y - (box.y + ageDy)) < 2 || /^(Photo|Available)$/.test(i.s.trim())) continue;
        if (i.y > (houseColon ? houseColon.y - 3 : box.y + ageDy - 2)) continue;
        const line = valueLines.find((l) => Math.abs(l.y - i.y) < 2.5);
        if (line) line.items.push(i);
        else valueLines.push({ y: i.y, items: [i] });
      }
      const starts = valueLines.flatMap((l, n) => (l.items.some((i) => /^:/.test(i.s.trim()) && i.x < box.x + valueDx + 2) ? [n] : []));
      const block = (n) => (starts[n] === undefined ? [] : valueLines.slice(starts[n], starts[n + 1] ?? valueLines.length).map((l) => l.y - box.y));
      const nameDys = block(0).length ? block(0) : [LINES.name.dy];
      const relDys = block(1).length ? block(1) : [LINES.relName.dy];
      // each line's crop stops short of its neighbours; a relation name wrapping
      // onto the age row overlaps it, so that line keeps a minimal descent
      const ladder = [...nameDys, ...relDys, ageDy];
      const lineAt = (dy, x0, x1) => {
        const n = ladder.indexOf(dy);
        const gapUp = n > 0 ? dy - ladder[n - 1] : Infinity;
        const gapDown = ladder[n + 1] - dy;
        return { dy, x0, x1, up: Math.min(7, gapUp - 1.5), down: gapDown < 6 ? 3 : Math.min(4, gapDown / 2) };
      };

      // relation label: from the text layer, which has it for every labelled box
      const relDy = relDys[0];
      const labelItems = inside.filter((i) => i.x < box.x + valueDx - 5 && Math.abs(i.y - (box.y + relDy)) < 5);
      let rel = labelItems.length ? parseRelationLayer(labelItems.map((i) => i.s).join("")) : null;
      let relLabelOcr = "";
      if (labelItems.length && !rel) {
        relLabelOcr = cleanTelugu((await ocr.teluguLine(await crop(box, { dy: relDy, x0: -2.5, x1: valueDx - 3 }))).text);
        rel = parseRelation(relLabelOcr);
      }

      // Telugu fields by OCR, a line at a time; a Telugu-only retry when the
      // mixed model emits Latin junk
      const readLine = async (l) => {
        const img = await crop(box, l);
        const first = await ocr.teluguLine(img);
        if (!hasLatinJunk(first.text)) return first;
        const again = await ocr.teluguOnlyLine(img);
        return again.text.trim() && !hasLatinJunk(again.text) ? again : first;
      };
      // the first name line runs above the photo frame, to the box edge; a
      // wrapped line starts under the ":" rather than after it
      const readField = async (dys, x1, firstX1 = x1) => {
        const parts = await Promise.all(dys.map((dy, n) => readLine(n ? lineAt(dy, valueDx - 3.5, x1) : lineAt(dy, valueDx, firstX1))));
        const text = dropTrailingJunk(parts.map((p) => cleanTelugu(p.text)).filter(Boolean).join(" "));
        return { text, confidence: parts.length ? Math.min(...parts.map((p) => p.confidence)) : 100 };
      };
      // A relation name's last line printed over the age row cannot be OCR'd
      // apart from the age. It is nearly always the family name, so when its
      // text-layer letters match the voter's own surname, that is used instead.
      const overAge = relDys.filter((dy) => Math.abs(ageDy - dy) < 6);
      const [name, relName, gender] = await Promise.all([
        readField(nameDys, relX1, boxW - 3),
        readField(relDys.filter((dy) => !overAge.includes(dy)), relX1),
        ocr.teluguLine(await crop(box, { dy: ageDy, x0: genderDx, x1: genderDx + (LINES.gender.x1 - LINES.gender.x0) })),
      ]);
      let relOverAgeMissing = false;
      for (const dy of overAge) {
        const layer = valueLines.find((l) => l.y - box.y === dy).items.map((i) => i.s).join("").replace(/[\u0000\s]/g, "");
        const surname = name.text.split(" ").at(-1) ?? "";
        if (sameLetters(layerLetters(surname), layer)) relName.text = `${relName.text} ${surname}`.trim();
        else relOverAgeMissing = true;
      }
      const g = parseGender(gender.text) || genderFromLayer;
      const ep = epicItem ? cleanEpic(epicItem.s) : { epic: "", valid: false };

      const voter = {
        pageNo,
        serial: Number(s.s),
        serialOcr: Number(s.s),
        acNo: codeTokens[0] ?? "",
        acPart: codeTokens[1] ?? "",
        acSerial: codeTokens[2] ?? "",
        wardNo: meta.wardNo,
        sectionNo: codeTokens[1] ?? "",
        sectionName: "",
        name: name.text,
        relationType: rel?.type ?? relLabelOcr,
        relationName: relName.text,
        house: houseItem ? houseItem.s.replace(/^:\s*/, "").trim() : "",
        age: ageItem ? ageItem.s.replace(/\D/g, "") : "",
        gender: g,
        epic: ep.epic,
        confidence: Math.min(name.confidence, relName.confidence),
        warnings: [],
      };
      if (!voter.name) voter.warnings.push("name unreadable");
      else if (hasLatinJunk(voter.name) || hasLatinJunk(voter.relationName)) voter.warnings.push("name contains non-Telugu characters");
      if (!labelItems.length) voter.warnings.push("relation label blank in the source");
      else if (!rel) voter.warnings.push(`relation label unreadable: "${relLabelOcr}"`);
      if (relOverAgeMissing) voter.warnings.push("part of the relation name overlaps the age and was left out");
      if (!g) voter.warnings.push(`gender unreadable: "${cleanTelugu(gender.text)}"`);
      else if (genderFromLayer && g !== genderFromLayer) voter.warnings.push(`gender OCR "${g}" disagrees with text layer "${genderFromLayer}"`);
      if (!ep.valid) voter.warnings.push(`EPIC ${epicItem ? `unusual: "${epicItem.s}"` : "missing"}`);
      if (!voter.age) voter.warnings.push("age missing");
      if (name.confidence < 60) voter.warnings.push(`low name confidence ${name.confidence.toFixed(0)}`);
      rows.push(voter);
    }
    voters.push(...rows);
    const seconds = (Date.now() - t0) / 1000;
    ocrSeconds += seconds;
    pageRows.push({ pageNo, rows: rows.length, seconds: Number(seconds.toFixed(2)), sectionNo: rows[0]?.acPart ?? "", sectionName: `AC ${rows[0]?.acNo ?? ""} part ${rows[0]?.acPart ?? ""}` });
    log(`page ${pageNo}: ${rows.length} voters, ${seconds.toFixed(1)}s`);
    onProgress({ stage: "page", pageNo, totalPages, voters: voters.length });
  }

  // serial continuity and duplicates
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

  const male = voters.filter((v) => v.gender === "పురుషుడు").length;
  const female = voters.filter((v) => v.gender === "స్త్రీ").length;
  const other = voters.filter((v) => v.gender && v.gender !== "పురుషుడు" && v.gender !== "స్త్రీ").length;
  const total = (Date.now() - started) / 1000;
  const acNo = mode(voters.map((v) => v.acNo));
  const sourceFile = basename(input);

  const metaOut = {
    SourceFile: sourceFile,
    ListType: "AP SEC urban local body ward list",
    Title: meta.title,
    WardNo: meta.wardNo,
    AssemblyConstituency: acNo,
    PartNo: meta.wardNo,
    ElectoralRollType: "ULB",
    Status: "",
    RollDescription: meta.title,
    DeletionReasonCode: "",
    AgeAsOn: meta.ageAsOn,
    DateOfPublication: meta.publishedOn,
    TotalPages: totalPages,
    ExpectedMale: "",
    ExpectedFemale: "",
    ExpectedThirdGender: "",
    ExpectedTotalVoters: "",
    OCRLanguage: "tel+eng (names) + PDF text layer (numbers)",
    Workers: workers,
    ExtractedVoters: voters.length,
    ProcessingSeconds: Number(total.toFixed(2)),
    ProcessedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    SerialNumbersRepaired: 0,
    ReviewItems: review.length,
  };
  const summary = {
    SourceFile: sourceFile,
    TotalPages: totalPages,
    VoterPagesOCRed: pageRows.filter((p) => p.rows > 0).length,
    ExtractedVoters: voters.length,
    ExtractedMale: male,
    ExtractedFemale: female,
    ExtractedThirdGender: other,
    FirstSerialNo: voters[0]?.serial ?? "",
    LastSerialNo: voters.at(-1)?.serial ?? "",
    TotalProcessingSeconds: Number(total.toFixed(2)),
    OCRPageSeconds: Number(ocrSeconds.toFixed(2)),
    AverageSecondsPerOCRPage: pageRows.length ? Number((ocrSeconds / pageRows.length).toFixed(2)) : "",
    ReviewItems: review.length,
  };

  await writeWorkbook({
    meta: metaOut,
    voters,
    summary,
    pages: pageRows,
    review,
    out: output,
    extraColumns: AP_EXTRA_COLUMNS,
    relationEn: AP_RELATION_EN,
    genderEn: AP_GENDER_EN,
    // The sheet the dashboard and scripts/import-panchayat.mjs (--no-panchayat)
    // import: one ward, booth-wise, so each assembly part is a booth.
    extraSheets: [{ name: "roll import", rows: importRows(voters) }],
  });
  log(`wrote ${output}: ${voters.length} voters, ${review.length} items to review, ${total.toFixed(0)}s`);
  onProgress({ stage: "done", pageNo: totalPages, totalPages, voters: voters.length });
  return { meta: metaOut, summary, voters, review };
}

export function mode(values) {
  const counts = new Map();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = "";
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

export const _test = { cleanTelugu, parseGender, parseRelation, parseRelationLayer, dropTrailingJunk, layerLetters, sameLetters };

const RELATION_CODE = { Father: "F", Husband: "H", Mother: "M", Wife: "W", Other: "O" };
const SEX_CODE = { "పురుషుడు": "M", "స్త్రీ": "F", "ఇతరులు": "O" };

function importRows(voters) {
  return voters.map((v) => ({
    PART_NO: Number(v.acPart) || "",
    SLNO: v.serial,
    EPIC_NO: v.epic,
    ELECTOR_NAME: transliterate(v.name),
    ELECTOR_NAME_TEL: v.name,
    RELATION_TYPE: RELATION_CODE[AP_RELATION_EN[v.relationType]] ?? "",
    RELATION_NAME: transliterate(v.relationName),
    RELATION_NAME_TEL: v.relationName,
    SEX: SEX_CODE[v.gender] ?? "",
    AGE: v.age === "" ? "" : Number(v.age),
    H_NO: v.house,
  }));
}
