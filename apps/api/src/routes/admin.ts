import { rm } from 'node:fs/promises';

import {
  adminLoginRequestSchema,
  createConstituencyAdminRequestSchema,
  updateConstituencyAdminRequestSchema,
  voterListQuerySchema,
  voterSchema,
  createAssemblyRequestSchema,
  createPinRequestSchema,
  updatePinRequestSchema,
  updatePollDetailsRequestSchema,
  updateAnnouncementRequestSchema,
  updateAppFeaturesRequestSchema,
  updateAssemblyActiveRequestSchema,
  updateStatsVisibilityRequestSchema,
  usageQuerySchema,
  appStatsQuerySchema,
  type AccessPin,
  type AdminLoginResponse,
  type AdminStats,
  type ApplyAnnouncementResult,
  type Assembly,
  type ConstituencyAdmin,
  type ResetPrintsResult,
  appUserActionSchema,
  appUserWardsRequestSchema,
  updateAppUserLimitRequestSchema,
} from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import { saveBanner, readBanner } from '../lib/banner.js';
import { boothStats, listBooths } from '../lib/booth-stats.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { generateUniquePin } from '../lib/pin.js';
import { pollDetailsData, pollDetailsOf } from '../lib/poll-details.js';
import { announcementOf } from '../lib/announcement.js';
import { appFeaturesOf } from '../lib/app-features.js';
import { actOnAppUser, AppUserError, filePendingForExisting, listAppUsers } from '../lib/app-user-access.js';
import { appStats } from '../lib/app-stats.js';
import { activateUser, deactivateUser, deactivatedAmong } from '../lib/user-blocks.js';
import { statsVisibilityOf } from '../lib/stats-visibility.js';
import { todayIst, usageReport } from '../lib/usage.js';
import { printReport, sessionPrintCounts, voterPrintSummaries, warRoomBooth } from '../lib/prints.js';
import { voterOrderBy, voterWhere } from '../lib/voter-filter.js';
import { deleteVoterPhotos, importVoterPhotos, photoSummary, VoterPhotoError } from '../lib/voter-photos.js';
import { prisma } from '../prisma.js';
import { exportRoutes } from './exports.js';

type PinRow = {
  id: string;
  pin: string;
  label: string | null;
  partNos: number[];
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  usageCount: number;
  createdAt: Date;
  assembly: { assemblyNo: number; nameEn: string };
};

function toAccessPin(row: PinRow): AccessPin {
  return {
    id: row.id,
    pin: row.pin,
    label: row.label,
    assemblyNo: row.assembly.assemblyNo,
    assemblyName: row.assembly.nameEn,
    partNos: row.partNos,
    isActive: row.isActive,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    usageCount: row.usageCount,
    createdAt: row.createdAt.toISOString(),
  };
}

type AdminRow = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
};

