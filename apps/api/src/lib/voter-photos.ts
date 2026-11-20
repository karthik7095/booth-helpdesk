import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';

import { prisma } from '../prisma.js';

/**
 * Voter photos for the app. An admin uploads a zip of `<EPIC>.jpg` files (the
 * roll converter's `--photos` folder); each photo is matched to its voter by
 * EPIC and filed in that voter's ward bundle (booth bundle where the roll has
 * no wards). A phone downloads only the bundles its user may see and unpacks
 * them to files, so photos never travel with the voter sync or sit in a
 * database.
 *
 * Bundle ("VPK1"): the 4 magic bytes, a little-endian uint32 index length,
 * the index as JSON `[[epic, offset, length], ...]` (offsets from the end of
 * the index), then the photos back to back.
 */

const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.uploads/voter-photos');

/** Bigger than this is a full-size picture, not a list photo: refused, it would bloat every phone. */
export const VOTER_PHOTO_MAX_BYTES = 150 * 1024;

const MAGIC = Buffer.from('VPK1');

export class VoterPhotoError extends Error {}

export type PhotoGroup = { kind: 'ward' | 'part'; no: number };

export type PhotoPackInfo = { kind: 'ward' | 'part'; no: number; count: number; bytes: number; updatedAt: string };

export type PhotoImportResult = {
  received: number;
  matched: number;
  unmatched: string[];
  unmatchedCount: number;
  tooLarge: string[];
  total: number;
  voters: number;
  packs: PhotoPackInfo[];
};

/** The files in a zip, read from its central directory (stored or deflated entries). */
export function readZip(zip: Buffer): { name: string; data: Buffer }[] {
  // End of central directory: the last "PK\x05\x06" within the trailing 64 KB comment window.
  let end = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new VoterPhotoError('That is not a zip file.');

  let entries = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (entries === 0xffff || offset === 0xffffffff) throw new VoterPhotoError('Zip64 files are not supported: zip fewer, smaller files.');

  const files: { name: string; data: Buffer }[] = [];
  while (entries-- > 0) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new VoterPhotoError('The zip file is damaged.');
    const method = zip.readUInt16LE(offset + 10);
    const compressed = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;

    if (name.endsWith('/')) continue;
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new VoterPhotoError('The zip file is damaged.');
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compressed);

    if (method === 0) files.push({ name, data: raw });
    else if (method === 8) files.push({ name, data: inflateRawSync(raw) });
    else throw new VoterPhotoError(`"${name}" uses a zip compression this server cannot read.`);
  }

  return files;
}

/** The EPIC a file in the zip is named for, or null for anything that is not a photo. */
function epicOf(name: string): string | null {
  const base = name.split('/').pop() ?? '';

  if (name.startsWith('__MACOSX/') || base.startsWith('.')) return null;

  const match = /^([A-Za-z0-9/]+)\.(jpe?g|png|webp)$/i.exec(base);

  return match ? match[1]!.toUpperCase() : null;
}

function buildPack(photos: [string, Buffer][]): Buffer {
  let at = 0;
  const index = photos.map(([epic, data]) => {
    const row = [epic, at, data.length] as const;
    at += data.length;
    return row;
  });
  const json = Buffer.from(JSON.stringify(index));
  const head = Buffer.alloc(8);
  MAGIC.copy(head, 0);
  head.writeUInt32LE(json.length, 4);

  return Buffer.concat([head, json, ...photos.map(([, data]) => data)]);
}

function readPack(pack: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();

  if (pack.length < 8 || !pack.subarray(0, 4).equals(MAGIC)) return out;

  const length = pack.readUInt32LE(4);
  const index = JSON.parse(pack.toString('utf8', 8, 8 + length)) as [string, number, number][];
  const base = 8 + length;

  for (const [epic, offset, size] of index) out.set(epic, pack.subarray(base + offset, base + offset + size));

  return out;
}

const groupKey = (group: PhotoGroup) => `${group.kind}:${group.no}`;

