import fastifyJwt from '@fastify/jwt';
import type { Access, AdminRole } from '@voter/shared';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { env } from '../env.js';
import { pollDetailsOf } from '../lib/poll-details.js';
import { announcementOf } from '../lib/announcement.js';
import { appFeaturesOf } from '../lib/app-features.js';
import { statsVisibilityOf } from '../lib/stats-visibility.js';
import { prisma } from '../prisma.js';
import { blockDevice, blockFor, DEACTIVATED, deviceIdOf } from '../lib/user-blocks.js';
import { isAppAdmin, refusalFor, REMOVED, wardNosOf } from '../lib/app-user-access.js';

export type SessionContext = {
  sessionId: string;
  fullName: string;
  mobileNumber: string;
  /** The mobile number was confirmed with the OTP texted at sign-in. */
  otpVerified: boolean;
  /** Set once a valid PIN has been verified against the session. */
  access: Access | null;
};

export type AdminContext = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  /** The only constituency a constituency admin may see; null for super admins. */
  assemblyId: string | null;
  assemblyName: string | null;
};

declare module 'fastify' {
  interface FastifyInstance {
    /** Requires a signed-in session (name + mobile), PIN verified or not. */
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Requires a session unlocked by a valid access PIN. */
    requireAccess: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Requires an admin token from the web dashboard — super or constituency admin. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Runs after `requireAdmin`; turns constituency admins away (super admins and the developer pass). */
    requireSuperAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Runs after `requireAdmin`; only the hidden developer role passes. */
    requireDeveloper: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }

  interface FastifyRequest {
    session: SessionContext;
    /** Set only after `requireAccess` has run. */
    access: Access;
    /** Set only after `requireAdmin` has run. */
    admin: AdminContext;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sid?: string; pid?: string; adm?: string; dev?: string; fp?: string };
    user: { sid?: string; pid?: string; adm?: string; dev?: string; fp?: string };
  }
}

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // Declared without a shared value; each request gets its own, set below.
  app.decorateRequest('session');
  app.decorateRequest('access');
  app.decorateRequest('admin');

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ message: 'Session expired, please sign in again.' });
    }

    if (!request.user.sid) {
      return reply.code(401).send({ message: 'Session expired, please sign in again.' });
    }

    const session = await prisma.loginSession.findUnique({
      where: { id: request.user.sid },
      include: { accessPin: { include: { assembly: true } } },
    });

    if (!session) {
      return reply.code(401).send({ message: 'Session expired, please sign in again.' });
    }

    const deviceId = deviceIdOf(request.headers);
    const block = await blockFor(session.mobileNumber, [deviceId, session.deviceId]);

    if (block) {
      // A phone still signed in with the switched-off number is blocked too,
      // even if its session started before its build sent an install id.
      if (block === DEACTIVATED && deviceId) await blockDevice(deviceId, session.mobileNumber);

      return reply.code(403).send(block);
    }

    // Sessions opened by older builds learn their install id once updated.
    if (deviceId && session.deviceId !== deviceId) {
      void prisma.loginSession
        .update({ where: { id: session.id }, data: { deviceId } })
        .catch(() => undefined);
    }

    let pin = session.accessPin;

    // Removed from this constituency, or (with approval required) not approved:
    // the session loses the PIN. Removed users are told and signed out; one
    // waiting for approval just lands back on the PIN screen, which shows the wait.
    if (pin) {
      const refusal = await refusalFor(pin.assembly, session);

      if (refusal) {
        await prisma.loginSession.update({ where: { id: session.id }, data: { accessPinId: null } }).catch(() => undefined);

        if (refusal === REMOVED) return reply.code(403).send(refusal);

        pin = null;
      }
    }

    const expired = pin?.expiresAt ? pin.expiresAt.getTime() < Date.now() : false;

    if (pin && (!pin.isActive || expired)) {
      return reply.code(403).send({
        message: 'This PIN is no longer active. Ask your admin for a new one.',
        code: 'PIN_REVOKED',
      });
    }

    if (pin && !pin.assembly.isActive) {
      return reply.code(403).send({
        message: 'This constituency has been deactivated by the admin.',
        code: 'ASSEMBLY_INACTIVE',
      });
    }

    request.session = {
      sessionId: session.id,
      fullName: session.fullName,
      mobileNumber: session.mobileNumber,
      otpVerified: session.otpVerifiedAt !== null,
      access: pin
        ? {
            pinId: pin.id,
            label: pin.label,
            assemblyNo: pin.assembly.assemblyNo,
            assemblyName: pin.assembly.nameEn,
            partNos: pin.partNos,
            wardNos: await wardNosOf(pin.assembly.id, session.mobileNumber),
            bannerUpdatedAt: pin.assembly.bannerUpdatedAt?.toISOString() ?? null,
            slipImageUpdatedAt: pin.assembly.slipImageUpdatedAt?.toISOString() ?? null,
            whatsappImageUpdatedAt: pin.assembly.whatsappImageUpdatedAt?.toISOString() ?? null,
            rollVersion: pin.assembly.rollVersion,
            canApproveUsers: await isAppAdmin(pin.assembly.id, session.mobileNumber),
            ...pollDetailsOf(pin.assembly),
            ...statsVisibilityOf(pin.assembly),
            ...appFeaturesOf(pin.assembly),
            ...announcementOf(pin.assembly),
          }
        : null,
    };
  });

  app.decorate('requireAccess', async (request: FastifyRequest, reply: FastifyReply) => {
    await app.authenticate(request, reply);

    if (reply.sent) return;

    if (!request.session?.access) {
      return reply.code(403).send({
        message: 'Enter your access PIN to view voter data.',
        code: 'PIN_REQUIRED',
      });
    }

    request.access = request.session.access;

    void prisma.loginSession
      .update({ where: { id: request.session.sessionId }, data: { lastSeenAt: new Date() } })
      .catch(() => undefined);
  });

  app.decorate('requireAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch {
      return reply.code(401).send({ message: 'Your admin session has expired.' });
    }

    if (!request.user.adm) {
      return reply.code(401).send({ message: 'Your admin session has expired.' });
    }

    const admin = await prisma.adminUser.findUnique({
      where: { id: request.user.adm },
      include: { assembly: { select: { nameEn: true } } },
    });

    if (!admin || !admin.isActive) {
      return reply.code(401).send({ message: 'Your admin session has expired.' });
    }

    // A constituency admin whose constituency is gone has nothing left to see.
    if (admin.role === 'constituency_admin' && !admin.assemblyId) {
      return reply.code(401).send({ message: 'Your admin session has expired.' });
    }

    request.admin = {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      role: admin.role,
      assemblyId: admin.role === 'constituency_admin' ? admin.assemblyId : null,
      assemblyName: admin.role === 'constituency_admin' ? (admin.assembly?.nameEn ?? null) : null,
    };
  });

  app.decorate('requireSuperAdmin', async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.admin?.role !== 'super_admin' && request.admin?.role !== 'developer') {
      return reply.code(403).send({ message: 'Only a super admin can do that.' });
    }
  });

  app.decorate('requireDeveloper', async (request: FastifyRequest, reply: FastifyReply) => {
    // Same wording as a missing route, so the role stays invisible to everyone else.
    if (request.admin?.role !== 'developer') {
      return reply.code(404).send({ message: `Route ${request.method}:${request.url} not found` });
    }
  });
};

export default fp(authPlugin, { name: 'auth' });
