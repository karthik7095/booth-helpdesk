import { createPrivateKey, randomInt, sign } from 'node:crypto';

import {
  createActivationCodeRequestSchema,
  deviceActivateRequestSchema,
  deviceCheckRequestSchema,
  updateActivationCodeRequestSchema,
  updateDeviceRequestSchema,
  type ActivationCode,
  type Device,
  type DeviceActivateResponse,
  type DeviceCheckResponse,
  type DeviceLease,
  type DeviceLicense,
  type DeviceRefusalReason,
} from '@voter/shared';
import type { FastifyPluginAsync, FastifyReply } from 'fastify';

import { env } from '../env.js';
import { prisma } from '../prisma.js';

/** Leases are short: the app re-checks on every launch and every ten minutes. */
const LEASE_TTL_SECONDS = 15 * 60;

const signingKey = env.LICENSE_SIGNING_KEY
  ? createPrivateKey({ key: Buffer.from(env.LICENSE_SIGNING_KEY, 'base64'), format: 'der', type: 'pkcs8' })
  : null;

/** Signed proof for the desktop app that this device may run right now. */
function issueLease(device: { id: string; fingerprint: string }, codeLabel: string): DeviceLease {
  if (!signingKey) throw new Error('LICENSE_SIGNING_KEY is not configured');
  const data = Buffer.from(
    JSON.stringify({ deviceId: device.id, fingerprint: device.fingerprint, exp: Math.floor(Date.now() / 1000) + LEASE_TTL_SECONDS, codeLabel }),
  );
  return { data: data.toString('base64url'), sig: sign(null, data, signingKey).toString('base64url') };
}

/** Device tokens are long-lived: the API re-checks the device on every launch anyway. */
const DEVICE_TOKEN_TTL = '3650d';

// No 0/O/1/I so codes can be read out over the phone.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(): string {
  let s = 'VRC';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** "VRC7K3M9QWD2HXP" -> "VRC-7K3M-9QWD-2HXP" */
export function formatCode(code: string): string {
  return code.replace(/^(VRC)(.{4})(.{4})(.{4})$/, '$1-$2-$3-$4');
}

export function refuse(reply: FastifyReply, status: number, reason: DeviceRefusalReason, message: string) {
  return reply.code(status).send({ reason, message });
}

type CodeRow = { id: string; code: string; label: string; isActive: boolean; expiresAt: Date | null };

export function codeProblem(code: CodeRow | null): { reason: DeviceRefusalReason; message: string } | null {
  if (!code) return { reason: 'invalid_code', message: 'That activation code is not recognised.' };
  if (!code.isActive) return { reason: 'code_disabled', message: 'This activation code has been disabled.' };
  if (code.expiresAt && code.expiresAt < new Date()) {
    return { reason: 'code_expired', message: 'This activation code has expired.' };
  }
  return null;
}

function licenseOf(device: { id: string; name: string }, code: CodeRow): DeviceLicense {
  return {
    deviceId: device.id,
    deviceName: device.name,
    codeLabel: code.label,
    expiresAt: code.expiresAt?.toISOString() ?? null,
  };
}

/** Public routes used by the desktop app. */
export const deviceRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/activate',
    { config: { rateLimit: { max: 10, timeWindow: '5 minutes' } } },
    async (request, reply) => {
      const parsed = deviceActivateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ message: 'Please check the details you entered.', issues: parsed.error.issues });
      }
      const { code: codeText, fingerprint, name, platform, osVersion, appVersion } = parsed.data;

      const code = await prisma.activationCode.findUnique({
        where: { code: codeText },
        include: { _count: { select: { devices: { where: { status: 'active' } } } } },
      });
      const problem = codeProblem(code);
      if (problem || !code) return refuse(reply, 403, problem!.reason, problem!.message);

      const existing = await prisma.device.findUnique({ where: { fingerprint } });
      if (existing?.status === 'revoked' && existing.activationCodeId === code.id) {
        return refuse(reply, 403, 'revoked', 'This computer has been blocked. Contact IRA Media Concepts.');
      }

      // A new computer (or one moving to this code) needs a free slot.
      const occupies = existing?.activationCodeId === code.id && existing.status === 'active' ? 1 : 0;
      if (code._count.devices - occupies >= code.maxDevices) {
        return refuse(
          reply,
          403,
          'code_full',
          `This activation code is already in use on ${code.maxDevices} computer${code.maxDevices === 1 ? '' : 's'}.`,
        );
      }

      const device = existing
        ? await prisma.device.update({
            where: { id: existing.id },
            data: { name, platform, osVersion, appVersion, status: 'active', activationCodeId: code.id, lastSeenAt: new Date() },
          })
        : await prisma.device.create({
            data: { fingerprint, name, platform, osVersion, appVersion, activationCodeId: code.id },
          });

      request.log.info({ deviceId: device.id, code: code.id }, 'device activated');
      if (!signingKey) return reply.code(500).send({ message: 'Licence signing is not configured on the server.' });
      const response: DeviceActivateResponse = {
        token: app.jwt.sign({ dev: device.id, fp: fingerprint }, { expiresIn: DEVICE_TOKEN_TTL }),
        license: licenseOf(device, code),
        lease: issueLease(device, code.label),
      };
      return response;
    },
  );

  app.post(
    '/check',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      try {
        await request.jwtVerify();
      } catch {
        return refuse(reply, 401, 'unknown_device', 'This computer is not activated.');
      }
      const { dev, fp } = request.user;
      if (!dev || !fp) return refuse(reply, 401, 'unknown_device', 'This computer is not activated.');

      const parsed = deviceCheckRequestSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: 'Bad request.' });
      if (parsed.data.fingerprint !== fp) {
        return refuse(reply, 403, 'fingerprint_mismatch', 'This licence belongs to a different computer.');
      }

      const device = await prisma.device.findUnique({ where: { id: dev }, include: { activationCode: true } });
      if (!device || device.fingerprint !== fp) {
        return refuse(reply, 401, 'unknown_device', 'This computer is no longer registered. Activate it again.');
      }
      if (device.status === 'revoked') {
        return refuse(reply, 403, 'revoked', 'This computer has been blocked. Contact IRA Media Concepts.');
      }
      const problem = codeProblem(device.activationCode);
      if (problem) return refuse(reply, 403, problem.reason, problem.message);

      const stats = parsed.data.stats;
      await prisma.device.update({
        where: { id: device.id },
        data: {
          lastSeenAt: new Date(),
          appVersion: parsed.data.appVersion ?? device.appVersion,
          checkIns: { increment: 1 },
          ...(stats ? { conversions: { increment: stats.conversions }, voters: { increment: stats.voters } } : {}),
        },
      });

      if (!signingKey) return reply.code(500).send({ message: 'Licence signing is not configured on the server.' });
      const response: DeviceCheckResponse = {
        ok: true,
        license: licenseOf(device, device.activationCode),
        lease: issueLease(device, device.activationCode.label),
      };
      return response;
    },
  );
};

