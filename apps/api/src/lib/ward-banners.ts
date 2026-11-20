import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { WARD_PRINT_BANNER_MAX_BYTES, type WardSummary } from '@voter/shared';

import { prisma } from '../prisma.js';

/** Beside the user slip covers, one folder per panchayat. */
const UPLOAD_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../.uploads/ward-banners');

const ALLOWED = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
]);

export class WardBannerError extends Error {}

/**
 * The panchayat's wards with their voter counts, the booths each votes at,
 * and whether a print banner is set. Narrowed to the parts a PIN covers, so
 * a PIN for one booth lists only the wards (and counts) on that booth.
 */
export async function listWards(
  assemblyId: string,
  assemblyNo: number,
  partNos: number[],
  wardNos: number[] = [],
): Promise<WardSummary[]> {
  const parts = partNos.length > 0 ? partNos : null;
  const only = wardNos.length > 0 ? wardNos : null;
  const rows = await prisma.$queryRaw<
    { ward_no: number; part_no: number; total: number; male: number; female: number }[]
  >`
    SELECT ward_no, part_no,
           COUNT(*)::int AS total,
           SUM(CASE WHEN upper(sex) LIKE 'M%' THEN 1 ELSE 0 END)::int AS male,
           SUM(CASE WHEN upper(sex) LIKE 'F%' THEN 1 ELSE 0 END)::int AS female
    FROM voters
    WHERE assembly_no = ${assemblyNo}
      AND ward_no IS NOT NULL
      AND (${parts}::int[] IS NULL OR part_no = ANY(${parts}::int[]))
      AND (${only}::int[] IS NULL OR ward_no = ANY(${only}::int[]))
    GROUP BY ward_no, part_no`;

  const banners = await prisma.wardPrintBanner.findMany({ where: { assemblyId } });
  const wards = new Map<number, WardSummary>();

  for (const row of rows) {
    const ward = wards.get(row.ward_no) ?? {
      wardNo: row.ward_no,
      total: 0,
      male: 0,
      female: 0,
      booths: [],
      printBannerUpdatedAt: null,
      printBannerUpdatedBy: null,
    };

    ward.total += row.total;
    ward.male += row.male;
    ward.female += row.female;
    ward.booths.push(row.part_no);
    wards.set(row.ward_no, ward);
  }

  for (const banner of banners) {
    const ward = wards.get(banner.wardNo);

    if (!ward) continue;

    ward.printBannerUpdatedAt = banner.updatedAt.toISOString();
    ward.printBannerUpdatedBy = banner.updatedByName;
  }

  return [...wards.values()]
    .map((ward) => ({ ...ward, booths: ward.booths.sort((a, b) => a - b) }))
    .sort((a, b) => a.wardNo - b.wardNo);
}

/** Whether the ward is on the panchayat's roll at all. */
export async function wardExists(assemblyNo: number, wardNo: number): Promise<boolean> {
  return (await prisma.voter.count({ where: { assemblyNo, wardNo }, take: 1 })) > 0;
}

/**
 * Replaces a ward's print banner. The file it replaces is deleted, so a ward
 * holds one image on the server however often it is changed.
 */
export async function saveWardPrintBanner(
  assemblyId: string,
  wardNo: number,
  dataUrl: string,
  by: { name: string; mobile: string },
): Promise<{ updatedAt: Date }> {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match) throw new WardBannerError('Expected a base64 image.');

  const mime = match[1]!.toLowerCase();
  const extension = ALLOWED.get(mime);

  if (!extension) throw new WardBannerError('Use a PNG, JPEG or WebP image.');

  const buffer = Buffer.from(match[2]!, 'base64');

  if (buffer.byteLength === 0) throw new WardBannerError('That image is empty.');
  if (buffer.byteLength > WARD_PRINT_BANNER_MAX_BYTES) {
    throw new WardBannerError('Keep the print banner under 1 MB.');
  }

  const existing = await prisma.wardPrintBanner.findUnique({
    where: { assemblyId_wardNo: { assemblyId, wardNo } },
  });

  if (existing) await rm(existing.path, { force: true });

  const folder = join(UPLOAD_DIR, assemblyId);
  await mkdir(folder, { recursive: true });

  // A new name each time, so no cache anywhere can hand back the old picture.
  const path = join(folder, `ward-${wardNo}-${Date.now()}.${extension}`);
  await writeFile(path, buffer);

  const data = {
    path,
    mime,
    bytes: buffer.byteLength,
    updatedByName: by.name,
    updatedByMobile: by.mobile,
  };
  const saved = await prisma.wardPrintBanner.upsert({
    where: { assemblyId_wardNo: { assemblyId, wardNo } },
    create: { assemblyId, wardNo, ...data },
    update: data,
  });

  return { updatedAt: saved.updatedAt };
}

export async function readWardPrintBanner(
  assemblyId: string,
  wardNo: number,
): Promise<{ body: Buffer; mime: string; updatedAt: Date } | null> {
  const row = await prisma.wardPrintBanner.findUnique({
    where: { assemblyId_wardNo: { assemblyId, wardNo } },
  });

  if (!row) return null;

  const body = await readFile(row.path).catch(() => null);

  return body ? { body, mime: row.mime, updatedAt: row.updatedAt } : null;
}

export async function deleteWardPrintBanner(assemblyId: string, wardNo: number): Promise<boolean> {
  const row = await prisma.wardPrintBanner.findUnique({
    where: { assemblyId_wardNo: { assemblyId, wardNo } },
  });

  if (!row) return false;

  await rm(row.path, { force: true });
  await prisma.wardPrintBanner.delete({ where: { id: row.id } });

  return true;
}
