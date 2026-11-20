import type {
  PrintLocation,
  PrintReport,
  VoterPrintSummary,
  WarRoomBooth,
  WarRoomPrint,
} from '@voter/shared';

import { Prisma } from '../generated/prisma/client.js';
import { namePrintPlaceLater } from './geocode.js';
import { joinedName } from './name-correction.js';
import { prisma } from '../prisma.js';
import { dateColumn, todayIst } from './usage.js';

function locationOf(row: {
  id: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  placeName: string | null;
}): PrintLocation | null {
  if (row.latitude === null || row.longitude === null) return null;

  // A fix whose lookup failed earlier gets another try; the next view shows it.
  if (!row.placeName) namePrintPlaceLater(row.id, row.latitude, row.longitude);

  return {
    latitude: row.latitude,
    longitude: row.longitude,
    accuracy: row.accuracy,
    placeName: row.placeName,
  };
}

/** How often each voter on a page of the roll has been printed, and by whom last. */
export async function voterPrintSummaries(
  voterIds: string[],
): Promise<Map<string, VoterPrintSummary>> {
  const summaries = new Map<string, VoterPrintSummary>();

  if (voterIds.length === 0) return summaries;

  const rows = await prisma.slipPrint.findMany({
    where: { voterId: { in: voterIds } },
    orderBy: { printedAt: 'desc' },
    include: { session: { select: { fullName: true, mobileNumber: true } } },
  });

  for (const row of rows) {
    const existing = summaries.get(row.voterId);

    if (existing) {
      existing.count += 1;
      continue;
    }

    // Newest first, so the first row seen for a voter is their latest print.
    summaries.set(row.voterId, {
      count: 1,
      last: {
        at: row.printedAt.toISOString(),
        method: row.method === 'dialog' ? 'dialog' : 'printer',
        by: {
          sessionId: row.sessionId,
          fullName: row.session.fullName,
          mobileNumber: row.session.mobileNumber,
        },
        location: locationOf(row),
      },
    });
  }

  return summaries;
}

/**
 * One booth in serial order with every slip printed for each voter, for the
 * dashboard's war room. A booth is about a thousand voters, so it is read whole.
 */