function toConstituencyAdmin(row: AdminRow): ConstituencyAdmin {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/login',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const parsed = adminLoginRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Please check the details you entered.',
          issues: parsed.error.issues,
        });
      }

      const admin = await prisma.adminUser.findUnique({
        where: { email: parsed.data.email },
        include: { assembly: { select: { nameEn: true } } },
      });
      const ok = admin ? await verifyPassword(parsed.data.password, admin.passwordHash) : false;
      const scoped = admin?.role === 'constituency_admin';

      // Same message either way, so the response can't be used to probe for accounts.
      if (!admin || !ok || !admin.isActive || (scoped && !admin.assemblyId)) {
        return reply.code(401).send({ message: 'Incorrect email or password.' });
      }

      await prisma.adminUser.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date() },
      });

      const response: AdminLoginResponse = {
        token: app.jwt.sign({ adm: admin.id }),
        admin: {
          id: admin.id,
          email: admin.email,
          name: admin.name,
          role: admin.role,
          assemblyId: scoped ? admin.assemblyId : null,
          assemblyName: scoped ? (admin.assembly?.nameEn ?? null) : null,
        },
      };

      return response;
    },
  );

  app.register(async (guarded) => {
    guarded.addHook('preHandler', guarded.requireAdmin);

    /**
     * Constituency admins may only reach their own constituency. Every
     * `/assemblies/:id...` route is checked here, so a new one is covered by
     * default; answering 404 rather than 403 keeps other ids unconfirmed.
     */
    guarded.addHook('preHandler', async (request, reply) => {
      if (reply.sent || request.admin.role !== 'constituency_admin') return;

      if (!request.routeOptions.url?.includes('/assemblies/:id')) return;

      const { id } = request.params as { id?: string };

      if (id !== request.admin.assemblyId) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }
    });

    await guarded.register(exportRoutes);

    guarded.get('/me', async (request) => request.admin);

    guarded.get('/stats', async (request) => {
      const assemblyId = request.admin.assemblyId ?? undefined;

      const [assemblies, voters, activePins, sessions] = await Promise.all([
        prisma.assembly.count({ where: { id: assemblyId } }),
        prisma.voter.count({ where: { assemblyId } }),
        prisma.accessPin.count({ where: { isActive: true, assemblyId } }),
        prisma.loginSession.count({
          where: { verifiedAt: { not: null }, ...(assemblyId ? { accessPin: { assemblyId } } : {}) },
        }),
      ]);

      const stats: AdminStats = { assemblies, voters, activePins, sessions };

      return stats;
    });

    guarded.get('/assemblies', async (request) => {
      const rows = await prisma.assembly.findMany({
        where: { id: request.admin.assemblyId ?? undefined },
        orderBy: { assemblyNo: 'asc' },
        include: { _count: { select: { pins: true } } },
      });

      const counts = await prisma.voter.groupBy({
        by: ['assemblyNo'],
        _count: { _all: true },
      });

      const voterCounts = new Map(counts.map((row) => [row.assemblyNo, row._count._all]));

      const assemblies: Assembly[] = rows.map((row) => ({
        id: row.id,
        assemblyNo: row.assemblyNo,
        name: row.nameEn,
        stateCode: row.stateCode,
        code: row.code,
        voterCount: voterCounts.get(row.assemblyNo) ?? 0,
        pinCount: row._count.pins,
        bannerUpdatedAt: row.bannerUpdatedAt?.toISOString() ?? null,
        slipImageUpdatedAt: row.slipImageUpdatedAt?.toISOString() ?? null,
        whatsappImageUpdatedAt: row.whatsappImageUpdatedAt?.toISOString() ?? null,
        isActive: row.isActive,
        ...pollDetailsOf(row),
        ...statsVisibilityOf(row),
        ...appFeaturesOf(row),
        ...announcementOf(row),
      }));

      return assemblies;
    });

    guarded.get('/assemblies/:id', async (request, reply) => {
      const { id } = request.params as { id: string };

      const assembly = await prisma.assembly.findUnique({
        where: { id },
        include: { _count: { select: { pins: true, voters: true } } },
      });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      return {
        id: assembly.id,
        assemblyNo: assembly.assemblyNo,
        name: assembly.nameEn,
        stateCode: assembly.stateCode,
        code: assembly.code,
        voterCount: assembly._count.voters,
        pinCount: assembly._count.pins,
        bannerUpdatedAt: assembly.bannerUpdatedAt?.toISOString() ?? null,
        slipImageUpdatedAt: assembly.slipImageUpdatedAt?.toISOString() ?? null,
        whatsappImageUpdatedAt: assembly.whatsappImageUpdatedAt?.toISOString() ?? null,
        isActive: assembly.isActive,
        ...pollDetailsOf(assembly),
        ...statsVisibilityOf(assembly),
        ...appFeaturesOf(assembly),
        ...announcementOf(assembly),
      } satisfies Assembly;
    });

    /** The election heading and polling day/hours shown on the WhatsApp slip. */
    guarded.patch('/assemblies/:id/poll', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updatePollDetailsRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: parsed.error.issues[0]?.message ?? 'Please check the poll details.',
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

      if (!existing) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      const updated = await prisma.assembly.update({
        where: { id },
        data: pollDetailsData(parsed.data),
      });

      return pollDetailsOf(updated);
    });

    /**
     * Switches a constituency off or back on. Off, its PINs stop unlocking the
     * app and every phone holding its roll is signed out and wiped on its
     * next launch; nothing on the server is deleted, so it can come back.
     */
    guarded.patch(
      '/assemblies/:id/active',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = updateAssemblyActiveRequestSchema.safeParse(request.body);

        if (!parsed.success) {
          return reply.code(400).send({ message: 'Invalid request.', issues: parsed.error.issues });
        }

        const existing = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

        if (!existing) {
          return reply.code(404).send({ message: 'That constituency does not exist.' });
        }

        const updated = await prisma.assembly.update({
          where: { id },
          data: { isActive: parsed.data.isActive },
          select: { isActive: true },
        });

        request.log.warn(
          { assemblyId: id, isActive: updated.isActive, admin: request.admin.id },
          updated.isActive ? 'constituency activated' : 'constituency deactivated',
        );

        return updated;
      },
    );

    /** Which booth breakdowns the dashboard and the app show. */
    guarded.patch('/assemblies/:id/stats-visibility', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateStatsVisibilityRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: parsed.error.issues[0]?.message ?? 'Invalid request.',
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

      if (!existing) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      const updated = await prisma.assembly.update({ where: { id }, data: parsed.data });

      return statsVisibilityOf(updated);
    });

    /**
     * Optional voter-screen features in the app. Super admins decide which
     * constituencies get them, so constituency admins cannot flip these.
     */
    guarded.patch(
      '/assemblies/:id/app-features',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = updateAppFeaturesRequestSchema.safeParse(request.body);

        if (!parsed.success) {
          return reply.code(400).send({
            message: parsed.error.issues[0]?.message ?? 'Invalid request.',
            issues: parsed.error.issues,
          });
        }

        const existing = await prisma.assembly.findUnique({
          where: { id },
          select: { id: true, requireLoginApproval: true, maxAppUsers: true },
        });

        if (!existing) {
          return reply.code(404).send({ message: 'That constituency does not exist.' });
        }

        const updated = await prisma.assembly.update({ where: { id }, data: parsed.data });

        // Switching approval on: everyone already using the PINs is listed as
        // waiting, and is held at the PIN screen until approved.
        if (parsed.data.requireLoginApproval && !existing.requireLoginApproval) {
          await filePendingForExisting(id);
        }

        return appFeaturesOf(updated);
      },
    );

    /**
     * The notice booth agents must read and accept on the app's home screen.
     * Any change to the text, or switching it on, gives it a new timestamp so
     * every phone asks its agent to accept it again.
     */
    guarded.patch('/assemblies/:id/announcement', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateAnnouncementRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: parsed.error.issues[0]?.message ?? 'Invalid request.',
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.assembly.findUnique({ where: { id } });

      if (!existing) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      const { enabled, title, body } = parsed.data;
      const nextTitle = title === undefined ? existing.announcementTitle : title || null;
      const nextBody = body === undefined ? existing.announcementBody : body || null;
      const nextEnabled = enabled ?? existing.announcementEnabled;

      if (nextEnabled && !nextBody) {
        return reply.code(400).send({ message: 'Write the message before switching the alert on.' });
      }

      const changed =
        nextTitle !== existing.announcementTitle ||
        nextBody !== existing.announcementBody ||
        (nextEnabled && !existing.announcementEnabled);

      const updated = await prisma.assembly.update({
        where: { id },
        data: {
          announcementEnabled: nextEnabled,
          announcementTitle: nextTitle,
          announcementBody: nextBody,
          ...(changed ? { announcementUpdatedAt: new Date() } : {}),
        },
      });

      return announcementOf(updated);
    });

    /**
     * Copies one constituency's alert to every other constituency and switches
     * it on there. Each constituency whose alert changes gets a new timestamp,
     * so agents already signed in are asked to read it when they next open the
     * app.
     */
    guarded.post(
      '/assemblies/:id/announcement/apply-to-all',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const source = await prisma.assembly.findUnique({ where: { id } });

        if (!source) {
          return reply.code(404).send({ message: 'That constituency does not exist.' });
        }

        if (!source.announcementBody?.trim()) {
          return reply.code(400).send({ message: 'Write and save the message first.' });
        }

        const now = new Date();
        const [updated] = await prisma.$transaction([
          prisma.assembly.updateMany({
            where: {
              id: { not: source.id },
              OR: [
                { announcementEnabled: false },
                { announcementTitle: { not: source.announcementTitle } },
                { announcementTitle: source.announcementTitle === null ? { not: null } : null },
                { announcementBody: { not: source.announcementBody } },
                { announcementBody: null },
              ],
            },
            data: {
              announcementEnabled: true,
              announcementTitle: source.announcementTitle,
              announcementBody: source.announcementBody,
              announcementUpdatedAt: now,
            },
          }),
          prisma.assembly.update({
            where: { id: source.id },
            data: {
              announcementEnabled: true,
              ...(source.announcementEnabled ? {} : { announcementUpdatedAt: now }),
            },
          }),
        ]);

        const result: ApplyAnnouncementResult = { updated: updated.count };

        return result;
      },
    );

    /**
     * Who used the app on one day, how often, for how long and where from.
     * Constituency admins see only people who unlocked their constituency.
     */
    guarded.get('/usage', async (request, reply) => {
      const parsed = usageQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          message: parsed.error.issues[0]?.message ?? 'Invalid date.',
          issues: parsed.error.issues,
        });
      }

      return usageReport(parsed.data.date ?? todayIst(), request.admin.assemblyId);
    });

    /** The super admin's Stats page: every constituency, narrowed by the filters. */
    guarded.get('/app-stats', { preHandler: guarded.requireSuperAdmin }, async (request, reply) => {
      const parsed = appStatsQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({
          message: parsed.error.issues[0]?.message ?? 'Invalid filters.',
          issues: parsed.error.issues,
        });
      }

      return appStats(parsed.data);
    });

    /** Slip printing in one constituency: totals, and who printed how much and where. */
    guarded.get('/assemblies/:id/prints', async (request, reply) => {
      const { id } = request.params as { id: string };
      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      return printReport(assembly.id);
    });

    /**
     * Starts a constituency's slip printing from zero: every print record it
     * holds is deleted, so the report, the roll's "Slips printed" column and
     * the app's counts all read 0 again. The reset itself is kept — who, when
     * and what the counts read — and shown as history on the card. A
     * constituency admin may reset its own constituency; the scoping hook
     * above keeps it to that one. It cannot be undone, and phones keep what
     * they have already printed.
     */
    guarded.delete('/assemblies/:id/prints', async (request, reply) => {
      const { id } = request.params as { id: string };
      const assembly = await prisma.assembly.findUnique({
        where: { id },
        select: { id: true, assemblyNo: true },
      });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      // Prints are stamped with the PIN's constituency, but an older row may
      // carry none; the voter's constituency catches those too.
      const where = {
        OR: [{ assemblyId: assembly.id }, { voter: { assemblyNo: assembly.assemblyNo } }],
      };
      const admin = request.admin;

      const deleted = await prisma.$transaction(async (tx) => {
        const [before] = await tx.$queryRaw<{ prints: number; voters: number; users: number }[]>`
          SELECT COUNT(*)::int AS prints,
                 COUNT(DISTINCT p.voter_id)::int AS voters,
                 COUNT(DISTINCT p.session_id)::int AS users
          FROM slip_prints p
          LEFT JOIN voters v ON v.id = p.voter_id
          WHERE p.assembly_id = ${assembly.id} OR v.assembly_no = ${assembly.assemblyNo}`;

        const { count } = await tx.slipPrint.deleteMany({ where });

        await tx.printReset.create({
          data: {
            assemblyId: assembly.id,
            adminId: admin.id,
            adminName: admin.name,
            adminEmail: admin.email,
            prints: before?.prints ?? count,
            voters: before?.voters ?? 0,
            users: before?.users ?? 0,
          },
        });

        return count;
      });

      const result: ResetPrintsResult = { deleted };

      return result;
    });

    /** The roll of one constituency, searchable — admins see it without a PIN. */
    guarded.get('/assemblies/:id/voters', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = voterListQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid filters.', issues: parsed.error.issues });
      }

      const assembly = await prisma.assembly.findUnique({ where: { id } });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      const { limit, offset, sort, dir } = parsed.data;
      const where = voterWhere(assembly.id, parsed.data);

      const [rows, total] = await Promise.all([
        prisma.voter.findMany({
          where,
          orderBy: voterOrderBy(sort, dir),
          take: limit,
          skip: offset,
        }),
        prisma.voter.count({ where }),
      ]);

      const prints = await voterPrintSummaries(rows.map((row) => row.id));

      return {
        // `updatedAt` crosses the wire as an ISO string, not a Date.
        voters: rows.map((row) => ({
          ...voterSchema.parse({ ...row, updatedAt: row.updatedAt.toISOString() }),
          prints: prints.get(row.id) ?? { count: 0, last: null },
        })),
        total,
      };
    });

    guarded.post('/assemblies', { preHandler: guarded.requireSuperAdmin }, async (request, reply) => {
      const parsed = createAssemblyRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Please check the constituency details.',
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.assembly.findUnique({
        where: { assemblyNo: parsed.data.assemblyNo },
      });

      if (existing) {
        return reply.code(409).send({ message: 'That assembly number already exists.' });
      }

      // A new constituency starts with the alert the other constituencies were last sent.
      const latestAlert = await prisma.assembly.findFirst({
        where: { announcementEnabled: true, announcementBody: { not: null } },
        orderBy: { announcementUpdatedAt: { sort: 'desc', nulls: 'last' } },
        select: { announcementTitle: true, announcementBody: true },
      });

      const created = await prisma.assembly.create({
        data: {
          ...(latestAlert
            ? {
                announcementEnabled: true,
                announcementTitle: latestAlert.announcementTitle,
                announcementBody: latestAlert.announcementBody,
                announcementUpdatedAt: new Date(),
              }
            : {}),
          assemblyNo: parsed.data.assemblyNo,
          nameEn: parsed.data.name,
          code: parsed.data.code,
          stateCode: parsed.data.stateCode,
          ...pollDetailsData(parsed.data),
        },
      });

      return reply.code(201).send({
        id: created.id,
        assemblyNo: created.assemblyNo,
        name: created.nameEn,
        stateCode: created.stateCode,
        code: created.code,
        voterCount: 0,
        pinCount: 0,
        bannerUpdatedAt: null,
        slipImageUpdatedAt: null,
        whatsappImageUpdatedAt: null,
        isActive: created.isActive,
        ...pollDetailsOf(created),
        ...statsVisibilityOf(created),
        ...appFeaturesOf(created),
        ...announcementOf(created),
      } satisfies Assembly);
    });

    /**
     * Everyone who has signed in to the app, newest first. A constituency admin
     * sees only those who unlocked one of its PINs. `q` matches name, mobile,
     * PIN, PIN label or constituency name.
     */
    guarded.get('/sessions', async (request) => {
      const { assemblyId } = request.admin;
      const search = ((request.query as { q?: string }).q ?? '').trim();
      const insensitive = { contains: search, mode: 'insensitive' as const };

      const rows = await prisma.loginSession.findMany({
        where: {
          ...(assemblyId ? { accessPin: { assemblyId } } : {}),
          ...(search
            ? {
                OR: [
                  { fullName: insensitive },
                  { mobileNumber: { contains: search } },
                  { accessPin: { pin: insensitive } },
                  { accessPin: { label: insensitive } },
                  { accessPin: { assembly: { nameEn: insensitive } } },
                ],
              }
            : {}),
        },
        orderBy: { lastSeenAt: 'desc' },
        take: 200,
        include: { accessPin: { include: { assembly: true } } },
      });

      const printed = await sessionPrintCounts(rows.map((row) => row.id));
      const deactivated = await deactivatedAmong(rows.map((row) => row.mobileNumber));

      return rows.map((row) => ({
        id: row.id,
        fullName: row.fullName,
        mobileNumber: row.mobileNumber,
        pin: row.accessPin?.pin ?? null,
        pinLabel: row.accessPin?.label ?? null,
        assemblyName: row.accessPin?.assembly.nameEn ?? null,
        verifiedAt: row.verifiedAt?.toISOString() ?? null,
        lastSeenAt: row.lastSeenAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
        prints: printed.get(row.id)?.prints ?? 0,
        votersPrinted: printed.get(row.id)?.voters ?? 0,
        deactivated: deactivated.has(row.mobileNumber),
      }));
    });

    /**
     * Switches an app user off by mobile number, or back on. Switched off, the
     * number and the phones it signed in on are signed out and cannot sign in
     * again (a reinstalled app gets past the phone block, never the number's).
     * A constituency admin may only act on people who used one of its PINs.
     */
    guarded.post('/app-users/:mobile/:action', async (request, reply) => {
      const { mobile, action } = request.params as { mobile: string; action: string };

      if (!/^\d{10}$/.test(mobile) || (action !== 'deactivate' && action !== 'activate')) {
        return reply.code(404).send({ message: 'Not found.' });
      }

      const { assemblyId } = request.admin;
      const known = await prisma.loginSession.count({
        where: { mobileNumber: mobile, ...(assemblyId ? { accessPin: { assemblyId } } : {}) },
      });

      if (known === 0) {
        return reply.code(404).send({ message: 'No app user has signed in with that number.' });
      }

      if (action === 'activate') {
        await activateUser(mobile);
        return { deactivated: false, devices: 0 };
      }

      const { devices } = await deactivateUser(mobile, request.admin.id);
      return { deactivated: true, devices };
    });

    /**
     * The constituency's app users and their standing: waiting for approval,
     * approved (at most APP_USER_LIMIT, admins included) or removed. Admins
     * here also choose which app users are app admins, who can approve and
     * remove others from the app.
     */
    guarded.get('/assemblies/:id/app-users', async (request, reply) => {
      const { id } = request.params as { id: string };
      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true, requireLoginApproval: true, maxAppUsers: true } });

      if (!assembly) return reply.code(404).send({ message: 'That constituency does not exist.' });

      return listAppUsers(assembly);
    });

    /** How many app users the constituency may have approved at once. Super admins only. */
    guarded.patch(
      '/assemblies/:id/app-user-limit',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = updateAppUserLimitRequestSchema.safeParse(request.body);

        if (!parsed.success) {
          return reply.code(400).send({ message: parsed.error.issues[0]?.message ?? 'Check the limit.' });
        }

        const exists = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

        if (!exists) return reply.code(404).send({ message: 'That constituency does not exist.' });

        const assembly = await prisma.assembly.update({
          where: { id },
          data: { maxAppUsers: parsed.data.limit },
          select: { id: true, requireLoginApproval: true, maxAppUsers: true },
        });

        request.log.info({ assemblyId: id, limit: parsed.data.limit, admin: request.admin.id }, 'app user limit changed');

        return listAppUsers(assembly);
      },
    );

    guarded.post('/assemblies/:id/app-users/:mobile/:action', async (request, reply) => {
      const { id, mobile, action } = request.params as { id: string; mobile: string; action: string };
      const parsed = appUserActionSchema.safeParse(action);

      if (!/^\d{10}$/.test(mobile) || !parsed.success) return reply.code(404).send({ message: 'Not found.' });

      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true, requireLoginApproval: true, maxAppUsers: true } });

      if (!assembly) return reply.code(404).send({ message: 'That constituency does not exist.' });

      const body = appUserWardsRequestSchema.safeParse(request.body ?? {});

      if (!body.success) return reply.code(400).send({ message: 'Invalid ward list.', issues: body.error.issues });

      try {
        await actOnAppUser(id, mobile, parsed.data, { label: request.admin.email }, body.data.wardNos);
      } catch (error) {
        if (error instanceof AppUserError) return reply.code(error.status).send({ message: error.message });
        throw error;
      }

      return listAppUsers(assembly);
    });

    /**
     * Removes a constituency and everything hanging off it — voters, PINs and
     * the banner. There is no undo.
     */
    guarded.delete(
      '/assemblies/:id',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const assembly = await prisma.assembly.findUnique({ where: { id } });

        if (!assembly) {
          return reply.code(404).send({ message: 'That constituency does not exist.' });
        }

        const voters = await prisma.voter.count({ where: { assemblyId: id } });
        const pins = await prisma.accessPin.count({ where: { assemblyId: id } });

        // Voters and pins cascade from the assembly row.
        await prisma.assembly.delete({ where: { id } });

        for (const path of [assembly.bannerPath, assembly.slipImagePath, assembly.whatsappImagePath]) {
          if (path) await rm(path, { force: true }).catch(() => undefined);
        }

        return { deleted: { assemblyNo: assembly.assemblyNo, name: assembly.nameEn, voters, pins } };
      },
    );

    /** Every booth in a constituency, with headline counts. */
    guarded.get('/assemblies/:id/booths', async (request, reply) => {
      const { id } = request.params as { id: string };
      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      return listBooths(id);
    });

    /** Gender, religion and community breakdowns for one booth. */
    guarded.get('/assemblies/:id/booths/:partNo', async (request, reply) => {
      const { id, partNo } = request.params as { id: string; partNo: string };
      const part = Number.parseInt(partNo, 10);

      if (!Number.isFinite(part)) {
        return reply.code(400).send({ message: 'Invalid booth number.' });
      }

      return boothStats(id, part);
    });

    /** One booth's voters in serial order with their slip prints, for the war room. */
    guarded.get('/assemblies/:id/booths/:partNo/war-room', async (request, reply) => {
      const { id, partNo } = request.params as { id: string; partNo: string };
      const part = Number.parseInt(partNo, 10);

      if (!Number.isFinite(part)) {
        return reply.code(400).send({ message: 'Invalid booth number.' });
      }

      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      return warRoomBooth(assembly.id, part);
    });

    // A voter photo upload is a zip sent as the raw request body.
    guarded.addContentTypeParser(['application/zip', 'application/octet-stream'], { parseAs: 'buffer' }, (_request, body, done) => {
      done(null, body);
    });

    /** Voter photos: how many voters have one, bundle by bundle. */
    guarded.get('/assemblies/:id/voter-photos', async (request, reply) => {
      const { id } = request.params as { id: string };
      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true, assemblyNo: true } });

      if (!assembly) return reply.code(404).send({ message: 'That constituency does not exist.' });

      return photoSummary(assembly);
    });

    /** Adds the photos in a zip of <EPIC>.jpg files (replacing any with the same EPIC). */
    guarded.post('/assemblies/:id/voter-photos', { bodyLimit: 400 * 1024 * 1024 }, async (request, reply) => {
      const { id } = request.params as { id: string };
      const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true, assemblyNo: true } });

      if (!assembly) return reply.code(404).send({ message: 'That constituency does not exist.' });
      if (!Buffer.isBuffer(request.body) || request.body.length === 0) {
        return reply.code(400).send({ message: 'Send the photos as a zip file.' });
      }

      try {
        const result = await importVoterPhotos(assembly, request.body);
        request.log.info({ assemblyId: id, received: result.received, matched: result.matched }, 'voter photos uploaded');

        return result;
      } catch (error) {
        if (error instanceof VoterPhotoError) return reply.code(400).send({ message: error.message });
        throw error;
      }
    });

    guarded.delete('/assemblies/:id/voter-photos', async (request, reply) => {
      const { id } = request.params as { id: string };

      await deleteVoterPhotos(id);

      return reply.code(204).send();
    });

    /** Stores the home-screen banner for a constituency. */
    guarded.post(
      '/assemblies/:id/banner',
      { bodyLimit: 8 * 1024 * 1024 },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const { dataUrl } = (request.body ?? {}) as { dataUrl?: string };

        if (typeof dataUrl !== 'string') {
          return reply.code(400).send({ message: 'No image was sent.' });
        }

        const assembly = await prisma.assembly.findUnique({ where: { id } });

        if (!assembly) {
          return reply.code(404).send({ message: 'That constituency does not exist.' });
        }

        try {
          const saved = await saveBanner(id, dataUrl);

          return { mime: saved.mime, bytes: saved.bytes, updatedAt: saved.updatedAt.toISOString() };
        } catch (error) {
          return reply
            .code(400)
            .send({ message: error instanceof Error ? error.message : 'Could not save that image.' });
        }
      },
    );

    /**
     * Stores the printer cover image, or the image sent with the slip text on
     * WhatsApp. Separate files and stamps: replacing one leaves the other.
     */
    for (const [route, kind, label] of [
      ['slip-image', 'slip', 'slip image'],
      ['whatsapp-image', 'whatsapp', 'WhatsApp image'],
    ] as const) {
      guarded.post(
        `/assemblies/:id/${route}`,
        // Room for a 16 MB WhatsApp video once base64 has grown it by a third.
        { bodyLimit: kind === 'whatsapp' ? 24 * 1024 * 1024 : 8 * 1024 * 1024 },
        async (request, reply) => {
          const { id } = request.params as { id: string };
          const { dataUrl } = (request.body ?? {}) as { dataUrl?: string };

          if (typeof dataUrl !== 'string') {
            return reply.code(400).send({ message: 'No image was sent.' });
          }

          const assembly = await prisma.assembly.findUnique({ where: { id } });

          if (!assembly) {
            return reply.code(404).send({ message: 'That constituency does not exist.' });
          }

          try {
            const saved = await saveBanner(id, dataUrl, kind);

            return {
              mime: saved.mime,
              bytes: saved.bytes,
              updatedAt: saved.updatedAt.toISOString(),
            };
          } catch (error) {
            return reply.code(400).send({
              message: error instanceof Error ? error.message : 'Could not save that image.',
            });
          }
        },
      );

      guarded.get(`/assemblies/:id/${route}`, async (request, reply) => {
        const { id } = request.params as { id: string };
        const image = await readBanner(id, kind);

        if (!image) return reply.code(404).send({ message: `No ${label} uploaded yet.` });

        return reply
          .header('content-type', image.mime)
          .header('cache-control', 'no-cache')
          .send(image.body);
      });
    }

    guarded.get('/assemblies/:id/banner', async (request, reply) => {
      const { id } = request.params as { id: string };
      const banner = await readBanner(id);

      if (!banner) return reply.code(404).send({ message: 'No banner uploaded yet.' });

      return reply
        .header('content-type', banner.mime)
        .header('cache-control', 'no-cache')
        .send(banner.body);
    });

    /** Every PIN issued, newest first; filtered to one constituency on request. */
    guarded.get('/pins', async (request) => {
      const query = request.query as { assemblyId?: string };
      const assemblyId = request.admin.assemblyId ?? query.assemblyId;

      const rows = await prisma.accessPin.findMany({
        where: assemblyId ? { assemblyId } : undefined,
        orderBy: { createdAt: 'desc' },
        include: { assembly: true },
      });

      return rows.map(toAccessPin);
    });

    /** Generates the PIN server-side — the admin only chooses its scope. */
    guarded.post('/pins', async (request, reply) => {
      const parsed = createPinRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Please check the PIN details.',
          issues: parsed.error.issues,
        });
      }

      const assembly = await prisma.assembly.findUnique({ where: { id: parsed.data.assemblyId } });
      const outOfScope =
        request.admin.assemblyId !== null && parsed.data.assemblyId !== request.admin.assemblyId;

      if (!assembly || outOfScope) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      const pin = await generateUniquePin(assembly, async (candidate) => {
        const clash = await prisma.accessPin.findUnique({ where: { pin: candidate } });
        return clash !== null;
      });

      const created = await prisma.accessPin.create({
        data: {
          pin,
          label: parsed.data.label ?? null,
          assemblyId: assembly.id,
          partNos: parsed.data.partNos,
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
          createdById: request.admin.id,
        },
        include: { assembly: true },
      });

      return reply.code(201).send(toAccessPin(created));
    });

    guarded.patch('/pins/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updatePinRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid request.', issues: parsed.error.issues });
      }

      const existing = await prisma.accessPin.findUnique({ where: { id } });
      const outOfScope =
        request.admin.assemblyId !== null && existing?.assemblyId !== request.admin.assemblyId;

      if (!existing || outOfScope) {
        return reply.code(404).send({ message: 'PIN not found.' });
      }

      const updated = await prisma.accessPin.update({
        where: { id },
        data: { isActive: parsed.data.isActive },
        include: { assembly: true },
      });

      return toAccessPin(updated);
    });

    /** Dashboard logins limited to one constituency. Super admins only. */
    guarded.get(
      '/assemblies/:id/admins',
      { preHandler: guarded.requireSuperAdmin },
      async (request) => {
        const { id } = request.params as { id: string };

        const rows = await prisma.adminUser.findMany({
          where: { assemblyId: id, role: 'constituency_admin' },
          orderBy: { createdAt: 'asc' },
        });

        return rows.map(toConstituencyAdmin);
      },
    );

    guarded.post(
      '/assemblies/:id/admins',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { id } = request.params as { id: string };
        const parsed = createConstituencyAdminRequestSchema.safeParse(request.body);

        if (!parsed.success) {
          return reply.code(400).send({
            message: parsed.error.issues[0]?.message ?? 'Please check the admin details.',
            issues: parsed.error.issues,
          });
        }

        const assembly = await prisma.assembly.findUnique({ where: { id }, select: { id: true } });

        if (!assembly) {
          return reply.code(404).send({ message: 'That constituency does not exist.' });
        }

        const clash = await prisma.adminUser.findUnique({ where: { email: parsed.data.email } });

        if (clash) {
          return reply.code(409).send({ message: 'An admin with that email already exists.' });
        }

        const created = await prisma.adminUser.create({
          data: {
            email: parsed.data.email,
            name: parsed.data.name,
            passwordHash: await hashPassword(parsed.data.password),
            role: 'constituency_admin',
            assemblyId: assembly.id,
          },
        });

        return reply.code(201).send(toConstituencyAdmin(created));
      },
    );

    /** Deactivates, reactivates or resets the password of a constituency admin. */
    guarded.patch(
      '/admins/:adminId',
      { preHandler: guarded.requireSuperAdmin },
      async (request, reply) => {
        const { adminId } = request.params as { adminId: string };
        const parsed = updateConstituencyAdminRequestSchema.safeParse(request.body);

        if (!parsed.success) {
          return reply.code(400).send({
            message: parsed.error.issues[0]?.message ?? 'Invalid request.',
            issues: parsed.error.issues,
          });
        }

        const existing = await prisma.adminUser.findUnique({ where: { id: adminId } });

        // Super admin accounts are managed from the seed, not from here.
        if (!existing || existing.role !== 'constituency_admin') {
          return reply.code(404).send({ message: 'Admin not found.' });
        }

        const updated = await prisma.adminUser.update({
          where: { id: adminId },
          data: {
            isActive: parsed.data.isActive,
            passwordHash: parsed.data.password ? await hashPassword(parsed.data.password) : undefined,
          },
        });

        return toConstituencyAdmin(updated);
      },
    );
  });
};
