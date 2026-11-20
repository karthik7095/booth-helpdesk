import type { Announcement } from '@voter/shared';

type AnnouncementColumns = {
  announcementEnabled: boolean;
  announcementTitle: string | null;
  announcementBody: string | null;
  announcementUpdatedAt: Date | null;
};

/** The booth-agent notice saved on a constituency, as the API returns it. */
export function announcementOf(assembly: AnnouncementColumns): Announcement {
  return {
    announcementEnabled: assembly.announcementEnabled,
    announcementTitle: assembly.announcementTitle,
    announcementBody: assembly.announcementBody,
    announcementUpdatedAt: assembly.announcementUpdatedAt?.toISOString() ?? null,
  };
}
