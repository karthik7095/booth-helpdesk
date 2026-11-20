import { z } from 'zod';

/**
 * Desktop app licensing: a computer is activated once with a code issued from
 * the dashboard, and then verifies itself with the API on every launch.
 */

export const devicePlatformSchema = z.enum(['darwin', 'win32', 'linux']);
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;

export const deviceStatusSchema = z.enum(['active', 'revoked']);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const deviceActivateRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4)
    .max(40)
    .transform((s) => s.toUpperCase().replace(/[^A-Z0-9]/g, '')),
  /** sha256 of the machine's hardware id; never the raw id. */
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/, 'Bad fingerprint'),
  name: z.string().trim().min(1).max(120),
  platform: devicePlatformSchema,
  osVersion: z.string().trim().max(80).optional(),
  appVersion: z.string().trim().max(40).optional(),
});
export type DeviceActivateRequest = z.input<typeof deviceActivateRequestSchema>;

export const deviceCheckRequestSchema = z.object({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  appVersion: z.string().trim().max(40).optional(),
  /** Work done since the last check-in, added to the device's totals. */
  stats: z
    .object({
      conversions: z.number().int().min(0).default(0),
      voters: z.number().int().min(0).default(0),
    })
    .optional(),
});
export type DeviceCheckRequest = z.input<typeof deviceCheckRequestSchema>;

export const deviceLicenseSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string(),
  codeLabel: z.string(),
  expiresAt: z.string().nullable(),
});
export type DeviceLicense = z.infer<typeof deviceLicenseSchema>;

/**
 * A short-lived statement signed by the server (Ed25519) that this device may
 * run; the desktop app verifies it with a built-in public key, so a look-alike
 * server cannot unlock the app.
 */
export const deviceLeaseSchema = z.object({
  /** base64url JSON: { deviceId, fingerprint, exp (unix seconds), codeLabel } */
  data: z.string(),
  /** base64url Ed25519 signature over `data` */
  sig: z.string(),
});
export type DeviceLease = z.infer<typeof deviceLeaseSchema>;

export const deviceActivateResponseSchema = z.object({
  token: z.string(),
  license: deviceLicenseSchema,
  lease: deviceLeaseSchema,
});
export type DeviceActivateResponse = z.infer<typeof deviceActivateResponseSchema>;

export const deviceCheckResponseSchema = z.object({
  ok: z.literal(true),
  license: deviceLicenseSchema,
  lease: deviceLeaseSchema,
});
export type DeviceCheckResponse = z.infer<typeof deviceCheckResponseSchema>;

/** Why a check or activation was refused; shown to the operator. */
export const deviceRefusalReasonSchema = z.enum([
  'invalid_code',
  'code_disabled',
  'code_expired',
  'code_full',
  'revoked',
  'unknown_device',
  'fingerprint_mismatch',
]);
export type DeviceRefusalReason = z.infer<typeof deviceRefusalReasonSchema>;

// --- dashboard side

export const activationCodeSchema = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  maxDevices: z.number().int(),
  isActive: z.boolean(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  deviceCount: z.number().int(),
  activeDeviceCount: z.number().int(),
});
export type ActivationCode = z.infer<typeof activationCodeSchema>;

export const createActivationCodeRequestSchema = z.object({
  label: z.string().trim().min(1, 'Say who this code is for').max(120),
  maxDevices: z.coerce.number().int().min(1).max(500).default(1),
  expiresAt: z.string().datetime().nullish(),
});
export type CreateActivationCodeRequest = z.input<typeof createActivationCodeRequestSchema>;

export const updateActivationCodeRequestSchema = z.object({
  isActive: z.boolean().optional(),
  label: z.string().trim().min(1).max(120).optional(),
  maxDevices: z.coerce.number().int().min(1).max(500).optional(),
  /** null removes the expiry. */
  expiresAt: z.string().datetime().nullable().optional(),
});
export type UpdateActivationCodeRequest = z.infer<typeof updateActivationCodeRequestSchema>;

export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  platform: devicePlatformSchema,
  osVersion: z.string().nullable(),
  appVersion: z.string().nullable(),
  /** Last 8 characters of the fingerprint, enough to tell machines apart. */
  fingerprintHint: z.string(),
  status: deviceStatusSchema,
  activationCodeId: z.string(),
  code: z.string(),
  codeLabel: z.string(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  checkIns: z.number().int(),
  conversions: z.number().int(),
  voters: z.number().int(),
});
export type Device = z.infer<typeof deviceSchema>;

export const updateDeviceRequestSchema = z.object({
  status: deviceStatusSchema.optional(),
  name: z.string().trim().min(1).max(120).optional(),
});
export type UpdateDeviceRequest = z.infer<typeof updateDeviceRequestSchema>;
