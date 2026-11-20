import { test } from "node:test";
import assert from "node:assert/strict";
import { addSecondary } from "../src/secondary.mjs";

const fake = { venkata: "వెంకట", rao: "రావు", k: "కె", konda: "కొండ", ward: "వార్డు" };

test("distinct words are sent once and written back with punctuation kept", async () => {
  const calls = [];
  const voters = [
    { sectionName: "1-Ward 2", name: "K. VENKATA RAO", relationType: "Father", relationName: "Konda Rao", gender: "Male" },
    { sectionName: "1-Ward 2", name: "Venkata", relationType: "Husband", relationName: "", gender: "Female" },
  ];
  const r = await addSecondary(voters, ["tel"], async (words, lang) => {
    calls.push({ words, lang });
    return words.map((w) => fake[w] ?? w);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].lang, "te");
  assert.deepEqual([...calls[0].words].sort(), ["k", "konda", "rao", "venkata", "ward"]);
  assert.equal(voters[0].name_tel, "కె. వెంకట రావు");
  assert.equal(voters[0].sectionName_tel, "1-వార్డు 2");
  assert.equal(voters[0].relationType_tel, "తండ్రి");
  assert.equal(voters[1].gender_tel, "స్త్రీ");
  assert.deepEqual(r.columns.map((c) => c.header), ["SectionName Telugu", "Name Telugu", "RelationType Telugu", "RelationName Telugu", "Gender Telugu"]);
});

test("a short answer from the server is an error", async () => {
  await assert.rejects(addSecondary([{ name: "Venkata Rao" }], ["hin"], async () => ["x"]), /returned 1 of 2/);
});
