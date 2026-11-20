import { Printer } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { card, muted, primaryButton, ScreenHeader } from "@/components/agent/ui";
import { VoterRow } from "@/components/agent/voter-row";
import { agentApi } from "@/lib/agent-api";
import { familyOf } from "@/lib/agent-family";
import { voterNames } from "@/lib/agent-voters";
import { requireAgent } from "@/lib/agent-session";
import { ApiError } from "@/lib/api";

export default async function AgentFamilyPage({ params }: PageProps<"/web/family/[id]">) {
  const { token } = await requireAgent();
  const { id } = await params;

  const voter = await agentApi.voter(id, token).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const members = await familyOf(voter, token);

  return (
    <>
      <ScreenHeader
        title="Family"
        subtitle={voter.houseNo ? `H.No ${voter.houseNo} · Booth ${voter.partNo}` : "No house number on the roll"}
        back={`/web/voter/${voter.id}`}
      />
      <main className="grid gap-4 p-4">
        <section className={`${card} grid gap-1 p-4`}>
          <p className={`text-xs font-semibold tracking-wider uppercase ${muted}`}>Family of</p>
          <p className="text-lg font-bold">{voterNames(voter).native || voterNames(voter).english}</p>
          <p className={`text-sm ${muted}`}>{members.length} voters at this house</p>
        </section>

        {voter.houseNo ? (
          <Link href={`/web/slip/${voter.id}?family=1`} className={primaryButton}>
            <Printer className="size-5" />
            Print family slips
          </Link>
        ) : (
          <p className={`text-center text-sm ${muted}`}>Without a house number the roll does not say who lives together.</p>
        )}

        <div className="grid gap-3">
          {members.map((member) => (
            <VoterRow key={member.id} voter={member} />
          ))}
        </div>
      </main>
    </>
  );
}
