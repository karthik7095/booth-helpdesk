import { AGE_BAND_SQL, ageSlices, type BoothStats, type BoothSummary, type StatSlice } from '@voter/shared';

import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../prisma.js';

/**
 * Booth-level aggregates. The roll has no nationality column, so the closest
 * equivalents it does carry — religion and community — are reported instead,
 * alongside gender.
 */
const UNKNOWN = 'Not recorded';

function normalise(rows: { key: string | null; count: bigint | number }[]): StatSlice[] {
  return rows
    .map((row) => ({
      label: row.key && row.key.trim() && row.key.trim().toUpperCase() !== 'NA'
        ? row.key.trim()
        : UNKNOWN,
      count: Number(row.count),
    }))
    .reduce<StatSlice[]>((merged, slice) => {
      const existing = merged.find((item) => item.label === slice.label);

      if (existing) existing.count += slice.count;
      else merged.push(slice);

      return merged;
    }, [])
    .sort((a, b) => b.count - a.count);
}

export async function listBooths(assemblyId: string): Promise<BoothSummary[]> {
  const rows = await prisma.$queryRaw<
    {
      part_no: number;
      total: bigint;
      voted: bigint;
      printed: bigint;
      voted_printed: bigint;
      male: bigint;
      female: bigint;
      booth: string | null;
      village: string | null;
    }[]
  >`
    SELECT part_no,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE has_voted) AS voted,
           COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM slip_prints p WHERE p.voter_id = voters.id)) AS printed,
           COUNT(*) FILTER (WHERE has_voted AND EXISTS (SELECT 1 FROM slip_prints p WHERE p.voter_id = voters.id)) AS voted_printed,
           COUNT(*) FILTER (WHERE upper(sex) LIKE 'M%') AS male,
           COUNT(*) FILTER (WHERE upper(sex) LIKE 'F%') AS female,
           MAX(e_boothaddress) AS booth,
           MAX(e_village) AS village
    FROM voters
    WHERE assembly_id = ${assemblyId}
    GROUP BY part_no
    ORDER BY part_no
  `;

  return rows.map((row) => ({
    partNo: row.part_no,
    total: Number(row.total),
    voted: Number(row.voted),
    printed: Number(row.printed),
    votedPrinted: Number(row.voted_printed),
    male: Number(row.male),
    female: Number(row.female),
    boothAddress: row.booth,
    village: row.village,
  }));
}

export async function boothStats(assemblyId: string, partNo: number): Promise<BoothStats> {
  const [gender, age, religion, community, total] = await Promise.all([
    prisma.$queryRaw<{ key: string | null; count: bigint }[]>`
      SELECT CASE WHEN upper(sex) LIKE 'M%' THEN 'Male'
                  WHEN upper(sex) LIKE 'F%' THEN 'Female'
                  ELSE sex END AS key,
             COUNT(*) AS count
      FROM voters WHERE assembly_id = ${assemblyId} AND part_no = ${partNo}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ label: string | null; count: bigint }[]>`
      SELECT ${Prisma.raw(AGE_BAND_SQL)} AS label, COUNT(*) AS count
      FROM voters WHERE assembly_id = ${assemblyId} AND part_no = ${partNo}
      GROUP BY 1`,
    prisma.$queryRaw<{ key: string | null; count: bigint }[]>`
      SELECT religion AS key, COUNT(*) AS count
      FROM voters WHERE assembly_id = ${assemblyId} AND part_no = ${partNo}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    prisma.$queryRaw<{ key: string | null; count: bigint }[]>`
      SELECT community AS key, COUNT(*) AS count
      FROM voters WHERE assembly_id = ${assemblyId} AND part_no = ${partNo}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 12`,
    prisma.voter.count({ where: { assemblyId, partNo } }),
  ]);

  return {
    partNo,
    total,
    gender: normalise(gender),
    age: ageSlices(age),
    religion: normalise(religion),
    community: normalise(community),
  };
}
