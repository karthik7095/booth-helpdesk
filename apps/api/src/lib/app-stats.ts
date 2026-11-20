import type { AppStats, AppStatsQuery, StatsBreakdownRow } from '@voter/shared';

import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../prisma.js';

/** "M", "Male", "F", "Female" and blanks all appear in the rolls. */
const SEX = Prisma.sql`CASE upper(left(trim(coalesce(v.sex, '')), 1))
  WHEN 'M' THEN 'M' WHEN 'F' THEN 'F' ELSE 'O' END`;

const AGE_GROUP = Prisma.sql`CASE
  WHEN v.age IS NULL THEN 'Unknown'
  WHEN v.age <= 25 THEN '18-25'
  WHEN v.age <= 35 THEN '26-35'
  WHEN v.age <= 45 THEN '36-45'
  WHEN v.age <= 60 THEN '46-60'
  ELSE '60+' END`;

const AGE_RANGES: Record<NonNullable<AppStatsQuery['ageGroup']>, [number, number]> = {
  '18-25': [0, 25],
  '26-35': [26, 35],
  '36-45': [36, 45],
  '46-60': [46, 60],
  '60+': [61, 1000],
};

/** Timestamps are stored in UTC; the range is whole days in India time. */
const IST_HOUR = (column: Prisma.Sql) =>
  Prisma.sql`extract(hour from (${column} + interval '5 hours 30 minutes'))::int`;

