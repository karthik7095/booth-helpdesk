/**
 * CSV for the dashboard's exports. Rows are CRLF-terminated and the file starts
 * with a UTF-8 byte-order mark, so Excel shows Telugu names correctly.
 */
export const CSV_BOM = '﻿';

type Cell = string | number | boolean | null | undefined | Date;

function cell(value: Cell): string {
  if (value === null || value === undefined) return '';

  let text = value instanceof Date ? value.toISOString() : String(value);

  // A leading = + - @ would make Excel treat the cell as a formula.
  if (/^[=+\-@\t\r]/.test(text) && typeof value === 'string') text = `'${text}`;

  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(values: Cell[]): string {
  return `${values.map(cell).join(',')}\r\n`;
}

/** `attachment; filename="..."` with anything unsafe stripped from the name. */
export function attachment(filename: string): string {
  return `attachment; filename="${filename.replace(/[^\w.-]+/g, '-')}"`;
}
