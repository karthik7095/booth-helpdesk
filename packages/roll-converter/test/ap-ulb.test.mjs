import { test } from "node:test";
import assert from "node:assert/strict";
import { _test } from "../src/formats/ap-ulb.mjs";
import { transliterate } from "../src/translit.mjs";

const { cleanTelugu, parseGender, parseRelation, parseRelationLayer, dropTrailingJunk, layerLetters, sameLetters } = _test;

test("cleanTelugu strips OCR punctuation and control characters", () => {
  assert.equal(cleanTelugu(": ఓబులేసు కూకట్లపల్లి ("), "ఓబులేసు కూకట్లపల్లి");
  assert.equal(cleanTelugu("కొప్పల 'పెంచాలయ్య"), "కొప్పల పెంచాలయ్య");
  assert.equal(cleanTelugu("రవికుమార్‌"), "రవికుమార్");
});

test("parseGender reads full and truncated gender words", () => {
  assert.equal(parseGender(": (స్తీ ,"), "స్త్రీ");
  assert.equal(parseGender("స్త్రీ"), "స్త్రీ");
  assert.equal(parseGender("పు"), "పురుషుడు");
  assert.equal(parseGender("పురుషుడు"), "పురుషుడు");
  assert.equal(parseGender("??"), "");
});

test("parseRelation tolerates OCR variants of the labels", () => {
  assert.equal(parseRelation("భర్త పేరు").type, "భర్త");
  assert.equal(parseRelation("తండి పేరు").type, "తండ్రి");
  assert.equal(parseRelation("త౦(డి పేరు").type, "తండ్రి");
  assert.equal(parseRelation("తల్లి పేరు").type, "తల్లి");
  assert.equal(parseRelation("భార్య పేరు").type, "భార్య");
  assert.equal(parseRelation("###"), null);
});

test("parseRelationLayer reads the text layer's relation labels", () => {
  assert.equal(parseRelationLayer("తం\u0000డి పేరు").type, "తండ్రి");
  assert.equal(parseRelationLayer("ర\u0000భ పేరు").type, "భర్త");
  assert.equal(parseRelationLayer("లిత\u0000 పేరు").type, "తల్లి");
  assert.equal(parseRelationLayer("\u0000\u0000"), null);
});

test("dropTrailingJunk removes stray marks read from the line below", () => {
  assert.equal(dropTrailingJunk("పద్మ గంజాల ఆ i"), "పద్మ గంజాల");
  assert.equal(dropTrailingJunk("దురరావు ౮"), "దురరావు");
  assert.equal(dropTrailingJunk("అదిలక్ష్మి [0"), "అదిలక్ష్మి");
  assert.equal(dropTrailingJunk("హరి కృష్ణ పి"), "హరి కృష్ణ పి");
  assert.equal(dropTrailingJunk("సాయి రమ"), "సాయి రమ");
  assert.equal(dropTrailingJunk("మురళి తాళ్ళ స ౧. త్ర"), "మురళి తాళ్ళ");
  assert.equal(dropTrailingJunk("వె౦కట నాంచారయ్య"), "వెంకట నాంచారయ్య");
  assert.equal(dropTrailingJunk("జయ (3 రాగమాలిక మీసాల"), "జయ (3 రాగమాలిక మీసాల");
  assert.equal(dropTrailingJunk("నాగ ©8 మేకల"), "నాగ ©8 మేకల");
});

test("an overprinted surname matches the voter's surname through the text layer's letters", () => {
  assert.equal(layerLetters("యల్లావుల"), "యలావుల");
  assert.ok(sameLetters(layerLetters("యల్లావుల"), "లాయవుల"));
  assert.ok(sameLetters(layerLetters("కొణతం"), "ణతం"));
  assert.ok(!sameLetters(layerLetters("మానికొండ"), "రావు"));
});

test("Telugu transliteration", () => {
  assert.equal(transliterate("ఓబులమ్మ కూకట్లపల్లి"), "Obulamma Kukatlapalli");
  assert.equal(transliterate("వెంకటమ్మ జగన్నాథం"), "Venkatamma Jagannatham");
  assert.equal(transliterate("శ్రీను"), "Shrinu");
});
