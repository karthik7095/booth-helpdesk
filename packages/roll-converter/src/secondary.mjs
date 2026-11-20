// Secondary-language columns for English rolls: the English names written in
// Telugu or Hindi. The transliteration itself runs on the server (services/xlit,
// AI4Bharat IndicXlit); this module gathers the distinct words of a roll, sends
// them in batches through the caller's `transliterate` function and fills the
// columns. Relation and gender labels come from fixed tables.

export const SECONDARY = {
  tel: {
    name: "Telugu",
    xlit: "te",
    relation: { Father: "తండ్రి", Husband: "భర్త", Mother: "తల్లి", Wife: "భార్య", Guardian: "సంరక్షకుడు", Other: "ఇతరులు" },
    gender: { Male: "పురుషుడు", Female: "స్త్రీ", "Third Gender": "ఇతరులు", Other: "ఇతరులు" },
  },
  hin: {
    name: "Hindi",
    xlit: "hi",
    relation: { Father: "पिता", Husband: "पति", Mother: "माता", Wife: "पत्नी", Guardian: "अभिभावक", Other: "अन्य" },
    gender: { Male: "पुरुष", Female: "महिला", "Third Gender": "तृतीय लिंग", Other: "अन्य" },
  },
};

/** Secondary languages for pickers in the UI. */
export const SECONDARY_LANGUAGES = Object.entries(SECONDARY).map(([code, l]) => ({ code, name: l.name }));

const WORD = /[A-Za-z]+/g;
// Small batches keep each server request well under the proxy's 120 s limit,
// even for words the server has not seen before (~0.1-1 s each on its CPU).
const BATCH = 40;
const TEXT_FIELDS = ["sectionName", "name", "relationName"];

/**
 * Add `<field> <Language>` values to each voter for every requested language.
 *
 * @param {object[]} voters  parsed voters of an English roll (changed in place)
 * @param {string[]} langs  secondary language codes ("tel", "hin")
 * @param {(words: string[], lang: string) => Promise<string[]>} transliterate
 *   server call: distinct words in, the same number of words out, in order
 * @returns {Promise<{columns: {header:string,key:string,width:number}[], words: number}>}
 */
export async function addSecondary(voters, langs, transliterate, { log = () => {}, onProgress = () => {} } = {}) {
  const words = [...new Set(voters.flatMap((v) => TEXT_FIELDS.flatMap((f) => (v[f] || "").match(WORD) ?? [])).map((w) => w.toLowerCase()))];
  const columns = [];
  for (const code of langs) {
    const l = SECONDARY[code];
    if (!l) continue;
    const map = new Map();
    for (let i = 0; i < words.length; i += BATCH) {
      const chunk = words.slice(i, i + BATCH);
      let out;
      try {
        out = await transliterate(chunk, l.xlit);
      } catch {
        out = await transliterate(chunk, l.xlit); // one retry for a dropped connection
      }
      if (!Array.isArray(out) || out.length !== chunk.length) throw new Error(`${l.name}: the server returned ${out?.length ?? 0} of ${chunk.length} words`);
      chunk.forEach((w, k) => map.set(w, out[k]));
      onProgress({ lang: code, done: Math.min(i + BATCH, words.length), total: words.length });
    }
    const write = (s) => (s || "").replace(WORD, (w) => map.get(w.toLowerCase()) ?? w);
    for (const v of voters) {
      v[`sectionName_${code}`] = write(v.sectionName);
      v[`name_${code}`] = write(v.name);
      v[`relationType_${code}`] = l.relation[v.relationType] ?? "";
      v[`relationName_${code}`] = write(v.relationName);
      v[`gender_${code}`] = l.gender[v.gender] ?? "";
    }
    columns.push(
      { header: `SectionName ${l.name}`, key: `sectionName_${code}`, width: 44 },
      { header: `Name ${l.name}`, key: `name_${code}`, width: 30 },
      { header: `RelationType ${l.name}`, key: `relationType_${code}`, width: 16 },
      { header: `RelationName ${l.name}`, key: `relationName_${code}`, width: 30 },
      { header: `Gender ${l.name}`, key: `gender_${code}`, width: 12 },
    );
    log(`${l.name}: ${words.length} distinct words transliterated`);
  }
  return { columns, words: words.length };
}