function toInfo(row: { groupKind: string; groupNo: number; count: number; bytes: number; updatedAt: Date }): PhotoPackInfo {
  return {
    kind: row.groupKind === 'part' ? 'part' : 'ward',
    no: row.groupNo,
    count: row.count,
    bytes: row.bytes,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Files the zip's photos into the constituency's bundles, keeping the photos
 * already there (an upload adds to or replaces by EPIC). Photos whose EPIC is
 * not on the roll are reported, not kept.
 */
export async function importVoterPhotos(
  assembly: { id: string; assemblyNo: number },
  zip: Buffer,
): Promise<PhotoImportResult> {
  const files = readZip(zip)
    .map((file) => ({ epic: epicOf(file.name), data: file.data, name: file.name }))
    .filter((file): file is { epic: string; data: Buffer; name: string } => file.epic !== null);

  if (!files.length) throw new VoterPhotoError('No photos in that zip: name each one <EPIC>.jpg.');

  const voters = await prisma.voter.findMany({
    where: { assemblyNo: assembly.assemblyNo, vcardId: { not: null } },
    select: { vcardId: true, wardNo: true, partNo: true },
  });
  const byWard = voters.some((voter) => voter.wardNo !== null);
  const groupOf = new Map<string, PhotoGroup>();

  for (const voter of voters) {
    const epic = voter.vcardId!.trim().toUpperCase();
    groupOf.set(epic, byWard && voter.wardNo !== null ? { kind: 'ward', no: voter.wardNo } : { kind: 'part', no: voter.partNo });
  }

  const existing = await prisma.voterPhotoPack.findMany({ where: { assemblyId: assembly.id } });
  const bundles = new Map<string, { group: PhotoGroup; photos: Map<string, Buffer> }>();

  for (const row of existing) {
    const pack = await readFile(row.path).catch(() => null);
    const group: PhotoGroup = { kind: row.groupKind === 'part' ? 'part' : 'ward', no: row.groupNo };

    bundles.set(groupKey(group), { group, photos: pack ? readPack(pack) : new Map() });
  }

  const unmatched: string[] = [];
  const tooLarge: string[] = [];
  let matched = 0;

  for (const file of files) {
    const group = groupOf.get(file.epic);

    if (!group) {
      unmatched.push(file.epic);
      continue;
    }
    if (file.data.length > VOTER_PHOTO_MAX_BYTES) {
      tooLarge.push(file.epic);
      continue;
    }

    const key = groupKey(group);

    if (!bundles.has(key)) bundles.set(key, { group, photos: new Map() });

    // Drop the EPIC from any other bundle (a voter moved ward since the last upload).
    for (const [other, bundle] of bundles) if (other !== key) bundle.photos.delete(file.epic);

    bundles.get(key)!.photos.set(file.epic, file.data);
    matched++;
  }

  const folder = join(UPLOAD_DIR, assembly.id);
  await mkdir(folder, { recursive: true });

  const stamp = Date.now();
  const oldPaths = existing.map((row) => row.path);

  for (const { group, photos } of bundles.values()) {
    if (!photos.size) {
      await prisma.voterPhotoPack.deleteMany({ where: { assemblyId: assembly.id, groupKind: group.kind, groupNo: group.no } });
      continue;
    }

    const pack = buildPack([...photos].sort(([a], [b]) => a.localeCompare(b)));
    // A new name each time, so a phone mid-download never reads a half-replaced file.
    const path = join(folder, `${group.kind}-${group.no}-${stamp}.vpk`);
    await writeFile(path, pack);

    const data = { path, bytes: pack.length, count: photos.size };
    await prisma.voterPhotoPack.upsert({
      where: { assemblyId_groupKind_groupNo: { assemblyId: assembly.id, groupKind: group.kind, groupNo: group.no } },
      create: { assemblyId: assembly.id, groupKind: group.kind, groupNo: group.no, ...data },
      update: data,
    });
  }

  for (const path of oldPaths) await rm(path, { force: true });

  const summary = await photoSummary(assembly);

  return {
    received: files.length,
    matched,
    unmatched: unmatched.slice(0, 20),
    unmatchedCount: unmatched.length,
    tooLarge: tooLarge.slice(0, 20),
    ...summary,
  };
}

/** Every bundle and how many of the roll's voters have a photo. */
export async function photoSummary(assembly: { id: string; assemblyNo: number }) {
  const [rows, voters] = await Promise.all([
    prisma.voterPhotoPack.findMany({ where: { assemblyId: assembly.id }, orderBy: [{ groupKind: 'asc' }, { groupNo: 'asc' }] }),
    prisma.voter.count({ where: { assemblyNo: assembly.assemblyNo } }),
  ]);
  const packs = rows.map(toInfo);

  return { total: packs.reduce((sum, pack) => sum + pack.count, 0), voters, packs };
}

/** The bundles this app user may download: their wards and booths only. */
export async function packsFor(
  assemblyNo: number,
  access: { partNos: number[]; wardNos: number[] },
): Promise<PhotoPackInfo[]> {
  const assembly = await prisma.assembly.findUnique({ where: { assemblyNo }, select: { id: true } });

  if (!assembly) return [];

  const rows = await prisma.voterPhotoPack.findMany({ where: { assemblyId: assembly.id }, orderBy: [{ groupKind: 'asc' }, { groupNo: 'asc' }] });

  return rows.filter((row) => allowed(row, access)).map(toInfo);
}

function allowed(row: { groupKind: string; groupNo: number }, access: { partNos: number[]; wardNos: number[] }) {
  if (row.groupKind === 'ward') return access.wardNos.length === 0 || access.wardNos.includes(row.groupNo);

  return access.partNos.length === 0 || access.partNos.includes(row.groupNo);
}

/** One bundle's file, if this user may have it. */
export async function packFile(
  assemblyNo: number,
  access: { partNos: number[]; wardNos: number[] },
  group: PhotoGroup,
): Promise<{ path: string; bytes: number } | null> {
  const assembly = await prisma.assembly.findUnique({ where: { assemblyNo }, select: { id: true } });

  if (!assembly) return null;

  const row = await prisma.voterPhotoPack.findUnique({
    where: { assemblyId_groupKind_groupNo: { assemblyId: assembly.id, groupKind: group.kind, groupNo: group.no } },
  });

  return row && allowed(row, access) ? { path: row.path, bytes: row.bytes } : null;
}

export async function deleteVoterPhotos(assemblyId: string): Promise<void> {
  const rows = await prisma.voterPhotoPack.findMany({ where: { assemblyId } });

  await prisma.voterPhotoPack.deleteMany({ where: { assemblyId } });
  for (const row of rows) await rm(row.path, { force: true });
}
