import { z } from 'zod';

import { voterPrintSummarySchema } from './print.js';

/** One row of the electoral roll. `e*` fields are English, `l*` local language. */
export const voterSchema = z.object({
  id: z.string(),
  assemblyNo: z.number().int(),
  partNo: z.number().int(),
  srNo: z.number().int(),
  sectionNo: z.number().int().nullable().default(null),
  /** Gram panchayat rolls only. */
  wardNo: z.number().int().nullable().default(null),
  eFirstName: z.string().nullable(),
  eLastName: z.string().nullable().default(null),
  eMiddleName: z.string().nullable(),
  lFirstName: z.string().nullable(),
  lLastName: z.string().nullable().default(null),
  lMiddleName: z.string().nullable(),
  /** RELATION_TYPE: F for father, H for husband, and so on. */
  relationType: z.string().nullable().default(null),
  sex: z.string().nullable(),
  age: z.number().int().nullable(),
  vcardId: z.string().nullable(),
  houseNo: z.string().nullable(),
  lAddress: z.string().nullable(),
  eAssemblyName: z.string().nullable(),
  streetArea: z.string().nullable().default(null),
  eVillage: z.string().nullable(),
  eBoothAddress: z.string().nullable(),
  mobileNo1: z.string().nullable(),
  religion: z.string().nullable(),
  community: z.string().nullable(),
  /** BC-A … BC-E when `community` (the caste category) is BC. */
  subCategory: z.string().nullable().default(null),
  /** The caste, or tribe for ST, within the category. */
  caste: z.string().nullable().default(null),
  /** One of the constituency's `partyOptions`, recorded by a field agent. */
  partyLoyalty: z.string().nullable().default(null),
  hasVoted: z.boolean(),
  isNewEnrollment: z.boolean().default(false),
  /** Marked deceased by a field agent; still on the roll, flagged. */
  isDeceased: z.boolean().default(false),
  updatedAt: z.string().optional(),
});

export type Voter = z.infer<typeof voterSchema>;

/**
 * Category → sub-category → caste. `value` is stored in `community`; only BC
 * has sub-categories, and ST asks for the tribe rather than the caste.
 */
export const CASTE_CATEGORIES: readonly {
  value: string;
  label: string;
  subCategories: readonly string[];
  casteLabel: string;
}[] = [
  { value: 'OC', label: 'OC / General', subCategories: [], casteLabel: 'Caste / Community' },
  {
    value: 'BC',
    label: 'BC',
    subCategories: ['BC-A', 'BC-B', 'BC-C', 'BC-D', 'BC-E'],
    casteLabel: 'Caste / Community',
  },
  { value: 'SC', label: 'SC', subCategories: [], casteLabel: 'Caste / Community' },
  { value: 'ST', label: 'ST', subCategories: [], casteLabel: 'Tribe / Community' },
  {
    value: 'North Indian',
    label: 'North Indian',
    subCategories: [],
    casteLabel: 'Caste / Community',
  },
];


/**
 * The voter's own English name, for lists and search results. The middle-name
 * column of a roll holds the relative's name, not part of this name, so it is
 * deliberately left out — see `voterRelativeName`.
 */
