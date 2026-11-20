import {
  importAssemblyRequestSchema,
  importVotersRequestSchema,
  type Assembly,
  type ImportResult,
  type RollWipeImpact,
  type RollWipeResult,
} from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import { pollDetailsData, pollDetailsOf } from '../lib/poll-details.js';
import { seedPageCache } from '../lib/seed-cache.js';
import { announcementOf } from '../lib/announcement.js';
import { appFeaturesOf } from '../lib/app-features.js';
import { statsVisibilityOf } from '../lib/stats-visibility.js';
import { prisma } from '../prisma.js';

/** Rolls arrive in chunks; insert them in batches so one statement stays sane. */
const BATCH_SIZE = 500;

export const importRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);
  // Onboarding a constituency is a super admin job.
  app.addHook('preHandler', app.requireSuperAdmin);

  /** Step 1 — create the constituency, or reuse it if the number already exists. */
  app.post('/assembly', async (request, reply) => {
    const parsed = importAssemblyRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: 'Please check the constituency details.',
        issues: parsed.error.issues,
      });
    }

    const { assemblyNo, name, code, stateCode } = parsed.data;
    // Blank poll fields on a re-upload leave the saved ones alone.
    const poll = pollDetailsData({
      electionTitle: parsed.data.electionTitle ?? undefined,
      pollDate: parsed.data.pollDate ?? undefined,
      pollTime: parsed.data.pollTime ?? undefined,
    });

    const assembly = await prisma.assembly.upsert({
      where: { assemblyNo },
      update: { nameEn: name, code, stateCode, ...poll },
      create: { assemblyNo, nameEn: name, code, stateCode, ...poll },
    });

    const response: Assembly = {
      id: assembly.id,
      assemblyNo: assembly.assemblyNo,
      name: assembly.nameEn,
      stateCode: assembly.stateCode,
      code: assembly.code,
      voterCount: await prisma.voter.count({ where: { assemblyNo: assembly.assemblyNo } }),
      pinCount: await prisma.accessPin.count({ where: { assemblyId: assembly.id } }),
      bannerUpdatedAt: assembly.bannerUpdatedAt?.toISOString() ?? null,
      slipImageUpdatedAt: assembly.slipImageUpdatedAt?.toISOString() ?? null,
      whatsappImageUpdatedAt: assembly.whatsappImageUpdatedAt?.toISOString() ?? null,
      isActive: assembly.isActive,
      ...pollDetailsOf(assembly),
      ...statsVisibilityOf(assembly),
      ...appFeaturesOf(assembly),
      ...announcementOf(assembly),
    };

    return response;
  });

  /**
   * What a re-upload would wipe. Shown to the admin before they confirm, so
   * it counts exactly what the wipe below removes.
   */
  app.get('/:assemblyId/impact', async (request, reply) => {
    const { assemblyId } = request.params as { assemblyId: string };
    const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } });

    if (!assembly) {
      return reply.code(404).send({ message: 'That constituency does not exist.' });
    }

    const onRoll = { assemblyId: assembly.id };

    const [voters, enrollments, votedMarks, slipPrints, pins, appUsers, [edited]] =
      await Promise.all([
        prisma.voter.count({ where: onRoll }),
        prisma.voter.count({ where: { ...onRoll, isNewEnrollment: true } }),
        prisma.voter.count({ where: { ...onRoll, hasVoted: true } }),
        prisma.slipPrint.count({ where: onRoll }),
        prisma.accessPin.count({ where: onRoll }),
        prisma.loginSession.count({
          where: { verifiedAt: { not: null }, accessPin: { assemblyId: assembly.id } },
        }),
        // Imports write created_at and updated_at together; anything an agent
        // changed since has moved updated_at on. Enrollments are counted above.
        prisma.$queryRaw<{ count: number }[]>`
          SELECT COUNT(*)::int AS count FROM voters
          WHERE assembly_id = ${assembly.id}
            AND is_new_enrollment = false
            AND updated_at > created_at + interval '1 minute'`,
      ]);

    const impact: RollWipeImpact = {
      voters,
      enrollments,
      votedMarks,
      fieldEdits: edited?.count ?? 0,
      slipPrints,
      appUsers,
      pins,
    };

    return impact;
  });

  /**
   * Wipes the roll so a corrected sheet can be uploaded in its place. Slip
   * prints go with their voters; PINs, admins, the banner and usage stay. The
   * roll version moves on, which tells every phone holding the old roll to
   * download again rather than merge the new one into it.
   */
  app.delete('/:assemblyId/voters', async (request, reply) => {
    const { assemblyId } = request.params as { assemblyId: string };
    const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } });

    if (!assembly) {
      return reply.code(404).send({ message: 'That constituency does not exist.' });
    }

    const roll = {
      OR: [{ assemblyId: assembly.id }, { assemblyNo: assembly.assemblyNo }],
    };

    const slipPrints = await prisma.slipPrint.count({ where: { voter: roll } });

    const [deleted, bumped] = await prisma.$transaction([
      prisma.voter.deleteMany({ where: roll }),
      prisma.assembly.update({
        where: { id: assembly.id },
        data: { rollVersion: { increment: 1 } },
        select: { rollVersion: true },
      }),
    ]);

    request.log.warn(
      { assemblyId: assembly.id, voters: deleted.count, admin: request.admin.id },
      'roll wiped for re-upload',
    );
    seedPageCache.invalidate(assembly.assemblyNo);

    const result: RollWipeResult = {
      voters: deleted.count,
      slipPrints,
      rollVersion: bumped.rollVersion,
    };

    return result;
  });

  /**
   * Step 2 — attach rows to that constituency. Rows carry no assembly number of
   * their own here: everything in the sheet maps to the constituency chosen by
   * the admin. Re-importing the same sheet is safe — duplicates are skipped.
   */
  app.post(
    '/:assemblyId/voters',
    // A chunk of 5000 roll rows is comfortably larger than Fastify's 1MB default.
    { bodyLimit: 32 * 1024 * 1024 },
    async (request, reply) => {
      const { assemblyId } = request.params as { assemblyId: string };

      const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } });

      if (!assembly) {
        return reply.code(404).send({ message: 'That constituency does not exist.' });
      }

      const parsed = importVotersRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Some rows could not be read.',
          issues: parsed.error.issues.slice(0, 10),
        });
      }

      const rows = parsed.data.rows.map((row) => ({
        ...row,
        assemblyId: assembly.id,
        assemblyNo: assembly.assemblyNo,
        eAssemblyName: row.eAssemblyName ?? assembly.nameEn,
      }));

      let inserted = 0;

      for (let index = 0; index < rows.length; index += BATCH_SIZE) {
        const batch = rows.slice(index, index + BATCH_SIZE);
        const result = await prisma.voter.createMany({ data: batch, skipDuplicates: true });
        inserted += result.count;
      }

      // Cached download pages no longer describe the roll.
      if (inserted > 0) seedPageCache.invalidate(assembly.assemblyNo);

      const response: ImportResult = {
        received: rows.length,
        inserted,
        skipped: rows.length - inserted,
      };

      return response;
    },
  );
};
