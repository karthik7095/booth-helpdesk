import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { env } from '../env.js';
import { prisma } from '../prisma.js';
import { codeProblem, refuse } from './devices.js';

/**
 * Cloud OCR for the desktop app: re-reads the voter boxes the on-device OCR
 * could not read cleanly, with the self-hosted Surya service (services/ocr).
 * Only activated, unblocked computers may call it; the images are passed
 * through to the service on localhost and nothing is stored.
 */
const recognizeSchema = z.object({
  fingerprint: z.string().min(8).max(200),
  // base64 PNG crops of voter-box bodies; ~30-80 KB each in practice
  images: z.array(z.string().min(16).max(1_500_000)).min(1).max(40),
});

/** A full page of 30 boxes on a slow CPU can take a few minutes. */
const OCR_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Secondary-language columns for English rolls: the distinct name words of a
 * roll, transliterated by the self-hosted IndicXlit service (services/xlit).
 */
const transliterateSchema = z.object({
  fingerprint: z.string().min(8).max(200),
  lang: z.enum(['te', 'hi']),
  words: z.array(z.string().regex(/^[A-Za-z]{1,40}$/)).min(1).max(400),
});

/** ~0.1-0.3 s per new word on the server's CPU; the app sends 150 at a time. */
const XLIT_TIMEOUT_MS = 110 * 1000;

/**
 * The calling computer, if it is activated, unblocked and its code still valid;
 * otherwise the refusal has been sent and null is returned.
 */
async function licensedDevice(request: FastifyRequest, reply: FastifyReply, fingerprint: string) {
  try {
    await request.jwtVerify();
  } catch {
    refuse(reply, 401, 'unknown_device', 'This computer is not activated.');
    return null;
  }
  const { dev, fp } = request.user;
  if (!dev || !fp) {
    refuse(reply, 401, 'unknown_device', 'This computer is not activated.');
    return null;
  }
  if (fingerprint !== fp) {
    refuse(reply, 403, 'fingerprint_mismatch', 'This licence belongs to a different computer.');
    return null;
  }
  const device = await prisma.device.findUnique({ where: { id: dev }, include: { activationCode: true } });
  if (!device || device.fingerprint !== fp) {
    refuse(reply, 401, 'unknown_device', 'This computer is no longer registered. Activate it again.');
    return null;
  }
  if (device.status === 'revoked') {
    refuse(reply, 403, 'revoked', 'This computer has been blocked. Contact IRA Media Concepts.');
    return null;
  }
  const problem = codeProblem(device.activationCode);
  if (problem) {
    refuse(reply, 403, problem.reason, problem.message);
    return null;
  }
  return device;
}

export const ocrRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/recognize',
    { bodyLimit: 25 * 1024 * 1024, config: { rateLimit: { max: 120, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = recognizeSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: 'Bad request.' });
      const device = await licensedDevice(request, reply, parsed.data.fingerprint);
      if (!device) return reply;

      let res: Response;
      try {
        res = await fetch(`${env.OCR_URL.replace(/\/$/, '')}/recognize`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ images: parsed.data.images }),
          signal: AbortSignal.timeout(OCR_TIMEOUT_MS),
        });
      } catch (error) {
        request.log.error({ err: error }, 'ocr service unreachable');
        return reply.code(503).send({ message: 'The cloud OCR service is not available right now.' });
      }
      const data = (await res.json().catch(() => null)) as { texts?: unknown; ms?: number; message?: string } | null;
      if (!res.ok || !data || !Array.isArray(data.texts)) {
        request.log.error({ status: res.status, message: data?.message }, 'ocr service error');
        return reply.code(502).send({ message: 'The cloud OCR service could not read these images.' });
      }
      request.log.info({ deviceId: device.id, images: parsed.data.images.length, ms: data.ms }, 'cloud ocr');
      return { texts: data.texts.map((t) => String(t ?? '')), ms: data.ms ?? 0 };
    },
  );

  app.post(
    '/transliterate',
    { bodyLimit: 256 * 1024, config: { rateLimit: { max: 240, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = transliterateSchema.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ message: 'Bad request.' });
      const device = await licensedDevice(request, reply, parsed.data.fingerprint);
      if (!device) return reply;

      const { lang, words } = parsed.data;
      let res: Response;
      try {
        res = await fetch(`${env.XLIT_URL.replace(/\/$/, '')}/transliterate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lang, words }),
          signal: AbortSignal.timeout(XLIT_TIMEOUT_MS),
        });
      } catch (error) {
        request.log.error({ err: error }, 'transliteration service unreachable');
        return reply.code(503).send({ message: 'The transliteration service is not available right now.' });
      }
      const data = (await res.json().catch(() => null)) as { words?: unknown; ms?: number; message?: string } | null;
      if (!res.ok || !data || !Array.isArray(data.words) || data.words.length !== words.length) {
        request.log.error({ status: res.status, message: data?.message }, 'transliteration service error');
        return reply.code(502).send({ message: 'The transliteration service could not convert these names.' });
      }
      request.log.info({ deviceId: device.id, lang, words: words.length, ms: data.ms }, 'transliterate');
      return { words: data.words.map((w) => String(w ?? '')), ms: data.ms ?? 0 };
    },
  );
};