function nextDay(isoDate: string) {
  const day = new Date(`${isoDate}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

function voterConditions(query: AppStatsQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];

  if (query.assemblyNo) conditions.push(Prisma.sql`v.assembly_no = ${query.assemblyNo}`);
  if (query.assemblyNo && query.partNo) conditions.push(Prisma.sql`v.part_no = ${query.partNo}`);
  if (query.sex) conditions.push(Prisma.sql`${SEX} = ${query.sex}`);
  if (query.ageGroup) {
    const [min, max] = AGE_RANGES[query.ageGroup];
    conditions.push(Prisma.sql`v.age BETWEEN ${min} AND ${max}`);
  }
  if (query.community) {
    conditions.push(Prisma.sql`upper(trim(v.community)) = upper(${query.community})`);
  }
  if (query.voted === 'voted') conditions.push(Prisma.sql`v.has_voted`);
  if (query.voted === 'not_voted') conditions.push(Prisma.sql`NOT v.has_voted`);

  return Prisma.join(conditions, ' AND ');
}

/** `column` within the date range, or TRUE when no range is set. */
function inRange(column: Prisma.Sql, query: AppStatsQuery): Prisma.Sql {
  const conditions: Prisma.Sql[] = [Prisma.sql`TRUE`];

  if (query.from) conditions.push(Prisma.sql`${column} >= ${new Date(`${query.from}T00:00:00+05:30`)}`);
  if (query.to) conditions.push(Prisma.sql`${column} < ${new Date(`${nextDay(query.to)}T00:00:00+05:30`)}`);

  return Prisma.join(conditions, ' AND ');
}

const breakdown = (rows: { key: string | null; voters: number; voted: number }[]): StatsBreakdownRow[] =>
  rows.map((row) => ({ key: row.key ?? 'Unknown', voters: row.voters, voted: row.voted }));

export async function appStats(query: AppStatsQuery): Promise<AppStats> {
  const where = voterConditions(query);
  const printed = inRange(Prisma.sql`p.printed_at`, query);
  const marked = inRange(Prisma.sql`v.voted_at`, query);
  const byBooth = Boolean(query.assemblyNo);
  const area = byBooth ? Prisma.sql`v.part_no` : Prisma.sql`v.assembly_no`;

  const assemblyFilter = query.assemblyNo
    ? Prisma.sql`a.assembly_no = ${query.assemblyNo}`
    : Prisma.sql`TRUE`;
  const pinBoothFilter =
    query.assemblyNo && query.partNo
      ? Prisma.sql`(cardinality(ap.part_nos) = 0 OR ${query.partNo} = ANY(ap.part_nos))`
      : Prisma.sql`TRUE`;
  const usageFilter = Prisma.join(
    [
      Prisma.sql`TRUE`,
      ...(query.from ? [Prisma.sql`d.date >= ${new Date(`${query.from}T00:00:00Z`)}`] : []),
      ...(query.to ? [Prisma.sql`d.date <= ${new Date(`${query.to}T00:00:00Z`)}`] : []),
    ],
    ' AND ',
  );

  const [
    [voterTotals],
    [printTotals],
    [people],
    voterAreas,
    printAreas,
    gender,
    ages,
    communities,
    printMethods,
    votedHours,
    printHours,
    agents,
  ] = await Promise.all([
    prisma.$queryRaw<
      {
        voters: number;
        voted: number;
        deceased: number;
        withMobile: number;
        withCommunity: number;
        votedInPeriod: number;
      }[]
    >`
      SELECT COUNT(*)::int AS voters,
             COUNT(*) FILTER (WHERE v.has_voted)::int AS voted,
             COUNT(*) FILTER (WHERE v.is_deceased)::int AS deceased,
             COUNT(*) FILTER (WHERE length(trim(coalesce(v.mobile_no1, ''))) >= 10)::int AS "withMobile",
             COUNT(*) FILTER (WHERE trim(coalesce(v.community, '')) <> '')::int AS "withCommunity",
             COUNT(*) FILTER (WHERE v.has_voted AND ${marked})::int AS "votedInPeriod"
      FROM voters v WHERE ${where}`,
    prisma.$queryRaw<{ prints: number; printedVoters: number }[]>`
      SELECT COUNT(*)::int AS prints, COUNT(DISTINCT p.voter_id)::int AS "printedVoters"
      FROM slip_prints p JOIN voters v ON v.id = p.voter_id
      WHERE ${where} AND ${printed}`,
    prisma.$queryRaw<{ appUsers: number; activePins: number }[]>`
      SELECT
        (SELECT COUNT(DISTINCT d.session_id)::int FROM app_usage_days d
           JOIN assemblies a ON a.id = d.assembly_id
           WHERE ${assemblyFilter} AND ${usageFilter}) AS "appUsers",
        (SELECT COUNT(*)::int FROM access_pins ap JOIN assemblies a ON a.id = ap.assembly_id
           WHERE ap.is_active AND ${assemblyFilter} AND ${pinBoothFilter}) AS "activePins"`,
    prisma.$queryRaw<{ no: number; name: string | null; voters: number; voted: number; deceased: number }[]>`
      SELECT ${area} AS no,
             ${byBooth ? Prisma.sql`max(coalesce(nullif(trim(v.e_village), ''), v.e_boothaddress))` : Prisma.sql`max(a.e_assemblyname)`} AS name,
             COUNT(*)::int AS voters,
             COUNT(*) FILTER (WHERE v.has_voted)::int AS voted,
             COUNT(*) FILTER (WHERE v.is_deceased)::int AS deceased
      FROM voters v LEFT JOIN assemblies a ON a.assembly_no = v.assembly_no
      WHERE ${where} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ no: number; prints: number; printedVoters: number }[]>`
      SELECT ${area} AS no, COUNT(*)::int AS prints, COUNT(DISTINCT p.voter_id)::int AS "printedVoters"
      FROM slip_prints p JOIN voters v ON v.id = p.voter_id
      WHERE ${where} AND ${printed} GROUP BY 1`,
    prisma.$queryRaw<{ key: string; voters: number; voted: number }[]>`
      SELECT ${SEX} AS key, COUNT(*)::int AS voters, COUNT(*) FILTER (WHERE v.has_voted)::int AS voted
      FROM voters v WHERE ${where} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ key: string; voters: number; voted: number }[]>`
      SELECT ${AGE_GROUP} AS key, COUNT(*)::int AS voters, COUNT(*) FILTER (WHERE v.has_voted)::int AS voted
      FROM voters v WHERE ${where} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ key: string | null; voters: number; voted: number }[]>`
      SELECT nullif(upper(trim(v.community)), '') AS key, COUNT(*)::int AS voters,
             COUNT(*) FILTER (WHERE v.has_voted)::int AS voted
      FROM voters v WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ key: string; prints: number }[]>`
      SELECT p.method AS key, COUNT(*)::int AS prints
      FROM slip_prints p JOIN voters v ON v.id = p.voter_id
      WHERE ${where} AND ${printed} GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ hour: number; count: number }[]>`
      SELECT ${IST_HOUR(Prisma.sql`v.voted_at`)} AS hour, COUNT(*)::int AS count
      FROM voters v WHERE ${where} AND v.has_voted AND v.voted_at IS NOT NULL AND ${marked}
      GROUP BY 1`,
    prisma.$queryRaw<{ hour: number; count: number }[]>`
      SELECT ${IST_HOUR(Prisma.sql`p.printed_at`)} AS hour, COUNT(*)::int AS count
      FROM slip_prints p JOIN voters v ON v.id = p.voter_id
      WHERE ${where} AND ${printed} GROUP BY 1`,
    prisma.$queryRaw<
      {
        sessionId: string;
        fullName: string;
        mobileNumber: string;
        assemblyName: string | null;
        votedMarks: number;
        prints: number;
      }[]
    >`
      WITH marks AS (
        SELECT v.marked_by_session_id AS session_id, COUNT(*)::int AS n
        FROM voters v
        WHERE ${where} AND v.has_voted AND v.marked_by_session_id IS NOT NULL AND ${marked}
        GROUP BY 1
      ), prints AS (
        SELECT p.session_id, COUNT(*)::int AS n
        FROM slip_prints p JOIN voters v ON v.id = p.voter_id
        WHERE ${where} AND ${printed}
        GROUP BY 1
      )
      SELECT s.id AS "sessionId", s.full_name AS "fullName", s.mobile_number AS "mobileNumber",
             a.e_assemblyname AS "assemblyName",
             coalesce(m.n, 0)::int AS "votedMarks", coalesce(pr.n, 0)::int AS prints
      FROM login_sessions s
      LEFT JOIN marks m ON m.session_id = s.id
      LEFT JOIN prints pr ON pr.session_id = s.id
      LEFT JOIN access_pins ap ON ap.id = s.access_pin_id
      LEFT JOIN assemblies a ON a.id = ap.assembly_id
      WHERE m.n IS NOT NULL OR pr.n IS NOT NULL
      ORDER BY coalesce(m.n, 0) + coalesce(pr.n, 0) DESC
      LIMIT 50`,
  ]);

  const printsByArea = new Map(printAreas.map((row) => [row.no, row]));
  const votedByHour = new Map(votedHours.map((row) => [row.hour, row.count]));
  const printsByHour = new Map(printHours.map((row) => [row.hour, row.count]));

  return {
    totals: { ...voterTotals!, ...printTotals!, ...people! },
    areas: voterAreas.map((row) => ({
      no: row.no,
      name: row.name ?? (byBooth ? `Booth ${row.no}` : `Constituency ${row.no}`),
      voters: row.voters,
      voted: row.voted,
      deceased: row.deceased,
      prints: printsByArea.get(row.no)?.prints ?? 0,
      printedVoters: printsByArea.get(row.no)?.printedVoters ?? 0,
    })),
    gender: breakdown(gender),
    ages: breakdown(ages),
    communities: breakdown(communities),
    printMethods,
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      votedMarks: votedByHour.get(hour) ?? 0,
      prints: printsByHour.get(hour) ?? 0,
    })),
    agents,
  };
}