type CodeWithCounts = CodeRow & {
  maxDevices: number;
  createdAt: Date;
  devices: { status: 'active' | 'revoked' }[];
};

function toActivationCode(row: CodeWithCounts): ActivationCode {
  return {
    id: row.id,
    code: formatCode(row.code),
    label: row.label,
    maxDevices: row.maxDevices,
    isActive: row.isActive,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    deviceCount: row.devices.length,
    activeDeviceCount: row.devices.filter((d) => d.status === 'active').length,
  };
}

type DeviceRow = {
  id: string;
  name: string;
  platform: string;
  osVersion: string | null;
  appVersion: string | null;
  fingerprint: string;
  status: 'active' | 'revoked';
  activationCodeId: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  checkIns: number;
  conversions: number;
  voters: number;
  activationCode: { code: string; label: string };
};

function toDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    name: row.name,
    platform: (['darwin', 'win32', 'linux'].includes(row.platform) ? row.platform : 'linux') as Device['platform'],
    osVersion: row.osVersion,
    appVersion: row.appVersion,
    fingerprintHint: row.fingerprint.slice(-8),
    status: row.status,
    activationCodeId: row.activationCodeId,
    code: formatCode(row.activationCode.code),
    codeLabel: row.activationCode.label,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    checkIns: row.checkIns,
    conversions: row.conversions,
    voters: row.voters,
  };
}

/** Licence management, under /api/admin; only the hidden developer role can reach it. */
export const adminDeviceRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', app.requireAdmin);
  app.addHook('preHandler', app.requireDeveloper);

  app.get('/activation-codes', async () => {
    const rows = await prisma.activationCode.findMany({
      orderBy: { createdAt: 'desc' },
      include: { devices: { select: { status: true } } },
    });
    return rows.map(toActivationCode);
  });

  app.post('/activation-codes', async (request, reply) => {
    const parsed = createActivationCodeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Please check the details you entered.', issues: parsed.error.issues });
    }
    // Retry on the (very unlikely) duplicate.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateCode();
      const exists = await prisma.activationCode.findUnique({ where: { code } });
      if (exists) continue;
      const row = await prisma.activationCode.create({
        data: {
          code,
          label: parsed.data.label,
          maxDevices: parsed.data.maxDevices,
          expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
          createdById: request.admin.id,
        },
        include: { devices: { select: { status: true } } },
      });
      return reply.code(201).send(toActivationCode(row));
    }
    return reply.code(500).send({ message: 'Could not generate a unique code, try again.' });
  });

  app.patch<{ Params: { id: string } }>('/activation-codes/:id', async (request, reply) => {
    const parsed = updateActivationCodeRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Please check the details you entered.' });
    const { expiresAt, ...rest } = parsed.data;
    const data = { ...rest, ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}) };
    const row = await prisma.activationCode
      .update({ where: { id: request.params.id }, data, include: { devices: { select: { status: true } } } })
      .catch(() => null);
    if (!row) return reply.code(404).send({ message: 'Activation code not found.' });
    return toActivationCode(row);
  });

  app.delete<{ Params: { id: string } }>('/activation-codes/:id', async (request, reply) => {
    const deleted = await prisma.activationCode.delete({ where: { id: request.params.id } }).catch(() => null);
    if (!deleted) return reply.code(404).send({ message: 'Activation code not found.' });
    return { ok: true };
  });

  app.get('/devices', async () => {
    const rows = await prisma.device.findMany({
      orderBy: { lastSeenAt: 'desc' },
      include: { activationCode: { select: { code: true, label: true } } },
    });
    return rows.map(toDevice);
  });

  app.patch<{ Params: { id: string } }>('/devices/:id', async (request, reply) => {
    const parsed = updateDeviceRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ message: 'Please check the details you entered.' });
    const row = await prisma.device
      .update({
        where: { id: request.params.id },
        data: parsed.data,
        include: { activationCode: { select: { code: true, label: true } } },
      })
      .catch(() => null);
    if (!row) return reply.code(404).send({ message: 'Device not found.' });
    return toDevice(row);
  });

  app.delete<{ Params: { id: string } }>('/devices/:id', async (request, reply) => {
    const deleted = await prisma.device.delete({ where: { id: request.params.id } }).catch(() => null);
    if (!deleted) return reply.code(404).send({ message: 'Device not found.' });
    return { ok: true };
  });
};
