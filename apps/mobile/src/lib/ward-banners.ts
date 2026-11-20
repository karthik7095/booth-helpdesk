import {
  WARD_PRINT_BANNER_MAX_BYTES,
  wardListSchema,
  wardPrintBannerSavedSchema,
  type WardSummary,
} from "@voter/shared";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { request } from "@/lib/api";
import { getMeta, setMeta } from "@/lib/db";

/**
 * Gram panchayat ward print banners: each ward's candidate symbol and name,
 * printed at the top of that ward's slips. Kept on the phone so a slip prints
 * its ward's banner at the booth with no signal; synced from the server
 * whenever the Settings screen opens or a banner is changed here.
 */

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const BANNER_DIR = "ward-banners";

function bannerDirectory(): Directory {
  return new Directory(Paths.document, BANNER_DIR);
}

/** A new name per version, so a preview never shows a replaced picture. */
function bannerFile(assemblyNo: number, wardNo: number, updatedAt: string): File {
  return new File(bannerDirectory(), `ward-${assemblyNo}-${wardNo}-${Date.parse(updatedAt) || 0}.img`);
}

function storedBanners(assemblyNo: number, wardNo?: number): File[] {
  const directory = bannerDirectory();

  if (!directory.exists) return [];

  const prefix = wardNo === undefined ? `ward-${assemblyNo}-` : `ward-${assemblyNo}-${wardNo}-`;

  return directory
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith(prefix));
}

function removeStored(assemblyNo: number, wardNo: number, keep?: string): void {
  for (const file of storedBanners(assemblyNo, wardNo)) {
    if (file.name === keep) continue;

    try {
      file.delete();
    } catch {
      // A stale copy only costs space.
    }
  }
}

/** The ward's print banner, if one is on the phone. */
export function cachedWardBannerUri(assemblyNo: number, wardNo: number): string | null {
  const [latest] = storedBanners(assemblyNo, wardNo).sort((a, b) => b.name.localeCompare(a.name));

  return latest?.uri ?? null;
}

const listKey = (assemblyNo: number) => `wardList-${assemblyNo}`;

/** The ward list as last fetched, for opening Settings with no signal. */
export async function cachedWardList(assemblyNo: number): Promise<WardSummary[]> {
  try {
    const raw = await getMeta(listKey(assemblyNo));

    return raw ? wardListSchema.parse(JSON.parse(raw)).wards : [];
  } catch {
    return [];
  }
}

/**
 * Fetches the wards and brings the phone's banners in line: downloads a
 * banner that changed, drops one removed from another phone. Offline, the
 * cached list and banners stay as they are.
 */
export async function syncWardBanners(token: string, assemblyNo: number): Promise<WardSummary[]> {
  let wards: WardSummary[];

  try {
    wards = wardListSchema.parse(await request<unknown>("/api/voters/wards", { token })).wards;
  } catch {
    return cachedWardList(assemblyNo);
  }

  await setMeta(listKey(assemblyNo), JSON.stringify({ wards }));

  const directory = bannerDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  for (const ward of wards) {
    if (!ward.printBannerUpdatedAt) {
      removeStored(assemblyNo, ward.wardNo);
      continue;
    }

    const file = bannerFile(assemblyNo, ward.wardNo, ward.printBannerUpdatedAt);

    if (file.exists) {
      removeStored(assemblyNo, ward.wardNo, file.name);
      continue;
    }

    try {
      await File.downloadFileAsync(`${baseUrl}/api/voters/wards/${ward.wardNo}/print-banner`, file, {
        headers: { authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
        idempotent: true,
      });
      removeStored(assemblyNo, ward.wardNo, file.name);
    } catch {
      // Keep the previous copy until the new one arrives.
    }
  }

  return wards;
}

/**
 * Shrinks a picked image to slip width and uploads it as the ward's print
 * banner, replacing the one there for every phone. Phone photos run to several
 * MB; at 768 px wide a JPEG is a small fraction of the 1 MB limit.
 */
export async function uploadWardBanner(
  token: string,
  assemblyNo: number,
  wardNo: number,
  sourceUri: string,
): Promise<string> {
  let base64: string | undefined;

  for (const [width, compress] of [
    [768, 0.8],
    [576, 0.6],
  ] as const) {
    const rendered = await (await ImageManipulator.manipulate(sourceUri).resize({ width }).renderAsync()).saveAsync({
      format: SaveFormat.JPEG,
      compress,
      base64: true,
    });

    base64 = rendered.base64;

    if (base64 && base64.length * 0.75 <= WARD_PRINT_BANNER_MAX_BYTES) break;
  }

  if (!base64) throw new Error("Could not read that image.");
  if (base64.length * 0.75 > WARD_PRINT_BANNER_MAX_BYTES) {
    throw new Error("That image is too large. Keep it under 1 MB.");
  }

  const saved = wardPrintBannerSavedSchema.parse(
    await request<unknown>(`/api/voters/wards/${wardNo}/print-banner`, {
      method: "PUT",
      token,
      body: { image: `data:image/jpeg;base64,${base64}` },
    }),
  );

  const directory = bannerDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  // Written straight from what was sent, so there is nothing to download back.
  const file = bannerFile(assemblyNo, wardNo, saved.printBannerUpdatedAt);
  file.write(base64, { encoding: "base64" });
  removeStored(assemblyNo, wardNo, file.name);

  return file.uri;
}

/**
 * Uploads a header already drawn on the phone (SlipHeaderRenderer) as the
 * ward's print banner, replacing the one there for every phone.
 */
export async function uploadWardBannerPng(
  token: string,
  assemblyNo: number,
  wardNo: number,
  pngBase64: string,
): Promise<string> {
  if (pngBase64.length * 0.75 > WARD_PRINT_BANNER_MAX_BYTES) throw new Error("The slip header came out too large.");

  const saved = wardPrintBannerSavedSchema.parse(
    await request<unknown>(`/api/voters/wards/${wardNo}/print-banner`, {
      method: "PUT",
      token,
      body: { image: `data:image/png;base64,${pngBase64}` },
    }),
  );

  const directory = bannerDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  const file = bannerFile(assemblyNo, wardNo, saved.printBannerUpdatedAt);
  file.write(pngBase64, { encoding: "base64" });
  removeStored(assemblyNo, wardNo, file.name);

  return file.uri;
}

export async function removeWardBanner(token: string, assemblyNo: number, wardNo: number): Promise<void> {
  await request<unknown>(`/api/voters/wards/${wardNo}/print-banner`, { method: "DELETE", token });
  removeStored(assemblyNo, wardNo);
}
