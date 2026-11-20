import { Directory, File, Paths } from "expo-file-system";
import { useSyncExternalStore } from "react";

import { request } from "@/lib/api";
import { getMeta, removeMeta, setMeta } from "@/lib/db";

/**
 * Voter photos, kept on the phone as `<EPIC>.jpg` files so the voter screens
 * show them offline without touching the voter database. The server serves
 * one bundle per ward (or booth) the user may see; each is downloaded once
 * and unpacked here, and again only when the admin uploads new photos.
 *
 * Bundle ("VPK1"): 4 magic bytes, a little-endian uint32 index length, the
 * index as JSON `[[epic, offset, length], ...]` (offsets from the end of the
 * index), then the photos back to back. Read with a file handle, so a large
 * bundle never has to sit in memory and no zip library is needed.
 */

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const ROOT = "voter-photos";

type Pack = { kind: "ward" | "part"; no: number; count: number; bytes: number; updatedAt: string };

export type PhotoSyncState =
  | { status: "idle" }
  | { status: "running"; done: number; total: number; label: string }
  | { status: "done"; total: number }
  | { status: "error"; done: number; total: number; message: string };

let state: PhotoSyncState = { status: "idle" };
const listeners = new Set<() => void>();

function publish(next: PhotoSyncState) {
  state = next;
  for (const listener of listeners) listener();
}

/** The photo download's progress, for the home screen. */
export function usePhotoSync(): PhotoSyncState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

function photoDirectory(assemblyNo: number): Directory {
  return new Directory(Paths.document, ROOT, String(assemblyNo));
}

const metaKey = (assemblyNo: number) => `voterPhotos-${assemblyNo}`;

/** The photo for this voter, if it is on the phone. */
export function voterPhotoUri(assemblyNo: number, epic: string | null | undefined): string | null {
  if (!epic) return null;

  try {
    const file = new File(photoDirectory(assemblyNo), `${epic.trim().toUpperCase()}.jpg`);

    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Every photo on the phone goes: on sign-out, or when the roll is replaced. */
export function deleteVoterPhotos(): void {
  try {
    const root = new Directory(Paths.document, ROOT);

    if (root.exists) root.delete();
  } catch {
    // Only costs space.
  }
  publish({ status: "idle" });
}

/** Bytes to a string, for the bundle's ASCII index (Hermes has no TextDecoder everywhere). */
function ascii(bytes: Uint8Array): string {
  let out = "";

  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }

  return out;
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Writes one bundle's photos to `directory`; `onPhoto` after each. */
async function unpack(pack: File, directory: Directory, onPhoto: (n: number) => void): Promise<void> {
  const handle = pack.open();

  try {
    const head = handle.readBytes(8);

    if (ascii(head.subarray(0, 4)) !== "VPK1") throw new Error("The photo bundle is damaged.");

    const indexLength = head[4]! | (head[5]! << 8) | (head[6]! << 16) | (head[7]! << 24);
    const index = JSON.parse(ascii(handle.readBytes(indexLength))) as [string, number, number][];
    const base = 8 + indexLength;

    for (let n = 0; n < index.length; n++) {
      const [epic, offset, length] = index[n]!;

      handle.offset = base + offset;
      const bytes = handle.readBytes(length);
      const file = new File(directory, `${epic}.jpg`);

      file.create({ overwrite: true });
      file.write(bytes);

      // Let the screen draw between batches: thousands of small writes.
      if (n % 100 === 99) {
        onPhoto(n + 1);
        await pause();
      }
    }
    onPhoto(index.length);
  } finally {
    handle.close();
  }
}

let running: Promise<void> | null = null;

/**
 * Brings the phone's photos in line with the server: downloads and unpacks
 * the bundles that are new or changed, and starts over if one was taken away
 * (photos deleted, or wards changed). Offline or on an older server it does
 * nothing; one run at a time.
 */
export function syncVoterPhotos(token: string, assemblyNo: number): Promise<void> {
  running ??= run(token, assemblyNo).finally(() => {
    running = null;
  });

  return running;
}

async function run(token: string, assemblyNo: number): Promise<void> {
  let packs: Pack[];

  try {
    packs = (await request<{ packs: Pack[] }>("/api/voters/photos", { token })).packs;
  } catch {
    return;
  }

  const key = (pack: Pack) => `${pack.kind}:${pack.no}`;
  let have: Record<string, string> = {};

  try {
    have = JSON.parse((await getMeta(metaKey(assemblyNo))) ?? "{}") as Record<string, string>;
  } catch {
    have = {};
  }

  const listed = new Set(packs.map(key));
  const directory = photoDirectory(assemblyNo);

  // A bundle taken away: its photos must go, and they are not told apart on
  // disk, so start this constituency's photos over.
  if (Object.keys(have).some((k) => !listed.has(k))) {
    try {
      if (directory.exists) directory.delete();
    } catch {
      // Overwritten below anyway.
    }
    have = {};
    await removeMeta(metaKey(assemblyNo));
  }

  const total = packs.reduce((sum, pack) => sum + pack.count, 0);
  const todo = packs.filter((pack) => have[key(pack)] !== pack.updatedAt);

  if (!todo.length) {
    publish(total ? { status: "done", total } : { status: "idle" });
    return;
  }

  if (!directory.exists) directory.create({ intermediates: true });

  let done = total - todo.reduce((sum, pack) => sum + pack.count, 0);
  const label = (pack: Pack) => `${pack.kind === "ward" ? "Ward" : "Booth"} ${pack.no}`;

  for (const pack of todo) {
    publish({ status: "running", done, total, label: `Downloading ${label(pack)}` });

    const file = new File(Paths.cache, `voter-photos-${assemblyNo}-${pack.kind}-${pack.no}.vpk`);

    try {
      await File.downloadFileAsync(`${baseUrl}/api/voters/photos/${pack.kind}/${pack.no}`, file, {
        headers: { authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
        idempotent: true,
        onProgress: ({ bytesWritten, totalBytes }) => {
          const share = totalBytes > 0 ? bytesWritten / totalBytes : 0;

          // The download is the first half of a bundle's progress, unpacking the second.
          publish({ status: "running", done: done + Math.round((pack.count * share) / 2), total, label: `Downloading ${label(pack)}` });
        },
      });

      const start = done;

      await unpack(file, directory, (n) => {
        publish({ status: "running", done: start + Math.round(pack.count / 2 + n / 2), total, label: `Saving ${label(pack)}` });
      });

      done = start + pack.count;
      have[key(pack)] = pack.updatedAt;
      await setMeta(metaKey(assemblyNo), JSON.stringify(have));
    } catch (error) {
      publish({
        status: "error",
        done,
        total,
        message: error instanceof Error && error.message ? error.message : "The photos did not finish downloading.",
      });
      return;
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        // The cache is cleared by the system in time.
      }
    }
  }

  publish({ status: "done", total });
}
