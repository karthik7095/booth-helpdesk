import { prisma } from '../prisma.js';

/**
 * Voters added from the app get their own numbering space, well clear of the
 * imported roll.
 *
 * `srNo` on an imported row comes from the ECI sheet and is authoritative —
 * a voter enrolled on a phone is not a member of that sequence. Numbering them
 * into it caused all three of the symptoms seen in production: new rows
 * collided with parts imported later, a part with no roll yet started at 1 and
 * clashed head-on when its sheet arrived, and because the number is assigned at
 * push time rather than enrollment time the order never matched the order
 * agents actually added people.
 *
 * The largest real part roll is on the order of 1,600 rows, so 90,000 is far
 * enough above the sheets that the two ranges cannot meet.
 */
export const ENROLLMENT_SRNO_BASE = 90_000;

/** Collisions are re-read and retried; this bounds a pathological hot part. */
const MAX_ATTEMPTS = 5;

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** The next free number in the enrollment range for this part. */
async function nextSrNo(assemblyNo: number, partNo: number): Promise<number> {
  const last = await prisma.voter.findFirst({
    where: { assemblyNo, partNo, srNo: { gte: ENROLLMENT_SRNO_BASE } },
    orderBy: { srNo: 'desc' },
    select: { srNo: true },
  });

  return (last?.srNo ?? ENROLLMENT_SRNO_BASE) + 1;
}

/**
 * Picking a serial number is a read followed by a write, so two agents
 * enrolling into the same part at the same moment can choose the same one and
 * the unique index on (assemblyNo, partNo, srNo) rejects the loser. Re-read and
 * try again rather than handing an agent a failure for a collision they had no
 * way to see or avoid.
 */
export async function withEnrollmentSrNo<T>(
  assemblyNo: number,
  partNo: number,
  insert: (srNo: number) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const srNo = await nextSrNo(assemblyNo, partNo);

    try {
      return await insert(srNo);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      lastError = error;
    }
  }

  throw lastError;
}
