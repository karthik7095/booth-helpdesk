import type { VoterSort } from '@voter/shared';

import type { Prisma } from '../generated/prisma/client.js';

/**
 * The roll's ordering for a dashboard column. Booth then serial is the roll's
 * own order and the tie-break for everything else, so a sorted page is stable.
 */
export function voterOrderBy(
  sort: VoterSort | undefined,
  dir: 'asc' | 'desc' = 'asc',
): Prisma.VoterOrderByWithRelationInput[] {
  const rollOrder: Prisma.VoterOrderByWithRelationInput[] = [{ partNo: 'asc' }, { srNo: 'asc' }];

  switch (sort) {
    case 'sr':
      return [{ partNo: 'asc' }, { srNo: dir }];
    case 'name':
      return [{ eFirstName: dir }, { eLastName: dir }, ...rollOrder];
    case 'age':
      return [{ age: dir }, ...rollOrder];
    case 'voterId':
      return [{ vcardId: dir }, ...rollOrder];
    case 'house':
      return [{ houseNo: dir }, ...rollOrder];
    case 'village':
      return [{ eVillage: dir }, ...rollOrder];
    case 'mobile':
      return [{ mobileNo1: dir }, ...rollOrder];
    case 'voted':
      return [{ hasVoted: dir }, ...rollOrder];
    case 'printed':
      return [{ prints: { _count: dir } }, ...rollOrder];
    case 'part':
      return [{ partNo: dir }, { srNo: 'asc' }];
    default:
      return rollOrder;
  }
}

/**
 * The free-text voter search, word by word.
 *
 * Rolls store the whole name in the first-name column, usually surname first
 * ("Immandi Karthik"), and often with doubled spaces from the source file. A
 * single substring match therefore misses "Karthik Immandi" and "Immandi
 * Karthik" alike. Instead every word the user types must appear somewhere on
 * the row — in any name column, in either script, or in the id, house, village
 * or mobile — so word order and spacing no longer matter.
 */
export function voterSearchClauses(search: string | undefined): Prisma.VoterWhereInput[] {
  const words = (search ?? '').split(/\s+/).filter(Boolean);

  return words.map((word) => ({
    OR: [
      { eFirstName: { contains: word, mode: 'insensitive' as const } },
      { eLastName: { contains: word, mode: 'insensitive' as const } },
      { eMiddleName: { contains: word, mode: 'insensitive' as const } },
      { lFirstName: { contains: word } },
      { lLastName: { contains: word } },
      { lMiddleName: { contains: word } },
      { vcardId: { contains: word, mode: 'insensitive' as const } },
      { houseNo: { contains: word, mode: 'insensitive' as const } },
      { eVillage: { contains: word, mode: 'insensitive' as const } },
      { mobileNo1: { contains: word } },
    ],
  }));
}

/** The dashboard's voter search, shared by the list and the CSV export. */
export function voterWhere(
  assemblyId: string,
  filters: {
    partNo?: number;
    wardNo?: number;
    search?: string;
    hasVoted?: boolean;
    deceased?: boolean;
    printed?: boolean;
    printedBy?: string;
  },
): Prisma.VoterWhereInput {
  const { partNo, wardNo, search, hasVoted, deceased, printed, printedBy } = filters;

  return {
    AND: [
      { assemblyId },
      ...(partNo === undefined ? [] : [{ partNo }]),
      ...(wardNo === undefined ? [] : [{ wardNo }]),
      ...(hasVoted === undefined ? [] : [{ hasVoted }]),
      ...(deceased === undefined ? [] : [{ isDeceased: deceased }]),
      // "Printed" means a slip print record exists for the voter, from any phone.
      ...(printed === undefined ? [] : [{ prints: printed ? { some: {} } : { none: {} } }]),
      // Narrowed to one agent: a print by that sign-in. "Not printed" plus an
      // agent still reads as never printed by anyone, which is what it says.
      ...(printedBy === undefined ? [] : [{ prints: { some: { sessionId: printedBy } } }]),
      ...voterSearchClauses(search),
    ],
  };
}
