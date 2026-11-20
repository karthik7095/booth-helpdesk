import { notFound } from "next/navigation";

import { PrintBar } from "@/app/web/slip/[id]/print-bar";
import { agentApi } from "@/lib/agent-api";
import { familyOf } from "@/lib/agent-family";
import { relativeNames, voterNames } from "@/lib/agent-voters";
import { requireAgent } from "@/lib/agent-session";
import { ApiError } from "@/lib/api";

/**
 * The voter slip for the system print dialog (AirPrint, or Save as PDF): the
 * thermal slip's fields and order. The mobile number is left off, as on the
 * printed slip, since the slip is handed over and often left at the booth.
 */
export default async function AgentSlipPage({ params, searchParams }: PageProps<"/web/slip/[id]">) {
  const { access, token } = await requireAgent();
  const { id } = await params;
  const family = (await searchParams).family === "1";

  const voter = await agentApi.voter(id, token).catch((error: unknown) => {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  });
  const rows = family ? await familyOf(voter, token) : [voter];

  const line = (label: string, value: string | number | null | undefined, strong = false) =>
    value === null || value === undefined || value === "" ? null : (
      <div className="grid grid-cols-[34%_1fr] gap-2 py-0.5">
        <span className="text-[#555]">{label}</span>
        <span className={strong ? "text-lg font-extrabold" : "font-semibold"}>{value}</span>
      </div>
    );

  return (
    <div className="min-h-dvh bg-white text-black">
      <PrintBar back={`/web/voter/${voter.id}`} voters={rows.map((row) => ({ id: row.id, partNo: row.partNo }))} />
      <article className="mx-auto max-w-[90mm] p-4 font-mono text-[13px] leading-snug print:max-w-none print:p-0">
        <header className="border-b-2 border-dashed border-black pb-2 text-center">
          <p className="text-base font-extrabold tracking-widest">VOTER SLIP</p>
          {access.electionTitle ? <p className="font-semibold">{access.electionTitle}</p> : null}
          <p>{access.assemblyName}</p>
          <p>
            Assembly {access.assemblyNo} - Booth {voter.partNo}
          </p>
        </header>

        {rows.map((row) => {
          const names = voterNames(row);
          const relative = relativeNames(row);
          return (
            <section key={row.id} className="border-b-2 border-dashed border-black py-2 break-inside-avoid">
              {line("Name", (names.english || names.native).toUpperCase(), true)}
              {names.native && names.english ? line("", names.native) : null}
              {line("Relative", relative.english || relative.native)}
              {line("Sex/Age", `${row.sex ?? "-"} / ${row.age ?? "-"}`)}
              {line("Voter ID", row.vcardId, true)}
              {line("Serial", row.srNo, true)}
              {line("House", row.houseNo)}
              {line("Village", row.eVillage)}
            </section>
          );
        })}

        <footer className="border-b-2 border-dashed border-black py-2 text-center break-inside-avoid">
          <p className="text-xl font-extrabold">POLLING BOOTH : {voter.partNo}</p>
          {voter.eBoothAddress ? <p>{voter.eBoothAddress}</p> : null}
          {access.pollDate || access.pollTime ? (
            <p className="mt-1 font-semibold">
              {[access.pollDate, access.pollTime].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </footer>
      </article>
    </div>
  );
}
