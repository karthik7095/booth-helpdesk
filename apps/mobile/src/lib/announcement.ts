import type { Access } from "@voter/shared";

import { getMeta, setMeta } from "@/lib/db";

/**
 * The booth-agent notice an admin writes on the dashboard. The phone keeps
 * which version (its timestamp) the agent accepted, so the notice stops
 * covering the home screen once read and comes back only when it changes.
 */
export type ActiveAnnouncement = { title: string; body: string; version: string };

/** The notice to show, or null when the admin has none switched on. */
export function activeAnnouncement(access: Access | null): ActiveAnnouncement | null {
  if (!access?.announcementEnabled || !access.announcementBody?.trim()) return null;

  return {
    title: access.announcementTitle?.trim() || "Announcement",
    body: access.announcementBody,
    version: access.announcementUpdatedAt ?? "1",
  };
}

const acceptedKey = (assemblyNo: number) => `announcementAccepted.${assemblyNo}`;

export async function isAnnouncementAccepted(assemblyNo: number, version: string): Promise<boolean> {
  return (await getMeta(acceptedKey(assemblyNo))) === version;
}

export async function acceptAnnouncement(assemblyNo: number, version: string): Promise<void> {
  await setMeta(acceptedKey(assemblyNo), version);
}

/** One paragraph of the notice: plain, a ✅ checklist item, or a ⚠️ caution. */
export type NoticeParagraph = { kind: "text" | "tick" | "caution"; spans: { text: string; bold: boolean }[] };

/**
 * Splits the notice into paragraphs on blank lines. `**bold**` is the only
 * markup; the leading ✅ or ⚠️ becomes the paragraph's kind and is dropped
 * from the text, since the app draws its own mark for it.
 */
export function noticeParagraphs(body: string): NoticeParagraph[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => {
      const kind = paragraph.startsWith("✅") ? "tick" : paragraph.startsWith("⚠") ? "caution" : "text";
      const text = kind === "tick" ? paragraph.replace(/^✅\s*/u, "") : paragraph;
      const spans = text
        .split("**")
        .map((part, index) => ({ text: part, bold: index % 2 === 1 }))
        .filter((span) => span.text);

      return { kind, spans };
    });
}
