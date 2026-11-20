import {
  loginRequestSchema,
  otpRequestSchema,
  pinRequestSchema,
  type LoginResponse,
  type PinResponse,
  type Session,
} from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import { otpEnabled, OtpError, verifyAccessToken } from '../lib/otp.js';
import { pollDetailsOf } from '../lib/poll-details.js';
import { announcementOf } from '../lib/announcement.js';
import { appFeaturesOf } from '../lib/app-features.js';
import { statsVisibilityOf } from '../lib/stats-visibility.js';
import { isAppAdmin, refusalFor, wardNosOf } from '../lib/app-user-access.js';
import { prisma } from '../prisma.js';
import { blockDevice, blockFor, DEACTIVATED, deviceIdOf } from '../lib/user-blocks.js';

export const authRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Step 1 — open a session. Anyone may sign in; the session carries no access
   * to voter data until the mobile number is confirmed by OTP (when MSG91 is
   * configured) and a PIN is verified against it.
   */
  app.post('/login', async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.code(400).send({
        message: 'Please check the details you entered.',
        issues: parsed.error.issues,
      });
    }

    const deviceId = deviceIdOf(request.headers);
    const block = await blockFor(parsed.data.mobileNumber, [deviceId]);

    if (block) {
      if (block === DEACTIVATED && deviceId) await blockDevice(deviceId, parsed.data.mobileNumber);

      return reply.code(403).send(block);
    }

    const session = await prisma.loginSession.create({ data: { ...parsed.data, deviceId } });

    const response: LoginResponse = {
      token: app.jwt.sign({ sid: session.id }),
      session: {
        id: session.id,
        fullName: session.fullName,
        mobileNumber: session.mobileNumber,
      },
      requiresPin: true,
      requiresOtp: otpEnabled(),
    };

    return response;
  });

  /**
   * Step 1b — confirm the mobile number. The app verifies the texted code with
   * the MSG91 widget and sends the widget's access token here; it must belong
   * to this session's number.
   */
  app.post(
    '/otp',
    {
      preHandler: app.authenticate,
      // Per address: agents on one mobile network can share it.
      config: { rateLimit: { max: 30, timeWindow: '10 minutes' } },
    },
    async (request, reply) => {
      const parsed = otpRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({ message: 'Please enter the OTP again.', issues: parsed.error.issues });
      }

      if (!otpEnabled() || request.session.otpVerified) return { verified: true };

      let check;
      try {
        check = await verifyAccessToken(parsed.data.accessToken, request.session.mobileNumber);
      } catch (error) {
        if (error instanceof OtpError) return reply.code(503).send({ message: error.message });
        throw error;
      }

      if (!check.ok) {
        request.log.warn({ sessionId: request.session.sessionId, reason: check.reason }, 'otp token refused');
        return reply.code(401).send({ message: 'The OTP could not be confirmed. Please request a new one.' });
      }

      await prisma.loginSession.update({
        where: { id: request.session.sessionId },
        data: { otpVerifiedAt: new Date() },
      });

      return { verified: true };
    },
  );

  /**
   * Step 2 — unlock the session with an access PIN issued by a super admin.
   * Rate limited because the PIN is the only real credential in this flow.
   */
  app.post(
    '/pin',
    {
      preHandler: app.authenticate,
      config: { rateLimit: { max: 10, timeWindow: '5 minutes' } },
    },
    async (request, reply) => {
      if (otpEnabled() && !request.session.otpVerified) {
        return reply.code(403).send({
          message: 'Please confirm your mobile number with the OTP first.',
          code: 'OTP_REQUIRED',
        });
      }

      const parsed = pinRequestSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.code(400).send({
          message: 'Please check the PIN you entered.',
          issues: parsed.error.issues,
        });
      }

      const pin = await prisma.accessPin.findUnique({
        where: { pin: parsed.data.pin },
        include: { assembly: true },
      });

      if (!pin) {
        return reply.code(401).send({ message: 'That PIN is not recognised.' });
      }

      if (!pin.isActive) {
        return reply.code(403).send({ message: 'This PIN has been deactivated. Contact your admin.' });
      }

      if (pin.expiresAt && pin.expiresAt.getTime() < Date.now()) {
        return reply.code(403).send({ message: 'This PIN has expired. Contact your admin.' });
      }

      if (!pin.assembly.isActive) {
        return reply.code(403).send({
          message: 'This constituency has been deactivated by the admin.',
          code: 'ASSEMBLY_INACTIVE',
        });
      }

      // Removed from this constituency, or waiting for an admin's approval: the
      // PIN is not attached. A first-time user is filed as pending here.
      const refusal = await refusalFor(
        pin.assembly,
        { mobileNumber: request.session.mobileNumber, fullName: request.session.fullName },
        { file: true },
      );

      if (refusal) return reply.code(403).send(refusal);

      await prisma.$transaction([
        prisma.loginSession.update({
          where: { id: request.session.sessionId },
          data: { accessPinId: pin.id, verifiedAt: new Date() },
        }),
        prisma.accessPin.update({
          where: { id: pin.id },
          data: { lastUsedAt: new Date(), usageCount: { increment: 1 } },
        }),
      ]);

      const response: PinResponse = {
        token: app.jwt.sign({ sid: request.session.sessionId, pid: pin.id }),
        access: {
          pinId: pin.id,
          label: pin.label,
          assemblyNo: pin.assembly.assemblyNo,
          assemblyName: pin.assembly.nameEn,
          partNos: pin.partNos,
          wardNos: await wardNosOf(pin.assembly.id, request.session.mobileNumber),
          bannerUpdatedAt: pin.assembly.bannerUpdatedAt?.toISOString() ?? null,
          slipImageUpdatedAt: pin.assembly.slipImageUpdatedAt?.toISOString() ?? null,
          whatsappImageUpdatedAt: pin.assembly.whatsappImageUpdatedAt?.toISOString() ?? null,
          rollVersion: pin.assembly.rollVersion,
          canApproveUsers: await isAppAdmin(pin.assembly.id, request.session.mobileNumber),
          ...pollDetailsOf(pin.assembly),
          ...statsVisibilityOf(pin.assembly),
          ...appFeaturesOf(pin.assembly),
          ...announcementOf(pin.assembly),
        },
      };

      return response;
    },
  );

  /**
   * Signing out of the app drops only the PIN: the session keeps its name and
   * confirmed mobile number, so the agent signs back in with the PIN alone.
   */
  app.post('/pin/release', { preHandler: app.authenticate }, async (request, reply) => {
    await prisma.loginSession.update({
      where: { id: request.session.sessionId },
      data: { accessPinId: null },
    });

    return reply.code(204).send();
  });

  /** Restores a session on app launch — tells the client whether a PIN is still needed. */
  app.get('/me', { preHandler: app.authenticate }, async (request) => {
    const session: Session = {
      id: request.session.sessionId,
      fullName: request.session.fullName,
      mobileNumber: request.session.mobileNumber,
      verified: request.session.access !== null,
      // Sessions unlocked before OTP was switched on keep working.
      otpPending: otpEnabled() && !request.session.otpVerified && request.session.access === null,
      access: request.session.access,
    };

    return session;
  });
};
