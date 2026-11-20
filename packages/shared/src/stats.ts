import { z } from 'zod';

/** ISO calendar date, e.g. "2026-09-23". */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-23');

export const AGE_GROUPS = ['18-25', '26-35', '36-45', '46-60', '60+'] as const;

/**
 * Filters for the super admin's Stats page. Voter filters (constituency,
 * booth, gender, age, community, voted) narrow every figure; the date range
 * narrows only activity — prints, voted marks and app use — in India time.
 */
export const appStatsQuerySchema = z.object({
  assemblyNo: z.coerce.number().int().positive().optional(),
  partNo: z.coerce.number().int().positive().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  sex: z.enum(['M', 'F', 'O']).optional(),
  ageGroup: z.enum(AGE_GROUPS).optional(),
  community: z.string().trim().min(1).max(60).optional(),
  voted: z.enum(['voted', 'not_voted']).optional(),
});

export type AppStatsQuery = z.infer<typeof appStatsQuerySchema>;

export type StatsBreakdownRow = { key: string; voters: number; voted: number };

export type StatsAreaRow = {
  /** Constituency number, or booth number when one constituency is picked. */
  no: number;
  name: string;
  voters: number;
  voted: number;
  deceased: number;
  printedVoters: number;
  prints: number;
};

export type StatsAgentRow = {
  sessionId: string;
  fullName: string;
  mobileNumber: string;
  assemblyName: string | null;
  votedMarks: number;
  prints: number;
};

export type AppStats = {
  totals: {
    voters: number;
    voted: number;
    deceased: number;
    withMobile: number;
    withCommunity: number;
    printedVoters: number;
    prints: number;
    votedInPeriod: number;
    appUsers: number;
    activePins: number;
  };
  /** Per constituency, or per booth when one constituency is picked. */
  areas: StatsAreaRow[];
  gender: StatsBreakdownRow[];
  ages: StatsBreakdownRow[];
  communities: StatsBreakdownRow[];
  printMethods: { key: string; prints: number }[];
  /** Hour of day in India time, 0–23, across the date range. */
  hourly: { hour: number; votedMarks: number; prints: number }[];
  agents: StatsAgentRow[];
};
