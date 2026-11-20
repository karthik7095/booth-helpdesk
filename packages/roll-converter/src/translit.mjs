// Devanagari (Marathi) -> Latin transliteration for names and places.
// Deterministic, readable output ("Prabhavati", "Ramchandra"); a dictionary of
// common Marathi names/surnames gives conventional English spellings first.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONSONANTS = {
  क: "k", ख: "kh", ग: "g", घ: "gh", ङ: "ng",
  च: "ch", छ: "chh", ज: "j", झ: "jh", ञ: "ny",
  ट: "t", ठ: "th", ड: "d", ढ: "dh", ण: "n",
  त: "t", थ: "th", द: "d", ध: "dh", न: "n",
  प: "p", फ: "ph", ब: "b", भ: "bh", म: "m",
  य: "y", र: "r", ल: "l", व: "v", ळ: "l",
  श: "sh", ष: "sh", स: "s", ह: "h",
  "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "d", "ढ़": "dh", "फ़": "f", "य़": "y",
};
const VOWELS = {
  अ: "a", आ: "a", इ: "i", ई: "i", उ: "u", ऊ: "u", ऋ: "ru",
  ए: "e", ऐ: "ai", ओ: "o", औ: "au", ऍ: "a", ऑ: "o", ऎ: "e", ऒ: "o",
};
const MATRAS = {
  "ा": "a", "ि": "i", "ी": "i", "ु": "u", "ू": "u", "ृ": "ru",
  "े": "e", "ै": "ai", "ो": "o", "ौ": "au", "ॅ": "a", "ॉ": "o", "ॆ": "e", "ॊ": "o",
};
// Telugu (U+0C00 block). Telugu keeps the inherent vowel at word end, so no
// schwa deletion is applied for this script.
const TE_CONSONANTS = {
  క: "k", ఖ: "kh", గ: "g", ఘ: "gh", ఙ: "ng",
  చ: "ch", ఛ: "chh", జ: "j", ఝ: "jh", ఞ: "ny",
  ట: "t", ఠ: "th", డ: "d", ఢ: "dh", ణ: "n",
  త: "t", థ: "th", ద: "d", ధ: "dh", న: "n",
  ప: "p", ఫ: "ph", బ: "b", భ: "bh", మ: "m",
  య: "y", ర: "r", ఱ: "r", ల: "l", ళ: "l", వ: "v",
  శ: "sh", ష: "sh", స: "s", హ: "h",
};
const TE_VOWELS = { అ: "a", ఆ: "a", ఇ: "i", ఈ: "i", ఉ: "u", ఊ: "u", ఋ: "ru", ఎ: "e", ఏ: "e", ఐ: "ai", ఒ: "o", ఓ: "o", ఔ: "au" };
const TE_MATRAS = { "ా": "a", "ి": "i", "ీ": "i", "ు": "u", "ూ": "u", "ృ": "ru", "ె": "e", "ే": "e", "ై": "ai", "ొ": "o", "ో": "o", "ౌ": "au" };
const TE_VIRAMA = "్";
const TE_ANUSVARA = "ం";
const TE_VISARGA = "ః";
const TE_CANDRABINDU = "ఁ";
const TE_DIGITS = { "౦": "0", "౧": "1", "౨": "2", "౩": "3", "౪": "4", "౫": "5", "౬": "6", "౭": "7", "౮": "8", "౯": "9" };

const VIRAMA = "्";
const ANUSVARA = "ं";
const CHANDRABINDU = "ँ";
const VISARGA = "ः";
const NUKTA = "़";
const DIGITS = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };
const LABIALS = new Set(["p", "ph", "b", "bh", "m"]);

