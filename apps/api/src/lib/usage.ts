import type { UsageReport, UsageUser } from '@voter/shared';

import { namePlaceLater } from './geocode.js';
import { prisma } from '../prisma.js';

/** Days roll over at midnight India time, not UTC. */
const TIME_ZONE = 'Asia/Kolkata';

/** Today's calendar date in India, e.g. "2026-09-23". */
export function todayIst(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(now);
}

/** A @db.Date column takes midnight UTC of the calendar date. */
export function dateColumn(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

/**
 * One day's usage, one row per person. Someone who signed in twice (say after
 * reinstalling) has two sessions; they are merged on the mobile number.
 */
export async function usageReport(date: string, assemblyId: string | null): Promise<UsageReport> {
  const rows = await prisma.appUsageDay.findMany({
    where: { date: dateColumn(date), ...(assemblyId ? { assemblyId } : {}) },
    include: {
      session: { include: { accessPin: { select: { label: true } } } },
      assembly: { select: { nameEn: true } },
    },
    orderBy: { lastSeenAt: 'desc' },
  });

  const people = new Map<string, UsageUser>();

  for (const row of rows) {
    const key = row.session.mobileNumber;
    const location =
      row.latitude !== null && row.longitude !== null && row.locatedAt
        ? {
            latitude: row.latitude,
            longitude: row.longitude,
            accuracy: row.accuracy,
            at: row.locatedAt.toISOString(),
            placeName: row.placeName,
          }
        : null;

    // A fix whose lookup failed earlier gets another try; the next view shows it.
    if (location && !row.placeName) namePlaceLater(row.id, location.latitude, location.longitude);
    const label = row.session.accessPin?.label ?? null;
    const existing = people.get(key);

    if (!existing) {
      people.set(key, {
        mobileNumber: row.session.mobileNumber,
        fullName: row.session.fullName,
        assemblyName: row.assembly?.nameEn ?? null,
        pinLabels: label ? [label] : [],
        opens: row.opens,
        activeSeconds: row.activeSeconds,
        firstSeenAt: row.firstSeenAt.toISOString(),
        lastSeenAt: row.lastSeenAt.toISOString(),
        location,
      });
      continue;
    }

    existing.opens += row.opens;
    existing.activeSeconds += row.activeSeconds;
    if (label && !existing.pinLabels.includes(label)) existing.pinLabels.push(label);
    if (row.firstSeenAt.toISOString() < existing.firstSeenAt) {
      existing.firstSeenAt = row.firstSeenAt.toISOString();
    }
    // Rows arrive newest first, so the first location seen is the latest.
    if (!existing.location && location) existing.location = location;
  }

  const users = [...people.values()];

  return {
    date,
    totals: {
      users: users.length,
      opens: users.reduce((sum, user) => sum + user.opens, 0),
      activeSeconds: users.reduce((sum, user) => sum + user.activeSeconds, 0),
      withLocation: users.filter((user) => user.location !== null).length,
    },
    users,
  };
}
