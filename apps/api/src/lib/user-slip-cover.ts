import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { USER_SLIP_COVER_MAX_BYTES, type UserSlipCover } from '@voter/shared';

import { prisma } from '../prisma.js';

/** Beside the constituency images, one folder per constituency. */
const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.uploads/slip-covers');

const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
]);

export class SlipCoverError extends Error {}

const toCover = (row: { slot: number; mime: string; bytes: number; updatedAt: Date }): UserSlipCover => ({
  slot: row.slot,
  mime: row.mime,
  bytes: row.bytes,
  updatedAt: row.updatedAt.toISOString(),
});

export async function listUserSlipCovers(assemblyId: string, mobileNumber: string): Promise<UserSlipCover[]> {
  const rows = await prisma.userSlipCover.findMany({
    where: { assemblyId, mobileNumber },
    orderBy: { slot: 'asc' },
  });

  return rows.map(toCover);
}

/**
 * Replaces one slot's cover. The file it replaces is deleted first, so a user
 * can never hold more than two images on the server however often they upload.
 */
export async function saveUserSlipCover(
  assemblyId: string,
  mobileNumber: string,
  slot: number,
  dataUrl: string,
): Promise<UserSlipCover> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) throw new SlipCoverError('Expected a base64 image.');

  const mime = match[1]!.toLowerCase();
  const extension = ALLOWED.get(mime);

  if (!extension) throw new SlipCoverError('Use a PNG, JPEG or WebP image.');

  const buffer = Buffer.from(match[2]!, 'base64');

  if (buffer.byteLength === 0) throw new SlipCoverError('That image is empty.');
  if (buffer.byteLength > USER_SLIP_COVER_MAX_BYTES) {
    throw new SlipCoverError('Keep the slip cover under 1 MB.');
  }

  const existing = await prisma.userSlipCover.findUnique({
    where: { assemblyId_mobileNumber_slot: { assemblyId, mobileNumber, slot } },
  });

  if (existing) await rm(existing.path, { force: true });

  const folder = join(UPLOAD_DIR, assemblyId);
  await mkdir(folder, { recursive: true });

  // A new name each time, so no cache anywhere can hand back the old picture.
  const path = join(folder, `${mobileNumber.replace(/\D/g, '')}-${slot}-${Date.now()}.${extension}`);
  await writeFile(path, buffer);

  const saved = await prisma.userSlipCover.upsert({
    where: { assemblyId_mobileNumber_slot: { assemblyId, mobileNumber, slot } },
    create: { assemblyId, mobileNumber, slot, path, mime, bytes: buffer.byteLength },
    update: { path, mime, bytes: buffer.byteLength },
  });

  return toCover(saved);
}

export async function readUserSlipCover(
  assemblyId: string,
  mobileNumber: string,
  slot: number,
): Promise<{ body: Buffer; mime: string; updatedAt: Date } | null> {
  const row = await prisma.userSlipCover.findUnique({
    where: { assemblyId_mobileNumber_slot: { assemblyId, mobileNumber, slot } },
  });

  if (!row) return null;

  const body = await readFile(row.path).catch(() => null);

  return body ? { body, mime: row.mime, updatedAt: row.updatedAt } : null;
}

export async function deleteUserSlipCover(assemblyId: string, mobileNumber: string, slot: number): Promise<boolean> {
  const row = await prisma.userSlipCover.findUnique({
    where: { assemblyId_mobileNumber_slot: { assemblyId, mobileNumber, slot } },
  });

  if (!row) return false;

  await rm(row.path, { force: true });
  await prisma.userSlipCover.delete({ where: { id: row.id } });

  return true;
}
