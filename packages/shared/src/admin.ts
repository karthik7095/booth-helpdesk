import { z } from 'zod';

/** Super admins sign in to the web dashboard with email + password. */
export const adminLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type AdminLoginRequest = z.infer<typeof adminLoginRequestSchema>;

/**
 * Super admins see every constituency. Constituency admins are created when a
 * constituency is onboarded and see only that one.
 */
/** `developer` is never listed anywhere; it alone manages desktop-app licences and otherwise acts as a super admin. */
export const adminRoleSchema = z.enum(['super_admin', 'constituency_admin', 'developer']);

export type AdminRole = z.infer<typeof adminRoleSchema>;

export const adminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: adminRoleSchema,
  /** Set only for constituency admins. */
  assemblyId: z.string().nullable(),
  assemblyName: z.string().nullable(),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

/** A dashboard login limited to one constituency, as listed to super admins. */
export const constituencyAdminSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
});

export type ConstituencyAdmin = z.infer<typeof constituencyAdminSchema>;

export const createConstituencyAdminRequestSchema = z.object({
  name: z.string().trim().min(2, 'Admin name is required'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export type CreateConstituencyAdminRequest = z.input<typeof createConstituencyAdminRequestSchema>;

/** Deactivate/reactivate a login, or reset its password. */
export const updateConstituencyAdminRequestSchema = z
  .object({
    isActive: z.boolean().optional(),
    password: z.string().min(8, 'Password must be at least 8 characters').optional(),
  })
  .refine((value) => value.isActive !== undefined || value.password !== undefined, {
    message: 'Nothing to update.',
  });

export type UpdateConstituencyAdminRequest = z.infer<typeof updateConstituencyAdminRequestSchema>;

export const adminLoginResponseSchema = z.object({
  token: z.string(),
  admin: adminUserSchema,
});

export type AdminLoginResponse = z.infer<typeof adminLoginResponseSchema>;

/** A blank form field means "not set", not an empty string. */
const blankToNull = (value: unknown) =>
  typeof value === 'string' && value.trim() === '' ? null : value;

/**
 * Printed at the top and bottom of the WhatsApp slip. The date and time are
 * the same for every voter in a constituency, so they live on the constituency.
 */
export const pollDetailsSchema = z.object({
  /** e.g. "KARIMNAGAR MUNICIPAL CORPORATION-2026". */
  electionTitle: z.preprocess(blankToNull, z.string().trim().max(120).nullish()),
  /** ISO date, "2026-02-11"; shown to voters as "11-Feb-2026". */
  pollDate: z.preprocess(
    blankToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-02-11')
      .nullish(),
  ),
  /** Free text, e.g. "7.00AM-5.00PM". */
  pollTime: z.preprocess(blankToNull, z.string().trim().max(60).nullish()),
});

export type PollDetails = z.infer<typeof pollDetailsSchema>;
export type PollDetailsInput = z.input<typeof pollDetailsSchema>;

/** What the API returns: every field present, null when unset. */
export const pollDetailsResponseSchema = z.object({
  electionTitle: z.string().nullable().default(null),
  pollDate: z.string().nullable().default(null),
  pollTime: z.string().nullable().default(null),
});

/**
 * Which booth breakdowns the dashboard and the app show. Gender and religion
 * are on by default; community is sensitive, so an admin opts in to it.
 */
export const statsVisibilitySchema = z.object({
  showGenderStats: z.boolean().default(true),
  showReligionStats: z.boolean().default(true),
  showCommunityStats: z.boolean().default(false),
});

export type StatsVisibility = z.infer<typeof statsVisibilitySchema>;

/** Flip one or more switches; the others keep their saved value. */
export const updateStatsVisibilityRequestSchema = z
  .object({
    showGenderStats: z.boolean().optional(),
    showReligionStats: z.boolean().optional(),
    showCommunityStats: z.boolean().optional(),
  })
  .refine((value) => Object.values(value).some((flag) => flag !== undefined), {
    message: 'Nothing to update.',
  });

export type UpdateStatsVisibilityRequest = z.infer<typeof updateStatsVisibilityRequestSchema>;

/**
 * Optional voter-screen features in the app. All start hidden; a super admin
 * switches them on per constituency as it needs them.
 */
/** What a constituency's party list starts as. */
export const DEFAULT_PARTY_OPTIONS = ['Lotus', 'Hand'] as const;

export const appFeaturesSchema = z.object({
  /** "Mark as voted" button on the voter screen. */
  enableVoteStatus: z.boolean().default(false),
  /** The home screen's "Enroll New Voter" tile and screen. */
  enableEnrollment: z.boolean().default(false),
  /** Category → sub-category (BC only) → caste dropdowns and entry. */
  enableCasteEntry: z.boolean().default(false),
  /** Party loyalty radio buttons. */
  enablePartyLoyalty: z.boolean().default(false),
  /**
   * The choices those radio buttons offer, set per constituency so every
   * agent picks from the same list. The label is what gets stored.
   */
  partyOptions: z.array(z.string()).default([...DEFAULT_PARTY_OPTIONS]),
  /** The Telugu caution under the slip's cover image. On unless switched off. */
  printCautionNote: z.boolean().default(true),
  /** App users may upload two slip covers of their own and pick which prints. */
  allowUserSlipCovers: z.boolean().default(false),
  /** Slips print the cover image. Off until switched on; older records read as off. */
  printSlipImage: z.boolean().default(false),
  /**
   * A gram panchayat: voters carry a ward number, the app lists wards beside
   * booths, and each ward has its own slip print banner that anyone holding
   * the PIN can upload. Absent from older servers, so read as off.
   */
  isPanchayat: z.boolean().default(false),
  /**
   * New app users wait for an admin to approve them after entering the PIN,
   * and at most APP_USER_LIMIT are approved at once. Absent from older servers.
   */
  requireLoginApproval: z.boolean().default(false),
});

export type AppFeatures = z.infer<typeof appFeaturesSchema>;

export const updateAppFeaturesRequestSchema = z
  .object({
    enableVoteStatus: z.boolean().optional(),
    enableEnrollment: z.boolean().optional(),
    enableCasteEntry: z.boolean().optional(),
    enablePartyLoyalty: z.boolean().optional(),
    printCautionNote: z.boolean().optional(),
    allowUserSlipCovers: z.boolean().optional(),
    printSlipImage: z.boolean().optional(),
    isPanchayat: z.boolean().optional(),
    requireLoginApproval: z.boolean().optional(),
    partyOptions: z
      .array(z.string().trim().min(1, 'A party name cannot be empty.').max(40))
      .min(1, 'Keep at least one party.')
      .max(12, 'At most 12 parties.')
      .refine(
        (names) => new Set(names.map((name) => name.toLowerCase())).size === names.length,
        { message: 'Each party can appear only once.' },
      )
      .optional(),
  })
  .refine((value) => Object.values(value).some((flag) => flag !== undefined), {
    message: 'Nothing to update.',
  });

export type UpdateAppFeaturesRequest = z.infer<typeof updateAppFeaturesRequestSchema>;

/**
 * A notice for booth agents on the app's home screen. Agents must tick that
 * they have read it before it closes; `announcementUpdatedAt` identifies the
 * version they accepted, so a changed notice is shown again.
 */
export const announcementSchema = z.object({
  announcementEnabled: z.boolean().default(false),
  announcementTitle: z.string().nullable().default(null),
  /** Plain text. Blank lines separate paragraphs; a paragraph starting ✅ is a checklist item, ⚠️ a caution. */
  announcementBody: z.string().nullable().default(null),
  announcementUpdatedAt: z.string().nullable().default(null),
});

export type Announcement = z.infer<typeof announcementSchema>;

export const updateAnnouncementRequestSchema = z
  .object({
    enabled: z.boolean().optional(),
    title: z.string().trim().max(120).optional(),
    body: z.string().trim().max(4000).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'Nothing to update.',
  });

export type UpdateAnnouncementRequest = z.infer<typeof updateAnnouncementRequestSchema>;

/** How many other constituencies took a copied alert. */
export const applyAnnouncementResultSchema = z.object({ updated: z.number().int() });

export type ApplyAnnouncementResult = z.infer<typeof applyAnnouncementResultSchema>;

export const assemblySchema = pollDetailsResponseSchema
  .extend(statsVisibilitySchema.shape)
  .extend(appFeaturesSchema.shape)
  .extend(announcementSchema.shape)
  .extend({
  id: z.string(),
  assemblyNo: z.number().int(),
  name: z.string(),
  stateCode: z.string(),
  code: z.string(),
  voterCount: z.number().int(),
  pinCount: z.number().int(),
  bannerUpdatedAt: z.string().nullable().default(null),
  /** The printer cover image is versioned separately from the banner. */
  slipImageUpdatedAt: z.string().nullable().default(null),
  /** The image sent with the slip text on WhatsApp, versioned on its own. */
  whatsappImageUpdatedAt: z.string().nullable().default(null),
  /** Off: PINs stop working and phones holding the roll are signed out. */
  isActive: z.boolean().default(true),
});

export type Assembly = z.infer<typeof assemblySchema>;

export const updateAssemblyActiveRequestSchema = z.object({
  isActive: z.boolean(),
});

export type UpdateAssemblyActiveRequest = z.infer<typeof updateAssemblyActiveRequestSchema>;

export const createAssemblyRequestSchema = pollDetailsSchema.extend({
  assemblyNo: z.coerce.number().int().min(1, 'Assembly number is required'),
  name: z.string().trim().min(2, 'Constituency name is required'),
  /** Letters used inside generated PINs, e.g. "GD" in S29GD241B1. */
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

export type CreateAssemblyRequest = z.input<typeof createAssemblyRequestSchema>;

/** Editing a constituency's poll details after it was created. */
export const updatePollDetailsRequestSchema = pollDetailsSchema;

export const accessPinSchema = z.object({
  id: z.string(),
  pin: z.string(),
  label: z.string().nullable(),
  assemblyNo: z.number().int(),
  assemblyName: z.string(),
  partNos: z.array(z.number().int()),
  isActive: z.boolean(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  usageCount: z.number().int(),
  createdAt: z.string(),
});

export type AccessPin = z.infer<typeof accessPinSchema>;

/** The PIN itself is generated server-side — the admin only picks its scope. */
export const createPinRequestSchema = z.object({
  assemblyId: z.string().min(1, 'Choose a constituency'),
  label: z.string().trim().max(120).optional(),
  /** Empty grants the whole constituency. */
  partNos: z.array(z.coerce.number().int().min(1)).default([]),
  expiresAt: z.string().datetime().nullish(),
});

export type CreatePinRequest = z.input<typeof createPinRequestSchema>;

export const updatePinRequestSchema = z.object({
  isActive: z.boolean(),
});

export type UpdatePinRequest = z.infer<typeof updatePinRequestSchema>;

export const adminStatsSchema = z.object({
  assemblies: z.number().int(),
  voters: z.number().int(),
  activePins: z.number().int(),
  sessions: z.number().int(),
});

export type AdminStats = z.infer<typeof adminStatsSchema>;

/** Someone who signed in to the app with a name and mobile number. */
export const appUserSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  mobileNumber: z.string(),
  /** Null until they unlock a session with a PIN. */
  pin: z.string().nullable(),
  pinLabel: z.string().nullable(),
  assemblyName: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  lastSeenAt: z.string(),
  createdAt: z.string(),
  /** Slips this sign-in has printed, and how many distinct voters they covered. */
  prints: z.number().int().default(0),
  votersPrinted: z.number().int().default(0),
  /** Switched off by an admin: signed out and unable to sign in again. */
  deactivated: z.boolean().default(false),
});

export type AppUser = z.infer<typeof appUserSchema>;
