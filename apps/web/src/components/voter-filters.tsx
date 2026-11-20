"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { SearchInput } from "@/components/search-input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** The select value meaning "no filter"; the param is dropped rather than sent. */
const ALL = "all";

/**
 * Keeps the roll's filters in the URL, like the search term, so a filtered
 * view can be reloaded, shared, paged and exported exactly as it is shown.
 */
export function useVoterParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  /** Sets (or, for "" / `ALL`, clears) each param and returns to the first page. */
  const apply = (changes: Record<string, string>) => {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(changes)) {
      if (value === "" || value === ALL) params.delete(key);
      else params.set(key, value);
    }

    params.delete("page");

    startTransition(() => {
      // The table is below the fold; a filter change must not jump to the top.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return { apply, pending };
}

function FilterSelect({
  id,
  label,
  value,
  options,
  disabled,
  onChange,
  className,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`grid gap-1.5 ${className ?? ""}`}>
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Select value={value || ALL} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** An app user who has printed in this constituency, for the agent filter. */
export type AgentOption = {
  sessionId: string;
  fullName: string;
  mobileNumber: string;
};

/** The filter bar above the roll: booth, slip and voting status, agent, and search. */
export function VoterFilters({
  booths,
  agents,
  partNo,
  printed,
  voted,
  deceased,
  agent,
  search,
}: {
  booths: number[];
  /** Everyone who has printed here; the dropdown is hidden when nobody has. */
  agents: AgentOption[];
  partNo: string;
  printed: string;
  voted: string;
  /** "true" when only voters marked deceased are shown. */
  deceased: string;
  /** Session id of the agent whose prints to show, or "". */
  agent: string;
  search: string;
}) {
  const { apply, pending } = useVoterParams();

  // The chosen agent may have dropped off the list (prints reset); keep them selectable.
  const agentOptions =
    agent && !agents.some((row) => row.sessionId === agent)
      ? [...agents, { sessionId: agent, fullName: "Selected agent", mobileNumber: "" }]
      : agents;
  // Always shown, so the filter is where admins expect it even before the first print.
  const noAgents = agentOptions.length === 0;

  return (
    <div className="grid gap-3 md:grid-cols-[repeat(3,minmax(0,12rem))_minmax(0,16rem)_1fr] md:items-end">
      <FilterSelect
        id="filter-booth"
        label="Booth"
        value={partNo}
        disabled={pending}
        onChange={(value) => apply({ part: value })}
        options={[
          { value: ALL, label: "All booths" },
          ...booths.map((booth) => ({ value: String(booth), label: `Booth ${booth}` })),
        ]}
      />
      <FilterSelect
        id="filter-printed"
        label="Slip"
        value={printed}
        disabled={pending}
        onChange={(value) => apply({ printed: value })}
        options={[
          { value: ALL, label: "All" },
          { value: "true", label: "Slip printed" },
          { value: "false", label: "Not printed" },
        ]}
      />
      <FilterSelect
        id="filter-voted"
        label="Status"
        // Deceased is its own URL param but sits in this list, as one more status.
        value={deceased === "true" ? "deceased" : voted}
        disabled={pending}
        onChange={(value) =>
          apply(value === "deceased" ? { voted: "", deceased: "true" } : { voted: value, deceased: "" })
        }
        options={[
          { value: ALL, label: "All" },
          { value: "true", label: "Voted" },
          { value: "false", label: "Not voted" },
          { value: "deceased", label: "Deceased" },
        ]}
      />
      <FilterSelect
        id="filter-agent"
        label="Printed by agent"
        value={agent}
        disabled={pending || noAgents}
        onChange={(value) => apply({ agent: value })}
        options={
          noAgents
            ? [{ value: ALL, label: "No agent has printed yet" }]
            : [
                { value: ALL, label: "Any agent" },
                ...agentOptions.map((row) => ({
                  value: row.sessionId,
                  label: row.mobileNumber
                    ? `${row.fullName} · ${row.mobileNumber}`
                    : row.fullName,
                })),
              ]
        }
      />
      <div className="grid gap-1.5 md:justify-self-end">
        <Label className="text-muted-foreground text-xs">Search</Label>
        <SearchInput
          initial={search}
          placeholder="Name, voter ID, house, village, mobile"
          label="Search voters"
        />
      </div>
    </div>
  );
}
