import { Readable } from 'node:stream';

import { voterListQuerySchema } from '@voter/shared';
import type { FastifyPluginAsync } from 'fastify';

import { attachment, CSV_BOM, csvRow } from '../lib/csv.js';
import { voterPrintSummaries } from '../lib/prints.js';
import { voterWhere } from '../lib/voter-filter.js';
import { prisma } from '../prisma.js';

/** Voters are read and written in pages so a 300k-row roll never sits in memory. */
const VOTER_BATCH = 5000;

/**
 * The voter roll as a CSV download. Registered inside the admin routes, so it
 * inherits their admin check and the constituency-admin scoping hook.
 */
export const exportRoutes: FastifyPluginAsync = async (app) => {
  /** The roll, honouring the same filters as the voter search on the page. */
  app.get('/assemblies/:id/export/voters.csv', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = voterListQuerySchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid filters.' });
    }

    const assembly = await prisma.assembly.findUnique({ where: { id } });

    if (!assembly) {
      return reply.code(404).send({ message: 'That constituency does not exist.' });
    }

    const where = voterWhere(assembly.id, parsed.data);

    async function* lines() {
      yield CSV_BOM +
        csvRow([
          'Part', 'Sr', 'Section', 'First name', 'Last name', 'Relative name', 'Relation',
          'Local first name', 'Local last name', 'Local relative name', 'Sex', 'Age',
          'Voter ID', 'House', 'Street / area', 'Village', 'Local address', 'Booth address',
          'Mobile', 'Religion', 'Category', 'Sub-category', 'Caste', 'Favourable', 'Voted', 'Voted at',
          'New enrollment', 'Deceased', 'Slips printed', 'Last printed at', 'Last printed by', 'Last print location', 'Ward',
        ]);

      let cursor: string | undefined;

      for (;;) {
        const batch = await prisma.voter.findMany({
          where,
          orderBy: [{ partNo: 'asc' }, { srNo: 'asc' }, { id: 'asc' }],
          take: VOTER_BATCH,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (batch.length === 0) return;

        const prints = await voterPrintSummaries(batch.map((voter) => voter.id));

        yield batch
          .map((voter) => {
            const summary = prints.get(voter.id);
            const last = summary?.last ?? null;
            const place = last?.location
              ? (last.location.placeName ??
                `${last.location.latitude.toFixed(5)}, ${last.location.longitude.toFixed(5)}`)
              : null;

            return csvRow([
              voter.partNo, voter.srNo, voter.sectionNo, voter.eFirstName, voter.eLastName,
              voter.eMiddleName, voter.relationType, voter.lFirstName, voter.lLastName,
              voter.lMiddleName, voter.sex, voter.age, voter.vcardId, voter.houseNo,
              voter.streetArea, voter.eVillage, voter.lAddress, voter.eBoothAddress,
              voter.mobileNo1, voter.religion, voter.community, voter.subCategory, voter.caste, voter.partyLoyalty,
              voter.hasVoted ? 'Yes' : 'No', voter.votedAt, voter.isNewEnrollment ? 'Yes' : 'No',
              voter.isDeceased ? 'Yes' : 'No',
              summary?.count ?? 0, last?.at ?? null,
              last ? `${last.by.fullName} (${last.by.mobileNumber})` : null, place, voter.wardNo,
            ]);
          })
          .join('');

        cursor = batch[batch.length - 1]?.id;
        if (batch.length < VOTER_BATCH) return;
      }
    }

    const { search, printed, hasVoted, deceased, partNo, wardNo, printedBy } = parsed.data;
    const suffix = [
      wardNo === undefined ? null : `ward-${wardNo}`,
      partNo === undefined ? null : `booth-${partNo}`,
      printedBy === undefined ? null : 'by-agent',
      search ? 'search' : null,
      printed === undefined ? null : printed ? 'printed' : 'not-printed',
      hasVoted === undefined ? null : hasVoted ? 'voted' : 'not-voted',
      deceased === undefined ? null : deceased ? 'deceased' : 'living',
    ]
      .filter(Boolean)
      .map((part) => `-${part}`)
      .join('');

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header(
        'content-disposition',
        attachment(`voters-${assembly.assemblyNo}-${assembly.nameEn}${suffix}.csv`),
      )
      .send(Readable.from(lines()));
  });
};
