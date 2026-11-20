import { voterSearchText, type StatSlice } from "@voter/shared";
import { ChevronDown, Printer, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { card, field, muted, Pager, primaryButton, ScreenHeader, secondaryButton } from "@/components/agent/ui";
import { VoterRow } from "@/components/agent/voter-row";
import { agentApi } from "@/lib/agent-api";
import {
  AGE_PRESETS,
  ageText,
  compareHouse,
  familiesOf,
  filtersFrom,
  matches,
  surnamesOf,
  voterNames,
  type Filters,
} from "@/lib/agent-voters";
import { requireAgent } from "@/lib/agent-session";
import { cn } from "@/lib/utils";

type Tab = "voters" | "families" | "stats";

const VOTERS_PER_PAGE = 100;
const FAMILIES_PER_PAGE = 40;
const MEMBERS_SHOWN = 10;

const GENDERS = [
  { id: "all", label: "All" },
  { id: "M", label: "Male" },
  { id: "F", label: "Female" },
  { id: "other", label: "Other" },
] as const;

export default async function AgentBoothPage({ params, searchParams }: PageProps<"/web/booths/[partNo]">) {
  const { access, token } = await requireAgent();
  const partNo = Number((await params).partNo);
  const query = await searchParams;

  if (!Number.isInteger(partNo) || (access.partNos.length > 0 && !access.partNos.includes(partNo))) notFound();

  const one = (key: string) => {
    const value = query[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const tab: Tab = one("tab") === "families" ? "families" : one("tab") === "stats" ? "stats" : "voters";
  const q = one("q");
  const filters = filtersFrom(query);
  const page = Math.max(1, Number.parseInt(one("page"), 10) || 1);

  const [all, booths] = await Promise.all([agentApi.boothVoters(partNo, token), agentApi.booths(token)]);
  const booth = booths.find((b) => b.partNo === partNo);

  const surnames = surnamesOf(all);
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (voter: (typeof all)[number]) =>
    matches(voter, filters, surnames) &&
    words.every((word) => voterSearchText(voter).includes(word) || String(voter.srNo) === word);
  const narrowed = q !== "" || filters.gender !== "all" || ageText(filters) !== null || filters.surname !== "";

  const voters = narrowed ? all.filter(hit) : all;
  const hits = new Set(voters.map((voter) => voter.id));

  const families = familiesOf(all, surnames)
    .filter((family) => !narrowed || family.members.some((member) => hits.has(member.id)))
    .sort((a, b) => {
      // Voters with no house number are not a household; keep them last.
      if (!a.key !== !b.key) return a.key ? -1 : 1;
      return filters.sort === "size" ? b.members.length - a.members.length || compareHouse(a, b) : compareHouse(a, b);
    });
  const households = familiesOf(all, surnames).filter((family) => family.key).length;

  // A booth runs to 1,500 voters; sending them all at once is megabytes on a phone.
  const perPage = tab === "families" ? FAMILIES_PER_PAGE : VOTERS_PER_PAGE;
  const listLength = tab === "families" ? families.length : voters.length;
  const pages = Math.max(1, Math.ceil(listLength / perPage));
  const current = Math.min(page, pages);
  const shownVoters = voters.slice((current - 1) * perPage, current * perPage);
  const shownFamilies = families.slice((current - 1) * perPage, current * perPage);

  // Links that keep the other settings: a tab, or the filters with one cleared.
  const href = (changes: Record<string, string>) => {
    const next = new URLSearchParams();
    const merged: Record<string, string> = {
      tab,
      q,
      gender: filters.gender === "all" ? "" : filters.gender,
      min: filters.min,
      max: filters.max,
      surname: filters.surname,
      sort: filters.sort === "size" ? "" : filters.sort,
      ...changes,
    };
    // A page number only travels when given: a new tab or filter starts at page 1.
    for (const [key, value] of Object.entries(merged)) {
      if (value && !(key === "tab" && value === "voters") && !(key === "page" && value === "1")) next.set(key, value);
    }
    const text = next.toString();
    return `/web/booths/${partNo}${text ? `?${text}` : ""}`;
  };

  const chips: { label: string; clear: string }[] = [
    ...(q ? [{ label: `“${q}”`, clear: href({ q: "" }) }] : []),
    ...(filters.surname ? [{ label: filters.surname, clear: href({ surname: "" }) }] : []),
    ...(filters.gender !== "all"
      ? [{ label: GENDERS.find((g) => g.id === filters.gender)!.label, clear: href({ gender: "" }) }]
      : []),
    ...(ageText(filters) ? [{ label: `Age ${ageText(filters)}`, clear: href({ min: "", max: "" }) }] : []),
  ];

  const tabs = [
    { id: "voters" as const, label: "Voters", count: voters.length },
    { id: "families" as const, label: "Families", count: families.length },
    { id: "stats" as const, label: "Statistics", count: undefined },
  ];

  return (
    <>
      <div className="sticky top-0 z-20 bg-white">
        <ScreenHeader
          title={`Booth ${partNo}`}
          subtitle={
            narrowed
              ? `${voters.length.toLocaleString("en-IN")} of ${all.length.toLocaleString("en-IN")} voters`
              : `${all.length.toLocaleString("en-IN")} voters · ${households.toLocaleString("en-IN")} families`
          }
          back="/web/booths"
        />
        <nav aria-label="Booth views" className="grid grid-cols-3 border-b border-[#DBE3F3]">
          {tabs.map((item) => {
            const selected = tab === item.id;
            return (
              <Link
                key={item.id}
                href={href({ tab: item.id })}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex h-12 items-center justify-center gap-1.5 border-b-[3px] text-[15px] font-bold",
                  selected ? "border-[#0C4EF0] text-[#0C4EF0]" : "border-transparent text-[#637094]",
                )}
              >
                {item.label}
                {item.count !== undefined ? (
                  <span
                    className={cn(
                      "rounded-full px-1.5 text-[11px] font-bold",
                      selected ? "bg-[#0C4EF0] text-white" : "bg-[#E6EEFF] text-[#637094]",
                    )}
                  >
                    {item.count.toLocaleString("en-IN")}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>

      {booth?.boothAddress ? <p className={`px-4 pt-3 text-sm ${muted}`}>{booth.boothAddress}</p> : null}

      {tab !== "stats" ? (
        <div className="grid gap-3 px-4 pt-3">
          <FilterForm tab={tab} q={q} filters={filters} surnames={surnames} voterIds={all.map((v) => v.id)} chipCount={chips.length} />
          {chips.length ? (
            <div className="flex flex-wrap gap-2">
              {chips.map((chip) => (
                <Link
                  key={chip.label}
                  href={chip.clear}
                  aria-label={`Remove ${chip.label} filter`}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[#0C4EF0] bg-[#E6EEFF] pr-2.5 pl-3 text-[13px] font-semibold text-[#0C4EF0]"
                >
                  {chip.label}
                  <X className="size-3.5" />
                </Link>
              ))}
              <Link href={href({ q: "", gender: "", min: "", max: "", surname: "" })} className={`inline-flex h-9 items-center px-2 text-[13px] font-semibold underline ${muted}`}>
                Clear all
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}

      <main className="grid gap-3 p-4">
        {tab === "voters" ? (
          voters.length ? (
            <>
              {shownVoters.map((voter) => (
                <VoterRow key={voter.id} voter={voter} />
              ))}
              <Pager page={current} pages={pages} href={(to) => href({ page: String(to) })} />
            </>
          ) : (
            <p className={`py-10 text-center ${muted}`}>No voters in this booth match.</p>
          )
        ) : null}

        {tab === "families" ? (
          <>
            <div className={`flex justify-between px-1 text-xs ${muted}`}>
              <span className="font-bold tracking-wider">{narrowed ? "FAMILIES WITH A MATCH" : "ALL FAMILIES"}</span>
              <span>{filters.sort === "size" ? "Most voters first" : "By house no."}</span>
            </div>
            {families.length === 0 ? <p className={`py-10 text-center ${muted}`}>No families in this booth match.</p> : null}
            {shownFamilies.map((family) => {
              const matching = family.members.filter((member) => hits.has(member.id)).length;
              const title = family.houseNo
                ? family.surnames.length > 2
                  ? `${family.surnames.slice(0, 2).join(", ")} +${family.surnames.length - 2}`
                  : family.surnames.join(", ") || `H.No ${family.houseNo}`
                : "No house number";
              return (
                <details key={family.key || "none"} className={`${card} group overflow-hidden open:border-[#0C4EF0]`}>
                  <summary className="flex cursor-pointer list-none items-center gap-3 p-3.5 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold uppercase">{title}</span>
                      <span className={`block truncate text-sm ${muted}`}>
                        {family.houseNo ? `H.No ${family.houseNo} · Head: ${voterNames(family.head).native || voterNames(family.head).english}` : "Not on any house"}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1.5 text-xs font-semibold">
                        <span className="rounded-full bg-[#E6EEFF] px-2 py-0.5">{family.males} M</span>
                        <span className="rounded-full bg-[#E6EEFF] px-2 py-0.5">{family.females} F</span>
                        {narrowed ? (
                          <span className="rounded-full bg-[#FFF1D0] px-2 py-0.5 text-[#7A5600]">
                            {matching} of {family.members.length} match
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="text-center">
                      <span className="block text-2xl font-extrabold text-[#0C4EF0]">{family.members.length}</span>
                      <span className={`block text-xs ${muted}`}>voters</span>
                    </span>
                    <ChevronDown className={`size-5 shrink-0 transition-transform group-open:rotate-180 ${muted}`} />
                  </summary>
                  <div className="divide-y divide-[#EAF0FA] border-t border-[#DBE3F3]">
                    {/* Matches first; an apartment block can hold dozens, the rest are a tap away. */}
                    {[...family.members]
                      .sort((a, b) => Number(hits.has(b.id)) - Number(hits.has(a.id)))
                      .slice(0, MEMBERS_SHOWN)
                      .map((member) => (
                        <VoterRow key={member.id} voter={member} boxed={false} dimmed={narrowed && !hits.has(member.id)} />
                      ))}
                    {family.members.length > MEMBERS_SHOWN && family.houseNo ? (
                      <Link href={`/web/family/${family.head.id}`} className="block p-3 text-center text-sm font-semibold text-[#0C4EF0]">
                        +{family.members.length - MEMBERS_SHOWN} more — open family
                      </Link>
                    ) : null}
                  </div>
                  {family.houseNo ? (
                    <div className="grid grid-cols-2 gap-2 p-3">
                      <Link href={`/web/slip/${family.head.id}?family=1`} className={secondaryButton}>
                        <Printer className="size-5" />
                        Print slips
                      </Link>
                      <Link href={`/web/family/${family.head.id}`} className={primaryButton}>
                        Open family
                      </Link>
                    </div>
                  ) : null}
                </details>
              );
            })}
            <Pager page={current} pages={pages} href={(to) => href({ page: String(to) })} />
          </>
        ) : null}

        {tab === "stats" ? <Statistics partNo={partNo} token={token} access={access} /> : null}
      </main>
    </>
  );
}

/** The filter panel: a plain GET form, so the filters live in the address and the back button. */
function FilterForm({
  tab,
  q,
  filters,
  surnames,
  voterIds,
  chipCount,
}: {
  tab: Tab;
  q: string;
  filters: Filters;
  surnames: Map<string, string>;
  voterIds: string[];
  chipCount: number;
}) {
  const tally = new Map<string, number>();
  for (const id of voterIds) {
    const surname = surnames.get(id);
    if (surname) tally.set(surname, (tally.get(surname) ?? 0) + 1);
  }
  const surnameList = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const preset = AGE_PRESETS.find((p) => String(p.min) === filters.min && (p.max === null ? "" : String(p.max)) === filters.max);

  return (
    <details className={`${card} overflow-hidden`} open={false}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-4 font-semibold [&::-webkit-details-marker]:hidden">
        <SlidersHorizontal className="size-5 text-[#0C4EF0]" />
        Search and filter
        {chipCount ? <span className="rounded-full bg-[#FE900A] px-2 text-xs font-bold text-white">{chipCount}</span> : null}
        <ChevronDown className={`ml-auto size-5 ${muted}`} />
      </summary>
      <form action="" className="grid gap-4 border-t border-[#DBE3F3] p-4">
        {tab === "voters" ? null : <input type="hidden" name="tab" value={tab} />}
        <label className="grid gap-2 text-sm font-semibold">
          Name, voter ID, house or serial
          <input name="q" type="search" defaultValue={q} className={field} />
        </label>

        <label className="grid gap-2 text-sm font-semibold">
          Surname
          <input name="surname" list="surnames" defaultValue={filters.surname} autoCapitalize="characters" placeholder="Any surname" className={`${field} uppercase`} />
          <datalist id="surnames">
            {surnameList.map(([surname, count]) => (
              <option key={surname} value={surname}>{`${surname} (${count})`}</option>
            ))}
          </datalist>
        </label>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">Gender</legend>
          <div className="grid grid-cols-4 gap-2">
            {GENDERS.map((gender) => (
              <label key={gender.id} className="relative">
                <input type="radio" name="gender" value={gender.id === "all" ? "" : gender.id} defaultChecked={filters.gender === gender.id} className="peer sr-only" />
                <span className="flex h-11 items-center justify-center rounded-xl border-2 border-[#DBE3F3] text-sm font-semibold peer-checked:border-[#0C4EF0] peer-checked:bg-[#E6EEFF] peer-checked:text-[#0C4EF0] peer-focus-visible:ring-2 peer-focus-visible:ring-[#0C4EF0]/40">
                  {gender.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">Age</legend>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <input name="min" type="number" inputMode="numeric" min={18} max={120} defaultValue={filters.min} placeholder="From" aria-label="From age" className={field} />
            <span className={muted}>–</span>
            <input name="max" type="number" inputMode="numeric" min={18} max={120} defaultValue={filters.max} placeholder="To" aria-label="To age" className={field} />
          </div>
          <p className={`text-xs ${muted}`}>
            Common ranges: {AGE_PRESETS.map((p) => p.label).join(", ")}
            {preset ? ` · now ${preset.label}` : ""}
          </p>
        </fieldset>

        {tab === "families" ? (
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-semibold">Sort families by</legend>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { id: "", label: "Most voters" },
                  { id: "house", label: "House no." },
                ] as const
              ).map((option) => (
                <label key={option.label} className="relative">
                  <input type="radio" name="sort" value={option.id} defaultChecked={(filters.sort === "house") === (option.id === "house")} className="peer sr-only" />
                  <span className="flex h-11 items-center justify-center rounded-xl border-2 border-[#DBE3F3] text-sm font-semibold peer-checked:border-[#0C4EF0] peer-checked:bg-[#E6EEFF] peer-checked:text-[#0C4EF0]">
                    {option.label}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <button type="submit" className={primaryButton}>
          Apply
        </button>
      </form>
    </details>
  );
}

/** Gender, age, religion and community bars, each switch as the admin set it. */
async function Statistics({ partNo, token, access }: { partNo: number; token: string; access: Awaited<ReturnType<typeof requireAgent>>["access"] }) {
  const stats = await agentApi.boothStats(partNo, token);
  const sections: { title: string; rows: StatSlice[]; show: boolean }[] = [
    { title: "Gender", rows: stats.gender, show: access.showGenderStats },
    { title: "Age", rows: stats.age, show: true },
    { title: "Religion", rows: stats.religion, show: access.showReligionStats },
    { title: "Community", rows: stats.community, show: access.showCommunityStats },
  ].filter((section) => section.show);

  return (
    <div className="grid gap-5">
      {sections.map((section) => {
        const largest = Math.max(1, ...section.rows.map((row) => row.count));
        return (
          <section key={section.title} className="grid gap-2">
            <h2 className="text-base font-semibold">{section.title}</h2>
            <div className={`${card} grid gap-3 p-4`}>
              {section.rows.length === 0 ? <p className={`text-sm ${muted}`}>Nothing recorded for this booth.</p> : null}
              {section.rows.map((row) => (
                <div key={row.label} className="grid gap-1">
                  <div className="flex justify-between gap-3 text-sm">
                    <span className="truncate">{row.label}</span>
                    <span className={muted}>
                      {row.count.toLocaleString("en-IN")}
                      {stats.total ? ` · ${Math.round((row.count / stats.total) * 100)}%` : ""}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-[#E6EEFF]">
                    <div className="h-full rounded-full bg-[#0C4EF0]" style={{ width: `${Math.max(2, (row.count / largest) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
