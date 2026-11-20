import {
  ACCESS_REMOVED,
  APPROVAL_PENDING,
  LOGIN_LIMIT_REACHED,
  type AppUserAction,
  type AppUserList,
  type AppUserStatus,
} from '@voter/shared';

import { prisma } from '../prisma.js';

/**
 * Who may use each constituency, by mobile number (AppUserAccess). Every app
 * request checks it, so it is held in memory like the user blocks: changes
 * made here apply at once, and a reload every minute picks up any made by
 * another API process.
 *
 * - `removed` is turned away from the constituency's PINs whether or not it
 *   requires approval, until an admin allows them again.
 * - With approval required, anyone not `approved` waits; entering the PIN
 *   files them as `pending` for an admin to decide.
 * - Without it, a new user is approved on the spot while fewer than the
 *   constituency's `maxAppUsers` are, and turned away once it is full.
 */

/** What the gate needs to know about a constituency. */
export type GatedAssembly = { id: string; requireLoginApproval: boolean; maxAppUsers: number };

type Standing = { status: AppUserStatus; isAdmin: boolean; isMayor: boolean; wardNos: number[] };

let standings = new Map<string, Standing>();
let loadedAt = 0;
const RELOAD_MS = 60_000;

const key = (assemblyId: string, mobileNumber: string) => `${assemblyId}|${mobileNumber}`;

async function fresh(): Promise<void> {
  if (Date.now() - loadedAt <= RELOAD_MS) return;

  const rows = await prisma.appUserAccess.findMany({
    select: { assemblyId: true, mobileNumber: true, status: true, isAdmin: true, isMayor: true, wardNos: true },
  });

  standings = new Map(
    rows.map((row) => [
      key(row.assemblyId, row.mobileNumber),
      { status: row.status as AppUserStatus, isAdmin: row.isAdmin, isMayor: row.isMayor, wardNos: row.wardNos },
    ]),
  );
  loadedAt = Date.now();
}

function remember(assemblyId: string, mobileNumber: string, standing: Standing | null): void {
  if (standing) standings.set(key(assemblyId, mobileNumber), standing);
  else standings.delete(key(assemblyId, mobileNumber));
}

export async function standingOf(assemblyId: string, mobileNumber: string): Promise<Standing | null> {
  await fresh();

  return standings.get(key(assemblyId, mobileNumber)) ?? null;
}

export type AccessRefusal = {
  code: typeof APPROVAL_PENDING | typeof ACCESS_REMOVED | typeof LOGIN_LIMIT_REACHED;
  message: string;
};

export const REMOVED: AccessRefusal = {
  code: ACCESS_REMOVED,
  message: 'Your access to this constituency was removed by the admin.',
};

export const PENDING: AccessRefusal = {
  code: APPROVAL_PENDING,
  message: 'Waiting for your admin to approve you. You can open the app once they do.',
};

const limitReached = (limit: number): AccessRefusal => ({
  code: LOGIN_LIMIT_REACHED,
  message: `This constituency already has its ${limit} users. Ask your admin to remove someone or raise the limit.`,
});

/**
 * Why this mobile number may not use the constituency right now, or null.
 * `file` records a first-time user as pending (the PIN screen does; ordinary
 * requests only check).
 */
export async function refusalFor(
  assembly: GatedAssembly,
  user: { mobileNumber: string; fullName: string },
  { file = false }: { file?: boolean } = {},
): Promise<AccessRefusal | null> {
  const standing = await standingOf(assembly.id, user.mobileNumber);

  if (standing?.status === 'removed') return REMOVED;
  if (standing?.status === 'approved') return null;

  // No approval step: in while there is room, approved on the spot.
  if (!assembly.requireLoginApproval) {
    const approved = await prisma.appUserAccess.count({ where: { assemblyId: assembly.id, status: 'approved' } });

    if (approved >= assembly.maxAppUsers) return limitReached(assembly.maxAppUsers);

    const data = { status: 'approved', decidedAt: new Date(), decidedBy: 'Signed in (no approval needed)' };

    await prisma.appUserAccess.upsert({
      where: { assemblyId_mobileNumber: { assemblyId: assembly.id, mobileNumber: user.mobileNumber } },
      create: { assemblyId: assembly.id, mobileNumber: user.mobileNumber, fullName: user.fullName, ...data },
      update: data,
    });
    remember(assembly.id, user.mobileNumber, {
      status: 'approved',
      isAdmin: standing?.isAdmin ?? false,
      isMayor: standing?.isMayor ?? false,
      wardNos: standing?.wardNos ?? [],
    });

    return null;
  }

  if (!standing && file) {
    await prisma.appUserAccess.upsert({
      where: { assemblyId_mobileNumber: { assemblyId: assembly.id, mobileNumber: user.mobileNumber } },
      create: { assemblyId: assembly.id, mobileNumber: user.mobileNumber, fullName: user.fullName },
      update: {},
    });
    remember(assembly.id, user.mobileNumber, { status: 'pending', isAdmin: false, isMayor: false, wardNos: [] });
  }

  return PENDING;
}

