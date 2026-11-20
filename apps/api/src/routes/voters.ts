import {
  downloadQuerySchema,
  markVotedRequestSchema,
  syncRequestSchema,
  uploadUserSlipCoverRequestSchema,
  appUserActionSchema,
  appUserWardsRequestSchema,
  uploadWardPrintBannerRequestSchema,
  updatePanchayatSlipRequestSchema,
  updateWardCandidateRequestSchema,
  uploadSymbolRequestSchema,
  voterListQuerySchema,
  voterPatchSchema,
  voterSchema,
  type DownloadResponse,
  type SyncResponse,
  type UserSlipCoverList,
  type WardList,
  type WardPrintBannerSaved,
  type Voter,
  type VoterListResponse,
  type VoterSummary,
} from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { Access } from '@voter/shared';
import { readBanner } from '../lib/banner.js';
import { boothStats, listBooths } from '../lib/booth-stats.js';
import { withEnrollmentSrNo } from '../lib/enrollment.js';
import { nameCorrection } from '../lib/name-correction.js';
import {
  deleteUserSlipCover,
  listUserSlipCovers,
  readUserSlipCover,
  saveUserSlipCover,
  SlipCoverError,
} from '../lib/user-slip-cover.js';
import { voterSearchClauses } from '../lib/voter-filter.js';
import { actOnAppUser, AppUserError, isAppAdmin, listAppUsers, isMayorOf } from '../lib/app-user-access.js';
import {
  deleteSarpanchSymbol,
  deleteTopImage,
  deleteWardSymbol,
  getPanchayatSlip,
  readSarpanchSymbol,
  readTopImage,
  readWardSymbol,
  saveSarpanchSymbol,
  saveTopImage,
  saveWardSymbol,
  SymbolError,
  updatePanchayatSlip,
  updateWardCandidate,
} from '../lib/panchayat-slip.js';
import {
  deleteWardPrintBanner,
  listWards,
  readWardPrintBanner,
  saveWardPrintBanner,
  WardBannerError,
  wardExists,
} from '../lib/ward-banners.js';
import { packFile, packsFor } from '../lib/voter-photos.js';
import { prisma } from '../prisma.js';

/**
 * Every query is fenced to the constituency the PIN was issued for, and to the
 * specific parts when the PIN names them.
 */
function scopeFor(access: Access) {
  return {
    assemblyNo: access.assemblyNo,
    ...(access.partNos.length > 0 ? { partNo: { in: access.partNos } } : {}),
    // The wards an admin let this user see when approving them.
    ...(access.wardNos.length > 0 ? { wardNo: { in: access.wardNos } } : {}),
  };
}

function toVoter(row: {
  id: string;
  assemblyNo: number;
  partNo: number;
  srNo: number;
  eFirstName: string | null;
  eMiddleName: string | null;
  lFirstName: string | null;
  lMiddleName: string | null;
  sex: string | null;
  age: number | null;
  vcardId: string | null;
  houseNo: string | null;
  lAddress: string | null;
  eAssemblyName: string | null;
  eVillage: string | null;
  eBoothAddress: string | null;
  mobileNo1: string | null;
  religion: string | null;
  community: string | null;
  subCategory: string | null;
  caste: string | null;
  partyLoyalty: string | null;
  hasVoted: boolean;
  isNewEnrollment: boolean;
  updatedAt: Date;
}): Voter {
  return voterSchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() });
}

