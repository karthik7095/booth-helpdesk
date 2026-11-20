import compress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';

import { env } from './env.js';
import authPlugin from './plugins/auth.js';
import { adminRoutes } from './routes/admin.js';
import { authRoutes } from './routes/auth.js';
import { adminDeviceRoutes, deviceRoutes } from './routes/devices.js';
import { importRoutes } from './routes/imports.js';
import { ocrRoutes } from './routes/ocr.js';
import { syncRoutes } from './routes/sync.js';
import { usageRoutes } from './routes/usage.js';
import { voterRoutes } from './routes/voters.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? { level: 'debug', transport: { target: 'pino-pretty' } }
        : { level: 'info' },
    // Node closes an idle keep-alive socket after 5 s by default. A phone
    // writing one seed page to SQLite takes longer than that between
    // requests, and a socket closed under its next request shows up on the
    // phone as a cut-off body. Hold connections open well past that.
    keepAliveTimeout: 65_000,
    // In production Apache terminates TLS and proxies /backend/ to this
    // process over loopback. Without this every phone would share the proxy's
    // address and the per-IP login rate limit would lock everyone out together.
    trustProxy: 'loopback',
  });

  await app.register(sensible);
  // The seed pages are ~3.3 MB of JSON each and 60 of them make up a first
  // download; gzip takes that from ~197 MB to ~21 MB.
  await app.register(compress, {
    global: true,
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
    // Level 4 rather than the default 6: on this shared box CPU is scarcer
    // than bandwidth, and the seed pages compress to within a few percent.
    zlibOptions: { level: 4 },
  });
  await app.register(rateLimit, { global: false });
  await app.register(cors, { origin: true });
  await app.register(authPlugin);

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(adminRoutes, { prefix: '/api/admin' });
  await app.register(importRoutes, { prefix: '/api/admin/imports' });
  await app.register(voterRoutes, { prefix: '/api/voters' });
  await app.register(syncRoutes, { prefix: '/api/sync' });
  await app.register(usageRoutes, { prefix: '/api/usage' });
  await app.register(deviceRoutes, { prefix: '/api/devices' });
  await app.register(ocrRoutes, { prefix: '/api/ocr' });
  await app.register(adminDeviceRoutes, { prefix: '/api/admin' });

  return app;
}
