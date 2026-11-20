import type { Voter } from "@voter/shared";
import Link from "next/link";

import { card, muted } from "@/components/agent/ui";
import { maskMobile, relativeNames, voterNames } from "@/lib/agent-voters";
import { cn } from "@/lib/utils";

/** One voter in a list, as the phone app lays it out: serial, names, relative, sex/age, mobile. */
export function VoterRow({ voter, dimmed = false, boxed = true }: { voter: Voter; dimmed?: boolean; boxed?: boolean }) {
  const names = voterNames(voter);
  const relative = relativeNames(voter);

  return (
    <Link
      href={`/web/voter/${voter.id}`}
      className={cn(
        "flex items-center gap-3 p-3 transition-colors hover:bg-[#F4F7FF]",
        boxed && `${card} overflow-hidden border-l-[6px] border-l-[#0EB89A]`,
        dimmed && "opacity-45",
      )}
    >
      <span className="w-12 shrink-0 text-base font-semibold">{voter.srNo}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold">{names.native || names.english || "Voter"}</span>
        {names.native && names.english ? (
          <span className={cn("block truncate text-xs uppercase", muted)}>{names.english}</span>
        ) : null}
        <span className={cn("block truncate text-sm", muted)}>{relative.native || relative.english || "—"}</span>
      </span>
      <span className="shrink-0 text-right">
        <span className="block text-base font-semibold">
          {(voter.sex ?? "?").toUpperCase().slice(0, 1)}/{voter.age ?? "?"}
        </span>
        <span className={cn("block text-sm", muted)}>{maskMobile(voter.mobileNo1)}</span>
        {voter.hasVoted ? <span className="block text-xs font-semibold text-[#17663D]">Voted</span> : null}
      </span>
    </Link>
  );
}
