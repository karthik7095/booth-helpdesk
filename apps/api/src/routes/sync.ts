import { voterSearchText, type Access } from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import { gunzipSync } from 'node:zlib';

import { withEnrollmentSrNo } from '../lib/enrollment.js';
import { joinedName, nameCorrection } from '../lib/name-correction.js';
import { namePrintPlaceLater } from '../lib/geocode.js';
import { seedPageCache } from '../lib/seed-cache.js';
import { prisma } from '../prisma.js';

/** Every query is fenced to the constituency — and parts — the PIN covers. */
function scopeFor(access: Access) {
  return {
    assemblyNo: access.assemblyNo,
    ...(access.partNos.length > 0 ? { partNo: { in: access.partNos } } : {}),
    // The wards an admin let this user see when approving them.
    ...(access.wardNos.length > 0 ? { wardNo: { in: access.wardNos } } : {}),
  };
}

const SELECT = {
  id: true,
  assemblyNo: true,
  partNo: true,
  srNo: true,
  sectionNo: true,
  wardNo: true,
  eFirstName: true,
  eLastName: true,
  eFirstNameRoll: true,
  eMiddleName: true,
  lFirstName: true,
  lLastName: true,
  lMiddleName: true,
  relationType: true,
  sex: true,
  age: true,
  vcardId: true,
  houseNo: true,
  streetArea: true,
  lAddress: true,
  eAssemblyName: true,
  eVillage: true,
  eBoothAddress: true,
  mobileNo1: true,
  religion: true,
  community: true,
  subCategory: true,
  caste: true,
  partyLoyalty: true,
  hasVoted: true,
  isNewEnrollment: true,
  isFound: true,
  remark: true,
  remarkDone: true,
  remarkBy: true,
  remarkAt: true,
  isDeceased: true,
  deceasedBy: true,
  deceasedAt: true,
  updatedAt: true,
} as const;

type Row = {
  [K in keyof typeof SELECT]: K extends 'updatedAt'
    ? Date
    : K extends 'remarkAt' | 'deceasedAt'
      ? Date | null
    : K extends 'hasVoted' | 'isNewEnrollment' | 'isFound' | 'remarkDone' | 'isDeceased'
      ? boolean
      : K extends 'id'
        ? string
        : K extends 'assemblyNo' | 'partNo' | 'srNo'
          ? number
          : K extends 'age' | 'sectionNo' | 'wardNo'
            ? number | null
            : string | null;
};

/**
 * WatermelonDB's raw record shape: snake_case columns matching the app's
 * schema, and the server id used as the record id so both sides agree on
 * identity without a mapping table.
 */
function toRaw(row: Row) {
  return {
    id: row.id,
    assembly_no: row.assemblyNo,
    part_no: row.partNo,
    sr_no: row.srNo,
    section_no: row.sectionNo,
    ward_no: row.wardNo,
    e_first_name: row.eFirstName,
    e_last_name: row.eLastName,
    e_first_name_roll: row.eFirstNameRoll,
    e_middle_name: row.eMiddleName,
    l_first_name: row.lFirstName,
    l_last_name: row.lLastName,
    l_middle_name: row.lMiddleName,
    relation_type: row.relationType,
    sex: row.sex,
    age: row.age,
    vcard_id: row.vcardId,
    house_no: row.houseNo,
    street_area: row.streetArea,
    l_address: row.lAddress,
    e_assembly_name: row.eAssemblyName,
    e_village: row.eVillage,
    e_booth_address: row.eBoothAddress,
    mobile_no1: row.mobileNo1,
    religion: row.religion,
    community: row.community,
    sub_category: row.subCategory,
    caste: row.caste,
    party_loyalty: row.partyLoyalty,
    has_voted: row.hasVoted,
    is_new_enrollment: row.isNewEnrollment,
    is_found: row.isFound,
    remark: row.remark,
    remark_done: row.remarkDone,
    remark_by: row.remarkBy,
    remark_at: row.remarkAt?.getTime() ?? null,
    is_deceased: row.isDeceased,
    deceased_by: row.deceasedBy,
    deceased_at: row.deceasedAt?.getTime() ?? null,
    server_updated_at: row.updatedAt.getTime(),
    // Precomputed here so the phone's search is one LIKE per word, not ten.
    search_text: voterSearchText(row),
  };
}

