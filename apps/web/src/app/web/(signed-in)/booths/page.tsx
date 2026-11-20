import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { card, muted, ScreenHeader } from "@/components/agent/ui";
import { agentApi } from "@/lib/agent-api";
import { requireAgent } from "@/lib/agent-session";

export default async function AgentBoothsPage() {
  const { token } = await requireAgent();
  const booths = await agentApi.booths(token);
  const total = booths.reduce((sum, booth) => sum + booth.total, 0);

  return (
    <>
      <ScreenHeader title="Booths" subtitle={`${booths.length} booths · ${total.toLocaleString("en-IN")} voters`} back="/web" />
      <main className="grid gap-3 p-4">
        {booths.length === 0 ? <p className={`py-10 text-center ${muted}`}>No booths on this PIN yet.</p> : null}
        {booths.map((booth) => (
          <Link key={booth.partNo} href={`/web/booths/${booth.partNo}`} className={`${card} flex items-center gap-4 p-4 hover:bg-[#F4F7FF]`}>
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-[#E6EEFF] text-lg font-extrabold text-[#0C4EF0]">
              {booth.partNo}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-bold">Booth {booth.partNo}</span>
              <span className={`block truncate text-sm ${muted}`}>{booth.boothAddress || booth.village || "No address on the roll"}</span>
              <span className={`block text-xs ${muted}`}>
                {booth.total.toLocaleString("en-IN")} voters · {booth.male} M · {booth.female} F · {booth.voted} voted
              </span>
            </span>
            <ChevronRight className={`size-5 shrink-0 ${muted}`} />
          </Link>
        ))}
      </main>
    </>
  );
}
