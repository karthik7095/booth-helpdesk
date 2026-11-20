import { z } from 'zod';

import { announcementSchema, appFeaturesSchema, pollDetailsResponseSchema, statsVisibilitySchema } from './admin.js';

/**
 * Step 1 — anyone may sign in with a name and mobile number. This only opens a
 * session; no voter data is reachable until a PIN is verified against it.
 */
export const loginRequestSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required'),
  mobileNumber: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Mobile number must be 10 digits'),
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  token: z.string(),
  session: z.object({
    id: z.string(),
    fullName: z.string(),
    mobileNumber: z.string(),
  }),
  /** Always true — the client must call /api/auth/pin next. */
  requiresPin: z.literal(true),
  /**
   * The mobile number must be confirmed by OTP (MSG91 widget, then
   * /api/auth/otp) before the PIN. Absent from older servers.
   */
  requiresOtp: z.boolean().default(false),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

/**
 * Step 1b — the access token the MSG91 OTP widget returns once the code texted
 * to the session's mobile number has been entered correctly.
 */
export const otpRequestSchema = z.object({
  accessToken: z.string().trim().min(10).max(4000),
});

export type OtpRequest = z.infer<typeof otpRequestSchema>;

/** Step 2 — an access PIN issued by a super admin, e.g. "S29GD241B1". */
export const pinRequestSchema = z.object({
  pin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9]{6,16}$/, 'Enter the access PIN you were given'),
});

export type PinRequest = z.infer<typeof pinRequestSchema>;

/** What a verified PIN grants: one constituency, optionally limited to parts. */
/** Stat switches default in, so an access saved by an older build still parses. */
export const accessSchema = pollDetailsResponseSchema
  .extend(statsVisibilitySchema.shape)
  .extend(appFeaturesSchema.shape)
  .extend(announcementSchema.shape)
  .extend({
  pinId: z.string(),
  label: z.string().nullable(),
  assemblyNo: z.number().int(),
  assemblyName: z.string(),
  /** Empty means every part/booth in the constituency. */
  partNos: z.array(z.number().int()),
  /** The wards an admin let this user see when approving them; empty means every ward. */
  wardNos: z.array(z.number().int()).default([]),
  /** When the constituency banner last changed; null when there is none. */
  bannerUpdatedAt: z.string().nullable().default(null),
  /** When the printer cover image last changed; null when there is none. */
  slipImageUpdatedAt: z.string().nullable().default(null),
  /** When the WhatsApp share image last changed; null when there is none. */
  whatsappImageUpdatedAt: z.string().nullable().default(null),
  /**
   * The constituency's roll version. The app compares it with the version it
   * downloaded; a difference means the admin re-uploaded the roll and the
   * copy on the phone must be replaced. Absent from older servers.
   */
  rollVersion: z.number().int().optional(),
  /** This user is an app admin here: the app shows the Approvals screen. */
  canApproveUsers: z.boolean().default(false),
});

export type Access = z.infer<typeof accessSchema>;

export const pinResponseSchema = z.object({
  /** A new token that carries the PIN's access — replace the login token with it. */
  token: z.string(),
  access: accessSchema,
});

export type PinResponse = z.infer<typeof pinResponseSchema>;

export const sessionSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  mobileNumber: z.string(),
  verified: z.boolean(),
  /** The mobile number has not been confirmed by OTP yet. Absent from older servers. */
  otpPending: z.boolean().default(false),
  access: accessSchema.nullable(),
});

export type Session = z.infer<typeof sessionSchema>;
