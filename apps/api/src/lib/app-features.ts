import type { AppFeatures } from '@voter/shared';

/** The voter-screen feature switches saved on a constituency, as the API returns them. */
export function appFeaturesOf(assembly: AppFeatures): AppFeatures {
  return {
    enableVoteStatus: assembly.enableVoteStatus,
    enableEnrollment: assembly.enableEnrollment,
    enableCasteEntry: assembly.enableCasteEntry,
    enablePartyLoyalty: assembly.enablePartyLoyalty,
    partyOptions: assembly.partyOptions,
    printCautionNote: assembly.printCautionNote,
    allowUserSlipCovers: assembly.allowUserSlipCovers,
    printSlipImage: assembly.printSlipImage,
    isPanchayat: assembly.isPanchayat,
    requireLoginApproval: assembly.requireLoginApproval,
  };
}
