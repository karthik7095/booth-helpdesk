// Turns OCR text from one voter box into structured fields. Rolls come in the
// state language (Marathi, Devanagari) or in English; parseBody() picks the
// label set by the `lang` argument ("mar" or "eng").

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Convert Devanagari digits to ASCII. */
export function asciiDigits(s) {
  return s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
}

/** Normalise OCR punctuation around labels: "नाव :", "नाव:", "नाव ;" -> "नाव:" */
function norm(line) {
  return asciiDigits(line)
    .replace(/[|]/g, "")
    .replace(/\s*[:;ः]\s*/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Clean OCR noise from a Devanagari field: zero-width joiners, Vedic accents, nukta
 * (never used in Marathi names), doubled vowel signs and trailing punctuation.
 */
export function cleanDevanagari(s) {
  return (s || "")
    .normalize("NFC")
    .replace(/[​-‍॑-़॔ँ]/g, "")
    .replace(/[ा-ौ]+([ा-ौ])/g, "$1")
    .replace(/[.,;:'"`|_\-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** House-number clean-up: the "ऍट" (at) prefix is read many ways by the OCR. */
export function normaliseHouse(s) {
  return s
    .trim()
    .replace(/^(?:ए[ंॅ]?ट|ऐट|एॅट|YT|Ue|At)\s+/u, "ऍट ")
    .replace(/\s+/g, " ");
}

const RELATION_LABELS = [
  { re: /^वडिलांचे(?:\s*नाव)?:?\s*/u, type: "वडिलांचे" },
  { re: /^पतीचे(?:\s*नाव)?:?\s*/u, type: "पतीचे" },
  { re: /^आईचे(?:\s*नाव)?:?\s*/u, type: "आईचे" },
  { re: /^पालका?चे(?:\s*नाव)?:?\s*/u, type: "पालक" },
  { re: /^इतर:?\s*/u, type: "इतर" },
];

/**
 * @param {string} bodyText OCR text of the box body (name / relation / house / age-gender lines)
 * @param {"mar"|"eng"|"tel"} [lang] label language of the roll
 * @returns {{name:string, relationType:string, relationName:string, house:string, age:string, gender:string, warnings:string[]}}
 */
export function parseBody(bodyText, lang = "mar") {
  if (lang === "eng") return parseBodyEnglish(bodyText);
  if (lang === "tel") return parseBodyTelugu(bodyText);
  return parseBodyMarathi(bodyText);
}

function parseBodyMarathi(bodyText) {
  const lines = bodyText.split(/\n/).map(norm).filter(Boolean);
  const out = { name: "", relationType: "", relationName: "", house: "", age: "", gender: "", warnings: [] };

  for (const raw of lines) {
    let line = raw;
    // The house label sometimes lands on the end of the previous line.
    const inline = /\s(घर\s*क्र\S*:?\s*.*)$/u.exec(line);
    if (inline && !out.house) {
      out.house = normaliseHouse(inline[1].replace(/^घर\s*\S+:?\s*/u, ""));
      line = line.slice(0, inline.index).trim();
      if (!line) continue;
    }
    if (/^नाव:/u.test(line) || /^नाव\s/u.test(line)) {
      out.name = line.replace(/^नाव:?\s*/u, "").trim();
      continue;
    }
    const rel = RELATION_LABELS.find((r) => r.re.test(line));
    if (rel) {
      out.relationType = rel.type;
      out.relationName = line.replace(rel.re, "").trim();
      continue;
    }
    // "घर क्रमांक" is often read without the anusvara or with a broken matra
    if (/^घर\s*क्र/u.test(line)) {
      out.house = normaliseHouse(line.replace(/^घर\s*\S+:?\s*/u, ""));
      continue;
    }
    if (/^वय/u.test(line)) {
      const age = /वय:?\s*(\d{1,3})/u.exec(line);
      const gender = /लिंग:?\s*(पुरुष|महिला|तृतीय\s*पंथी|इतर)/u.exec(line);
      out.age = age ? age[1] : "";
      out.gender = gender ? gender[1].replace(/\s+/g, " ") : "";
      if (!age) out.warnings.push(`age unreadable: "${line}"`);
      if (!gender) out.warnings.push(`gender unreadable: "${line}"`);
      continue;
    }
    // Unlabelled line: most likely a wrapped continuation of the previous field.
    if (out.relationName && !out.house) out.relationName += " " + line;
    else if (out.name && !out.relationName) out.name += " " + line;
    else out.warnings.push(`unparsed line: "${line}"`);
  }

  out.name = cleanDevanagari(out.name);
  out.relationName = cleanDevanagari(out.relationName);
  out.house = out.house.replace(/[​-‍॑-॔]/g, "").trim();
  if (!out.name) out.warnings.push("name missing");
  if (!out.gender) out.warnings.push("gender missing");
  return out;
}

// English rolls (e.g. the Andhra Pradesh SIR drafts) use the same box layout
// with English labels: "Name :", "Fathers Name:", "Husbands Name:", "Mothers
// Name:", "Others:", "House Number :", "Age : 29 Gender : Female". Low
// resolution scans garble the labels ("Narme", "Holise Number", "House Numba",
// "Age +68", "Gander: Mae"), so labels are matched loosely by shape and the
// separator may be any of : ; + © * . or missing.
const SEP = String.raw`\s*[:;+©®*.,]?\s*`;
const NAME_LABEL = new RegExp(String.raw`^N[a-z]{2,4}` + String.raw`\s*[:;+©®*.,]\s*`);
const NAME_LABEL_BARE = /^N(?:ame|arne|arme|ame)\s+/;
// Labels are printed in title case; matching case keeps a wrapped name line such
// as "FATHIMA" from being taken for a "Fathers Name" label. A label needs the
// "Name" word or a separator after it.
const RELATION_LABELS_EN = new RegExp(String.raw`^(Fat|Hus|Mot|Wif|Gua|Oth)[a-z]*'?s?(?:\s*N[a-z]{2,4}` + SEP + String.raw`|\s*[:;+©®*.,]\s*)`);
const RELATION_TYPE = { fat: "Father", hus: "Husband", mot: "Mother", wif: "Wife", gua: "Guardian", oth: "Other" };
const HOUSE_LABEL = new RegExp(String.raw`^H[a-z]{2,5}\s*(?:N[a-z]{2,5}|No\.?)` + SEP, "i");
const HOUSE_INLINE = new RegExp(String.raw`\s(H[a-z]{2,5}\s*(?:N[a-z]{2,5}|No\.?)\s*[:;+©®*.,]\s*.*)$`);
const AGE_RE = /\bA[gq][eo]\W{0,4}(\d{1,3})\b/i;
// "Female" comes out as "Fernale", "Fermnale", "Farmnale"; "Male" as "Mae", "Malas".
const GENDER_RE = /\bG[ae]n[a-z]{0,4}\W{0,4}(Th[a-z]*(?:\s*G[a-z]*)?|M[a-z]{0,5}|F[a-z]{1,8}|O[a-z]{2,5})\b/i;

/** Map a (possibly garbled) gender word by its shape: Male, Mae, Femate, Third Gender, Other. */
function englishGender(word) {
  const w = word.toLowerCase();
  if (w.startsWith("th")) return "Third Gender";
  if (w.startsWith("f")) return "Female";
  if (w.startsWith("m")) return "Male";
  if (w.startsWith("o")) return "Other";
  return "";
}

/** Trim OCR punctuation and stray marks around a Latin field. */
function cleanLatin(s) {
  return (s || "")
    .replace(/[​-‍]/g, "")
    // a capital I (or J) at a word start is often read as "["
    .replace(/(^|\s)[\[{](?=[A-Za-z])/g, "$1I")
    .replace(/^[\s.,;:'"`|_\-+©®*‘’]+/, "")
    .replace(/[\s.,;:'"`|_\-+©®*‘’]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseBodyEnglish(bodyText) {
  const lines = bodyText.split(/\n/).map(norm).map((l) => l.replace(/^[‘'`"|]+/, "")).filter(Boolean);
  const out = { name: "", relationType: "", relationName: "", house: "", age: "", gender: "", warnings: [] };
  let bracket = false;

  lines.forEach((raw, index) => {
    let line = raw;
    // The house label sometimes lands on the end of the previous line.
    const inline = HOUSE_INLINE.exec(line);
    if (inline && !out.house) {
      out.house = inline[1].replace(HOUSE_LABEL, "").trim();
      line = line.slice(0, inline.index).trim();
      if (!line) return;
    }
    if (NAME_LABEL.test(line) || (index === 0 && NAME_LABEL_BARE.test(line))) {
      out.name = line.replace(NAME_LABEL, "").replace(NAME_LABEL_BARE, "").trim();
      return;
    }
    const rel = RELATION_LABELS_EN.exec(line);
    if (rel) {
      out.relationType = RELATION_TYPE[rel[1].toLowerCase()];
      out.relationName = line.slice(rel[0].length).trim();
      return;
    }
    if (HOUSE_LABEL.test(line)) {
      out.house = line.replace(HOUSE_LABEL, "").trim();
      return;
    }
    if (AGE_RE.test(line) || /^A[gq][eo]\b/i.test(line) || /\bG[ae]n[a-z]{0,4}\W/i.test(line)) {
      const age = AGE_RE.exec(line);
      const gender = GENDER_RE.exec(line);
      out.age = age ? age[1] : "";
      // the colon after "Age" is sometimes read as a 1: "Age 129" for "Age : 29"
      if (/^1\d\d$/.test(out.age) && Number(out.age) > 120) {
        out.warnings.push(`age read as ${out.age}, taken as ${out.age.slice(1)}`);
        out.age = out.age.slice(1);
      }
      if (out.age && Number(out.age) < 18) out.warnings.push(`age read as ${out.age}, below voting age: check the PDF`);
      out.gender = gender ? englishGender(gender[1]) : "";
      if (!age) out.warnings.push(`age unreadable: "${line}"`);
      if (!out.gender) out.warnings.push(`gender unreadable: "${line}"`);
      return;
    }
    // Unlabelled line: most likely a wrapped continuation of the previous field
    // (house numbers wrap often: "FLAT NO-" / "211,PALURIVILLAGE").
    if (out.relationName && !out.house) out.relationName += " " + line;
    else if (out.name && !out.relationName) out.name += " " + line;
    else if (out.house && !out.age) out.house += (/-$/.test(out.house) ? "" : " ") + line;
    else out.warnings.push(`unparsed line: "${line}"`);
  });

  bracket = /(^|\s)[\[{][A-Za-z]/.test(out.name + " " + out.relationName);
  out.name = cleanLatin(out.name);
  out.relationName = cleanLatin(out.relationName);
  out.house = cleanLatin(out.house);
  if (bracket) out.warnings.push(`"[" read as "I" at a word start, check I/J`);
  if (!out.name) out.warnings.push("name missing");
  if (!out.gender) out.warnings.push("gender missing");
  return out;
}

// Telugu rolls (Andhra Pradesh, same box layout):
//   "ఓటరు పేరు : …", "తండ్రి పేరు: …" (భర్త husband, తల్లి mother, భార్య wife,
//   ఇతరులు other), "ఇంటి సంఖ్య : W-29-281-1", "వయస్సు : 42 లింగము : స్త్రీ" (పు = male).
// The mixed tel+eng model sometimes reads the relation label as Latin ("Sod
// పేరు:"); such a box gets relationType "" and the caller retries the body
// with the Telugu-only model. Values are kept in Telugu, with the same relation
// and gender words as the AP ward-list format so both import alike.
const TE = /[ఀ-౿]/u;
// By first letter, then by the distinctive tail when the first letter is
// misread ("ఛర్త" for భర్త, "లేండ్రి" for తండ్రి).
const TE_RELATIONS = [
  { re: /^భా|ార్య/u, type: "భార్య" },
  { re: /^భ|^.ర్త/u, type: "భర్త" },
  { re: /^తల|ల్లి/u, type: "తల్లి" },
  { re: /^త|ండ్రి|డ్రి/u, type: "తండ్రి" },
  { re: /^ఇత/u, type: "ఇతరులు" },
  // Telangana rolls print "అన్య:" (other); Surya sometimes writes it in Devanagari
  { re: /^అన్య|^अन्य|^इतर/u, type: "ఇతరులు" },
];

/** Strip OCR punctuation and zero-width marks around a Telugu field. */
export function cleanTeluguField(s) {
  return (s || "")
    .normalize("NFC")
    .replace(/[\u200b-\u200d\u2060]/g, "")
    .replace(/^[\s.,;:'"`|_\-+©®*‘’]+/, "")
    .replace(/[\s.,;:'"`|_\-+©®*‘’]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** "పు"/"పురుషుడు" -> పురుషుడు, "స్త్రీ"/"స్తీ" -> స్త్రీ, "ఇతరులు"/"థర్డ్" -> ఇతరులు. */
function teluguGender(t) {
  if (/స్త|స్తీ|స్రీ|స్ర|స్త్రీ/u.test(t)) return "స్త్రీ";
  if (/^పు|పురు|షుడు/u.test(t)) return "పురుషుడు";
  if (/^ఇ|థర్డ్|తృతీయ/u.test(t)) return "ఇతరులు";
  return "";
}

/** The Latin W of house numbers is printed in Telugu (డబ్ల్యూ) and OCR'd many ways. */
function teluguHouse(s) {
  return cleanTeluguField(s).replace(/^[ఀ-౿‌]{2,8}(?=\s*-\s*\d)/u, (w) => (/(యూ|లూ|ల్యూ|ల్లూ)$/u.test(w) ? "W" : w)).replace(/\s*-\s*/g, "-");
}

function parseBodyTelugu(bodyText) {
  const lines = bodyText.split(/\n/).map(norm).filter(Boolean);
  const out = { name: "", relationType: "", relationName: "", house: "", age: "", gender: "", warnings: [] };
  let sawRelation = false;

  for (const line of lines) {
    const colon = line.indexOf(":");
    const label = colon >= 0 ? line.slice(0, colon).trim() : "";
    const value = colon >= 0 ? line.slice(colon + 1).trim() : line;

    // The age/gender line is found by its labels ("వయస్సు :" at the start, or
    // "లింగము :"), never by the letters alone: names such as లింగయ్య (Lingaiah)
    // and దేవయ్య (Devaiah) contain them.
    const ageLine = /^వ[యర]స్సు|^వయ\S*\s*[:;]/u.test(line) || (/ల[ిీ]ంగ(?:ము|ం)\s*[:;]/u.test(line) && !/పేరు|సంఖ్య/u.test(label));
    if (ageLine) {
      const age = /(?:వయ\S*)?\D{0,6}?(\d{1,3})/u.exec(line);
      const gender = /ల[ిీ]ంగ\S*\s*:?\s*(\S+)/u.exec(line);
      out.age = age ? age[1] : "";
      out.gender = gender ? teluguGender(gender[1]) : "";
      if (!age) out.warnings.push(`age unreadable: "${line}"`);
      if (!out.gender) out.warnings.push(`gender unreadable: "${line}"`);
      continue;
    }
    // "ఇంటి సంఖ్య : 2-6-1"; the colon is sometimes lost or read as "1"
    // ("ఇంటి సంఖ్య 1 2-6-1"), so the house line is found by its label alone.
    if (/^ఇంటి|సంఖ్య$/u.test(label) || (!label && /^ఇంటి\s/u.test(line))) {
      out.house = label ? value : line.replace(/^ఇంటి\s*\S*\s*[:;]?\s*(?:1\s+(?=\S))?/u, "");
      continue;
    }
    if (/^ఓట/u.test(label) || (!out.name && !sawRelation && /పేరు/u.test(label) && !TE_RELATIONS.some((r) => r.re.test(label)))) {
      out.name = value;
      continue;
    }
    // Any labelled line between the name and the house is the relation, even
    // when its label is unreadable ("I: పెరుమాండ్ల నాన్").
    if (label && (/పేరు/u.test(label) || TE_RELATIONS.some((r) => r.re.test(label)) || (out.name && !sawRelation && !out.house))) {
      sawRelation = true;
      const rel = /[\u0C00-\u0C7F\u0900-\u097F]/u.test(label) ? TE_RELATIONS.find((r) => r.re.test(label.replace(/\s*పేరు.*$/u, ""))) : null;
      out.relationType = rel ? rel.type : "";
      out.relationName = value;
      if (!rel) out.warnings.push(`relation label unreadable: "${label}"`);
      continue;
    }
    // Unlabelled line: a wrapped continuation of the previous field.
    if (sawRelation && !out.house) out.relationName += " " + line;
    else if (out.name && !sawRelation) out.name += " " + line;
    else if (out.house && !out.age) out.house += line;
    else out.warnings.push(`unparsed line: "${line}"`);
  }

  out.name = cleanTeluguField(out.name);
  out.relationName = cleanTeluguField(out.relationName);
  out.house = teluguHouse(out.house);
  if (/^1\d\d$/.test(out.age) && Number(out.age) > 120) {
    out.warnings.push(`age read as ${out.age}, taken as ${out.age.slice(1)}`);
    out.age = out.age.slice(1);
  }
  if (out.age && Number(out.age) < 18) out.warnings.push(`age read as ${out.age}, below voting age: check the PDF`);
  if (!out.name) out.warnings.push("name missing");
  if (!out.relationName) out.warnings.push("relation missing");
  if (!out.house) out.warnings.push("house number missing");
  if (!out.gender) out.warnings.push("gender missing");
  return out;
}

const EPIC_RE = /^[A-Z]{3}\d{7}$/;

/** Map look-alike glyphs by position: letters in the first three places, digits after. */
function mapEpic(s) {
  let letters = (/^[A-Z]+/.exec(s) ?? [""])[0];
  let digits = s.slice(letters.length);
  if (letters.length < 3) {
    // a letter read as a digit: 0->O, 1->I, 5->S, 8->B in the first three positions
    letters = s.slice(0, 3).replace(/0/g, "O").replace(/1/g, "I").replace(/4/g, "A").replace(/5/g, "S").replace(/8/g, "B");
    digits = s.slice(3);
  }
  digits = digits.replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
  return { letters, digits };
}

/**
 * Clean an OCR EPIC string; fixes the common O/0 and I/1 confusions by position.
 * `repaired` is true only when a glyph was substituted or dropped, not for case,
 * spacing or a doubled letter (WJuU… for WJU…), which are mechanical.
 */
export function cleanEpic(text) {
  const s = (text || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (EPIC_RE.test(s)) return { epic: s, valid: true, repaired: false };

  // An extra letter is nearly always a doubled glyph (ABBB..., WJUU...): collapse it.
  const doubled = /^([A-Z]{4})(\d{7})$/.exec(s);
  if (doubled && /([A-Z])\1/.test(doubled[1])) {
    const epic = doubled[1].replace(/([A-Z])\1/, "$1") + doubled[2];
    if (EPIC_RE.test(epic)) return { epic, valid: true, repaired: false };
  }

  let { letters, digits } = mapEpic(s);
  if (letters.length > 3) letters = letters.replace(/([A-Z])\1/, "$1").slice(0, 3);
  let epic = letters + digits;

  // One character too many at the letter/digit boundary (XB0O1183870 for
  // XBO1183870): read the first four as letters; if that shows a doubled letter
  // and exactly seven digits follow, the doubled glyph is the extra one.
  if (!EPIC_RE.test(epic) && s.length === 11) {
    const head = s.slice(0, 4).replace(/0/g, "O").replace(/1/g, "I").replace(/4/g, "A").replace(/5/g, "S").replace(/8/g, "B");
    const tail = s.slice(4).replace(/O/g, "0").replace(/I/g, "1").replace(/L/g, "1").replace(/S/g, "5").replace(/B/g, "8").replace(/Z/g, "2");
    if (/^[A-Z]{4}$/.test(head) && /([A-Z])\1/.test(head) && /^\d{7}$/.test(tail)) epic = head.replace(/([A-Z])\1/, "$1") + tail;
  }
  // A wrong digit count cannot be repaired safely; keep it and flag it for review.
  return { epic, valid: EPIC_RE.test(epic), repaired: true };
}

/** Clean an OCR serial number string. */
export function cleanSerial(text) {
  const s = asciiDigits(text || "").replace(/[^0-9]/g, "");
  return s ? Number(s) : null;
}

/**
 * Repair serial numbers that OCR missed or misread, using the fact that boxes are
 * numbered consecutively in reading order (row by row, left to right) across pages.
 * Mutates `voters` (ordered) and returns how many were repaired.
 */
export function repairSerials(voters) {
  let repaired = 0;
  if (!voters.length) return { repaired, gaps: [] };

  // Work page by page: within a page the boxes are consecutive, and each page's own OCR
  // reads vote on its starting serial, so a box missed on one page cannot shift the rest.
  const pages = new Map();
  for (const v of voters) {
    if (!pages.has(v.pageNo)) pages.set(v.pageNo, []);
    pages.get(v.pageNo).push(v);
  }
  const gaps = [];
  let next = null; // serial expected at the start of the next page
  for (const [pageNo, list] of pages) {
    // candidate starts implied by each readable serial; take the most common
    const votes = new Map();
    list.forEach((v, i) => {
      if (v.serialOcr !== null && v.serialOcr > 0 && v.serialOcr < 100000) {
        const start = v.serialOcr - i;
        votes.set(start, (votes.get(start) ?? 0) + 1);
      }
    });
    let start = null;
    let best = 0;
    for (const [s, c] of votes) if (c > best || (c === best && next !== null && s === next)) { best = c; start = s; }
    if (start === null || (best < 2 && next !== null)) start = next ?? 1;
    if (next !== null && start !== next) gaps.push({ pageNo, expected: next, found: start });
    list.forEach((v, i) => {
      v.serial = start + i;
      if (v.serialOcr !== v.serial) repaired++;
    });
    next = start + list.length;
  }
  return { repaired, gaps };
}
