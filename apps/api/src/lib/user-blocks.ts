import { prisma } from '../prisma.js';

/**
 * Switched-off mobile numbers and app installs, held in memory: every app
 * request checks them, and on polling day that is a lot of requests. Changes
 * made here apply at once; a reload every minute picks up any made elsewhere.
 */
let blockedMobiles = new Set<string>();
let blockedDevices = new Set<string>();
let loadedAt = 0;

const RELOAD_MS = 60_000;

async function reload() {
  const [users, devices] = await Promise.all([
    prisma.blockedUser.findMany({ select: { mobileNumber: true } }),
    prisma.blockedDevice.findMany({ select: { deviceId: true } }),
  ]);

  blockedMobiles = new Set(users.map((row) => row.mobileNumber));
  blockedDevices = new Set(devices.map((row) => row.deviceId));
  loadedAt = Date.now();
}

async function fresh() {
  if (Date.now() - loadedAt > RELOAD_MS) await reload();
}

export const DEACTIVATED = {
  message: 'This mobile number has been deactivated by the admin.',
  code: 'USER_DEACTIVATED',
} as const;

export const DEVICE_BLOCKED = {
  message: 'This phone has been blocked by the admin. Contact your admin.',
  code: 'DEVICE_BLOCKED',
} as const;

/** Why this mobile number or app install may not use the app, or null. */
export async function blockFor(
  mobileNumber: string,
  deviceIds: (string | null | undefined)[],
): Promise<typeof DEACTIVATED | typeof DEVICE_BLOCKED | null> {
  await fresh();

  if (blockedMobiles.has(mobileNumber)) return DEACTIVATED;
  if (deviceIds.some((id) => id && blockedDevices.has(id))) return DEVICE_BLOCKED;

  return null;
}

export async function isDeactivated(mobileNumber: string): Promise<boolean> {
  await fresh();

  return blockedMobiles.has(mobileNumber);
}

/** The app install id the phone sends with every request, when its build has one. */
export function deviceIdOf(headers: Record<string, string | string[] | undefined>): string | null {
  const value = headers['x-device-id'];
  const id = Array.isArray(value) ? value[0] : value;

  return id && /^[A-Za-z0-9-]{8,64}$/.test(id) ? id : null;
}

/**
 * Switches a mobile number off, and with it every app install it signed in
 * on: those phones are signed out on their next request and cannot sign in
 * with any number until the user is switched back on or the app reinstalled.
 */
export async function deactivateUser(mobileNumber: string, adminId: string | null) {
  const sessions = await prisma.loginSession.findMany({
    where: { mobileNumber, deviceId: { not: null } },
    select: { deviceId: true },
    distinct: ['deviceId'],
  });
  const deviceIds = sessions.map((row) => row.deviceId!).filter(Boolean);

  await prisma.$transaction([
    prisma.blockedUser.upsert({
      where: { mobileNumber },
      create: { mobileNumber, blockedById: adminId },
      update: {},
    }),
    prisma.blockedDevice.createMany({
      data: deviceIds.map((deviceId) => ({ deviceId, mobileNumber })),
      skipDuplicates: true,
    }),
  ]);
  await reload();

  return { devices: deviceIds.length };
}

/** Switches the number and its phones back on. */
export async function activateUser(mobileNumber: string) {
  await prisma.$transaction([
    prisma.blockedUser.deleteMany({ where: { mobileNumber } }),
    prisma.blockedDevice.deleteMany({ where: { mobileNumber } }),
  ]);
  await reload();
}

/** Deactivated numbers among these, for the App users list. */
export async function deactivatedAmong(mobileNumbers: string[]): Promise<Set<string>> {
  await fresh();

  return new Set(mobileNumbers.filter((mobile) => blockedMobiles.has(mobile)));
}

/** Adds an install seen signing in with a number that is already switched off. */
export async function blockDevice(deviceId: string, mobileNumber: string) {
  if (blockedDevices.has(deviceId)) return;

  await prisma.blockedDevice.createMany({ data: [{ deviceId, mobileNumber }], skipDuplicates: true });
  blockedDevices.add(deviceId);
}
