import { Directory, File, Paths } from "expo-file-system";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:4000";
const BANNER_DIR = "banner";

/**
 * Unrelated images per constituency: the home-screen banner, the cover printed
 * above each voter slip, and the image sent with the slip text on WhatsApp. Separate files, separate stamps — an agent can
 * have one and not the other, and replacing one must not re-download the other.
 */
export type ConstituencyImage = "banner" | "slip" | "whatsapp";

const ENDPOINT: Record<ConstituencyImage, string> = {
  banner: "/api/voters/banner",
  slip: "/api/voters/slip-image",
  whatsapp: "/api/voters/whatsapp-image",
};

function bannerDirectory(): Directory {
  return new Directory(Paths.document, BANNER_DIR);
}

/**
 * Each version gets its own file name. Overwriting one fixed path left the
 * image showing the old picture: the URI never changed, so neither React nor
 * the image cache had any reason to load it again.
 */
function bannerFile(assemblyNo: number, updatedAt: string, kind: ConstituencyImage): File {
  const version = Date.parse(updatedAt) || updatedAt.replace(/\W/g, "");

  return new File(bannerDirectory(), `${kind}-${assemblyNo}-${version}.img`);
}

/** Every stored version of one image, including the unversioned name older builds used. */
function storedFiles(assemblyNo: number, kind: ConstituencyImage): File[] {
  const directory = bannerDirectory();

  if (!directory.exists) return [];

  return directory
    .list()
    .filter(
      (entry): entry is File =>
        entry instanceof File &&
        (entry.name.startsWith(`${kind}-${assemblyNo}-`) ||
          entry.name === `${kind}-${assemblyNo}.img`),
    );
}

/** The cached file, if one has been downloaded for this constituency. */
export function cachedBannerUri(
  assemblyNo: number,
  kind: ConstituencyImage = "banner",
): string | null {
  // Old versions are removed after each download, so there is normally one.
  // Versioned names sort newest first; the old unversioned name only as a fallback.
  const legacy = `${kind}-${assemblyNo}.img`;
  const [latest] = storedFiles(assemblyNo, kind).sort((a, b) =>
    a.name === legacy ? 1 : b.name === legacy ? -1 : b.name.localeCompare(a.name),
  );

  return latest?.uri ?? null;
}

/**
 * Fetches the constituency image once and keeps it on the device, so it still
 * shows with no connection. Re-downloads only when the server says it changed,
 * and keeps the previous one until the new one has fully arrived.
 */
export async function syncBanner(
  token: string,
  assemblyNo: number,
  updatedAt: string | null,
  kind: ConstituencyImage = "banner",
): Promise<string | null> {
  if (!updatedAt) return cachedBannerUri(assemblyNo, kind);

  const file = bannerFile(assemblyNo, updatedAt, kind);

  if (file.exists) return file.uri;

  const directory = bannerDirectory();

  if (!directory.exists) directory.create({ intermediates: true });

  try {
    const downloaded = await File.downloadFileAsync(`${baseUrl}${ENDPOINT[kind]}`, file, {
      headers: { authorization: `Bearer ${token}`, "ngrok-skip-browser-warning": "true" },
      idempotent: true,
    });

    for (const old of storedFiles(assemblyNo, kind)) {
      if (old.name !== file.name) {
        try {
          old.delete();
        } catch {
          // Harmless: a stale copy only costs space.
        }
      }
    }

    return downloaded.uri;
  } catch {
    // A failed refresh keeps whatever is already on the device.
    try {
      if (file.exists) file.delete();
    } catch {
      // Nothing to clean up.
    }

    return cachedBannerUri(assemblyNo, kind);
  }
}
