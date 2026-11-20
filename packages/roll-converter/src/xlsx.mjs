// Writes the three-sheet workbook: "Meta data", "voters", "summary".
import ExcelJS from "exceljs";
import { transliterate, RELATION_EN, GENDER_EN } from "./translit.mjs";

export const VOTER_COLUMNS = [
  "AssemblyConstituency", "PartNo", "SectionNo", "SectionName", "ElectoralRollType", "Status",
  "DeletionReasonCode", "SerialNo", "EPIC", "Name", "RelationType", "RelationName", "HouseNumber",
  "Age", "Gender", "AgeAsOn", "DateOfPublication", "TotalPages", "PageNo",
  "SectionName Eng", "Name Eng", "RelationType Eng", "RelationName Eng", "Gender Eng",
];

function headerStyle(row) {
  row.font = { bold: true };
  row.alignment = { vertical: "middle" };
}

/**
 * @param {object} args
 * @param {object} args.meta  key/value pairs for the Meta data sheet (insertion order kept)
 * @param {object[]} args.voters  parsed voters in serial order
 * @param {object} args.summary  key/value metrics
 * @param {object[]} args.pages  per-page rows: {pageNo, rows, seconds, sectionNo, sectionName}
 * @param {string} args.out  output path
 */
export async function writeWorkbook({ meta, voters, summary, pages, review, out, extraColumns = [], extraSheets = [], relationEn = RELATION_EN, genderEn = GENDER_EN }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "voter-roll-converter";
  wb.created = new Date();

  // --- Meta data
  const ms = wb.addWorksheet("Meta data", { views: [{ state: "frozen", ySplit: 1 }] });
  ms.columns = [{ header: "Field", key: "f", width: 23 }, { header: "Value", key: "v", width: 42 }];
  headerStyle(ms.getRow(1));
  for (const [k, v] of Object.entries(meta)) ms.addRow({ f: k, v: v ?? "" });
  ms.autoFilter = { from: "A1", to: `B${ms.rowCount}` };

  // --- voters
  const vs = wb.addWorksheet("voters", { views: [{ state: "frozen", ySplit: 1 }] });
  vs.columns = [
    ...VOTER_COLUMNS.map((h) => ({ header: h, key: h, width: widthFor(h) })),
    ...extraColumns.map((c) => ({ header: c.header, key: c.header, width: c.width ?? 12 })),
  ];
  headerStyle(vs.getRow(1));
  for (const v of voters) {
    vs.addRow({
      AssemblyConstituency: meta.AssemblyConstituency,
      PartNo: v.partNo ?? meta.PartNo,
      SectionNo: v.sectionNo,
      SectionName: v.sectionName,
      ElectoralRollType: meta.ElectoralRollType,
      Status: meta.Status,
      DeletionReasonCode: meta.DeletionReasonCode ?? "",
      SerialNo: v.serial,
      EPIC: v.epic,
      Name: v.name,
      RelationType: v.relationType,
      RelationName: v.relationName,
      HouseNumber: v.house,
      Age: v.age === "" ? "" : Number(v.age),
      Gender: v.gender,
      AgeAsOn: meta.AgeAsOn,
      DateOfPublication: meta.DateOfPublication,
      TotalPages: meta.TotalPages,
      PageNo: v.pageNo,
      "SectionName Eng": transliterate(v.sectionName),
      "Name Eng": transliterate(v.name),
      "RelationType Eng": relationEn[v.relationType] ?? transliterate(v.relationType),
      "RelationName Eng": transliterate(v.relationName),
      "Gender Eng": genderEn[v.gender] ?? transliterate(v.gender),
      ...Object.fromEntries(extraColumns.map((c) => [c.header, v[c.key] ?? ""])),
    });
  }
  vs.autoFilter = { from: "A1", to: `${vs.getColumn(vs.columnCount).letter}${vs.rowCount}` };

  // --- summary
  const ss = wb.addWorksheet("summary", { views: [{ state: "frozen", ySplit: 1 }] });
  ss.columns = [{ width: 26 }, { width: 14 }, { width: 10 }, { width: 11 }, { width: 60 }];
  ss.addRow(["Metric", "Value"]);
  headerStyle(ss.getRow(1));
  for (const [k, v] of Object.entries(summary)) ss.addRow([k, v ?? ""]);
  ss.addRow([]);
  const ph = ss.addRow(["PageNo", "Rows", "Seconds", "SectionNo", "SectionName"]);
  headerStyle(ph);
  for (const p of pages) ss.addRow([p.pageNo, p.rows, p.seconds, p.sectionNo, p.sectionName]);

  // --- review: rows a person should check against the PDF
  const rs = wb.addWorksheet("review", { views: [{ state: "frozen", ySplit: 1 }] });
  rs.columns = [
    { header: "SerialNo", key: "serial", width: 10 },
    { header: "PageNo", key: "pageNo", width: 8 },
    { header: "EPIC", key: "epic", width: 14 },
    { header: "Name", key: "name", width: 32 },
    { header: "Issue", key: "issue", width: 60 },
    { header: "Confidence", key: "confidence", width: 11 },
  ];
  headerStyle(rs.getRow(1));
  for (const r of review ?? []) rs.addRow(r);
  if (rs.rowCount > 1) rs.autoFilter = { from: "A1", to: `F${rs.rowCount}` };

  // --- extra tables (e.g. ward-wise and booth-wise counts): rows are plain objects
  for (const sheet of extraSheets) {
    if (!sheet.rows.length) continue;
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = Object.keys(sheet.rows[0]).map((k) => ({ header: k, key: k, width: Math.max(9, k.length + 2) }));
    headerStyle(ws.getRow(1));
    for (const r of sheet.rows) ws.addRow(r);
  }

  await wb.xlsx.writeFile(out);
}

function widthFor(h) {
  if (/SectionName/.test(h)) return 44;
  if (/Name|Assembly/.test(h)) return 30;
  if (/Date|AgeAsOn|Status|EPIC|Relation/.test(h)) return 16;
  return 10;
}
