import { z } from 'zod';

/**
 * How many app users a constituency starts with, admins included. A super
 * admin can change it per constituency (`maxAppUsers`).
 */
export const APP_USER_LIMIT = 5;

export const updateAppUserLimitRequestSchema = z.object({
  limit: z.coerce.number().int().min(1, 'Allow at least 1 user.').max(500, 'At most 500 users.'),
});

export type UpdateAppUserLimitRequest = z.input<typeof updateAppUserLimitRequestSchema>;

export const appUserStatusSchema = z.enum(['pending', 'approved', 'removed']);

export type AppUserStatus = z.infer<typeof appUserStatusSchema>;

/** One app user's standing in a constituency. */
export const appUserAccessSchema = z.object({
  mobileNumber: z.string(),
  fullName: z.string(),
  status: appUserStatusSchema,
  isAdmin: z.boolean(),
  /** The top app admin: approves and removes anyone, and chooses the other admins. */
  isMayor: z.boolean().default(false),
  requestedAt: z.string(),
  decidedAt: z.string().nullable(),
  decidedBy: z.string().nullable(),
  lastSeenAt: z.string().nullable(),
  /** The wards they may download; empty means every ward. */
  wardNos: z.array(z.number().int()).default([]),
});

export type AppUserAccess = z.infer<typeof appUserAccessSchema>;

export const appUserListSchema = z.object({
  requireLoginApproval: z.boolean(),
  limit: z.number().int(),
  approved: z.number().int(),
  users: z.array(appUserAccessSchema),
  /**
   * The constituency's wards with their voter counts. Not empty means it has
   * wards, and approving someone needs the wards they may see.
   */
  wards: z.array(z.object({ wardNo: z.number().int(), voters: z.number().int() })).default([]),
});

export type AppUserList = z.infer<typeof appUserListSchema>;

/** What an admin can do to an app user. Making admins is for the dashboard only. */
export const appUserActionSchema = z.enum([
  'approve',
  'remove',
  'allow',
  'make-admin',
  'unmake-admin',
  'set-wards',
  'make-mayor',
  'unmake-mayor',
]);

export type AppUserAction = z.infer<typeof appUserActionSchema>;

/**
 * The body of `approve`, `make-admin` and `set-wards`: the wards the user may
 * download. Empty means every ward. Required (for approve and make-admin too)
 * when the constituency has wards, so nobody is let in without the choice.
 */
export const appUserWardsRequestSchema = z.object({
  wardNos: z.array(z.coerce.number().int().min(0).max(9999)).max(1000).optional(),
});

export type AppUserWardsRequest = z.infer<typeof appUserWardsRequestSchema>;

/** Error codes the API answers with while a user may not use a constituency. */
export const APPROVAL_PENDING = 'APPROVAL_PENDING';
export const ACCESS_REMOVED = 'ACCESS_REMOVED';
export const LOGIN_LIMIT_REACHED = 'LOGIN_LIMIT_REACHED';
