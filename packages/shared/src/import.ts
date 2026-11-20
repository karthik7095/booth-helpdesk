import { z } from 'zod';

import { pollDetailsSchema } from './admin.js';

/** Empty cells arrive as "", null or undefined depending on the file format. */
// `.optional()` matters as much as the null in the union: a sheet may not carry
// the column at all, so the key can be missing from the row object.
const optionalText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text.length > 0 ? text : null;
  });

const optionalInt = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(String(value).replace(/\D/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : null;
  });

const requiredInt = z
  .union([z.string(), z.number()])
  .transform((value) => Number.parseInt(String(value).replace(/\D/g, ''), 10))
  .refine((value) => Number.isFinite(value), 'Must be a number');

/** One parsed row of an electoral-roll sheet. */
export const voterImportRowSchema = z.object({
  partNo: requiredInt,
  srNo: requiredInt,
  /** SECTION_NO — the roll's subdivision of a part. */
  sectionNo: optionalInt,
  /** WARD_NO — the ward on a gram panchayat roll; absent from assembly rolls. */
  wardNo: optionalInt,
  eFirstName: optionalText,
  /** Elector_Last_Name — the surname the roll carries separately. */
  eLastName: optionalText,
  eMiddleName: optionalText,
  lFirstName: optionalText,
  lLastName: optionalText,
  lMiddleName: optionalText,
  /** RELATION_TYPE — F, H, M and so on, describing Relation_Name. */
  relationType: optionalText,
  /** STREET_AREA — the locality line above the village. */
  streetArea: optionalText,
  sex: optionalText,
  age: optionalInt,
  vcardId: optionalText,
  houseNo: optionalText,
  lAddress: optionalText,
  eAssemblyName: optionalText,
  eVillage: optionalText,
  eBoothAddress: optionalText,
  mobileNo1: optionalText,
  religion: optionalText,
  community: optionalText,
});

export type VoterImportRow = z.input<typeof voterImportRowSchema>;

/** Step 1 of an import — create (or reuse) the constituency the rows belong to. */
export const importAssemblyRequestSchema = pollDetailsSchema.extend({
  assemblyNo: z.coerce.number().int().min(1, 'Assembly number is required'),
  name: z.string().trim().min(2, 'Constituency name is required'),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,4}$/, 'Use 2-4 letters, e.g. GD'),
  stateCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]\d{1,3}$/, 'Use a state code like S29')
    .default('S29'),
});

export type ImportAssemblyRequest = z.input<typeof importAssemblyRequestSchema>;

/** Step 2 — rows are sent in chunks so large rolls don't hit body limits. */
export const importVotersRequestSchema = z.object({
  rows: z.array(voterImportRowSchema).min(1).max(5000),
});

export const importResultSchema = z.object({
  received: z.number().int(),
  inserted: z.number().int(),
  /** Rows already present for this constituency (same part + serial number). */
  skipped: z.number().int(),
});

export type ImportResult = z.infer<typeof importResultSchema>;

/** Sheet headers we understand, normalised to lowercase alphanumerics. */
export const IMPORT_COLUMNS: Record<string, keyof VoterImportRow | 'assemblyNo'> = {
  // The roll's own headers, which are the source of truth for every field.
  acno: 'assemblyNo',
  partno: 'partNo',
  slno: 'srNo',
  sectionno: 'sectionNo',
  wardno: 'wardNo',
  epicno: 'vcardId',
  electorname: 'eFirstName',
  electorlastname: 'eLastName',
  electornametel: 'lFirstName',
  electorlastnametel: 'lLastName',
  sex: 'sex',
  age: 'age',
  relationtype: 'relationType',
  relationname: 'eMiddleName',
  relationnametel: 'lMiddleName',
  hno: 'houseNo',
  streetarea: 'streetArea',
  village: 'eVillage',
  mobileno: 'mobileNo1',
  boothaddress: 'eBoothAddress',
  religion: 'religion',
  community: 'community',

  // Headers earlier sheets used for the same fields, still accepted.
  assemblyno: 'assemblyNo',
  srno: 'srNo',
  efirstname: 'eFirstName',
  elastname: 'eLastName',
  emiddlename: 'eMiddleName',
  lfirstname: 'lFirstName',
  llastname: 'lLastName',
  lmiddlename: 'lMiddleName',
  vcardid: 'vcardId',
  houseno: 'houseNo',
  laddress: 'lAddress',
  eassemblyname: 'eAssemblyName',
  evillage: 'eVillage',
  eboothaddress: 'eBoothAddress',
  mobileno1: 'mobileNo1',
};

/** The fields a sheet must provide before it can be read as a roll. */
export const REQUIRED_IMPORT_FIELDS = ['partNo', 'srNo'] as const;

export function normaliseHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}
