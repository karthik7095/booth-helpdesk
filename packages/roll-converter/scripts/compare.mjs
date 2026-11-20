// Compare a converted workbook with a reference workbook, joined on SerialNo.
import ExcelJS from "exceljs";

const [ours, ref] = process.argv.slice(2);
async function load(path) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path);
  const ws = wb.getWorksheet("voters");
  const header = ws.getRow(1).values.slice(1);
  const rows = new Map();
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const o = {};
    header.forEach((h, i) => (o[h] = row.values[i + 1] ?? ""));
    rows.set(Number(o.SerialNo), o);
  });
  return rows;
}
const a = await load(ours);
const b = await load(ref);
const fields = ["EPIC", "Name", "RelationType", "RelationName", "HouseNumber", "Age", "Gender", "SectionNo"];
const diff = Object.fromEntries(fields.map((f) => [f, []]));
let common = 0;
for (const [serial, rb] of b) {
  const ra = a.get(serial);
  if (!ra) continue;
  common++;
  for (const f of fields) {
    const x = String(ra[f] ?? "").trim();
    const y = String(rb[f] ?? "").trim();
    if (x !== y) diff[f].push(`${serial}: ours="${x}" ref="${y}"`);
  }
}
console.log(`ours ${a.size} rows, ref ${b.size} rows, common serials ${common}`);
console.log(`missing in ours: ${[...b.keys()].filter((k) => !a.has(k)).slice(0, 20).join(",")}`);
for (const f of fields) {
  console.log(`\n${f}: ${diff[f].length} differ (${((1 - diff[f].length / common) * 100).toFixed(1)}% agree)`);
  for (const d of diff[f].slice(0, Number(process.env.SHOW ?? 12))) console.log("  " + d);
}
