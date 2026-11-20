import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CANDIDATE_SYMBOL_MAX_BYTES,
  type PanchayatSlip,
  type UpdatePanchayatSlipRequest,
} from '@voter/shared';

import { prisma } from '../prisma.js';

/**
 * A gram panchayat's slip header: the heading, the line under the candidates,
 * the Sarpanch candidate (once per panchayat) and each ward's member
 * candidate, each with a symbol. Typed and uploaded from the app's Settings by
 * anyone holding the PIN; the phone draws the header from it and saves that as
 * the ward's print banner, so printing itself is unchanged.
 */

const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.uploads/candidate-symbols');

const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
]);

export class SymbolError extends Error {}

type Editor = { name: string; mobile: string };

/** Decodes and writes a symbol, under a new name each time so no cache serves the old one. */
async function writeSymbol(assemblyId: string, stem: string, dataUrl: string): Promise<{ path: string; mime: string }> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) throw new SymbolError('Expected a base64 image.');

  const mime = match[1]!.toLowerCase();
  const extension = ALLOWED.get(mime);

  if (!extension) throw new SymbolError('Use a PNG, JPEG or WebP image.');

  const buffer = Buffer.from(match[2]!, 'base64');

  if (buffer.byteLength === 0) throw new SymbolError('That image is empty.');
  if (buffer.byteLength > CANDIDATE_SYMBOL_MAX_BYTES) throw new SymbolError('Keep the symbol under 1 MB.');

  const folder = join(UPLOAD_DIR, assemblyId);
  await mkdir(folder, { recursive: true });

  const path = join(folder, `${stem}-${Date.now()}.${extension}`);
  await writeFile(path, buffer);

  return { path, mime };
}

export async function getPanchayatSlip(assemblyId: string): Promise<PanchayatSlip> {
  const [assembly, candidates] = await Promise.all([
    prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId } }),
    prisma.wardCandidate.findMany({ where: { assemblyId }, orderBy: { wardNo: 'asc' } }),
  ]);

  return {
    heading: assembly.slipHeading,
    tagline: assembly.slipTagline,
    sarpanchName: assembly.sarpanchName,
    sarpanchNameEn: assembly.sarpanchNameEn,
    sarpanchSymbolUpdatedAt: assembly.sarpanchSymbolUpdatedAt?.toISOString() ?? null,
    municipal: assembly.slipMunicipal,
    topImageUpdatedAt: assembly.slipTopImageUpdatedAt?.toISOString() ?? null,
    wards: candidates.map((row) => ({
      wardNo: row.wardNo,
      name: row.name,
      nameEn: row.nameEn,
      symbolUpdatedAt: row.symbolUpdatedAt?.toISOString() ?? null,
      updatedBy: row.updatedByName,
    })),
  };
}

/** Only the fields sent are changed; null clears one. */
export async function updatePanchayatSlip(assemblyId: string, patch: UpdatePanchayatSlipRequest): Promise<void> {
  await prisma.assembly.update({
    where: { id: assemblyId },
    data: {
      ...(patch.heading !== undefined ? { slipHeading: patch.heading } : {}),
      ...(patch.tagline !== undefined ? { slipTagline: patch.tagline } : {}),
      ...(patch.sarpanchName !== undefined ? { sarpanchName: patch.sarpanchName } : {}),
      ...(patch.sarpanchNameEn !== undefined ? { sarpanchNameEn: patch.sarpanchNameEn } : {}),
      ...(patch.municipal !== undefined ? { slipMunicipal: patch.municipal } : {}),
    },
  });
}

export async function saveSarpanchSymbol(assemblyId: string, dataUrl: string): Promise<Date> {
  const assembly = await prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId } });
  const saved = await writeSymbol(assemblyId, 'sarpanch', dataUrl);

  if (assembly.sarpanchSymbolPath) await rm(assembly.sarpanchSymbolPath, { force: true });

  const updatedAt = new Date();

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: { sarpanchSymbolPath: saved.path, sarpanchSymbolMime: saved.mime, sarpanchSymbolUpdatedAt: updatedAt },
  });

  return updatedAt;
}

