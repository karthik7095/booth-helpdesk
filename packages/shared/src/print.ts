import { z } from 'zod';

/** How the slip left the phone: the paired thermal printer or the system dialog. */
export const slipPrintMethodSchema = z.enum(['printer', 'dialog']);

export type SlipPrintMethod = z.infer<typeof slipPrintMethodSchema>;

/** Where the phone was when it printed. */
export const printLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  /** Metres. */
  accuracy: z.number().nullable(),
  /** e.g. "Banjara Hills, Hyderabad"; null until looked up, or if none found. */
  placeName: z.string().nullable(),
});

export type PrintLocation = z.infer<typeof printLocationSchema>;

/** The app user who printed. */
export const printerUserSchema = z.object({
  sessionId: z.string(),
  fullName: z.string(),
  mobileNumber: z.string(),
});

/** One voter's print history, as shown on the roll: how many, and the latest. */
export const voterPrintSummarySchema = z.object({
  count: z.number().int(),
  last: z
    .object({
      at: z.string(),
      method: slipPrintMethodSchema,
      by: printerUserSchema,
      location: printLocationSchema.nullable(),
    })
    .nullable(),
});

export type VoterPrintSummary = z.infer<typeof voterPrintSummarySchema>;

/** One app user's printing in a constituency. */
export const printUserSchema = printerUserSchema.extend({
  pinLabel: z.string().nullable(),
  /** Slips printed; a household slip counts once per voter on it. */
  prints: z.number().int(),
  /** Distinct voters printed. */
  voters: z.number().int(),
  lastPrintedAt: z.string(),
  /** The phone's position at its latest located print. */
  lastLocation: printLocationSchema.nullable(),
});

export type PrintUser = z.infer<typeof printUserSchema>;

/** One time the print counts were reset: when, by whom, and what they read before. */
export const printResetSchema = z.object({
  id: z.string(),
  at: z.string(),
  by: z.object({
    name: z.string(),
    email: z.string(),
  }),
  /** The counts just before the reset. */
  prints: z.number().int(),
  voters: z.number().int(),
  users: z.number().int(),
});

export type PrintReset = z.infer<typeof printResetSchema>;

/** A constituency's slip printing, overall and per app user. */
export const printReportSchema = z.object({
  totals: z.object({
    prints: z.number().int(),
    voters: z.number().int(),
    users: z.number().int(),
    /** Prints since midnight India time. */
    today: z.number().int(),
  }),
  users: z.array(printUserSchema),
  /** Latest first. The counts above run from the most recent one. */
  resets: z.array(printResetSchema).default([]),
});

export type PrintReport = z.infer<typeof printReportSchema>;

/** One slip print as the war room lists it. */
export const warRoomPrintSchema = z.object({
  at: z.string(),
  method: slipPrintMethodSchema,
  by: printerUserSchema,
  location: printLocationSchema.nullable(),
});

export type WarRoomPrint = z.infer<typeof warRoomPrintSchema>;

/** One voter of a booth, with every slip printed for them, newest first. */
export const warRoomVoterSchema = z.object({
  id: z.string(),
  srNo: z.number().int(),
  name: z.string().nullable(),
  localName: z.string().nullable(),
  relationType: z.string().nullable(),
  relativeName: z.string().nullable(),
  age: z.number().int().nullable(),
  sex: z.string().nullable(),
  houseNo: z.string().nullable(),
  vcardId: z.string().nullable(),
  mobileNo: z.string().nullable(),
  prints: z.array(warRoomPrintSchema),
});

export type WarRoomVoter = z.infer<typeof warRoomVoterSchema>;

/** A whole booth in serial order, for the dashboard's war room. */
export const warRoomBoothSchema = z.object({
  partNo: z.number().int(),
  boothAddress: z.string().nullable(),
  voters: z.array(warRoomVoterSchema),
});

export type WarRoomBooth = z.infer<typeof warRoomBoothSchema>;

/** What resetting a constituency's print counts removed. */
export const resetPrintsResultSchema = z.object({
  /** Slip print records deleted. */
  deleted: z.number().int(),
});

export type ResetPrintsResult = z.infer<typeof resetPrintsResultSchema>;

/** The two slip-cover slots each app user has, where the constituency allows it. */
export const SLIP_COVER_SLOTS = [1, 2] as const;

/** Largest slip cover an app user may upload. */
export const USER_SLIP_COVER_MAX_BYTES = 1024 * 1024;

/** One of the signed-in user's own slip covers. */
export const userSlipCoverSchema = z.object({
  slot: z.number().int().min(1).max(2),
  mime: z.string(),
  bytes: z.number().int(),
  updatedAt: z.string(),
});

