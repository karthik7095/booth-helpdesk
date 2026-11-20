import { Directory, File, Paths } from "expo-file-system";
import { AppState, Linking } from "react-native";

import { WhatsAppShare } from "../../modules/whatsapp-share";
import { cachedBannerUri } from "@/lib/banner";

/**
 * The cover image is downloaded as a bare ".img" file, since the server sends
 * no name with it. WhatsApp goes by the extension, so it is copied next door
 * under the one its own first bytes call for.
 */
const SIGNATURES: { extension: string; matches: (bytes: Uint8Array) => boolean }[] = [
  { extension: "jpg", matches: (b) => b[0] === 0xff && b[1] === 0xd8 },
  { extension: "png", matches: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e },
  {
    extension: "webp",
    matches: (b) => b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45,
  },
  // The WhatsApp attachment may be a video: MP4 carries "ftyp" from byte 4.
  {
    extension: "mp4",
    matches: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70,
  },
];

const SHARE_DIR = "share";

/**
 * A copy of the constituency's WhatsApp image that other apps can open — or,
 * where the admin has uploaded none, of the slip cover image, which is what
 * was sent before the WhatsApp image existed. Null when neither is on the phone.
 */
export async function shareableCoverUri(assemblyNo: number): Promise<string | null> {
  const cached = cachedBannerUri(assemblyNo, "whatsapp") ?? cachedBannerUri(assemblyNo, "slip");

  if (!cached) return null;

  try {
    const source = new File(cached);
    const bytes = (await source.bytes()).slice(0, 12);
    const extension = SIGNATURES.find((signature) => signature.matches(bytes))?.extension;

    // An unrecognised file is not worth handing over: WhatsApp would reject it.
    if (!extension) return null;

    const directory = new Directory(Paths.cache, SHARE_DIR);

    if (!directory.exists) directory.create({ intermediates: true });

    const target = new File(directory, `voter-slip-${assemblyNo}.${extension}`);

    // Rewritten every time, so replacing the image on the dashboard takes effect.
    if (target.exists) target.delete();

    await source.copy(target);

    return target.contentUri;
  } catch {
    return null;
  }
}

export function isWhatsAppInstalled(): boolean {
  try {
    return Boolean(WhatsAppShare?.installedPackage());
  } catch {
    return false;
  }
}

export type ImageShareOutcome = "sent" | "no-image" | "unavailable";

/**
 * Opens WhatsApp with the image attached and the slip text as its caption.
 * With `phone` (full international form, no "+") WhatsApp goes straight to
 * that number's chat; without one it asks which chat to send it to.
 */
export async function shareCoverWithText(
  assemblyNo: number,
  text: string,
  phone: string | null = null,
): Promise<ImageShareOutcome> {
  if (!WhatsAppShare) return "unavailable";

  const contentUri = await shareableCoverUri(assemblyNo);

  if (!contentUri) return "no-image";

  try {
    // The image goes on the share itself. openChatWithImageCopied only copied
    // it to the clipboard, which agents took for the image not being sent.
    await WhatsAppShare.shareImageWithText(contentUri, text, phone);

    return "sent";
  } catch {
    return "unavailable";
  }
}

/** Opens the chat before the image is sent, so WhatsApp knows the number. */
export const GREETING = "నమస్కారం 🙏";

/** How long to wait for the agent to come back from sending the greeting. */
const RETURN_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Settles true once the app has gone to the background and come back, false
 * if that does not happen in time. Subscribe before handing off to WhatsApp.
 */
function waitForReturn(): { returned: Promise<boolean>; cancel: () => void } {
  let finish: (value: boolean) => void = () => undefined;

  const returned = new Promise<boolean>((resolve) => {
    let left = false;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        left = true;
        return;
      }

      if (left) finish(true);
    });
    const timer = setTimeout(() => finish(false), RETURN_TIMEOUT_MS);

    finish = (value) => {
      subscription.remove();
      clearTimeout(timer);
      resolve(value);
    };
  });

  return { returned, cancel: () => finish(false) };
}

/**
 * The image with the slip text as its caption, straight into the voter's
 * chat even when the number is not in the agent's contacts.
 *
 * WhatsApp opens a chat with an attached image only for a number it already
 * knows — saved in contacts or chatted with before — and asks which chat for
 * any other. A text link opens any number's chat but carries no image. So
 * this sends a short greeting through the link first, which gives WhatsApp a
 * chat with that number, and once the agent is back in the app sends the
 * image to it. Two taps on Send, one image message with the full caption.
 */
export async function shareCoverAfterGreeting(
  assemblyNo: number,
  text: string,
  phone: string,
): Promise<ImageShareOutcome> {
  if (!WhatsAppShare) return "unavailable";

  // Checked first, so the voter is not greeted for an image that cannot follow.
  const contentUri = await shareableCoverUri(assemblyNo);

  if (!contentUri) return "no-image";

  const wait = waitForReturn();

  try {
    await Linking.openURL(`whatsapp://send?phone=${phone}&text=${encodeURIComponent(GREETING)}`);
  } catch {
    wait.cancel();

    return "unavailable";
  }

  if (!(await wait.returned)) return "unavailable";

  // A moment for the activity to settle, or the second hand-off can be dropped.
  await new Promise((resolve) => setTimeout(resolve, 500));

  try {
    await WhatsAppShare.shareImageWithText(contentUri, text, phone);

    return "sent";
  } catch {
    return "unavailable";
  }
}
