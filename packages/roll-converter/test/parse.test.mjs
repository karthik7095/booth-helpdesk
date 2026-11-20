import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBody, cleanEpic, cleanSerial, repairSerials, cleanDevanagari, normaliseHouse } from "../src/parse.mjs";

test("parseBody reads the four standard lines", () => {
  const r = parseBody("नाव : बाबासाहेब रामचंद्र गायकवाड\nइतर: प्रभावती बाबासाहेब गायकवाड\nघर क्रमांक : 1\n\nवय : 82 लिंग : पुरुष");
  assert.equal(r.name, "बाबासाहेब रामचंद्र गायकवाड");
  assert.equal(r.relationType, "इतर");
  assert.equal(r.relationName, "प्रभावती बाबासाहेब गायकवाड");
  assert.equal(r.house, "1");
  assert.equal(r.age, "82");
  assert.equal(r.gender, "पुरुष");
  assert.deepEqual(r.warnings, []);
});

test("parseBody handles husband/father labels, Devanagari digits and a garbled house label", () => {
  const r = parseBody("नाव: मनिषा राजेंद्र मंडले\nपतीचे नाव: राजेंद्र मंडले घर क्रमाक: २३\nवय : ४६ लिंग : महिला");
  assert.equal(r.relationType, "पतीचे");
  assert.equal(r.relationName, "राजेंद्र मंडले");
  assert.equal(r.house, "23");
  assert.equal(r.age, "46");
  assert.equal(r.gender, "महिला");
});

test("parseBody flags missing fields", () => {
  const r = parseBody("नाव : कोणी\nवडिलांचे नाव: कोणी\nघर क्रमांक : 5\nवय : xx लिंग : ??");
  assert.ok(r.warnings.some((w) => w.startsWith("age unreadable")));
  assert.ok(r.warnings.some((w) => w.startsWith("gender unreadable")));
});

test("cleanEpic accepts valid ids and repairs common OCR slips", () => {
  assert.deepEqual(cleanEpic("ABB8717654"), { epic: "ABB8717654", valid: true, repaired: false });
  assert.equal(cleanEpic("ABBB8682155").epic, "ABB8682155");
  assert.equal(cleanEpic("ABB 8717654").epic, "ABB8717654");
  assert.equal(cleanEpic("4BB8717654").epic, "ABB8717654");
  assert.equal(cleanEpic("ABB87I7654").epic, "ABB8717654");
  assert.equal(cleanEpic("FNJ12705629").valid, false);
  assert.equal(cleanEpic("ABB8/11855").valid, false);
});

test("cleanSerial strips borders and converts digits", () => {
  assert.equal(cleanSerial("[12"), 12);
  assert.equal(cleanSerial("१५"), 15);
  assert.equal(cleanSerial("|"), null);
});

test("repairSerials numbers boxes consecutively per page and reports gaps", () => {
  const v = (pageNo, serialOcr) => ({ pageNo, serialOcr, raw: { serial: String(serialOcr ?? "") } });
  const voters = [v(3, 1), v(3, null), v(3, 3), v(4, 4), v(4, 5), v(5, 8), v(5, 9)];
  const { repaired, gaps } = repairSerials(voters);
  assert.deepEqual(voters.map((x) => x.serial), [1, 2, 3, 4, 5, 8, 9]);
  assert.equal(repaired, 1);
  assert.deepEqual(gaps, [{ pageNo: 5, expected: 6, found: 8 }]);
});

test("cleanDevanagari removes OCR noise", () => {
  assert.equal(cleanDevanagari("विश्‍वनाथ"), "विश्वनाथ");
  assert.equal(cleanDevanagari("गायकवाड़"), "गायकवाड");
  assert.equal(cleanDevanagari("अण्णासौो"), "अण्णासो");
  assert.equal(cleanDevanagari("सरतापे."), "सरतापे");
});

test("normaliseHouse unifies the 'at' prefix", () => {
  assert.equal(normaliseHouse("एंट कारखेल"), "ऍट कारखेल");
  assert.equal(normaliseHouse("Ue पोस्ड कारखेल"), "ऍट पोस्ड कारखेल");
  assert.equal(normaliseHouse("23-3"), "23-3");
});

test("parseBody reads English labels (2026 AP SIR roll)", () => {
  const r = parseBody("Name : Vijaya Nelli\nHusbands Name: Srinivasa Rao Nelli\nHouse Number : 1-1\nAge : 29 Gender : Female", "eng");
  assert.deepEqual(r, { name: "Vijaya Nelli", relationType: "Husband", relationName: "Srinivasa Rao Nelli", house: "1-1", age: "29", gender: "Female", warnings: [] });
});