/** An app admin here: approved and marked admin on the dashboard. */
export async function isAppAdmin(assemblyId: string, mobileNumber: string): Promise<boolean> {
  const standing = await standingOf(assemblyId, mobileNumber);

  return standing?.status === 'approved' && standing.isAdmin;
}

/** The wards an approved user may see; empty means every ward. */
export async function wardNosOf(assemblyId: string, mobileNumber: string): Promise<number[]> {
  const standing = await standingOf(assemblyId, mobileNumber);

  return standing?.status === 'approved' ? standing.wardNos : [];
}

/** The constituency's wards and voter counts; empty when it has none. */
export async function wardsIn(assemblyId: string): Promise<{ wardNo: number; voters: number }[]> {
  const assembly = await prisma.assembly.findUnique({ where: { id: assemblyId }, select: { assemblyNo: true } });

  if (!assembly) return [];

  // By number, like every voter query: imported rows are keyed on it.
  const rows = await prisma.voter.groupBy({
    by: ['wardNo'],
    where: { assemblyNo: assembly.assemblyNo, wardNo: { not: null } },
    _count: { _all: true },
    orderBy: { wardNo: 'asc' },
  });

  return rows.map((row) => ({ wardNo: row.wardNo!, voters: row._count._all }));
}

/**
 * Files everyone who has already unlocked one of the constituency's PINs as
 * pending, so switching approval on lists them for the admin at once instead
 * of only as each phone next calls in.
 */
export async function filePendingForExisting(assemblyId: string): Promise<number> {
  const sessions = await prisma.loginSession.findMany({
    where: { accessPin: { assemblyId }, verifiedAt: { not: null } },
    orderBy: { lastSeenAt: 'desc' },
    select: { mobileNumber: true, fullName: true },
  });
  const seen = new Set<string>();
  const fresh = sessions.filter((row) => (seen.has(row.mobileNumber) ? false : (seen.add(row.mobileNumber), true)));

  const result = await prisma.appUserAccess.createMany({
    data: fresh.map((row) => ({ assemblyId, mobileNumber: row.mobileNumber, fullName: row.fullName })),
    skipDuplicates: true,
  });

  loadedAt = 0;

  return result.count;
}

export async function listAppUsers(assembly: GatedAssembly): Promise<AppUserList> {
  const rows = await prisma.appUserAccess.findMany({
    where: { assemblyId: assembly.id },
    orderBy: [{ requestedAt: 'desc' }],
  });
  const seen = await prisma.loginSession.groupBy({
    by: ['mobileNumber'],
    where: { accessPin: { assemblyId: assembly.id }, mobileNumber: { in: rows.map((row) => row.mobileNumber) } },
    _max: { lastSeenAt: true },
  });
  const lastSeen = new Map(seen.map((row) => [row.mobileNumber, row._max.lastSeenAt]));
  const order: Record<string, number> = { pending: 0, approved: 1, removed: 2 };
  const wards = await wardsIn(assembly.id);

  return {
    requireLoginApproval: assembly.requireLoginApproval,
    limit: assembly.maxAppUsers,
    approved: rows.filter((row) => row.status === 'approved').length,
    users: rows
      .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3))
      .map((row) => ({
        mobileNumber: row.mobileNumber,
        fullName: row.fullName,
        status: row.status as AppUserStatus,
        isAdmin: row.isAdmin,
        isMayor: row.isMayor,
        requestedAt: row.requestedAt.toISOString(),
        decidedAt: row.decidedAt?.toISOString() ?? null,
        decidedBy: row.decidedBy,
        lastSeenAt: lastSeen.get(row.mobileNumber)?.toISOString() ?? null,
        wardNos: row.wardNos,
      })),
    wards,
  };
}

export class AppUserError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** The top app admin here: approved and marked Mayor on the dashboard. */
export async function isMayorOf(assemblyId: string, mobileNumber: string): Promise<boolean> {
  const standing = await standingOf(assemblyId, mobileNumber);

  return standing?.status === 'approved' && standing.isMayor;
}

/**
 * Approves, removes or allows back an app user, or makes them an admin.
 * `by.app` is an app admin on the Approvals screen. Nobody changes their own
 * access there, and the Mayor flag is set only on the dashboard. A Mayor
 * manages everyone else, admins included, and makes or unmakes admins; any
 * other app admin manages ordinary users only.
 *
 * In a constituency with wards, `approve`, `make-admin` and `set-wards` need
 * `wardNos`: the wards the user may download (empty for all of them).
 */
