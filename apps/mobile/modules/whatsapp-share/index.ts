import { requireOptionalNativeModule } from "expo";

type WhatsAppShareModule = {
  /** The WhatsApp package installed on this phone, or null when there is none. */
  installedPackage: () => string | null;
  /** Opens WhatsApp with the image attached and the text as its caption. */
  shareImageWithText: (contentUri: string, text: string, phone: string | null) => Promise<string>;
  /**
   * Copies the image, then opens `phone`'s chat with the text typed in, for the
   * agent to paste the image. Missing on APKs built before it was added.
   */
  openChatWithImageCopied?: (contentUri: string, text: string, phone: string) => Promise<string>;
};

/** Optional: on iOS, and in Expo Go, the native side is simply not there. */
export const WhatsAppShare = requireOptionalNativeModule<WhatsAppShareModule>("WhatsAppShare");