test("parseBody English: wrapped relation name, inline house label, other relations", () => {
  const r = parseBody("Name : NAGESWARA RAO GOPISETTI\nFathers Name: VENKATA RAMANA\nGOPISETTY\nHouse Number : 1-3\nAge : 35 Gender : Male", "eng");
  assert.equal(r.relationType, "Father");
  assert.equal(r.relationName, "VENKATA RAMANA GOPISETTY");
  assert.equal(r.house, "1-3");
  const m = parseBody("Name : saikumar navudu\nMothers Name: saikimar navudu House Number : 1-3\nAge : 27 Gender : Male", "eng");
  assert.equal(m.relationType, "Mother");
  assert.equal(m.relationName, "saikimar navudu");
  assert.equal(m.house, "1-3");
  const o = parseBody("Name : Someone\nOthers: Guardian Person\nHouse Number : 2-7/1\nAge : 40 Gender : Third Gender", "eng");
  assert.equal(o.relationType, "Other");
  assert.equal(o.gender, "Third Gender");
});

test("parseBody English flags missing fields", () => {
  const r = parseBody("Fathers Name: X\nHouse Number : 5\nAge : xx Gender : ??", "eng");
  assert.ok(r.warnings.includes("name missing"));
  assert.ok(r.warnings.some((w) => w.startsWith("age unreadable")));
  assert.ok(r.warnings.some((w) => w.startsWith("gender unreadable")));
});

test("cleanEpic: doubled letters are mechanical, one extra character is dropped when unambiguous", () => {
  assert.deepEqual(cleanEpic("WJuU4157798"), { epic: "WJU4157798", valid: true, repaired: false });
  assert.deepEqual(cleanEpic("XB0O1183870"), { epic: "XBO1183870", valid: true, repaired: true });
  assert.equal(cleanEpic("WJU15565911").valid, false); // eight digits: which one is extra is unknown
});

test("parseBody English joins a wrapped house number", () => {
  const r = parseBody("Name : P J PADMAVATHI\nHusbands Name: PV SATYANARAYANA\nPASUPULETI\nHouse Number : FLAT NO-\n211,PALURIVILLAGE\nAge : 61 Gender : Female", "eng");
  assert.equal(r.relationName, "PV SATYANARAYANA PASUPULETI");
  assert.equal(r.house, "FLAT NO-211,PALURIVILLAGE");
  assert.deepEqual(r.warnings, []);
});

test("parseBody English tolerates garbled labels from low resolution scans", () => {
  const a = parseBody("Narme : VEERAMMA KALAMALLA\nHusbands Name: NAGESHU KALAMALLA\nHouse Number : W-29-86\nAge + 44 Gender : Female", "eng");
  assert.deepEqual([a.name, a.relationType, a.relationName, a.house, a.age, a.gender], ["VEERAMMA KALAMALLA", "Husband", "NAGESHU KALAMALLA", "W-29-86", "44", "Female"]);
  const b = parseBody("Name : SUNANDA GORLA\nHusbands Name: CHANDRASEHAR REDDY GORLA Holise Number: W-29-325\nAge +50 Gander: Mae", "eng");
  assert.equal(b.relationName, "CHANDRASEHAR REDDY GORLA");
  assert.equal(b.house, "W-29-325");
  assert.equal(b.age, "50");
  assert.equal(b.gender, "Male");
  const c = parseBody("Name : GOPAL VALLEPU\nFathers Namo: VENKATAIAH\nHouse Numba: W-30-187-A\n‘Age 55 Gender Female", "eng");
  assert.equal(c.relationName, "VENKATAIAH");
  assert.equal(c.house, "W-30-187-A");
  assert.equal(c.age, "55");
  assert.equal(c.gender, "Female");
});

test("parseBody English: '[' at a word start is an I, wrapped FATHIMA is not a label", () => {
  const r = parseBody("Name : shaik [brahim basha\nFathers Name: SHAIK\nFATHIMA\nHouse Number : 1\nAge : 66 Gender : Male", "eng");
  assert.equal(r.name, "shaik Ibrahim basha");
  assert.equal(r.relationType, "Father");
  assert.equal(r.relationName, "SHAIK FATHIMA");
  assert.ok(r.warnings.some((w) => w.includes("check I/J")));
});

test("parseBody English: misread gender words and a colon read as 1 in the age", () => {
  assert.equal(parseBody("Name : A\nFathers Name: B\nHouse Number : 1\nAge: 66 Gender: Fernale", "eng").gender, "Female");
  assert.equal(parseBody("Name : A\nFathers Name: B\nHouse Number : 1\nAge: 53 Gender: Farmnale", "eng").gender, "Female");
  assert.equal(parseBody("Name : A\nFathers Name: B\nHouse Number : 1\nAge: 56 Gender: Malas", "eng").gender, "Male");
  const r = parseBody("Name : A\nFathers Name: B\nHouse Number : 1\nAge 129 Gender : Female", "eng");
  assert.equal(r.age, "29");
  assert.ok(r.warnings.some((w) => w.startsWith("age read as 129")));
  assert.equal(parseBody("Name : A\nFathers Name: B\nHouse Number : 1\nAge : 102 Gender : Male", "eng").age, "102");
});

