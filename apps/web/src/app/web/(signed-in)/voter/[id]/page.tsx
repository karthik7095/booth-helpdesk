import { Phone, Printer, Users } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { VoterEditor } from "@/app/web/(signed-in)/voter/[id]/voter-editor";
import { card, muted, primaryButton, ScreenHeader, secondaryButton } from "@/components/agent/ui";
import { agentApi } from "@/lib/agent-api";
import { dialable, relationLabel, relativeNames, voterNames, whatsappLink } from "@/lib/agent-voters";
import { requireAgent } from "@/lib/agent-session";
import { ApiError } from "@/lib/api";

export default async function AgentVoterPage({ params }: PageProps<"/web/voter/[id]">) {
  const { access, token } = await requireAgent();
  const { id } = await params;

  const voter = await agentApi.voter(id, token).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });

  const names = voterNames(voter);
  const relative = relativeNames(voter);
  const phone = dialable(voter.mobileNo1);

  const rows: [string, string | number | null][] = [
    ["Name (English)", names.english || null],
    [relationLabel(voter), [relative.native, relative.english].filter(Boolean).join(" · ") || null],
    ["Sex / Age", `${voter.sex ?? "—"} / ${voter.age ?? "—"}`],
    ["Voter ID (EPIC)", voter.vcardId],
    ["Booth", voter.partNo],
    ["Serial", voter.srNo],
    ["House", voter.houseNo],
    ["Village / area", voter.eVillage],
    ["Booth address", voter.eBoothAddress],
    ["Mobile", voter.mobileNo1],
  ];

  return (
    <>
      <ScreenHeader title={names.native || names.english || "Voter"} subtitle={`Booth ${voter.partNo} · Serial ${voter.srNo}`} back={`/web/booths/${voter.partNo}`} />
      <main className="grid gap-4 p-4">
        <section className={`${card} divide-y divide-[#EAF0FA]`}>
          {rows
            .filter(([, value]) => value !== null && value !== "")
            .map(([label, value]) => (
              <div key={label} className="grid grid-cols-[38%_1fr] gap-3 px-4 py-3 text-sm">
                <span className={muted}>{label}</span>
                <span className="font-semibold break-words">{value}</span>
              </div>
            ))}
          {voter.hasVoted ? <p className="px-4 py-3 text-sm font-semibold text-[#17663D]">Voted</p> : null}
        </section>

        <div className="grid grid-cols-2 gap-3">
          <a href={whatsappLink(voter, access)} target="_blank" rel="noopener noreferrer" className={primaryButton}>
            WhatsApp slip
          </a>
          <Link href={`/web/slip/${voter.id}`} className={secondaryButton}>
            <Printer className="size-5" />
            Print slip
          </Link>
          <Link href={`/web/family/${voter.id}`} className={secondaryButton}>
            <Users className="size-5" />
            Family
          </Link>
          {phone ? (
            <a href={`tel:+${phone}`} className={secondaryButton}>
              <Phone className="size-5" />
              Call
            </a>
          ) : (
            <span className={`${secondaryButton} opacity-50`} aria-disabled="true">
              <Phone className="size-5" />
              No mobile
            </span>
          )}
        </div>

        <VoterEditor voter={voter} access={access} />
      </main>
    </>
  );
}
