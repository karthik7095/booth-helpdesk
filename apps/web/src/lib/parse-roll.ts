import {
  IMPORT_COLUMNS,
  normaliseHeader,
  REQUIRED_IMPORT_FIELDS,
  type VoterImportRow,
} from "@voter/shared";
import Papa from "papaparse";
// The package has no root export; the browser build is the one that takes a File.
// `readSheet` returns rows — the default export returns one entry per sheet.
import readXlsxFile, { readSheet } from "read-excel-file/browser";

export type SheetSummary = {
  name: string;
  /** Data rows, excluding the header row. */
  rowCount: number;
  headers: string[];
  /** True when the sheet carries the columns a roll needs. */
  isRoll: boolean;
  missingColumns: string[];
};

export type ParsedRoll = {
  sheetName: string;
  rows: VoterImportRow[];
  /** Headers in the sheet that we don't map to a column. */
  unknownColumns: string[];
  /** Roll headers we expect but didn't find. */
  missingColumns: string[];
  /** Taken from the sheet so the form can be pre-filled. */
  detectedAssemblyNo: number | null;
  detectedAssemblyName: string | null;
  /** Rows dropped because they had no part/serial number. */
  droppedRows: number;
};

export type Workbook = {
  sheets: SheetSummary[];
  /** Rows of the sheet that looks like the roll, or null if none does. */
  roll: ParsedRoll | null;
};

/**
 * Checked as fields rather than header spellings: the roll calls them PART_NO
 * and SLNO, older exports called them partNo and srNo, and both must pass.
 */
const REQUIRED_LABELS: Record<(typeof REQUIRED_IMPORT_FIELDS)[number], string> = {
  partNo: "PART_NO",
  srNo: "SLNO",
};

function missingFields(headers: string[]): string[] {
  const fields = new Set(
    headers.map((header) => IMPORT_COLUMNS[normaliseHeader(header)]).filter(Boolean),
  );

  return REQUIRED_IMPORT_FIELDS.filter((field) => !fields.has(field)).map(
    (field) => REQUIRED_LABELS[field],
  );
}
const CSV_SHEET = "CSV";

function toRow(record: Record<string, unknown>): {
  row: VoterImportRow | null;
  assemblyNo: number | null;
} {
  const mapped: Record<string, unknown> = {};
  let assemblyNo: number | null = null;

  for (const [header, value] of Object.entries(record)) {
    const field = IMPORT_COLUMNS[normaliseHeader(header)];

    if (!field) continue;

    if (field === "assemblyNo") {
      const parsed = Number.parseInt(String(value ?? "").replace(/\D/g, ""), 10);
      assemblyNo = Number.isFinite(parsed) ? parsed : null;
      continue;
    }

    mapped[field] = value;
  }

  const partNo = Number.parseInt(String(mapped.partNo ?? "").replace(/\D/g, ""), 10);
  const srNo = Number.parseInt(String(mapped.srNo ?? "").replace(/\D/g, ""), 10);

  // Part + serial number identify a voter on the roll; a row without them can't be stored.
  if (!Number.isFinite(partNo) || !Number.isFinite(srNo)) {
    return { row: null, assemblyNo };
  }

  return { row: { ...mapped, partNo, srNo } as VoterImportRow, assemblyNo };
}

function summarise(name: string, headers: string[], rowCount: number): SheetSummary {
  return {
    name,
    rowCount,
    headers,
    missingColumns: missingFields(headers),
    isRoll: missingFields(headers).length === 0,
  };
}

function buildRoll(
  sheetName: string,
  headers: string[],
  records: Record<string, unknown>[],
): ParsedRoll {
  const rows: VoterImportRow[] = [];
  let droppedRows = 0;
  let detectedAssemblyNo: number | null = null;
  let detectedAssemblyName: string | null = null;

  for (const record of records) {
    const { row, assemblyNo } = toRow(record);

    if (assemblyNo !== null && detectedAssemblyNo === null) detectedAssemblyNo = assemblyNo;

    if (!row) {
      droppedRows += 1;
      continue;
    }

    if (!detectedAssemblyName && row.eAssemblyName) {
      detectedAssemblyName = String(row.eAssemblyName).trim();
    }

    rows.push(row);
  }

  return {
    sheetName,
    rows,
    unknownColumns: headers.filter((header) => !IMPORT_COLUMNS[normaliseHeader(header)]),
    missingColumns: missingFields(headers),
    detectedAssemblyNo,
    detectedAssemblyName,
    droppedRows,
  };
}

/** Turns a sheet's cell grid into keyed records. */
function toRecords(grid: unknown[][]): { headers: string[]; records: Record<string, unknown>[] } {
  const [headerRow, ...dataRows] = grid;
  const headers = (headerRow ?? []).map((cell) => String(cell ?? "").trim());

  return {
    headers,
    records: dataRows.map((cells) =>
      Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? null])),
    ),
  };
}

async function parseCsv(file: File): Promise<Workbook> {
  const result = await new Promise<Papa.ParseResult<Record<string, unknown>>>((resolve, reject) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: resolve,
      error: reject,
    });
  });

  const headers = result.meta.fields ?? [];
  const summary = summarise(CSV_SHEET, headers, result.data.length);

  return {
    sheets: [summary],
    roll: summary.isRoll ? buildRoll(CSV_SHEET, headers, result.data) : null,
  };
}

/**
 * Reads every sheet so the admin can pick the right one — workbooks often carry
 * a summary tab alongside the roll — and maps the one that looks like the roll.
 */
export async function parseWorkbook(file: File): Promise<Workbook> {
  if (file.name.toLowerCase().endsWith(".csv")) return parseCsv(file);

  const workbook = (await readXlsxFile(file)) as unknown as {
    sheet: string;
    data: unknown[][];
  }[];

  const sheets = workbook.map((sheet) => {
    const [headerRow] = sheet.data;
    const headers = (headerRow ?? []).map((cell) => String(cell ?? "").trim());

    return summarise(sheet.sheet, headers, Math.max(0, sheet.data.length - 1));
  });

  // Prefer the roll sheet with the most rows — that's the data, not a summary tab.
  const best = sheets
    .filter((sheet) => sheet.isRoll)
    .sort((a, b) => b.rowCount - a.rowCount)
    .at(0);

  if (!best) return { sheets, roll: null };

  const target = workbook.find((sheet) => sheet.sheet === best.name)!;
  const { headers, records } = toRecords(target.data);

  return { sheets, roll: buildRoll(best.name, headers, records) };
}

/** Re-reads a single sheet when the admin picks a different one. */
export async function parseSheet(file: File, sheetName: string): Promise<ParsedRoll> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    const workbook = await parseCsv(file);

    if (!workbook.roll) throw new Error("That file has no roll columns.");

    return workbook.roll;
  }

  const grid = (await readSheet(file, sheetName)) as unknown as unknown[][];
  const { headers, records } = toRecords(grid);

  return buildRoll(sheetName, headers, records);
}