let dictionary = null;
function dict() {
  if (!dictionary) {
    try {
      const path = fileURLToPath(new URL("../data/names-en.json", import.meta.url));
      dictionary = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      dictionary = {};
    }
  }
  return dictionary;
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** Transliterate one Telugu word (no spaces). */
function transliterateTeluguWord(word) {
  const chars = [...word.normalize("NFC")];
  let out = "";
  let pending = null;
  const flush = (vowel) => {
    if (pending === null) {
      out += vowel ?? "";
      return;
    }
    out += pending + (vowel ?? "a");
    pending = null;
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    const cons = TE_CONSONANTS[ch];
    if (cons) {
      if (pending !== null) flush("a");
      pending = cons;
      continue;
    }
    if (ch === TE_VIRAMA) {
      if (pending !== null) {
        out += pending;
        pending = null;
      }
      continue;
    }
    if (TE_MATRAS[ch]) {
      flush(TE_MATRAS[ch]);
      continue;
    }
    if (TE_VOWELS[ch]) {
      if (pending !== null) flush("a");
      out += TE_VOWELS[ch];
      continue;
    }
    if (ch === TE_ANUSVARA || ch === TE_CANDRABINDU) {
      if (pending !== null) flush("a");
      // word-final anusvara is conventionally "m" (Jagannatham, Sriram)
      const nxt = (next && TE_CONSONANTS[next]) || "";
      out += !next || LABIALS.has(nxt) ? "m" : "n";
      continue;
    }
    if (ch === TE_VISARGA) {
      if (pending !== null) flush("a");
      out += "h";
      continue;
    }
    if (TE_DIGITS[ch]) {
      if (pending !== null) flush("a");
      out += TE_DIGITS[ch];
      continue;
    }
    if (pending !== null) flush("a");
    out += ch;
  }
  if (pending !== null) out += pending + "a";
  return capitalize(out);
}

/** Transliterate one Devanagari or Telugu word (no spaces). */
export function transliterateWord(word) {
  const known = dict()[word];
  if (known) return known;
  if (/[\u0C00-\u0C7F]/.test(word)) return transliterateTeluguWord(word);

  const chars = [...word.normalize("NFC")];
  let out = "";
  let pendingConsonant = null; // consonant awaiting a vowel/virama decision
  let afterVirama = false;

  const flush = (vowel) => {
    if (pendingConsonant === null) {
      out += vowel ?? "";
      return;
    }
    out += pendingConsonant + (vowel ?? "a");
    pendingConsonant = null;
  };

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];

    if (ch === NUKTA) continue; // handled by two-char lookups below
    const withNukta = next === NUKTA ? ch + NUKTA : null;
    const cons = (withNukta && CONSONANTS[withNukta]) || CONSONANTS[ch];
    if (cons) {
      if (pendingConsonant !== null) flush("a");
      pendingConsonant = cons;
      afterVirama = chars[i - 1] === VIRAMA;
      if (withNukta) i++;
      continue;
    }
    if (ch === VIRAMA) {
      if (pendingConsonant !== null) {
        out += pendingConsonant;
        pendingConsonant = null;
      }
      continue;
    }
    if (MATRAS[ch]) {
      flush(MATRAS[ch]);
      continue;
    }
    if (VOWELS[ch]) {
      if (pendingConsonant !== null) flush("a");
      out += VOWELS[ch];
      continue;
    }
    if (ch === ANUSVARA || ch === CHANDRABINDU) {
      if (pendingConsonant !== null) flush("a");
      // nasal assimilates to the following consonant: m before labials, n otherwise
      const nxt = (next && CONSONANTS[next]) || "";
      out += LABIALS.has(nxt) ? "m" : "n";
      continue;
    }
    if (ch === VISARGA) {
      if (pendingConsonant !== null) flush("a");
      out += "h";
      continue;
    }
    if (DIGITS[ch]) {
      if (pendingConsonant !== null) flush("a");
      out += DIGITS[ch];
      continue;
    }
    // anything else (Latin letters, punctuation) passes through
    if (pendingConsonant !== null) flush("a");
    out += ch;
  }

  // Word-final consonant: drop the inherent "a" (राम -> Ram), except when the
  // final consonant closes a conjunct with r/l/y/v (चंद्र -> Chandra, आर्य -> Arya).
  if (pendingConsonant !== null) {
    const keepA = afterVirama && ["r", "l", "y", "v"].includes(pendingConsonant);
    out += pendingConsonant + (keepA ? "a" : "");
  }
  return capitalize(out);
}

const INDIC = /[ऀ-ॿఀ-౿]/;

/** Transliterate a phrase; non-Indic tokens are kept as they are. */
export function transliterate(text) {
  if (!text) return "";
  return text
    .split(/(\s+)/)
    .map((tok) => (INDIC.test(tok) ? tok.split(/([^ऀ-ॿఀ-౿]+)/).map((p) => (INDIC.test(p) ? transliterateWord(p) : p)).join("") : tok))
    .join("")
    .trim();
}

export const RELATION_EN = { "वडिलांचे": "Father", "पतीचे": "Husband", "आईचे": "Mother", "इतर": "Other", "पालक": "Guardian" };
export const GENDER_EN = { "पुरुष": "Male", "महिला": "Female", "तृतीय पंथी": "Third Gender", "इतर": "Other" };
