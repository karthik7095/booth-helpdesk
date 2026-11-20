import { usageHeartbeatSchema } from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import { namePlaceLater } from '../lib/geocode.js';
import { dateColumn, todayIst } from '../lib/usage.js';
import { prisma } from '../prisma.js';

export const usageRoutes: FastifyPluginAsync = async (app) => {
  /**
   * The app calls this about once a minute while open. Each call adds to the
   * caller's row for today, so the table holds one row per session per day.
   */
  app.post(
    '/heartbeat',
    {
      preHandler: app.requireAccess,
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const parsed = usageHeartbeatSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ message: 'Invalid heartbeat.', issues: parsed.error.issues });
      }

      const { opened, seconds, location } = parsed.data;
      const now = new Date();
      const sessionId = request.session.sessionId;
      const date = dateColumn(todayIst(now));

      const pin = await prisma.accessPin.findUnique({
        where: { id: request.access.pinId },
        select: { assemblyId: true },
      });

      const located = location
        ? {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy ?? null,
            locatedAt: now,
            // Cleared until the new fix has been looked up.
            placeName: null,
          }
        : {};

      const upsert = () =>
        prisma.appUsageDay.upsert({
          where: { sessionId_date: { sessionId, date } },
          create: {
            sessionId,
            assemblyId: pin?.assemblyId ?? null,
            date,
            opens: opened ? 1 : 0,
            activeSeconds: seconds,
            firstSeenAt: now,
            lastSeenAt: now,
            ...located,
          },
          update: {
            opens: { increment: opened ? 1 : 0 },
            activeSeconds: { increment: seconds },
            lastSeenAt: now,
            ...located,
          },
        });

      // Two first heartbeats racing can both try to create today's row; the
      // loser retries as an update.
      const row = await upsert().catch(() => upsert());

      if (location) namePlaceLater(row.id, location.latitude, location.longitude);

      return reply.code(204).send();
    },
  );
};
