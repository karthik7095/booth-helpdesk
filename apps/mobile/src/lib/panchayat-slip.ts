import {
  CANDIDATE_SYMBOL_MAX_BYTES,
  panchayatSlipSchema,
  symbolSavedSchema,
  type PanchayatSlip,
  type UpdatePanchayatSlipRequest,
  type UpdateWardCandidateRequest,
} from "@voter/shared";
import { Directory, File, Paths } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";

import { request } from "@/lib/api";
import { getMeta, setMeta } from "@/lib/db";

/**
 * A gram panchayat's slip header, typed in Settings: the heading, the line
 * under the candidates, the Sarpanch candidate (one for the whole panchayat)
 * and each ward's member candidate, each with a symbol. The phone draws each
 * ward's header from these (SlipHeaderRenderer) and uploads it as that ward's
 * print banner, so printing and offline use are unchanged.
 */

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const SYMBOL_DIR = "candidate-symbols";

const EMPTY: PanchayatSlip = {
  heading: null,
  tagline: null,
  sarpanchName: null,
  sarpanchNameEn: null,
  sarpanchSymbolUpdatedAt: null,
  municipal: false,
  topImageUpdatedAt: null,
  wards: [],
};

function symbolDirectory(): Directory {
  return new Directory(Paths.document, SYMBOL_DIR);
}

/** "sarpanch", "top" (the image above the candidates) or the ward number. */
export type SymbolOwner = "sarpanch" | "top" | number;

function symbolPath(owner: SymbolOwner): string {
  if (owner === "sarpanch") return "panchayat-slip/sarpanch-symbol";
  if (owner === "top") return "panchayat-slip/top-image";
  return `wards/${owner}/symbol`;
}

/** PNG keeps a cut-out photo's transparent background white on the slip; JPEG would turn it black. */
const mimeOf = (base64: string) => (base64.startsWith("iVBOR") ? "image/png" : "image/jpeg");

const symbolPrefix = (assemblyNo: number, owner: SymbolOwner) => `sym-${assemblyNo}-${owner}-`;

function symbolFile(assemblyNo: number, owner: SymbolOwner, updatedAt: string): File {
  return new File(symbolDirectory(), `${symbolPrefix(assemblyNo, owner)}${Date.parse(updatedAt) || 0}.img`);
}

function storedSymbols(assemblyNo: number, owner: SymbolOwner): File[] {
  const directory = symbolDirectory();

  if (!directory.exists) return [];

  return directory
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith(symbolPrefix(assemblyNo, owner)));
}

function removeStored(assemblyNo: number, owner: SymbolOwner, keep?: string): void {
  for (const file of storedSymbols(assemblyNo, owner)) {
    if (file.name === keep) continue;

    try {
      file.delete();
    } catch {
      // A stale copy only costs space.
    }
  }
}

/** The symbol on this phone, if any. */
export function cachedSymbolUri(assemblyNo: number, owner: SymbolOwner): string | null {
  const [latest] = storedSymbols(assemblyNo, owner).sort((a, b) => b.name.localeCompare(a.name));

  return latest?.uri ?? null;
}

/** The symbol as a data URI, for drawing into the slip header; null when there is none. */
export async function symbolDataUri(assemblyNo: number, owner: SymbolOwner): Promise<string | null> {
  const uri = cachedSymbolUri(assemblyNo, owner);

  if (!uri) return null;

  try {
    const base64 = await new File(uri).base64();

    return `data:${mimeOf(base64)};base64,${base64}`;
  } catch {
    return null;
  }
}

const slipKey = (assemblyNo: number) => `panchayatSlip-${assemblyNo}`;

