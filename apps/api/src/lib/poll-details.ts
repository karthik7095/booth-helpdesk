import type { PollDetails } from '@voter/shared';

type PollColumns = {
  electionTitle: string | null;
  pollDate: Date | null;
  pollTime: string | null;
};

/** The constituency's poll details as they cross the wire. */
export function pollDetailsOf(assembly: PollColumns) {
  return {
    electionTitle: assembly.electionTitle,
    // A @db.Date column comes back as midnight UTC, so the date part is exact.
    pollDate: assembly.pollDate?.toISOString().slice(0, 10) ?? null,
    pollTime: assembly.pollTime,
  };
}

/**
 * Prisma data for a parsed request. Fields left out of the request stay as they
 * are; fields sent as null are cleared.
 */
export function pollDetailsData(input: PollDetails) {
  return {
    ...(input.electionTitle !== undefined && { electionTitle: input.electionTitle }),
    ...(input.pollDate !== undefined && {
      pollDate: input.pollDate === null ? null : new Date(`${input.pollDate}T00:00:00Z`),
    }),
    ...(input.pollTime !== undefined && { pollTime: input.pollTime }),
  };
}