export type UserSlipCover = z.infer<typeof userSlipCoverSchema>;

export const userSlipCoverListSchema = z.object({ covers: z.array(userSlipCoverSchema) });

export type UserSlipCoverList = z.infer<typeof userSlipCoverListSchema>;

/** A new image for one slot, as a `data:image/...;base64,` string. */
export const uploadUserSlipCoverRequestSchema = z.object({ image: z.string().min(1) });

export type UploadUserSlipCoverRequest = z.infer<typeof uploadUserSlipCoverRequestSchema>;

/** A ward print banner is a slip cover too, so it has the same size limit. */
export const WARD_PRINT_BANNER_MAX_BYTES = USER_SLIP_COVER_MAX_BYTES;

/** One ward of a gram panchayat, as the app's ward list and settings show it. */
export const wardSummarySchema = z.object({
  wardNo: z.number().int(),
  total: z.number().int(),
  male: z.number().int(),
  female: z.number().int(),
  /** Assembly booths (parts) the ward's voters vote at. */
  booths: z.array(z.number().int()),
  /** When the ward's print banner last changed; null when it has none. */
  printBannerUpdatedAt: z.string().nullable(),
  /** Who last uploaded it, as they signed in. */
  printBannerUpdatedBy: z.string().nullable(),
});

export type WardSummary = z.infer<typeof wardSummarySchema>;

/** Empty for an assembly constituency. */
export const wardListSchema = z.object({ wards: z.array(wardSummarySchema) });

export type WardList = z.infer<typeof wardListSchema>;

export const uploadWardPrintBannerRequestSchema = z.object({ image: z.string().min(1) });

export type UploadWardPrintBannerRequest = z.infer<typeof uploadWardPrintBannerRequestSchema>;

/** What saving a ward's print banner answers. */
export const wardPrintBannerSavedSchema = z.object({
  wardNo: z.number().int(),
  printBannerUpdatedAt: z.string(),
});

export type WardPrintBannerSaved = z.infer<typeof wardPrintBannerSavedSchema>;

/** A candidate symbol is a small picture; the same 1 MB cap keeps uploads quick. */
export const CANDIDATE_SYMBOL_MAX_BYTES = USER_SLIP_COVER_MAX_BYTES;

/** What the panchayat slip header shows above the cut line. */
export const DEFAULT_SLIP_TAGLINE = 'మీ అమూల్యమైన ఓటు వేయండి';

const typedName = z
  .string()
  .trim()
  .max(80, 'Keep it under 80 characters.')
  .nullable()
  .transform((value) => (value ? value : null));

/** A ward's member candidate, as typed in the app's Settings. */
export const wardCandidateSchema = z.object({
  wardNo: z.number().int(),
  name: z.string().nullable(),
  nameEn: z.string().nullable(),
  /** When the symbol last changed; null when there is none. */
  symbolUpdatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

export type WardCandidate = z.infer<typeof wardCandidateSchema>;

/** The panchayat's slip header: heading, tagline, the Sarpanch candidate and every ward's member. */
export const panchayatSlipSchema = z.object({
  heading: z.string().nullable(),
  tagline: z.string().nullable(),
  sarpanchName: z.string().nullable(),
  sarpanchNameEn: z.string().nullable(),
  sarpanchSymbolUpdatedAt: z.string().nullable(),
  /**
   * A municipal corporation rather than a gram panchayat: the header reads
   * MAYOR and WARD n CORPORATOR instead of SARPANCH and WARD n MEMBER. The
   * defaults keep the app working against an API that predates them.
   */
  municipal: z.boolean().default(false),
  /** When the image printed above the candidates last changed; null when there is none. */
  topImageUpdatedAt: z.string().nullable().default(null),
  wards: z.array(wardCandidateSchema),
});

export type PanchayatSlip = z.infer<typeof panchayatSlipSchema>;

export const updatePanchayatSlipRequestSchema = z.object({
  heading: typedName.optional(),
  tagline: typedName.optional(),
  sarpanchName: typedName.optional(),
  sarpanchNameEn: typedName.optional(),
  municipal: z.boolean().optional(),
});

export type UpdatePanchayatSlipRequest = z.input<typeof updatePanchayatSlipRequestSchema>;

export const updateWardCandidateRequestSchema = z.object({
  name: typedName,
  nameEn: typedName,
});

export type UpdateWardCandidateRequest = z.input<typeof updateWardCandidateRequestSchema>;

export const uploadSymbolRequestSchema = z.object({ image: z.string().min(1) });

/** What uploading a candidate symbol answers. */
export const symbolSavedSchema = z.object({ symbolUpdatedAt: z.string() });