export async function cachedPanchayatSlip(assemblyNo: number): Promise<PanchayatSlip> {
  try {
    const raw = await getMeta(slipKey(assemblyNo));

    return raw ? panchayatSlipSchema.parse(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

async function keep(assemblyNo: number, slip: PanchayatSlip): Promise<PanchayatSlip> {
  await setMeta(slipKey(assemblyNo), JSON.stringify(slip));

  return slip;
}

async function downloadSymbol(
  token: string,
  assemblyNo: number,
  owner: SymbolOwner,
  updatedAt: string | null,
): Promise<void> {
  if (!updatedAt) {
    removeStored(assemblyNo, owner);
    return;
  }

  const file = symbolFile(assemblyNo, owner, updatedAt);

  if (file.exists) {
    removeStored(assemblyNo, owner, file.name);
    return;
  }

  const path = symbolPath(owner);

  try {
    await File.downloadFileAsync(`${baseUrl}/api/voters/${path}`, file, {
      headers: { authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
      idempotent: true,
    });
    removeStored(assemblyNo, owner, file.name);
  } catch {
    // Keep the previous copy until the new one arrives.
  }
}

/** Fetches the header's parts and brings the phone's symbols in line. Offline: the cached copy. */
export async function syncPanchayatSlip(token: string, assemblyNo: number): Promise<PanchayatSlip> {
  let slip: PanchayatSlip;

  try {
    slip = panchayatSlipSchema.parse(await request<unknown>("/api/voters/panchayat-slip", { token }));
  } catch {
    return cachedPanchayatSlip(assemblyNo);
  }

  const directory = symbolDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  await downloadSymbol(token, assemblyNo, "sarpanch", slip.sarpanchSymbolUpdatedAt);
  await downloadSymbol(token, assemblyNo, "top", slip.topImageUpdatedAt);

  for (const ward of slip.wards) await downloadSymbol(token, assemblyNo, ward.wardNo, ward.symbolUpdatedAt);

  return keep(assemblyNo, slip);
}

export async function savePanchayatSlip(
  token: string,
  assemblyNo: number,
  patch: UpdatePanchayatSlipRequest,
): Promise<PanchayatSlip> {
  const slip = panchayatSlipSchema.parse(
    await request<unknown>("/api/voters/panchayat-slip", { method: "PUT", token, body: patch }),
  );

  return keep(assemblyNo, slip);
}

export async function saveWardCandidate(
  token: string,
  assemblyNo: number,
  wardNo: number,
  names: UpdateWardCandidateRequest,
): Promise<PanchayatSlip> {
  const slip = panchayatSlipSchema.parse(
    await request<unknown>(`/api/voters/wards/${wardNo}/candidate`, { method: "PUT", token, body: names }),
  );

  return keep(assemblyNo, slip);
}

/**
 * Shrinks a picked symbol or photo and uploads it. Symbols print about 110
 * dots wide, so 400 px is plenty; the image above the candidates spans the
 * slip, 576 px. Kept as PNG (transparency stays white) unless that is too big.
 */
export async function uploadSymbol(
  token: string,
  assemblyNo: number,
  owner: SymbolOwner,
  sourceUri: string,
): Promise<string> {
  const image = await ImageManipulator.manipulate(sourceUri)
    .resize({ width: owner === "top" ? 576 : 400 })
    .renderAsync();
  let base64 = (await image.saveAsync({ format: SaveFormat.PNG, base64: true })).base64;

  if (base64 && base64.length * 0.75 > CANDIDATE_SYMBOL_MAX_BYTES) {
    base64 = (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true })).base64;
  }

  if (!base64) throw new Error("Could not read that image.");
  if (base64.length * 0.75 > CANDIDATE_SYMBOL_MAX_BYTES) throw new Error("That image is too large.");

  const saved = symbolSavedSchema.parse(
    await request<unknown>(`/api/voters/${symbolPath(owner)}`, {
      method: "PUT",
      token,
      body: { image: `data:${mimeOf(base64)};base64,${base64}` },
    }),
  );

  const directory = symbolDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  const file = symbolFile(assemblyNo, owner, saved.symbolUpdatedAt);
  file.write(base64, { encoding: "base64" });
  removeStored(assemblyNo, owner, file.name);

  return file.uri;
}

export async function removeSymbol(token: string, assemblyNo: number, owner: SymbolOwner): Promise<void> {
  await request<unknown>(`/api/voters/${symbolPath(owner)}`, { method: "DELETE", token });
  removeStored(assemblyNo, owner);
}

/** The image above the candidates with its size, for laying out the header; null when there is none. */
export async function topImageData(assemblyNo: number): Promise<{ uri: string; width: number; height: number } | null> {
  const uri = cachedSymbolUri(assemblyNo, "top");
  const data = await symbolDataUri(assemblyNo, "top");

  if (!uri || !data) return null;

  try {
    const image = await ImageManipulator.manipulate(uri).renderAsync();

    return { uri: data, width: image.width, height: image.height };
  } catch {
    return null;
  }
}
