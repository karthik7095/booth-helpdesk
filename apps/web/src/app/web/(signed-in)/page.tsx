import { Building2, LogOut, Search } from "lucide-react";
import Link from "next/link";

import { agentLogoutAction } from "@/app/web/actions";
import { card, field, muted, primaryButton, ScreenHeader } from "@/components/agent/ui";
import { agentApi } from "@/lib/agent-api";
import { requireAgent } from "@/lib/agent-session";

export default async function AgentHomePage() {
  const { session, access, token } = await requireAgent();
  const summary = await agentApi.summary(token);

  const tiles = [
    { label: "Voters", value: summary.total },
    { label: "Voted", value: summary.voted },
    { label: "Pending", value: summary.pending },
  ];

  return (
    <>
      <ScreenHeader
        title={`${access.assemblyNo} · ${access.assemblyName}`}
        subtitle={`${session.fullName}${access.label ? ` · ${access.label}` : ""}${access.partNos.length ? ` · Booths ${access.partNos.join(", ")}` : ""}`}
        action={
          <form action={agentLogoutAction}>
            <button type="submit" aria-label="Sign out" className="grid size-11 place-items-center rounded-xl text-[#637094] hover:bg-[#EEF3FF]">
              <LogOut className="size-5" />
            </button>
          </form>
        }
      />

      <main className="grid gap-5 p-4">
        <form action="/web/search" className="grid gap-3">
          <label htmlFor="q" className="text-sm font-semibold">
            Find a voter
          </label>
          <div className="relative">
            <Search className={`pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 ${muted}`} />
            <input id="q" name="q" type="search" enterKeyHint="search" placeholder="Name, relative, voter ID, house, mobile" className={`${field} pl-11`} />
          </div>
          <button type="submit" className={primaryButton}>
            Search
          </button>
        </form>

        <section className="grid grid-cols-3 gap-3" aria-label="Turnout">
          {tiles.map((tile) => (
            <div key={tile.label} className={`${card} p-3`}>
              <p className={`text-xs font-semibold tracking-wider uppercase ${muted}`}>{tile.label}</p>
              <p className="text-2xl font-extrabold">{tile.value.toLocaleString("en-IN")}</p>
            </div>
          ))}
        </section>

        <Link href="/web/booths" className={`${card} flex items-center gap-4 p-4 hover:bg-[#F4F7FF]`}>
          <span className="grid size-12 place-items-center rounded-xl bg-[#E6EEFF] text-[#0C4EF0]">
            <Building2 className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block text-base font-bold">Booths</span>
            <span className={`block text-sm ${muted}`}>Voters, families and statistics, booth by booth</span>
          </span>
        </Link>

        <p className={`text-center text-xs ${muted}`}>
          On an iPhone: tap Share, then “Add to Home Screen” to open this like an app.
        </p>
      </main>
    </>
  );
}
