import { z } from 'zod';

/**
 * What wiping a constituency's roll for a re-upload would remove, shown to the
 * admin before they confirm. Everything here goes; PINs, admin logins, the
 * banner and usage history stay.
 */
export const rollWipeImpactSchema = z.object({
  /** Rows on the roll today, enrollments included. */
  voters: z.number().int(),
  /** Voters added from the app in the field — they are not in any sheet. */
  enrollments: z.number().int(),
  /** Voters marked as having voted. */
  votedMarks: z.number().int(),
  /** Voters an agent changed after import: mobile, house, caste, party and so on. */
  fieldEdits: z.number().int(),
  /** Slip print records, with their locations. */
  slipPrints: z.number().int(),
  /** App users who unlocked this constituency; each must download the roll again. */
  appUsers: z.number().int(),
  /** Kept, listed so the admin knows access is unaffected. */
  pins: z.number().int(),
});

export type RollWipeImpact = z.infer<typeof rollWipeImpactSchema>;

export const rollWipeResultSchema = z.object({
  voters: z.number().int(),
  slipPrints: z.number().int(),
  /** The new roll version phones will see on their next sync. */
  rollVersion: z.number().int(),
});

export type RollWipeResult = z.infer<typeof rollWipeResultSchema>;