export async function actOnAppUser(
  assemblyId: string,
  mobileNumber: string,
  action: AppUserAction,
  by: { label: string; app?: { mobileNumber: string; isMayor: boolean } },
  wardNos?: number[],
): Promise<void> {
  const row = await prisma.appUserAccess.findUnique({ where: { assemblyId_mobileNumber: { assemblyId, mobileNumber } } });

  if (!row) {
    // Someone who used a PIN before approval was switched on can still be removed.
    const used = await prisma.loginSession.count({ where: { mobileNumber, accessPin: { assemblyId } } });

    if (!used) throw new AppUserError(404, 'That person has not signed in to this constituency.');
  }

  if (by.app) {
    if (action === 'make-mayor' || action === 'unmake-mayor') {
      throw new AppUserError(403, 'The Mayor is chosen on the dashboard.');
    }
    if (mobileNumber === by.app.mobileNumber) throw new AppUserError(403, 'You cannot change your own access.');
    if (row?.isMayor) throw new AppUserError(403, 'The Mayor can only be changed on the dashboard.');
    if (!by.app.isMayor && (action === 'make-admin' || action === 'unmake-admin')) {
      throw new AppUserError(403, 'Only the Mayor can choose admins.');
    }
    if (!by.app.isMayor && row?.isAdmin) throw new AppUserError(403, 'Only the Mayor can change another admin.');
  }

  const fullName =
    row?.fullName ??
    (await prisma.loginSession.findFirst({ where: { mobileNumber, accessPin: { assemblyId } }, orderBy: { lastSeenAt: 'desc' } }))
      ?.fullName ??
    mobileNumber;
  const decided = { decidedAt: new Date(), decidedBy: by.label };

  // The wards chosen for this user, checked against the roll. Asked for only
  // where the constituency has wards; elsewhere they always see everything.
  const chosenWards = async (): Promise<number[] | undefined> => {
    const wards = await wardsIn(assemblyId);

    if (wards.length === 0) return action === 'set-wards' ? [] : undefined;
    if (wardNos === undefined) throw new AppUserError(400, 'Choose the wards this person may see.');

    const known = new Set(wards.map((ward) => ward.wardNo));
    const unknown = wardNos.filter((wardNo) => !known.has(wardNo));

    if (unknown.length) throw new AppUserError(400, `No ward ${unknown.join(', ')} in this constituency.`);

    return [...new Set(wardNos)].sort((a, b) => a - b);
  };
  const write = async (data: {
    status?: AppUserStatus;
    isAdmin?: boolean;
    isMayor?: boolean;
    decidedAt?: Date;
    decidedBy?: string;
    wardNos?: number[];
  }) => {
    const saved = await prisma.appUserAccess.upsert({
      where: { assemblyId_mobileNumber: { assemblyId, mobileNumber } },
      create: { assemblyId, mobileNumber, fullName, ...data },
      update: data,
    });

    remember(assemblyId, mobileNumber, {
      status: saved.status as AppUserStatus,
      isAdmin: saved.isAdmin,
      isMayor: saved.isMayor,
      wardNos: saved.wardNos,
    });
  };
  const roomForOneMore = async () => {
    if (row?.status === 'approved') return;

    const [approved, assembly] = await Promise.all([
      prisma.appUserAccess.count({ where: { assemblyId, status: 'approved' } }),
      prisma.assembly.findUniqueOrThrow({ where: { id: assemblyId }, select: { maxAppUsers: true } }),
    ]);

    if (approved >= assembly.maxAppUsers) {
      throw new AppUserError(
        409,
        `Already ${assembly.maxAppUsers} users approved, the limit for this constituency. Remove one first, or ask a super admin to raise the limit.`,
      );
    }
  };

  switch (action) {
    case 'approve':
      if (row?.status === 'removed') throw new AppUserError(409, 'Allow them again first, then approve.');
      await roomForOneMore();
      await write({ status: 'approved', wardNos: await chosenWards(), ...decided });
      return;
    case 'remove':
      await write({ status: 'removed', isAdmin: false, isMayor: false, ...decided });
      return;
    case 'allow':
      // Off the removed list; with approval on they ask again like a new user.
      await write({ status: 'pending', ...decided });
      return;
    case 'make-admin':
      if (row?.status === 'removed') throw new AppUserError(409, 'Allow them again first.');
      await roomForOneMore();
      // Someone already approved keeps their wards unless new ones are given.
      await write({
        status: 'approved',
        isAdmin: true,
        wardNos: row?.status === 'approved' && wardNos === undefined ? row.wardNos : await chosenWards(),
        ...decided,
      });
      return;
    case 'unmake-admin':
      await write({ isAdmin: false, isMayor: false });
      return;
    case 'make-mayor':
      if (row?.status === 'removed') throw new AppUserError(409, 'Allow them again first.');
      await roomForOneMore();
      // The Mayor sees the whole roll.
      await write({ status: 'approved', isAdmin: true, isMayor: true, wardNos: [], ...decided });
      return;
    case 'unmake-mayor':
      await write({ isMayor: false });
      return;
    case 'set-wards':
      if (row?.status !== 'approved') throw new AppUserError(409, 'Approve them first.');
      await write({ wardNos: await chosenWards(), ...decided });
      return;
  }
}
