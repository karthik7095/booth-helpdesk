import "server-only";

import type { Voter } from "@voter/shared";

import { agentApi } from "@/lib/agent-api";

/**
 * The voter and everyone sharing their house number in the same booth and
 * village, in serial order, as the phone's Family screen finds them. House
 * numbers like "1-2/3" repeat across villages, so the village must match too.
 */
export async function familyOf(voter: Voter, token: string): Promise<Voter[]> {
  const houseNo = voter.houseNo?.trim();

  if (!houseNo) return [voter];

  const village = (voter.eVillage ?? "").trim().toUpperCase();
  const { voters } = await agentApi.search({ partNo: voter.partNo, houseNo, limit: 200 }, token);
  const members = voters.filter((member) => (member.eVillage ?? "").trim().toUpperCase() === village);

  return members.some((member) => member.id === voter.id) ? members : [voter, ...members];
}