export function voterName(voter: Pick<Voter, 'eFirstName' | 'eLastName'>): string {
  return [voter.eFirstName, voter.eLastName]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** The father's or husband's name, which rolls store in the middle-name column. */
export function voterRelativeName(voter: Pick<Voter, 'eMiddleName'>): string {
  return (voter.eMiddleName ?? '').trim();
}

/** Every field the free-text search looks in, in the order they are joined. */
export type VoterSearchFields = Pick<
  Voter,
  | 'eFirstName'
  | 'eLastName'
  | 'eMiddleName'
  | 'lFirstName'
  | 'lLastName'
  | 'lMiddleName'
  | 'vcardId'
  | 'houseNo'
  | 'eVillage'
  | 'mobileNo1'
>;

/**
 * The one string the app's local search runs against, so a query is one
 * `LIKE` per word instead of ten. Lower-cased and whitespace-collapsed here
 * rather than in SQL, because SQLite's `lower()` only folds ASCII and rolls
 * carry doubled spaces from the source file. Stored on the phone as
 * `search_text`; the server fills it for every row it sends, and the app
 * refreshes it whenever it writes a voter itself.
 */
export function voterSearchText(voter: VoterSearchFields): string {
  return [
    voter.eFirstName,
    voter.eLastName,
    voter.eMiddleName,
    voter.lFirstName,
    voter.lLastName,
    voter.lMiddleName,
    voter.vcardId,
    voter.houseNo,
    voter.eVillage,
    voter.mobileNo1,
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * A boolean from a query string. Not `z.coerce.boolean()`: that runs
 * `Boolean("false")`, which is true, so `?hasVoted=false` would select the
 * voted. Only the words "true" and "false" (or real booleans) are accepted.
 */
const queryBoolean = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => value === true || value === 'true');

export const voterListQuerySchema = z.object({
  assemblyNo: z.coerce.number().int().optional(),
  partNo: z.coerce.number().int().optional(),
  /** One ward, where the roll has wards. Dashboard only. */
  wardNo: z.coerce.number().int().optional(),
  /** Matches name, voter card id, house number or village. */
  search: z.string().trim().optional(),
  /** One house number exactly, ignoring case: a household, as the app's Family screen groups it. */
  houseNo: z.string().trim().min(1).optional(),
  hasVoted: queryBoolean.optional(),
  /** True: only voters marked deceased; false: only the living. */
  deceased: queryBoolean.optional(),
  /** True: at least one slip printed; false: never printed. Dashboard only. */
  printed: queryBoolean.optional(),
  /** Only voters whose slip this app user (sign-in session id) printed. Dashboard only. */
  printedBy: z.string().trim().min(1).optional(),
  /** Column to order by; booth then serial when absent. */
  sort: z
    .enum(['part', 'sr', 'name', 'age', 'voterId', 'house', 'village', 'mobile', 'voted', 'printed'])
    .optional(),
  dir: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type VoterSort = NonNullable<z.infer<typeof voterListQuerySchema>['sort']>;

export type VoterListQuery = z.input<typeof voterListQuerySchema>;

export const voterListResponseSchema = z.object({
  voters: z.array(
    voterSchema.extend({
      /** Set by the dashboard's roll; the app's own list never carries it. */
      prints: voterPrintSummarySchema.optional(),
    }),
  ),
  total: z.number().int(),
});

export type VoterListResponse = z.infer<typeof voterListResponseSchema>;

/** The home screen's counters for the PIN's booths, from the server. */
export const voterSummarySchema = z.object({
  total: z.number().int(),
  voted: z.number().int(),
  pending: z.number().int(),
  /** Distinct voters with a slip printed, by any phone. */
  printed: z.number().int().default(0),
  /** Of those, printed by this sign-in. */
  printedByMe: z.number().int().default(0),
  /**
   * When an admin last reset the constituency's print counts, or null if
   * never. Phones drop their own print records from before this moment so
   * their counts match and nothing from before it is uploaded again.
   */
  printsResetAt: z.string().nullable().default(null),
});

export type VoterSummary = z.infer<typeof voterSummarySchema>;

export const markVotedRequestSchema = z.object({
  hasVoted: z.boolean(),
});

export type MarkVotedRequest = z.infer<typeof markVotedRequestSchema>;

/** Fields a PIN holder may correct or fill in from the app. */
export const voterPatchSchema = z.object({
  /** A corrected English name; the roll's spelling is kept beside it on the server. */
  eFirstName: z.string().trim().min(1, 'Name is required').max(120).optional(),
  mobileNo1: z.string().trim().max(20).nullish(),
  age: z.coerce.number().int().min(18).max(120).nullish(),
  sex: z.string().trim().max(10).nullish(),
  houseNo: z.string().trim().max(120).nullish(),
  religion: z.string().trim().max(60).nullish(),
  community: z.string().trim().max(60).nullish(),
  subCategory: z.string().trim().max(20).nullish(),
  caste: z.string().trim().max(80).nullish(),
  partyLoyalty: z.string().trim().max(40).nullish(),
  eVillage: z.string().trim().max(120).nullish(),
  hasVoted: z.boolean().optional(),
});

export type VoterPatch = z.infer<typeof voterPatchSchema>;

/** A voter enrolled in the field. The server assigns the serial number. */
export const voterEnrollmentSchema = z.object({
  /** Client-generated so a queued enrollment synced twice lands once. */
  clientRef: z.string().min(8).max(64),
  partNo: z.coerce.number().int().min(1),
  eFirstName: z.string().trim().min(1, 'Name is required'),
  eMiddleName: z.string().trim().max(120).nullish(),
  sex: z.string().trim().max(10).nullish(),
  age: z.coerce.number().int().min(18).max(120).nullish(),
  vcardId: z.string().trim().max(40).nullish(),
  houseNo: z.string().trim().max(120).nullish(),
  mobileNo1: z.string().trim().max(20).nullish(),
  eVillage: z.string().trim().max(120).nullish(),
  religion: z.string().trim().max(60).nullish(),
  community: z.string().trim().max(60).nullish(),
});

export type VoterEnrollment = z.infer<typeof voterEnrollmentSchema>;

/** One offline batch: edits made on device plus voters enrolled there. */
export const syncRequestSchema = z.object({
  updates: z.array(voterPatchSchema.extend({ id: z.string() })).max(500).default([]),
  enrollments: z.array(voterEnrollmentSchema).max(200).default([]),
});

export type SyncRequest = z.input<typeof syncRequestSchema>;

export const syncResponseSchema = z.object({
  updated: z.array(z.string()),
  enrolled: z.array(z.object({ clientRef: z.string(), id: z.string(), srNo: z.number().int() })),
  failed: z.array(z.object({ ref: z.string(), message: z.string() })),
});

export type SyncResponse = z.infer<typeof syncResponseSchema>;

/** Paged bulk download used to seed the on-device SQLite copy. */
export const downloadQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(5000).default(2000),
  /** ISO timestamp — only rows changed since then, for a top-up sync. */
  since: z.string().optional(),
});

export type DownloadQuery = z.input<typeof downloadQuerySchema>;

export const downloadResponseSchema = z.object({
  voters: z.array(voterSchema),
  nextCursor: z.string().nullable(),
  total: z.number().int(),
});

export type DownloadResponse = z.infer<typeof downloadResponseSchema>;

/** One booth (part) in a constituency, with its headline counts. */
export const boothSummarySchema = z.object({
  partNo: z.number().int(),
  total: z.number().int(),
  voted: z.number().int(),
  /** Voters with at least one slip printed. */
  printed: z.number().int().default(0),
  /** Voters both marked as voted and printed, so the two can be cross-filtered. */
  votedPrinted: z.number().int().default(0),
  male: z.number().int(),
  female: z.number().int(),
  boothAddress: z.string().nullable(),
  village: z.string().nullable(),
});

export type BoothSummary = z.infer<typeof boothSummarySchema>;

export const statSliceSchema = z.object({
  label: z.string(),
  count: z.number().int(),
});

export type StatSlice = z.infer<typeof statSliceSchema>;

/**
 * Age groups for the booth breakdown, youngest first. Bounds are inclusive and
 * never overlap, so 40 falls in "30–40" and 75 in "61–75".
 */
export const AGE_BANDS = [
  { label: '18–23', min: 18, max: 23 },
  { label: '24–29', min: 24, max: 29 },
  { label: '30–40', min: 30, max: 40 },
  { label: '41–60', min: 41, max: 60 },
  { label: '61–75', min: 61, max: 75 },
  { label: '75+', min: 76, max: null },
] as const;

/** A SQL CASE expression (Postgres and SQLite alike) mapping `age` to its band label. */
export const AGE_BAND_SQL = `CASE ${AGE_BANDS.map((band) =>
  band.max === null
    ? `WHEN age >= ${band.min} THEN '${band.label}'`
    : `WHEN age BETWEEN ${band.min} AND ${band.max} THEN '${band.label}'`,
).join(' ')} ELSE NULL END`;

/**
 * Grouped `AGE_BAND_SQL` counts as slices: every band in order, empty ones
 * included so booths compare at a glance, then "Not recorded" if any.
 */
export function ageSlices(
  rows: { label: string | null; count: number | bigint }[],
): { label: string; count: number }[] {
  const counts = new Map(rows.map((row) => [row.label, Number(row.count)]));
  const slices = AGE_BANDS.map((band) => ({ label: band.label, count: counts.get(band.label) ?? 0 }));
  const missing = counts.get(null) ?? 0;

  return missing > 0 ? [...slices, { label: 'Not recorded', count: missing }] : slices;
}

/**
 * Breakdowns for one booth. The roll carries religion and community rather
 * than nationality, so those are reported alongside gender.
 */
export const boothStatsSchema = z.object({
  partNo: z.number().int(),
  total: z.number().int(),
  gender: z.array(statSliceSchema),
  /** Every band in `AGE_BANDS` order, empty ones included, then "Not recorded". */
  age: z.array(statSliceSchema).default([]),
  religion: z.array(statSliceSchema),
  community: z.array(statSliceSchema),
});

export type BoothStats = z.infer<typeof boothStatsSchema>;