export const voterRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAccess);

  app.get('/', async (request, reply) => {
    const parsed = voterListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters.', issues: parsed.error.issues });
    }

    const { assemblyNo, partNo, search, houseNo, hasVoted, limit, offset } = parsed.data;

    const where = {
      AND: [
        scopeFor(request.access),
        ...(assemblyNo === undefined ? [] : [{ assemblyNo }]),
        ...(partNo === undefined ? [] : [{ partNo }]),
        ...(houseNo === undefined ? [] : [{ houseNo: { equals: houseNo, mode: 'insensitive' as const } }]),
        ...(hasVoted === undefined ? [] : [{ hasVoted }]),
        ...voterSearchClauses(search),
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.voter.findMany({
        where,
        orderBy: [{ assemblyNo: 'asc' }, { partNo: 'asc' }, { srNo: 'asc' }],
        take: limit,
        skip: offset,
      }),
      prisma.voter.count({ where }),
    ]);

    const response: VoterListResponse = { voters: rows.map(toVoter), total };

    return response;
  });

  /**
   * The PIN's booths with headline counts, for clients that keep no copy of
   * the roll (the web app); the phone works these out from its own.
   */
  app.get('/booths', async (request) => {
    const { access } = request;
    const assembly = await prisma.assembly.findUnique({
      where: { assemblyNo: access.assemblyNo },
      select: { id: true },
    });

    if (!assembly) return [];

    const booths = await listBooths(assembly.id);

    return access.partNos.length ? booths.filter((booth) => access.partNos.includes(booth.partNo)) : booths;
  });

  /** Gender, age, religion and community breakdowns for one of the PIN's booths. */
  app.get('/booths/:partNo', async (request, reply) => {
    const { access } = request;
    const partNo = Number.parseInt((request.params as { partNo: string }).partNo, 10);

    if (!Number.isFinite(partNo) || (access.partNos.length > 0 && !access.partNos.includes(partNo))) {
      return reply.code(404).send({ message: 'That booth is not on your PIN.' });
    }

    const assembly = await prisma.assembly.findUnique({
      where: { assemblyNo: access.assemblyNo },
      select: { id: true },
    });

    if (!assembly) return reply.code(404).send({ message: 'That constituency does not exist.' });

    return boothStats(assembly.id, partNo);
  });

  /**
   * Slip prints from every phone, for bulk printing: how many voters of each
   * booth have been printed, and with a booth, how many times each voter.
   */
  app.get('/prints', async (request) => {
    const { access } = request;
    const rows = await prisma.$queryRaw<{ part_no: number; voters: bigint }[]>`
      SELECT v.part_no, COUNT(DISTINCT p.voter_id) AS voters
      FROM slip_prints p JOIN voters v ON v.id = p.voter_id
      WHERE v.assembly_no = ${access.assemblyNo}
      GROUP BY v.part_no`;

    const booths: Record<string, number> = {};

    for (const row of rows) {
      if (access.partNos.length === 0 || access.partNos.includes(row.part_no)) {
        booths[String(row.part_no)] = Number(row.voters);
      }
    }

    return { booths };
  });

  app.get('/booths/:partNo/prints', async (request, reply) => {
    const { access } = request;
    const partNo = Number.parseInt((request.params as { partNo: string }).partNo, 10);

    if (!Number.isFinite(partNo) || (access.partNos.length > 0 && !access.partNos.includes(partNo))) {
      return reply.code(404).send({ message: 'That booth is not on your PIN.' });
    }

    const rows = await prisma.slipPrint.groupBy({
      by: ['voterId'],
      where: { voter: { assemblyNo: access.assemblyNo, partNo } },
      _count: { _all: true },
    });

    return { prints: Object.fromEntries(rows.map((row) => [row.voterId, row._count._all])) };
  });

  /** The constituency banner for the signed-in PIN, cached on the device. */
  app.get('/banner', async (request, reply) => {
    const assembly = await prisma.assembly.findUnique({
      where: { assemblyNo: request.access.assemblyNo },
      select: { id: true },
    });

    const banner = assembly ? await readBanner(assembly.id) : null;

    if (!banner) return reply.code(404).send({ message: 'No banner for this constituency.' });

    return reply
      .header('content-type', banner.mime)
      .header('last-modified', banner.updatedAt.toUTCString())
      .send(banner.body);
  });

  for (const [route, kind, label] of [
    ['slip-image', 'slip', 'slip image'],
    ['whatsapp-image', 'whatsapp', 'WhatsApp image'],
  ] as const) {
    app.get(`/${route}`, async (request, reply) => {
      const assembly = await prisma.assembly.findUnique({
        where: { assemblyNo: request.access.assemblyNo },
        select: { id: true },
      });

      const image = assembly ? await readBanner(assembly.id, kind) : null;

      if (!image) return reply.code(404).send({ message: `No ${label} for this constituency.` });

      return reply
        .header('content-type', image.mime)
        .header('last-modified', image.updatedAt.toUTCString())
        .send(image.body);
    });
  }

  /**
   * The signed-in user's own slip covers (slots 1 and 2), where the
   * constituency allows them. Keyed on the mobile number, so they follow the
   * user to a new phone.
   */
  const coverSlot = (raw: string) => (raw === '1' ? 1 : raw === '2' ? 2 : null);
  const coverAssemblyId = async (assemblyNo: number) =>
    (await prisma.assembly.findUnique({ where: { assemblyNo }, select: { id: true } }))?.id ?? null;

  app.get('/my-slip-covers', async (request) => {
    const assemblyId = await coverAssemblyId(request.access.assemblyNo);
    const response: UserSlipCoverList = {
      covers:
        assemblyId && request.access.allowUserSlipCovers
          ? await listUserSlipCovers(assemblyId, request.session.mobileNumber)
          : [],
    };

    return response;
  });

  app.get('/my-slip-covers/:slot', async (request, reply) => {
    const slot = coverSlot((request.params as { slot: string }).slot);
    const assemblyId = await coverAssemblyId(request.access.assemblyNo);
    const image =
      slot && assemblyId ? await readUserSlipCover(assemblyId, request.session.mobileNumber, slot) : null;

    if (!image) return reply.code(404).send({ message: 'No slip cover in that slot.' });

    return reply
      .header('content-type', image.mime)
      .header('last-modified', image.updatedAt.toUTCString())
      .send(image.body);
  });

  // 1 MB of image is about 1.4 MB as base64.
  app.put('/my-slip-covers/:slot', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    if (!request.access.allowUserSlipCovers) {
      return reply.code(403).send({ message: 'Own slip covers are not switched on for this constituency.' });
    }

    const slot = coverSlot((request.params as { slot: string }).slot);
    const parsed = uploadUserSlipCoverRequestSchema.safeParse(request.body);

    if (!slot || !parsed.success) return reply.code(400).send({ message: 'Choose cover 1 or 2 and an image.' });

    const assemblyId = await coverAssemblyId(request.access.assemblyNo);

    if (!assemblyId) return reply.code(404).send({ message: 'That constituency does not exist.' });

    try {
      return await saveUserSlipCover(assemblyId, request.session.mobileNumber, slot, parsed.data.image);
    } catch (error) {
      if (error instanceof SlipCoverError) return reply.code(400).send({ message: error.message });
      throw error;
    }
  });

  app.delete('/my-slip-covers/:slot', async (request, reply) => {
    const slot = coverSlot((request.params as { slot: string }).slot);
    const assemblyId = await coverAssemblyId(request.access.assemblyNo);

    if (!slot || !assemblyId) return reply.code(400).send({ message: 'Choose cover 1 or 2.' });

    await deleteUserSlipCover(assemblyId, request.session.mobileNumber, slot);

    return reply.code(204).send();
  });

  /**
   * Gram panchayat wards and their slip print banners. Each ward has its own
   * candidates and symbols, so its slips print its own banner. Anyone holding
   * the panchayat's PIN may set one (the panchayat decided that, rather than
   * routing every change through an admin); the last uploader is recorded.
   * An assembly constituency has no wards: the list is empty and the rest 404.
   */
  const wardParam = (raw: string) => {
    const wardNo = Number.parseInt(raw, 10);

    return Number.isInteger(wardNo) && wardNo > 0 && wardNo < 10_000 ? wardNo : null;
  };
  const panchayatOf = async (assemblyNo: number) =>
    prisma.assembly.findFirst({ where: { assemblyNo, isPanchayat: true }, select: { id: true } });

  app.get('/wards', async (request) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);
    const response: WardList = {
      wards: panchayat
        ? await listWards(panchayat.id, request.access.assemblyNo, request.access.partNos, request.access.wardNos)
        : [],
    };

    return response;
  });

  app.get('/wards/:wardNo/print-banner', async (request, reply) => {
    const wardNo = wardParam((request.params as { wardNo: string }).wardNo);
    const panchayat = await panchayatOf(request.access.assemblyNo);
    const image = wardNo && panchayat ? await readWardPrintBanner(panchayat.id, wardNo) : null;

    if (!image) return reply.code(404).send({ message: 'That ward has no print banner.' });

    return reply
      .header('content-type', image.mime)
      .header('last-modified', image.updatedAt.toUTCString())
      .send(image.body);
  });

  // 1 MB of image is about 1.4 MB as base64.
  app.put('/wards/:wardNo/print-banner', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const wardNo = wardParam((request.params as { wardNo: string }).wardNo);
    const parsed = uploadWardPrintBannerRequestSchema.safeParse(request.body);

    if (!wardNo || !parsed.success) return reply.code(400).send({ message: 'Choose a ward and an image.' });

    const panchayat = await panchayatOf(request.access.assemblyNo);

    if (!panchayat) {
      return reply.code(403).send({ message: 'Ward print banners are only for gram panchayats.' });
    }

    if (!(await wardExists(request.access.assemblyNo, wardNo))) {
      return reply.code(404).send({ message: `Ward ${wardNo} is not on this panchayat's roll.` });
    }

    try {
      const saved = await saveWardPrintBanner(panchayat.id, wardNo, parsed.data.image, {
        name: request.session.fullName,
        mobile: request.session.mobileNumber,
      });

      request.log.info({ wardNo, by: request.session.mobileNumber }, 'ward print banner replaced');

      const response: WardPrintBannerSaved = { wardNo, printBannerUpdatedAt: saved.updatedAt.toISOString() };

      return response;
    } catch (error) {
      if (error instanceof WardBannerError) return reply.code(400).send({ message: error.message });
      throw error;
    }
  });

  app.delete('/wards/:wardNo/print-banner', async (request, reply) => {
    const wardNo = wardParam((request.params as { wardNo: string }).wardNo);
    const panchayat = await panchayatOf(request.access.assemblyNo);

    if (!wardNo || !panchayat) return reply.code(400).send({ message: 'Choose a ward.' });

    await deleteWardPrintBanner(panchayat.id, wardNo);
    request.log.info({ wardNo, by: request.session.mobileNumber }, 'ward print banner removed');

    return reply.code(204).send();
  });

  /**
   * The panchayat slip header's typed parts and symbols: the heading and
   * tagline, the Sarpanch candidate, and each ward's member candidate. The
   * phone draws each ward's header from these and saves it as that ward's
   * print banner (above). Same rule: anyone holding the panchayat's PIN.
   */
  const editor = (request: { session: { fullName: string; mobileNumber: string } }) => ({
    name: request.session.fullName,
    mobile: request.session.mobileNumber,
  });
  const sendImage = (reply: import('fastify').FastifyReply, image: { body: Buffer; mime: string } | null) =>
    image
      ? reply.header('content-type', image.mime).header('cache-control', 'no-store').send(image.body)
      : reply.code(404).send({ message: 'No symbol uploaded.' });
  const symbolFailed = (reply: import('fastify').FastifyReply, error: unknown) => {
    if (error instanceof SymbolError) return reply.code(400).send({ message: error.message });
    throw error;
  };

  app.get('/panchayat-slip', async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);

    if (!panchayat) return reply.code(404).send({ message: 'Slip candidates are only for gram panchayats.' });

    return getPanchayatSlip(panchayat.id);
  });

  app.put('/panchayat-slip', async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);
    const parsed = updatePanchayatSlipRequestSchema.safeParse(request.body);

    if (!panchayat) return reply.code(403).send({ message: 'Slip candidates are only for gram panchayats.' });
    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? 'Check the names.' });

    await updatePanchayatSlip(panchayat.id, parsed.data);
    request.log.info({ by: request.session.mobileNumber }, 'panchayat slip header changed');

    return getPanchayatSlip(panchayat.id);
  });

  app.get('/panchayat-slip/sarpanch-symbol', async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);

    return sendImage(reply, panchayat ? await readSarpanchSymbol(panchayat.id) : null);
  });

  app.put('/panchayat-slip/sarpanch-symbol', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);
    const parsed = uploadSymbolRequestSchema.safeParse(request.body);

    if (!panchayat) return reply.code(403).send({ message: 'Slip candidates are only for gram panchayats.' });
    if (!parsed.success) return reply.code(400).send({ message: 'Choose an image.' });

    try {
      const updatedAt = await saveSarpanchSymbol(panchayat.id, parsed.data.image);
      request.log.info({ by: request.session.mobileNumber }, 'sarpanch symbol replaced');

      return { symbolUpdatedAt: updatedAt.toISOString() };
    } catch (error) {
      return symbolFailed(reply, error);
    }
  });

  app.delete('/panchayat-slip/sarpanch-symbol', async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);

    if (!panchayat) return reply.code(403).send({ message: 'Slip candidates are only for gram panchayats.' });

    await deleteSarpanchSymbol(panchayat.id);

    return reply.code(204).send();
  });

  app.get('/panchayat-slip/top-image', async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);

    return sendImage(reply, panchayat ? await readTopImage(panchayat.id) : null);
  });

  app.put('/panchayat-slip/top-image', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);
    const parsed = uploadSymbolRequestSchema.safeParse(request.body);

    if (!panchayat) return reply.code(403).send({ message: 'Slip candidates are only for gram panchayats.' });
    if (!parsed.success) return reply.code(400).send({ message: 'Choose an image.' });

    try {
      const updatedAt = await saveTopImage(panchayat.id, parsed.data.image);
      request.log.info({ by: request.session.mobileNumber }, 'slip top image replaced');

      return { symbolUpdatedAt: updatedAt.toISOString() };
    } catch (error) {
      return symbolFailed(reply, error);
    }
  });

  app.delete('/panchayat-slip/top-image', async (request, reply) => {
    const panchayat = await panchayatOf(request.access.assemblyNo);

    if (!panchayat) return reply.code(403).send({ message: 'Slip candidates are only for gram panchayats.' });

    await deleteTopImage(panchayat.id);

    return reply.code(204).send();
  });

  /** The ward exists on the roll and the constituency is a panchayat, or the reply is already sent. */
  const wardTarget = async (request: { access: { assemblyNo: number }; params: unknown }, reply: import('fastify').FastifyReply) => {
    const wardNo = wardParam((request.params as { wardNo: string }).wardNo);
    const panchayat = await panchayatOf(request.access.assemblyNo);

    if (!panchayat) {
      reply.code(403).send({ message: 'Slip candidates are only for gram panchayats.' });
      return null;
    }

    if (!wardNo || !(await wardExists(request.access.assemblyNo, wardNo))) {
      reply.code(404).send({ message: 'That ward is not on this panchayat\'s roll.' });
      return null;
    }

    return { assemblyId: panchayat.id, wardNo };
  };

  app.put('/wards/:wardNo/candidate', async (request, reply) => {
    const parsed = updateWardCandidateRequestSchema.safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? 'Check the names.' });

    const target = await wardTarget(request, reply);

    if (!target) return reply;

    await updateWardCandidate(target.assemblyId, target.wardNo, parsed.data, editor(request));
    request.log.info({ wardNo: target.wardNo, by: request.session.mobileNumber }, 'ward candidate changed');

    return getPanchayatSlip(target.assemblyId);
  });

  app.get('/wards/:wardNo/symbol', async (request, reply) => {
    const wardNo = wardParam((request.params as { wardNo: string }).wardNo);
    const panchayat = await panchayatOf(request.access.assemblyNo);

    return sendImage(reply, wardNo && panchayat ? await readWardSymbol(panchayat.id, wardNo) : null);
  });

  app.put('/wards/:wardNo/symbol', { bodyLimit: 2 * 1024 * 1024 }, async (request, reply) => {
    const parsed = uploadSymbolRequestSchema.safeParse(request.body);

    if (!parsed.success) return reply.code(400).send({ message: 'Choose an image.' });

    const target = await wardTarget(request, reply);

    if (!target) return reply;

    try {
      const updatedAt = await saveWardSymbol(target.assemblyId, target.wardNo, parsed.data.image, editor(request));
      request.log.info({ wardNo: target.wardNo, by: request.session.mobileNumber }, 'ward symbol replaced');

      return { symbolUpdatedAt: updatedAt.toISOString() };
    } catch (error) {
      return symbolFailed(reply, error);
    }
  });

  app.delete('/wards/:wardNo/symbol', async (request, reply) => {
    const target = await wardTarget(request, reply);

    if (!target) return reply;

    await deleteWardSymbol(target.assemblyId, target.wardNo);

    return reply.code(204).send();
  });

  /**
   * The Approvals screen, for app admins (marked on the dashboard): who is
   * waiting, approved or removed in this constituency, and approve, remove or
   * allow again. Admins themselves are changed only on the dashboard.
   */
  const adminAssembly = async (request: { access: { assemblyNo: number }; session: { mobileNumber: string } }) => {
    const assembly = await prisma.assembly.findUnique({
      where: { assemblyNo: request.access.assemblyNo },
      select: { id: true, requireLoginApproval: true, maxAppUsers: true },
    });

    return assembly && (await isAppAdmin(assembly.id, request.session.mobileNumber)) ? assembly : null;
  };

  app.get('/app-users', async (request, reply) => {
    const assembly = await adminAssembly(request);

    if (!assembly) return reply.code(403).send({ message: 'Only app admins can see approvals.' });

    return listAppUsers(assembly);
  });

  /** The voter photo bundles this user may download (their wards or booths), with versions. */
  app.get('/photos', async (request) => ({ packs: await packsFor(request.access.assemblyNo, request.access) }));

  /** One bundle, as a file for the phone to unpack. */
  // JPEGs do not shrink: no gzip, so the phone gets a length to show progress against.
  app.get('/photos/:kind/:no', { compress: false }, async (request, reply) => {
    const { kind, no } = request.params as { kind: string; no: string };

    if ((kind !== 'ward' && kind !== 'part') || !/^\d{1,5}$/.test(no)) return reply.code(404).send({ message: 'Not found.' });

    const file = await packFile(request.access.assemblyNo, request.access, { kind, no: Number(no) });

    if (!file) return reply.code(404).send({ message: 'No photos for that ward.' });

    const { createReadStream } = await import('node:fs');

    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-length', String(file.bytes))
      .header('cache-control', 'no-store')
      .send(createReadStream(file.path));
  });

  /**
   * Cheap poll for the app's home screen: how many people wait for approval
   * and who asked last, so an admin sees a new request without opening
   * Approvals.
   */
  app.get('/app-users/pending', async (request, reply) => {
    const assembly = await adminAssembly(request);

    if (!assembly) return reply.code(403).send({ message: 'Only app admins can see approvals.' });

    const where = { assemblyId: assembly.id, status: 'pending' as const };
    const [count, latest] = await Promise.all([
      prisma.appUserAccess.count({ where }),
      prisma.appUserAccess.findFirst({ where, orderBy: { requestedAt: 'desc' }, select: { fullName: true, mobileNumber: true, requestedAt: true } }),
    ]);

    return {
      pending: count,
      latest: latest ? { name: latest.fullName, mobileNumber: latest.mobileNumber, requestedAt: latest.requestedAt.toISOString() } : null,
    };
  });

  app.post('/app-users/:mobile/:action', async (request, reply) => {
    const { mobile, action } = request.params as { mobile: string; action: string };
    const parsed = appUserActionSchema.safeParse(action);

    if (!/^\d{10}$/.test(mobile) || !parsed.success) return reply.code(404).send({ message: 'Not found.' });

    const assembly = await adminAssembly(request);

    if (!assembly) return reply.code(403).send({ message: 'Only app admins can approve users.' });

    const body = appUserWardsRequestSchema.safeParse(request.body ?? {});

    if (!body.success) return reply.code(400).send({ message: 'Invalid ward list.', issues: body.error.issues });

    try {
      await actOnAppUser(
        assembly.id,
        mobile,
        parsed.data,
        {
          label: `${request.session.fullName} (app)`,
          app: {
            mobileNumber: request.session.mobileNumber,
            isMayor: await isMayorOf(assembly.id, request.session.mobileNumber),
          },
        },
        body.data.wardNos,
      );
    } catch (error) {
      if (error instanceof AppUserError) return reply.code(error.status).send({ message: error.message });
      throw error;
    }

    request.log.info({ mobile, action, by: request.session.mobileNumber }, 'app user access changed from the app');

    return listAppUsers(assembly);
  });

  /**
   * Bulk export that seeds the app's on-device SQLite copy. Keyset paging on id
   * keeps each page cheap even a quarter of a million rows in.
   */
  app.get('/download', async (request, reply) => {
    const parsed = downloadQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid download request.', issues: parsed.error.issues });
    }

    const { cursor, limit, since } = parsed.data;
    const scope = scopeFor(request.access);

    const where = {
      AND: [
        scope,
        ...(cursor ? [{ id: { gt: cursor } }] : []),
        ...(since ? [{ updatedAt: { gt: new Date(since) } }] : []),
      ],
    };

    const [rows, total] = await Promise.all([
      prisma.voter.findMany({ where, orderBy: { id: 'asc' }, take: limit }),
      prisma.voter.count({ where: { AND: [scope, ...(since ? [{ updatedAt: { gt: new Date(since) } }] : [])] } }),
    ]);

    const response: DownloadResponse = {
      voters: rows.map(toVoter),
      nextCursor: rows.length === limit ? (rows.at(-1)?.id ?? null) : null,
      total,
    };

    return response;
  });

  /** Field edits and enrollments queued offline, pushed in one batch. */
  app.post('/sync', { bodyLimit: 4 * 1024 * 1024 }, async (request, reply) => {
    const parsed = syncRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid sync batch.', issues: parsed.error.issues });
    }

    const { updates, enrollments } = parsed.data;
    const scope = scopeFor(request.access);
    const assemblyId =
      (
        await prisma.assembly.findUnique({
          where: { assemblyNo: request.access.assemblyNo },
          select: { id: true },
        })
      )?.id ?? null;
    const response: SyncResponse = { updated: [], enrolled: [], failed: [] };

    for (const { id, eFirstName, ...patch } of updates) {
      const existing = await prisma.voter.findFirst({
        where: { AND: [{ id }, scope] },
        select: { id: true, eFirstName: true, eLastName: true, eFirstNameRoll: true },
      });

      if (!existing) {
        response.failed.push({ ref: id, message: 'Voter is outside this PIN\'s constituency.' });
        continue;
      }

      const data = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));

      await prisma.voter.update({
        where: { id },
        data: {
          ...data,
          ...(eFirstName === undefined ? {} : nameCorrection(existing, eFirstName)),
          ...(patch.hasVoted === undefined
            ? {}
            : {
                votedAt: patch.hasVoted ? new Date() : null,
                markedBySessionId: patch.hasVoted ? request.session.sessionId : null,
              }),
        },
      });

      response.updated.push(id);
    }

    for (const enrollment of enrollments) {
      // A PIN limited to certain parts may only add voters to those parts.
      if (
        request.access.partNos.length > 0 &&
        !request.access.partNos.includes(enrollment.partNo)
      ) {
        response.failed.push({
          ref: enrollment.clientRef,
          message: `Your PIN does not cover part ${enrollment.partNo}.`,
        });
        continue;
      }

      const existing = await prisma.voter.findUnique({ where: { clientRef: enrollment.clientRef } });

      if (existing) {
        response.enrolled.push({ clientRef: enrollment.clientRef, id: existing.id, srNo: existing.srNo });
        continue;
      }

      const assembly = await prisma.assembly.findUnique({
        where: { assemblyNo: request.access.assemblyNo },
      });

      try {
        const { clientRef, ...fields } = enrollment;

        // Numbered in the enrollment range, not on the end of the imported roll.
        const created = await withEnrollmentSrNo(
          request.access.assemblyNo,
          enrollment.partNo,
          (srNo) =>
            prisma.voter.create({
              data: {
                ...fields,
                clientRef,
                srNo,
                assemblyId: assembly?.id ?? null,
                assemblyNo: request.access.assemblyNo,
                eAssemblyName: request.access.assemblyName,
                isNewEnrollment: true,
              },
            }),
        );

        response.enrolled.push({ clientRef, id: created.id, srNo: created.srNo });
      } catch {
        response.failed.push({
          ref: enrollment.clientRef,
          message: 'Could not save this enrollment — try again.',
        });
      }
    }

    return response;
  });

  /** Fills in details the roll is missing, e.g. a mobile number. */
  app.patch('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = voterPatchSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid request.', issues: parsed.error.issues });
    }

    const existing = await prisma.voter.findFirst({
      where: { AND: [{ id }, scopeFor(request.access)] },
      select: { id: true, eFirstName: true, eLastName: true, eFirstNameRoll: true },
    });

    if (!existing) {
      return reply.code(404).send({ message: 'Voter not found.' });
    }

    const { eFirstName, ...patch } = parsed.data;
    const data = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );

    const updated = await prisma.voter.update({
      where: { id },
      data: { ...data, ...(eFirstName === undefined ? {} : nameCorrection(existing, eFirstName)) },
    });


    return toVoter(updated);
  });

  /**
   * Turnout and slip counters for the agent's own booths, across every phone
   * working them — the phone itself only knows what it printed. Shown on the
   * home screen and cached there for when there is no signal.
   */
  app.get('/summary', async (request) => {
    const scope = scopeFor(request.access);

    const [total, voted, printed, printedByMe, lastReset] = await Promise.all([
      prisma.voter.count({ where: scope }),
      prisma.voter.count({ where: { AND: [scope, { hasVoted: true }] } }),
      prisma.voter.count({ where: { AND: [scope, { prints: { some: {} } }] } }),
      prisma.voter.count({
        where: { AND: [scope, { prints: { some: { sessionId: request.session.sessionId } } }] },
      }),
      prisma.printReset.findFirst({
        where: { assembly: { assemblyNo: request.access.assemblyNo } },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const summary: VoterSummary = {
      total,
      voted,
      pending: total - voted,
      printed,
      printedByMe,
      printsResetAt: lastReset?.createdAt.toISOString() ?? null,
    };

    return summary;
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const voter = await prisma.voter.findFirst({
      where: { AND: [{ id }, scopeFor(request.access)] },
    });

    if (!voter) {
      return reply.code(404).send({ message: 'Voter not found.' });
    }

    return toVoter(voter);
  });

  /** Booth agents tick voters off the roll as they turn up. */
  app.patch('/:id/voted', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = markVotedRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid request.', issues: parsed.error.issues });
    }

    const existing = await prisma.voter.findFirst({
      where: { AND: [{ id }, scopeFor(request.access)] },
      select: { id: true },
    });

    if (!existing) {
      return reply.code(404).send({ message: 'Voter not found.' });
    }

    const { hasVoted } = parsed.data;

    const updated = await prisma.voter.update({
      where: { id: existing.id },
      data: {
        hasVoted,
        votedAt: hasVoted ? new Date() : null,
        markedBySessionId: hasVoted ? request.session.sessionId : null,
      },
    });

    return toVoter(updated);
  });
};
