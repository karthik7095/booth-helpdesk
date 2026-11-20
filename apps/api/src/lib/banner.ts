import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '../prisma.js';

/** Images live next to the API on disk — no cloud storage for now. */
const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.uploads/banners');

/**
 * A constituency carries two unrelated images: the home-screen banner, and the
 * cover printed above each voter slip. They are stored and versioned
 * separately because they are replaced independently and are wanted in very
 * different formats — the slip cover is dithered to one bit for a thermal head.
 */
export type ImageKind = 'banner' | 'slip' | 'whatsapp';

const COLUMNS = {
  banner: { path: 'bannerPath', mime: 'bannerMime', updatedAt: 'bannerUpdatedAt' },
  slip: { path: 'slipImagePath', mime: 'slipImageMime', updatedAt: 'slipImageUpdatedAt' },
  whatsapp: {
    path: 'whatsappImagePath',
    mime: 'whatsappImageMime',
    updatedAt: 'whatsappImageUpdatedAt',
  },
} as const;

const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
]);

/** The WhatsApp attachment may also be a short video; WhatsApp sends MP4 with a caption. */
const VIDEO = new Map([['video/mp4', 'mp4']]);

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_VIDEO_BYTES = 16 * 1024 * 1024;

export type SavedBanner = { mime: string; bytes: number; updatedAt: Date };

/** Accepts a `data:image/png;base64,...` string, as sent by the dashboard. */
export async function saveBanner(
  assemblyId: string,
  dataUrl: string,
  kind: ImageKind = 'banner',
): Promise<SavedBanner> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) throw new Error('Expected a base64 image.');

  const [, mime, base64] = match as unknown as [string, string, string];
  const video = kind === 'whatsapp' ? VIDEO.get(mime.toLowerCase()) : undefined;
  const extension = ALLOWED.get(mime.toLowerCase()) ?? video;

  if (!extension) {
    throw new Error(
      kind === 'whatsapp' ? 'Use a PNG, JPEG or WebP image, or an MP4 video.' : 'Use a PNG, JPEG or WebP image.',
    );
  }

  const buffer = Buffer.from(base64, 'base64');

  if (buffer.byteLength === 0) throw new Error('That file is empty.');
  if (video && buffer.byteLength > MAX_VIDEO_BYTES) throw new Error('Keep the video under 16 MB.');
  if (!video && buffer.byteLength > MAX_BYTES) throw new Error('Keep the image under 4 MB.');

  await mkdir(UPLOAD_DIR, { recursive: true });

  const suffix = kind === 'banner' ? '' : `-${kind}`;
  const path = join(UPLOAD_DIR, `${assemblyId}${suffix}.${extension}`);
  await writeFile(path, buffer);

  // Switching between an image and a video changes the extension; drop the old file.
  const previous = (await prisma.assembly.findUnique({ where: { id: assemblyId } }))?.[
    COLUMNS[kind].path
  ];

  if (previous && previous !== path) await rm(previous, { force: true });

  const updatedAt = new Date();
  const columns = COLUMNS[kind];

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: {
      [columns.path]: path,
      [columns.mime]: mime.toLowerCase(),
      [columns.updatedAt]: updatedAt,
    },
  });

  return { mime: mime.toLowerCase(), bytes: buffer.byteLength, updatedAt };
}

export async function readBanner(
  assemblyId: string,
  kind: ImageKind = 'banner',
): Promise<{ body: Buffer; mime: string; updatedAt: Date } | null> {
  const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } });
  const columns = COLUMNS[kind];
  const path = assembly?.[columns.path];
  const mime = assembly?.[columns.mime];

  if (!path || !mime) return null;

  const body = await readFile(path).catch(() => null);

  if (!body) return null;

  return { body, mime, updatedAt: assembly[columns.updatedAt] ?? new Date(0) };
}