// Bigger pages mean fewer round trips; at 10k the per-request overhead
// (query planning, TLS, gzip setup) is amortised without the response growing
// large enough to threaten the API's 320 MB heap.
const PAGE_SIZE = 10000;

type SeedPage = {
  rows: ReturnType<typeof toRaw>[];
  nextCursor: string | null;
  total?: number;
  rollVersion?: number;
  /** The wards this download covers, comma-separated; empty for all of them. */
  wardScope?: string;
  timestamp: number;
};

function acceptsGzip(header: string | string[] | undefined): boolean {
  return (Array.isArray(header) ? header.join(',') : (header ?? '')).toLowerCase().includes('gzip');
}

/** The constituency's roll version; 1 until the roll is first re-uploaded. */
async function rollVersionOf(assemblyNo: number): Promise<number> {
  const assembly = await prisma.assembly.findUnique({
    where: { assemblyNo },
    select: { rollVersion: true },
  });

  return assembly?.rollVersion ?? 1;
}

/** `<updatedAt ms>:<id>` of the last row of the previous pull page. */
function parsePullCursor(raw: string | undefined): { updatedAt: Date; id: string } | null {
  if (!raw) return null;

  const separator = raw.indexOf(':');
  const millis = Number(raw.slice(0, separator));
  const id = raw.slice(separator + 1);

  return separator > 0 && Number.isFinite(millis) && id ? { updatedAt: new Date(millis), id } : null;
}

