import {
  USER_SLIP_COVER_MAX_BYTES,
  userSlipCoverListSchema,
  userSlipCoverSchema,
  type UserSlipCover,
} from "@voter/shared";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { request } from "@/lib/api";
import { cachedBannerUri } from "@/lib/banner";
import { getMeta, setMeta } from "@/lib/db";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const COVER_DIR = "slip-covers";

export type CoverSlot = 1 | 2;

/** Which cover goes on the slip: the constituency's, or one of the user's own. */
export type CoverChoice = "constituency" | "1" | "2";

function coverDirectory(): Directory {
  return new Directory(Paths.document, COVER_DIR);
}

/** A new name per version, so the preview never shows a replaced picture. */
function coverFile(assemblyNo: number, slot: CoverSlot, updatedAt: string): File {
  return new File(coverDirectory(), `mine-${assemblyNo}-${slot}-${Date.parse(updatedAt) || 0}.img`);
}

function storedCovers(assemblyNo: number, slot: CoverSlot): File[] {
  const directory = coverDirectory();

  if (!directory.exists) return [];

  return directory
    .list()
    .filter(
      (entry): entry is File =>
        entry instanceof File && entry.name.startsWith(`mine-${assemblyNo}-${slot}-`),
    );
}

function removeStored(assemblyNo: number, slot: CoverSlot, keep?: string): void {
  for (const file of storedCovers(assemblyNo, slot)) {
    if (file.name === keep) continue;

    try {
      file.delete();
    } catch {
      // A stale copy only costs space.
    }
  }
}

/** The user's own cover in this slot, if one is on the phone. */
export function cachedMySlipCover(assemblyNo: number, slot: CoverSlot): string | null {
  const [latest] = storedCovers(assemblyNo, slot).sort((a, b) => b.name.localeCompare(a.name));

  return latest?.uri ?? null;
}

/**
 * Brings the phone's copies in line with the server: downloads a slot that
 * changed, drops one the user removed elsewhere. Offline, the copies on the
 * phone stay as they are.
 */
export async function syncMySlipCovers(
  token: string,
  assemblyNo: number,
): Promise<Record<CoverSlot, string | null>> {
  const cached = () => ({ 1: cachedMySlipCover(assemblyNo, 1), 2: cachedMySlipCover(assemblyNo, 2) });

  let covers: UserSlipCover[];

  try {
    covers = userSlipCoverListSchema.parse(
      await request<unknown>("/api/voters/my-slip-covers", { token }),
    ).covers;
  } catch {
    return cached();
  }

  const directory = coverDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  for (const slot of [1, 2] as const) {
    const cover = covers.find((item) => item.slot === slot);

    if (!cover) {
      removeStored(assemblyNo, slot);
      continue;
    }

    const file = coverFile(assemblyNo, slot, cover.updatedAt);

    if (file.exists) {
      removeStored(assemblyNo, slot, file.name);
      continue;
    }

    try {
      await File.downloadFileAsync(`${baseUrl}/api/voters/my-slip-covers/${slot}`, file, {
        headers: { authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
        idempotent: true,
      });
      removeStored(assemblyNo, slot, file.name);
    } catch {
      // Keep the previous copy until the new one arrives.
    }
  }

  return cached();
}

/**
 * Shrinks a picked image to slip width and uploads it to the slot, replacing
 * (and deleting) the cover that was there. Phone photos run to several MB; at
 * 768 px wide a JPEG is a small fraction of the 1 MB limit.
 */
export async function uploadMySlipCover(
  token: string,
  assemblyNo: number,
  slot: CoverSlot,
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

    if (base64 && base64.length * 0.75 <= USER_SLIP_COVER_MAX_BYTES) break;
  }

  if (!base64) throw new Error("Could not read that image.");

  const uri = await saveCover(token, assemblyNo, slot, base64, "image/jpeg");

  // A picture replaces a text cover in the slot.
  await setCoverText(assemblyNo, slot, null);

  return uri;
}

/**
 * Uploads a text cover: the typed heading, already drawn as a PNG on the phone
 * (see TextCoverEditor). It travels and prints exactly like a picked image; the
 * text itself is kept on this phone so the cover can be edited again.
 */
export async function uploadTextSlipCover(
  token: string,
  assemblyNo: number,
  slot: CoverSlot,
  text: string,
  pngBase64: string,
): Promise<string> {
  const uri = await saveCover(token, assemblyNo, slot, pngBase64, "image/png");

  await setCoverText(assemblyNo, slot, text);

  return uri;
}

/** Sends a cover to the slot and keeps the same bytes as the phone's copy. */
async function saveCover(
  token: string,
  assemblyNo: number,
  slot: CoverSlot,
  base64: string,
  mime: "image/jpeg" | "image/png",
): Promise<string> {
  if (base64.length * 0.75 > USER_SLIP_COVER_MAX_BYTES) {
    throw new Error("That image is too large. Keep it under 1 MB.");
  }

  const saved = userSlipCoverSchema.parse(
    await request<unknown>(`/api/voters/my-slip-covers/${slot}`, {
      method: "PUT",
      token,
      body: { image: `data:${mime};base64,${base64}` },
    }),
  );

  const directory = coverDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  // Written straight from what was sent, so there is nothing to download back.
  const file = coverFile(assemblyNo, slot, saved.updatedAt);
  file.write(base64, { encoding: "base64" });
  removeStored(assemblyNo, slot, file.name);

  return file.uri;
}

export async function removeMySlipCover(token: string, assemblyNo: number, slot: CoverSlot): Promise<void> {
  await request<unknown>(`/api/voters/my-slip-covers/${slot}`, { method: "DELETE", token });
  removeStored(assemblyNo, slot);
  await setCoverText(assemblyNo, slot, null);
}

const textKey = (assemblyNo: number, slot: CoverSlot) => `slipCoverText-${assemblyNo}-${slot}`;

/** The text a slot's cover was drawn from on this phone; null when it is a picture. */
export async function getCoverText(assemblyNo: number, slot: CoverSlot): Promise<string | null> {
  return (await getMeta(textKey(assemblyNo, slot))) || null;
}

async function setCoverText(assemblyNo: number, slot: CoverSlot, text: string | null): Promise<void> {
  await setMeta(textKey(assemblyNo, slot), text ?? "");
}

const choiceKey = (assemblyNo: number) => `slipCoverChoice-${assemblyNo}`;

export async function getCoverChoice(assemblyNo: number): Promise<CoverChoice> {
  const value = await getMeta(choiceKey(assemblyNo));

  return value === "1" || value === "2" ? value : "constituency";
}

export async function setCoverChoice(assemblyNo: number, choice: CoverChoice): Promise<void> {
  await setMeta(choiceKey(assemblyNo), choice);
}

/**
 * The cover to print: the user's chosen one when own covers are allowed and
 * it is on the phone, else the constituency's.
 */
export async function printableSlipCoverUri(assemblyNo: number, ownAllowed: boolean): Promise<string | null> {
  if (ownAllowed) {
    const choice = await getCoverChoice(assemblyNo);

    if (choice !== "constituency") {
      const own = cachedMySlipCover(assemblyNo, Number(choice) as CoverSlot);

      if (own) return own;
    }
  }

  return cachedBannerUri(assemblyNo, "slip");
}