export async function deleteSarpanchSymbol(assemblyId: string): Promise<void> {
  const assembly = await prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId } });

  if (assembly.sarpanchSymbolPath) await rm(assembly.sarpanchSymbolPath, { force: true });

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: { sarpanchSymbolPath: null, sarpanchSymbolMime: null, sarpanchSymbolUpdatedAt: null },
  });
}

export async function readSarpanchSymbol(assemblyId: string): Promise<{ body: Buffer; mime: string } | null> {
  const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } });

  if (!assembly?.sarpanchSymbolPath || !assembly.sarpanchSymbolMime) return null;

  const body = await readFile(assembly.sarpanchSymbolPath).catch(() => null);

  return body ? { body, mime: assembly.sarpanchSymbolMime } : null;
}

/** The image printed above the candidates on every ward's header. */
export async function saveTopImage(assemblyId: string, dataUrl: string): Promise<Date> {
  const assembly = await prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId } });
  const saved = await writeSymbol(assemblyId, 'top', dataUrl);

  if (assembly.slipTopImagePath) await rm(assembly.slipTopImagePath, { force: true });

  const updatedAt = new Date();

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: { slipTopImagePath: saved.path, slipTopImageMime: saved.mime, slipTopImageUpdatedAt: updatedAt },
  });

  return updatedAt;
}

export async function deleteTopImage(assemblyId: string): Promise<void> {
  const assembly = await prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId } });

  if (assembly.slipTopImagePath) await rm(assembly.slipTopImagePath, { force: true });

  await prisma.assembly.update({
    where: { id: assemblyId },
    data: { slipTopImagePath: null, slipTopImageMime: null, slipTopImageUpdatedAt: null },
  });
}

export async function readTopImage(assemblyId: string): Promise<{ body: Buffer; mime: string } | null> {
  const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId } });

  if (!assembly?.slipTopImagePath || !assembly.slipTopImageMime) return null;

  const body = await readFile(assembly.slipTopImagePath).catch(() => null);

  return body ? { body, mime: assembly.slipTopImageMime } : null;
}

export async function updateWardCandidate(
  assemblyId: string,
  wardNo: number,
  names: { name: string | null; nameEn: string | null },
  by: Editor,
): Promise<void> {
  const data = { ...names, updatedByName: by.name, updatedByMobile: by.mobile };

  await prisma.wardCandidate.upsert({
    where: { assemblyId_wardNo: { assemblyId, wardNo } },
    create: { assemblyId, wardNo, ...data },
    update: data,
  });
}

export async function saveWardSymbol(assemblyId: string, wardNo: number, dataUrl: string, by: Editor): Promise<Date> {
  const existing = await prisma.wardCandidate.findUnique({ where: { assemblyId_wardNo: { assemblyId, wardNo } } });
  const saved = await writeSymbol(assemblyId, `ward-${wardNo}`, dataUrl);

  if (existing?.symbolPath) await rm(existing.symbolPath, { force: true });

  const updatedAt = new Date();
  const data = {
    symbolPath: saved.path,
    symbolMime: saved.mime,
    symbolUpdatedAt: updatedAt,
    updatedByName: by.name,
    updatedByMobile: by.mobile,
  };

  await prisma.wardCandidate.upsert({
    where: { assemblyId_wardNo: { assemblyId, wardNo } },
    create: { assemblyId, wardNo, ...data },
    update: data,
  });

  return updatedAt;
}

export async function deleteWardSymbol(assemblyId: string, wardNo: number): Promise<void> {
  const existing = await prisma.wardCandidate.findUnique({ where: { assemblyId_wardNo: { assemblyId, wardNo } } });

  if (!existing?.symbolPath) return;

  await rm(existing.symbolPath, { force: true });
  await prisma.wardCandidate.update({
    where: { id: existing.id },
    data: { symbolPath: null, symbolMime: null, symbolUpdatedAt: null },
  });
}

export async function readWardSymbol(assemblyId: string, wardNo: number): Promise<{ body: Buffer; mime: string } | null> {
  const row = await prisma.wardCandidate.findUnique({ where: { assemblyId_wardNo: { assemblyId, wardNo } } });

  if (!row?.symbolPath || !row.symbolMime) return null;

  const body = await readFile(row.symbolPath).catch(() => null);

  return body ? { body, mime: row.symbolMime } : null;
}