export const syncRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAccess);

  /**
   * The first load: one page of the roll at a time. The phone inserts each
   * page and throws it away, so neither side ever holds 296k rows at once —
   * which is what ruled out WatermelonDB's turbo mode, where the whole payload
   * has to exist as a single JS string before native code can parse it.
   */
  app.get('/seed', async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string };
    const limit = Math.min(Number(query.limit) || PAGE_SIZE, PAGE_SIZE);
    const { assemblyNo, partNos, wardNos } = request.access;
    const cursor = query.cursor ?? '';

    const build = async (snapshotAt: number): Promise<SeedPage> => {
      const scope = scopeFor(request.access);
      const rows: Row[] = await prisma.voter.findMany({
        where: scope,
        select: SELECT,
        orderBy: { id: 'asc' },
        take: limit,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      return {
        rows: rows.map(toRaw),
        nextCursor: rows.length === limit ? rows[rows.length - 1]!.id : null,
        // Counting 296k rows on every page is wasted work; only the first needs it.
        total: cursor ? undefined : await prisma.voter.count({ where: scope }),
        // Remembered by the phone; a later pull with a different version means
        // the roll was re-uploaded and this download is stale.
        rollVersion: cursor ? undefined : await rollVersionOf(assemblyNo),
        // Remembered beside it: an admin changing this user's wards makes the
        // copy on the phone the wrong slice of the roll, to be downloaded again.
        wardScope: cursor ? undefined : wardNos.join(','),
        // The phone stores this as its sync watermark, so anything edited after
        // the snapshot this page belongs to is picked up by the first delta sync.
        timestamp: snapshotAt,
      };
    };

    // A PIN limited to some booths, or a user to some wards, is rare; their
    // pages are built to order. The shared cache holds the whole roll.
    if (partNos.length > 0 || wardNos.length > 0) return reply.send(await build(Date.now()));

    const rollVersion = await rollVersionOf(assemblyNo);
    const page = await seedPageCache.get(assemblyNo, rollVersion, limit, cursor, build);

    if (acceptsGzip(request.headers['accept-encoding'])) {
      return reply
        .header('content-type', 'application/json; charset=utf-8')
        .header('content-encoding', 'gzip')
        .send(page.gz);
    }

    return reply.header('content-type', 'application/json; charset=utf-8').send(gunzipSync(page.gz));
  });

  /**
   * WatermelonDB's pull: everything that changed since the phone last synced,
   * one page at a time. A bulk edit on the dashboard can touch more rows than
   * fit in one response, and a page that was simply cut off would leave the
   * rest unsynced for good once the phone moved its watermark past them. The
   * cursor is the last row's (updatedAt, id), so pages never overlap or skip.
   */
  app.get('/pull', async (request, reply) => {
    const query = request.query as { lastPulledAt?: string; cursor?: string };
    const lastPulledAt = Number(query.lastPulledAt);

    if (!query.lastPulledAt || !Number.isFinite(lastPulledAt)) {
      return reply.code(400).send({
        message: 'This device has no voter list yet — download it first.',
        code: 'SEED_REQUIRED',
      });
    }

    // Taken before the query so a row edited while the phone is still paging
    // is newer than the watermark and arrives on the next pull.
    const timestamp = Date.now();
    const since = new Date(lastPulledAt);
    const cursor = parsePullCursor(query.cursor);

    const rows: Row[] = await prisma.voter.findMany({
      where: {
        AND: [
          scopeFor(request.access),
          cursor
            ? {
                OR: [
                  { updatedAt: { gt: cursor.updatedAt } },
                  { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
                ],
              }
            : { updatedAt: { gt: since } },
        ],
      },
      select: SELECT,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: PAGE_SIZE,
    });

    const last = rows[rows.length - 1];

    // Everything the phone did not already have counts as an update: Watermelon
    // applies `updated` to a missing record by creating it. Slip prints only
    // ever travel up, so the phone gets none back.
    return {
      changes: {
        voters: { created: [], updated: rows.map(toRaw), deleted: [] },
        slip_prints: { created: [], updated: [], deleted: [] },
      },
      timestamp,
      rollVersion: await rollVersionOf(request.access.assemblyNo),
      wardScope: request.access.wardNos.join(','),
      nextCursor:
        rows.length === PAGE_SIZE && last ? `${last.updatedAt.getTime()}:${last.id}` : null,
    };
  });

  /** WatermelonDB's push: records the phone created or changed while offline. */
  app.post('/push', async (request, reply) => {
    type Raws = { created?: Record<string, unknown>[]; updated?: Record<string, unknown>[] };
    const body = request.body as { changes?: { voters?: Raws; slip_prints?: Raws } };

    const created = body.changes?.voters?.created ?? [];
    const updated = body.changes?.voters?.updated ?? [];
    const prints = [
      ...(body.changes?.slip_prints?.created ?? []),
      ...(body.changes?.slip_prints?.updated ?? []),
    ];
    const access = request.access;

    const allowed = (partNo: number) =>
      access.partNos.length === 0 || access.partNos.includes(partNo);

    // One bad row used to escape the loop and fail the whole push, which made
    // WatermelonDB discard the entire batch — unrelated edits included — and
    // retry the lot. Rows are attempted independently now; every upsert is
    // keyed on the record id and idempotent, so the rows that did land stay
    // landed and only the genuine failures are reported back.
    const failures: string[] = [];

    for (const raw of created) {
      const partNo = Number(raw.part_no);

      if (!allowed(partNo)) {
        return reply.code(403).send({ message: `Your PIN does not cover part ${partNo}.` });
      }

      const assembly = await prisma.assembly.findUnique({
        where: { assemblyNo: access.assemblyNo },
        select: { id: true, name: true },
      });

      try {
        await withEnrollmentSrNo(access.assemblyNo, partNo, (srNo) =>
          prisma.voter.upsert({
            where: { id: String(raw.id) },
            create: {
              id: String(raw.id),
              assemblyId: assembly?.id ?? null,
              assemblyNo: access.assemblyNo,
              eAssemblyName: access.assemblyName,
              partNo,
              srNo,
              eFirstName: (raw.e_first_name as string) ?? null,
              eLastName: (raw.e_last_name as string) ?? null,
              eMiddleName: (raw.e_middle_name as string) ?? null,
              lFirstName: (raw.l_first_name as string) ?? null,
              lLastName: (raw.l_last_name as string) ?? null,
              lMiddleName: (raw.l_middle_name as string) ?? null,
              relationType: (raw.relation_type as string) ?? null,
              sectionNo:
                raw.section_no === null || raw.section_no === undefined
                  ? null
                  : Number(raw.section_no),
              sex: (raw.sex as string) ?? null,
              age: raw.age === null || raw.age === undefined ? null : Number(raw.age),
              vcardId: (raw.vcard_id as string) ?? null,
              houseNo: (raw.house_no as string) ?? null,
              streetArea: (raw.street_area as string) ?? null,
              lAddress: (raw.l_address as string) ?? null,
              eVillage: (raw.e_village as string) ?? null,
              eBoothAddress: (raw.e_booth_address as string) ?? null,
              mobileNo1: (raw.mobile_no1 as string) ?? null,
              religion: (raw.religion as string) ?? null,
              community: (raw.community as string) ?? null,
              subCategory: (raw.sub_category as string) ?? null,
              caste: (raw.caste as string) ?? null,
              partyLoyalty: (raw.party_loyalty as string) ?? null,
              hasVoted: Boolean(raw.has_voted),
              isNewEnrollment: true,
            },
            // A retried push must not create the voter twice.
            update: {},
          }),
        );
      } catch (error) {
        request.log.error({ err: error, id: raw.id, partNo }, 'enrollment push failed');
        failures.push(String(raw.id));
      }
    }

    for (const raw of updated) {
      const existing = await prisma.voter.findUnique({
        where: { id: String(raw.id) },
        select: {
          partNo: true,
          assemblyNo: true,
          hasVoted: true,
          eFirstName: true,
          eLastName: true,
          eFirstNameRoll: true,
        },
      });

      if (!existing || existing.assemblyNo !== access.assemblyNo || !allowed(existing.partNo)) {
        return reply.code(403).send({ message: 'That voter is outside your PIN.' });
      }

      // Must cover every field of `voterPatchSchema`: anything an agent can
      // edit but this block omits is accepted, dropped, and then overwritten
      // on the phone by the next pull — a silent loss of their work.
      const hasVoted = Boolean(raw.has_voted);

      try {
        await prisma.voter.update({
          where: { id: String(raw.id) },
          data: {
            // Compared as a whole name, so a build that never edits it pushes
            // the same value back and nothing changes.
            ...nameCorrection(existing, joinedName(raw.e_first_name, raw.e_last_name)),
            eMiddleName: (raw.e_middle_name as string) ?? null,
            sex: (raw.sex as string) ?? null,
            age: raw.age === null || raw.age === undefined ? null : Number(raw.age),
            vcardId: (raw.vcard_id as string) ?? null,
            houseNo: (raw.house_no as string) ?? null,
            eVillage: (raw.e_village as string) ?? null,
            mobileNo1: (raw.mobile_no1 as string) ?? null,
            religion: (raw.religion as string) ?? null,
            community: (raw.community as string) ?? null,
            // Absent from pushes by builds that predate these columns; leave
            // the stored value alone rather than wiping it.
            ...('sub_category' in raw
              ? { subCategory: (raw.sub_category as string) ?? null }
              : {}),
            ...('caste' in raw ? { caste: (raw.caste as string) ?? null } : {}),
            ...('party_loyalty' in raw
              ? { partyLoyalty: (raw.party_loyalty as string) ?? null }
              : {}),
            // Found and the follow-up remark; absent from older builds' pushes.
            ...('is_found' in raw ? { isFound: Boolean(raw.is_found) } : {}),
            ...('remark' in raw
              ? {
                  remark: ((raw.remark as string | null) ?? '').trim() || null,
                  remarkDone: Boolean(raw.remark_done),
                  remarkBy: (raw.remark_by as string) ?? null,
                  remarkAt: raw.remark_at == null ? null : new Date(Number(raw.remark_at)),
                }
              : {}),
            // Deceased; absent from older builds' pushes, which leave it as it is.
            ...('is_deceased' in raw
              ? {
                  isDeceased: Boolean(raw.is_deceased),
                  deceasedBy: raw.is_deceased ? ((raw.deceased_by as string) ?? null) : null,
                  deceasedAt:
                    raw.is_deceased && raw.deceased_at != null ? new Date(Number(raw.deceased_at)) : null,
                }
              : {}),
            hasVoted,
            // Stamped only when the status actually flips, so re-pushing an
            // unrelated edit does not move the time or the agent who marked it.
            ...(hasVoted === existing.hasVoted
              ? {}
              : {
                  votedAt: hasVoted ? new Date() : null,
                  markedBySessionId: hasVoted ? request.session.sessionId : null,
                }),
          },
        });
      } catch (error) {
        request.log.error({ err: error, id: raw.id }, 'voter update push failed');
        failures.push(String(raw.id));
      }
    }

    if (prints.length > 0) {
      const pin = await prisma.accessPin.findUnique({
        where: { id: access.pinId },
        select: { assemblyId: true },
      });
      const sessionId = request.session.sessionId;

      // An admin's "reset print count" clears everything up to that moment. A
      // phone that printed before it but had no signal must not bring those
      // prints back now; it drops them itself once it sees the reset.
      const lastReset = await prisma.printReset.findFirst({
        where: { assembly: { assemblyNo: access.assemblyNo } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });
      const resetAt = lastReset?.createdAt.getTime() ?? 0;

      for (const raw of prints) {
        const id = String(raw.id);
        const voterId = String(raw.voter_id ?? '');
        const partNo = Number(raw.part_no);
        const printedAt = new Date(Number(raw.printed_at));
        const latitude = raw.latitude == null ? null : Number(raw.latitude);
        const longitude = raw.longitude == null ? null : Number(raw.longitude);

        // A print of a voter outside the PIN, or of one the server never had,
        // is dropped quietly: there is nothing to fix on the phone.
        const voter = await prisma.voter.findUnique({
          where: { id: voterId },
          select: { assemblyNo: true, partNo: true },
        });

        if (
          !voter ||
          voter.assemblyNo !== access.assemblyNo ||
          !allowed(voter.partNo) ||
          Number.isNaN(printedAt.getTime()) ||
          printedAt.getTime() < resetAt
        ) {
          continue;
        }

        try {
          // Keyed on the phone's id: a retried push must not count a slip twice.
          const saved = await prisma.slipPrint.upsert({
            where: { id },
            create: {
              id,
              voterId,
              sessionId,
              assemblyId: pin?.assemblyId ?? null,
              partNo: Number.isFinite(partNo) ? partNo : voter.partNo,
              method: raw.method === 'dialog' ? 'dialog' : 'printer',
              latitude,
              longitude,
              accuracy: raw.accuracy == null ? null : Number(raw.accuracy),
              printedAt,
            },
            update: {},
            select: { id: true, placeName: true },
          });

          if (latitude !== null && longitude !== null && !saved.placeName) {
            namePrintPlaceLater(saved.id, latitude, longitude);
          }
        } catch (error) {
          request.log.error({ err: error, id }, 'slip print push failed');
          failures.push(id);
        }
      }
    }

    // Reported rather than swallowed: a 2xx tells the phone every record synced,
    // so silently dropping one would lose an agent's work for good. The phone
    // retries the batch and the rows already written are no-ops.
    if (failures.length > 0) {
      return reply.code(409).send({
        message: `${failures.length} change${failures.length === 1 ? '' : 's'} could not be saved. They are still on your phone and will be sent again.`,
        ids: failures,
      });
    }

    return {};
  });
};