export async function warRoomBooth(assemblyId: string, partNo: number): Promise<WarRoomBooth> {
  const voters = await prisma.voter.findMany({
    where: { assemblyId, partNo },
    orderBy: [{ srNo: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      srNo: true,
      eFirstName: true,
      eLastName: true,
      lFirstName: true,
      lLastName: true,
      relationType: true,
      eMiddleName: true,
      lMiddleName: true,
      age: true,
      sex: true,
      houseNo: true,
      vcardId: true,
      mobileNo1: true,
      eBoothAddress: true,
    },
  });

  const prints = await prisma.slipPrint.findMany({
    where: { voterId: { in: voters.map((voter) => voter.id) } },
    orderBy: { printedAt: 'desc' },
    include: { session: { select: { fullName: true, mobileNumber: true } } },
  });

  const byVoter = new Map<string, WarRoomPrint[]>();

  for (const row of prints) {
    const list = byVoter.get(row.voterId) ?? [];

    list.push({
      at: row.printedAt.toISOString(),
      method: row.method === 'dialog' ? 'dialog' : 'printer',
      by: {
        sessionId: row.sessionId,
        fullName: row.session.fullName,
        mobileNumber: row.session.mobileNumber,
      },
      location: locationOf(row),
    });
    byVoter.set(row.voterId, list);
  }

  return {
    partNo,
    boothAddress: voters.find((voter) => voter.eBoothAddress)?.eBoothAddress ?? null,
    voters: voters.map((voter) => ({
      id: voter.id,
      srNo: voter.srNo,
      name: joinedName(voter.eFirstName, voter.eLastName) || null,
      localName: joinedName(voter.lFirstName, voter.lLastName) || null,
      relationType: voter.relationType,
      relativeName: voter.eMiddleName || voter.lMiddleName,
      age: voter.age,
      sex: voter.sex,
      houseNo: voter.houseNo,
      vcardId: voter.vcardId,
      mobileNo: voter.mobileNo1,
      prints: byVoter.get(voter.id) ?? [],
    })),
  };
}

/** Prints and distinct voters printed, per sign-in. */
export async function sessionPrintCounts(
  sessionIds: string[],
): Promise<Map<string, { prints: number; voters: number }>> {
  const counts = new Map<string, { prints: number; voters: number }>();

  if (sessionIds.length === 0) return counts;

  const rows = await prisma.$queryRaw<{ sessionId: string; prints: number; voters: number }[]>`
    SELECT session_id AS "sessionId",
           COUNT(*)::int AS prints,
           COUNT(DISTINCT voter_id)::int AS voters
    FROM slip_prints
    WHERE session_id IN (${Prisma.join(sessionIds)})
    GROUP BY session_id`;

  for (const row of rows) counts.set(row.sessionId, { prints: row.prints, voters: row.voters });

  return counts;
}

/** A constituency's printing: the totals, and one row per app user who printed. */
export async function printReport(assemblyId: string): Promise<PrintReport> {
  const [totals] = await prisma.$queryRaw<{ prints: number; voters: number; users: number }[]>`
    SELECT COUNT(*)::int AS prints,
           COUNT(DISTINCT voter_id)::int AS voters,
           COUNT(DISTINCT session_id)::int AS users
    FROM slip_prints
    WHERE assembly_id = ${assemblyId}`;

  const today = await prisma.slipPrint.count({
    where: { assemblyId, printedAt: { gte: dateColumn(todayIst()) } },
  });

  const users = await prisma.$queryRaw<
    {
      sessionId: string;
      fullName: string;
      mobileNumber: string;
      pinLabel: string | null;
      prints: number;
      voters: number;
      lastPrintedAt: Date;
    }[]
  >`
    SELECT p.session_id AS "sessionId",
           s.full_name AS "fullName",
           s.mobile_number AS "mobileNumber",
           a.label AS "pinLabel",
           COUNT(*)::int AS prints,
           COUNT(DISTINCT p.voter_id)::int AS voters,
           MAX(p.printed_at) AS "lastPrintedAt"
    FROM slip_prints p
    JOIN login_sessions s ON s.id = p.session_id
    LEFT JOIN access_pins a ON a.id = s.access_pin_id
    WHERE p.assembly_id = ${assemblyId}
    GROUP BY p.session_id, s.full_name, s.mobile_number, a.label
    ORDER BY prints DESC, "lastPrintedAt" DESC`;

  // Each user's latest print that carried a position.
  const located = await prisma.$queryRaw<
    {
      id: string;
      sessionId: string;
      latitude: number | null;
      longitude: number | null;
      accuracy: number | null;
      placeName: string | null;
    }[]
  >`
    SELECT DISTINCT ON (session_id)
           id, session_id AS "sessionId", latitude, longitude, accuracy, place_name AS "placeName"
    FROM slip_prints
    WHERE assembly_id = ${assemblyId} AND latitude IS NOT NULL
    ORDER BY session_id, printed_at DESC`;

  const lastLocation = new Map(located.map((row) => [row.sessionId, locationOf(row)]));

  const resets = await prisma.printReset.findMany({
    where: { assemblyId },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return {
    resets: resets.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      by: { name: row.adminName, email: row.adminEmail },
      prints: row.prints,
      voters: row.voters,
      users: row.users,
    })),
    totals: {
      prints: totals?.prints ?? 0,
      voters: totals?.voters ?? 0,
      users: totals?.users ?? 0,
      today,
    },
    users: users.map((row) => ({
      sessionId: row.sessionId,
      fullName: row.fullName,
      mobileNumber: row.mobileNumber,
      pinLabel: row.pinLabel,
      prints: row.prints,
      voters: row.voters,
      lastPrintedAt: row.lastPrintedAt.toISOString(),
      lastLocation: lastLocation.get(row.sessionId) ?? null,
    })),
  };
}