test("parseBody Telugu reads the AP roll labels, W house prefix and short gender", () => {
  const r = parseBody("ఓటరు పేరు : యమానూర మహమ్మద్‌ ఉమర్‌\nతండ్రి పేరు: యమానూర సర్జర్‌ హుసేన్‌\n\nఇంటి సంఖ్య : డటలయూ-29-170\nవయస్సు : 19 లింగము : పు", "tel");
  assert.deepEqual([r.name, r.relationType, r.relationName, r.house, r.age, r.gender], ["యమానూర మహమ్మద్ ఉమర్", "తండ్రి", "యమానూర సర్జర్ హుసేన్", "W-29-170", "19", "పురుషుడు"]);
  assert.deepEqual(r.warnings, []);
  const f = parseBody("ఓటరు పేరు ; భాగ్య లక్ష్మి\nఛర్త పేరు: రఘునాథ రెడ్డి\nఇంటి సంఖ్య : W-29-281-1\nవయస్సు : 42 లీంగము ; స్తీ", "tel");
  assert.equal(f.relationType, "భర్త");
  assert.equal(f.gender, "స్త్రీ");
  assert.equal(parseBody("ఓటరు పేరు : X\nలేండ్రి పేరు: Y\nఇంటి సంఖ్య : 1\nవయస్సు : 40 లింగము : పు", "tel").relationType, "తండ్రి");
  const latin = parseBody("ఓటరు పేరు : X\nSod పేరు: Y\nఇంటి సంఖ్య : 1\nవయస్సు : 40 లింగము : 3", "tel");
  assert.equal(latin.relationType, "");
  assert.equal(latin.relationName, "Y");
  assert.equal(latin.gender, "");
});

test("parseBody Telugu: names containing లింగ / వయ are not taken for the age line", () => {
  const r = parseBody("ఓటరు పేరు : దేవయ్య గోట్టె\nతండ్రి పేరు: లింగయ్య\nఇంటి సంఖ్య : 2-6-11/2\nవయస్సు : 48 లింగము : పురుషులు", "tel");
  assert.deepEqual([r.name, r.relationType, r.relationName, r.house, r.age, r.gender], ["దేవయ్య గోట్టె", "తండ్రి", "లింగయ్య", "2-6-11/2", "48", "పురుషుడు"]);
  assert.deepEqual(r.warnings, []);
  assert.equal(parseBody("ఓటరు పేరు : X\nభర్త పేరు: Y\nఇంటి సంఖ్య : 1\nవయస్సు : 37 లింగము : స్త్రీలు", "tel").gender, "స్త్రీ");
});

test("parseBody Telugu: house line without a colon, relation with an unreadable label", () => {
  const h = parseBody("ఓటరు పేరు : అన్నారపు ఆకాశ్‌\nతండ్రి పేరు: అన్నారపు వెంకటేశం\nఇంటి సంఖ్య 1 2-6-1172\nవయస్సు : 20 లింగము : పురుషులు", "tel");
  assert.equal(h.relationName, "అన్నారపు వెంకటేశం");
  assert.equal(h.house, "2-6-1172");
  const r = parseBody("ఓటరు పేరు : పెరుమాండ్ల కస్తూరి\nI: పెరుమాండ్ల నాన్‌\nఇంటి సంఖ్య : 2-6-3\nవయస్సు : 27 లింగము : స్త్రీలు", "tel");
  assert.equal(r.name, "పెరుమాండ్ల కస్తూరి");
  assert.equal(r.relationType, "");
  assert.equal(r.relationName, "పెరుమాండ్ల నాన్");
  assert.ok(r.warnings.some((w) => w.startsWith("relation label unreadable")));
  assert.ok(parseBody("ఓటరు పేరు : X\nవయస్సు : 27 లింగము : స్త్రీలు", "tel").warnings.includes("house number missing"));
});

test("parseBody Telugu: Telangana's అన్య (other) label, also as Surya's Devanagari spelling", () => {
  const r = parseBody("ఓటరు పేరు : పెరుమాండ్ల కస్తూరి\nఅన్య: పెరుమాండ్ల కళ్యాణ్\nఇంటి సంఖ్య : 2-6-31\nవయస్సు : 27 లింగము : స్త్రీలు", "tel");
  assert.equal(r.relationType, "ఇతరులు");
  assert.equal(r.relationName, "పెరుమాండ్ల కళ్యాణ్");
  assert.deepEqual(r.warnings, []);
  assert.equal(parseBody("ఓటరు పేరు : X\nअन्य: మేర్గు శారద\nఇంటి సంఖ్య : 1\nవయస్సు : 44 లింగము : పురుషులు", "tel").relationType, "ఇతరులు");
});
