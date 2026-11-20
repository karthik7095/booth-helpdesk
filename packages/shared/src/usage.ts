import { z } from 'zod';

/** ISO calendar date, e.g. "2026-09-23". */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-23');

/**
 * Sent by the app about once a minute while it is in the foreground. `seconds`
 * is the time used since the last heartbeat that reached the server, so time
 * spent offline is counted once the phone is back online.
 */
export const usageHeartbeatSchema = z.object({
  /** True on the first heartbeat after the app is opened or brought forward. */
  opened: z.boolean().default(false),
  seconds: z.number().int().min(0).max(6 * 60 * 60),
  /** Omitted when location permission is denied or no fix was available. */
  location: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      /** Metres. */
      accuracy: z.number().nonnegative().nullish(),
    })
    .nullish(),
});

export type UsageHeartbeat = z.input<typeof usageHeartbeatSchema>;

export const usageQuerySchema = z.object({
  /** Defaults to today, India time. */
  date: isoDate.optional(),
});

export const usageLocationSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  accuracy: z.number().nullable(),
  at: z.string(),
  /** e.g. "Banjara Hills, Hyderabad"; null until looked up, or if none found. */
  placeName: z.string().nullable(),
});

export type UsageLocation = z.infer<typeof usageLocationSchema>;

/** One person's use of the app on one day. A person is a mobile number. */
export const usageUserSchema = z.object({
  mobileNumber: z.string(),
  fullName: z.string(),
  assemblyName: z.string().nullable(),
  /** "Issued to" labels of the PINs they used that day. */
  pinLabels: z.array(z.string()),
  opens: z.number().int(),
  activeSeconds: z.number().int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  location: usageLocationSchema.nullable(),
});

export type UsageUser = z.infer<typeof usageUserSchema>;

export const usageReportSchema = z.object({
  date: isoDate,
  totals: z.object({
    users: z.number().int(),
    opens: z.number().int(),
    activeSeconds: z.number().int(),
    withLocation: z.number().int(),
  }),
  users: z.array(usageUserSchema),
});

export type UsageReport = z.infer<typeof usageReportSchema>;
