import { test } from "node:test";
import assert from "node:assert/strict";
import { transliterate, transliterateWord } from "../src/translit.mjs";

test("dictionary spellings win", () => {
  assert.equal(transliterate("बाबासाहेब रामचंद्र गायकवाड"), "Babasaheb Ramchandra Gaikwad");
});

test("rule-based transliteration keeps explicit vowels and drops the final inherent a", () => {
  assert.equal(transliterateWord("कोमल"), "Komal");
  assert.equal(transliterateWord("राणी"), "Rani");
  assert.equal(transliterateWord("इंद्रजित"), "Indrajit");
  assert.equal(transliterateWord("आर्य"), "Arya");
  assert.equal(transliterateWord("चंद्र"), "Chandra");
  assert.equal(transliterateWord("संभाजी"), "Sambhaji");
});

test("digits and Latin pass through", () => {
  assert.equal(transliterate("१९-२"), "19-2");
  assert.equal(transliterate("एस/ओ नामदेव"), "Es/O Namdev");
});
