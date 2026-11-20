"use client";

import type { WarRoomBooth, WarRoomPrint, WarRoomVoter } from "@voter/shared";
import { ChevronDown, Download, MapPin } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** Prints are stamped with the phone's clock, shown in India time like the prints card. */
const TIME_ZONE = "Asia/Kolkata";
const PAGE_SIZE = 50;

type Filter = "all" | "printed" | "pending";
type BoothOption = { partNo: number; total: number; printed: number; place: string | null };

function when(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function placeOf(print: WarRoomPrint): string | null {
  const location = print.location;

  if (!location) return null;

  return (
    location.placeName ?? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
  );
}

function relationOf(code: string | null): string {
  const value = (code ?? "").trim().toUpperCase();

  if (value.startsWith("F")) return "Father";
  if (value.startsWith("H")) return "Husband";
  if (value.startsWith("M")) return "Mother";
  if (value.startsWith("W")) return "Wife";

  return "Relative";
}

/**
 * The print colours, shared by the grid, the list and the legend. Orange stands
 * apart from the dashboard's blue; a second print is a solid, darker step.
 */
const SHADE = {
  none: "bg-background border-border text-foreground",
  once: "bg-[#FFE7C7] border-[#F5B25A] text-[#7A3D00]",
  again: "bg-[#E46F00] border-[#E46F00] text-white",
} as const;

function shadeOf(voter: WarRoomVoter) {
  if (voter.prints.length === 0) return SHADE.none;
  return voter.prints.length === 1 ? SHADE.once : SHADE.again;
}

function slipsLabel(voter: WarRoomVoter) {
  const count = voter.prints.length;

  if (count === 0) return "Not printed";
  return count === 1 ? "Printed" : `Printed ×${count}`;
}

const matches = (voter: WarRoomVoter, filter: Filter) =>
  filter === "all" || (filter === "printed" ? voter.prints.length > 0 : voter.prints.length === 0);

/** Excel fills, matching the on-screen shades (ARGB). */
const EXCEL_FILL = { once: "FFFFE7C7", again: "FFF9B866" } as const;

async function exportBooth(
  booth: WarRoomBooth,
  voters: WarRoomVoter[],
  file: string,
  assemblyName: string,
) {
  // Loaded on demand: the workbook library is only wanted when someone exports.
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`Booth ${booth.partNo}`, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  sheet.columns = [
    { header: "Serial", key: "sr", width: 9 },
    { header: "Name", key: "name", width: 28 },
    { header: "Local name", key: "localName", width: 26 },
    { header: "Relation", key: "relation", width: 10 },
    { header: "Relative name", key: "relative", width: 28 },
    { header: "Age", key: "age", width: 6 },
    { header: "Sex", key: "sex", width: 6 },
    { header: "House", key: "house", width: 12 },
    { header: "Voter ID", key: "epic", width: 14 },
    { header: "Mobile", key: "mobile", width: 13 },
    { header: "Slips printed", key: "count", width: 13 },
    { header: "Last printed at", key: "at", width: 22 },
    { header: "Last printed by", key: "by", width: 22 },
    { header: "Agent mobile", key: "byMobile", width: 13 },
    { header: "Print location", key: "place", width: 30 },
    { header: "Booth address", key: "address", width: 30 },
    { header: "Constituency", key: "assembly", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const voter of voters) {
    const last = voter.prints[0];
    const row = sheet.addRow({
      sr: voter.srNo,
      name: voter.name,
      localName: voter.localName,
      relation: voter.relativeName ? relationOf(voter.relationType) : null,
      relative: voter.relativeName,
      age: voter.age,
      sex: voter.sex,
      house: voter.houseNo,
      epic: voter.vcardId,
      mobile: voter.mobileNo,
      count: voter.prints.length,
      at: last ? when(last.at) : null,
      by: last?.by.fullName ?? null,
      byMobile: last?.by.mobileNumber ?? null,
      place: last ? placeOf(last) : null,
      address: booth.boothAddress,
      assembly: assemblyName,
    });

    if (voter.prints.length > 0) {
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: voter.prints.length === 1 ? EXCEL_FILL.once : EXCEL_FILL.again },
      };
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = file;
  link.click();
  URL.revokeObjectURL(url);
}

export function WarRoom({
  assemblyNo,
  assemblyName,
  booths,
  booth,
}: {
  assemblyNo: number;
  assemblyName: string;
  booths: BoothOption[];
  booth: WarRoomBooth;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [current, setCurrent] = useState<number | null>(null);
  const [jump, setJump] = useState("");
  const [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false);

  const voters = booth.voters;
  const first = voters[0]?.srNo ?? 0;
  const last = voters.at(-1)?.srNo ?? 0;
  const printed = voters.filter((voter) => voter.prints.length > 0);
  const notPrinted = voters.length - printed.length;
  const again = printed.filter((voter) => voter.prints.length > 1).length;
  const pct = voters.length ? Math.round((printed.length / voters.length) * 100) : 0;

  const shown = useMemo(() => voters.filter((voter) => matches(voter, filter)), [voters, filter]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const pageIndex = Math.min(page, pages - 1);
  const rows = shown.slice(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE);
  const selected = voters.find((voter) => voter.srNo === current) ?? null;

  const pickBooth = (value: string) => {
    startTransition(() => router.push(`${pathname}?booth=${encodeURIComponent(value)}`));
  };

  const goToSerial = () => {
    const serial = Number.parseInt(jump.replace(/\D/g, ""), 10);

    if (!voters.some((voter) => voter.srNo === serial)) {
      toast.error(`Serial ${jump || "?"} is not in booth ${booth.partNo} (${first}–${last}).`);
      return;
    }

    setCurrent(serial);
    setView("grid");
    setJump("");
    document.getElementById(`serial-${serial}`)?.scrollIntoView({ block: "center" });
  };

  const runExport = async (kind: Filter) => {
    const list = voters.filter((voter) => matches(voter, kind));

    if (list.length === 0) {
      toast.info("There are no voters to export for that choice.");
      return;
    }

    const suffix = kind === "all" ? "" : kind === "printed" ? "-printed" : "-not-printed";
    setExporting(true);

    try {
      await exportBooth(
        booth,
        list,
        `war-room-${assemblyNo}-booth-${booth.partNo}${suffix}.xlsx`,
        assemblyName,
      );
    } catch {
      toast.error("Could not build the Excel file.");
    } finally {
      setExporting(false);
    }
  };

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${voters.length.toLocaleString()}` },
    { key: "printed", label: `Printed ${printed.length.toLocaleString()}` },
    { key: "pending", label: `Not printed ${notPrinted.toLocaleString()}` },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-64 flex-1 gap-1.5 sm:max-w-sm">
          <Label htmlFor="war-room-booth" className="text-muted-foreground text-xs">
            Booth
          </Label>
          <Select value={String(booth.partNo)} onValueChange={pickBooth} disabled={pending}>
            <SelectTrigger id="war-room-booth" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {booths.map((option) => (
                <SelectItem key={option.partNo} value={String(option.partNo)}>
                  Booth {option.partNo}
                  {option.place ? ` · ${option.place}` : ""} · {option.total.toLocaleString()}{" "}
                  voters
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <form
          className="grid gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            goToSerial();
          }}
        >
          <Label htmlFor="war-room-serial" className="text-muted-foreground text-xs">
            Go to serial
          </Label>
          <div className="flex gap-2">
            <Input
              id="war-room-serial"
              inputMode="numeric"
              placeholder={`${first}–${last}`}
              value={jump}
              onChange={(event) => setJump(event.target.value)}
              className="w-36"
            />
            <Button type="submit" variant="outline">
              Go
            </Button>
          </div>
        </form>

        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button disabled={exporting}>
              <Download className="size-4" />
              {exporting ? "Exporting…" : `Export booth ${booth.partNo}`}
              <ChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            <DropdownMenuItem className="grid gap-0.5" onSelect={() => void runExport("all")}>
              <span>All voters</span>
              <span className="text-muted-foreground text-xs">
                {voters.length.toLocaleString()} rows · Excel, printed rows highlighted
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className="grid gap-0.5" onSelect={() => void runExport("printed")}>
              <span>Slip printed</span>
              <span className="text-muted-foreground text-xs">
                {printed.length.toLocaleString()} rows · with who printed and when
              </span>
            </DropdownMenuItem>
            <DropdownMenuItem className="grid gap-0.5" onSelect={() => void runExport("pending")}>
              <span>Not printed yet</span>
              <span className="text-muted-foreground text-xs">
                {notPrinted.toLocaleString()} rows · to hand out to agents
              </span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn("grid gap-4 sm:grid-cols-2 lg:grid-cols-4", pending && "opacity-60")}>
        <Stat label="Voters" value={voters.length} note={`Serials ${first}–${last}`} />
        <Stat
          label="Slip printed"
          value={printed.length}
          note={`${pct}% of the booth`}
          className="text-[#B35500] dark:text-[#FFB55C]"
        />
        <Stat label="Not printed yet" value={notPrinted} note="Still to reach" />
        <Stat label="Printed again" value={again} note="2 or more slips" />
      </div>

      <Card className={cn("gap-0 overflow-hidden py-0", pending && "opacity-60")}>
        <CardHeader className="flex flex-row flex-wrap items-center gap-3 border-b py-3">
          <CardTitle className="sr-only">Booth {booth.partNo} serial numbers</CardTitle>
          <Segmented
            label="Show"
            options={filters}
            value={filter}
            onChange={(key) => {
              setFilter(key);
              setPage(0);
            }}
          />
          <div className="text-muted-foreground flex flex-wrap gap-4 text-xs">
            <Legend shade={SHADE.none} label="Not printed" />
            <Legend shade={SHADE.once} label="Printed once" />
            <Legend shade={SHADE.again} label="Printed 2+ times" />
          </div>
          <div className="flex-1" />
          <Segmented
            label="View"
            options={[
              { key: "grid", label: "Serial grid" },
              { key: "list", label: "Voter list" },
            ]}
            value={view}
            onChange={setView}
          />
        </CardHeader>

        {view === "grid" ? (
          <CardContent className="flex flex-wrap p-0">
            <div
              aria-label={`Serial numbers, booth ${booth.partNo}`}
              className="max-h-[620px] min-w-0 flex-[999_1_520px] overflow-y-auto p-4"
            >
              <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-2">
                {voters.map((voter) => (
                  <button
                    key={voter.id}
                    id={`serial-${voter.srNo}`}
                    type="button"
                    aria-pressed={voter.srNo === current}
                    aria-label={`Serial ${voter.srNo}, ${slipsLabel(voter).toLowerCase()}`}
                    onClick={() => setCurrent(voter.srNo)}
                    className={cn(
                      "relative h-9 rounded-md border text-[13px] font-medium tabular-nums transition-colors",
                      "hover:border-primary focus-visible:ring-ring/50 outline-none focus-visible:ring-[3px]",
                      shadeOf(voter),
                      !matches(voter, filter) && "opacity-25",
                      voter.srNo === current && "outline-primary outline-2 outline-offset-2",
                    )}
                  >
                    {voter.srNo}
                    {voter.prints.length > 1 ? (
                      <span
                        aria-hidden
                        className="bg-foreground text-background absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold"
                      >
                        {voter.prints.length}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <aside
              aria-label="Selected voter"
              className="bg-muted/30 flex-[1_1_280px] border-l p-4"
            >
              {selected ? (
                <VoterPanel voter={selected} />
              ) : (
                <p className="text-muted-foreground text-sm">
                  Click a serial number to see the voter and who printed their slip.
                </p>
              )}
            </aside>
          </CardContent>
        ) : (
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>Serial</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Father / husband</TableHead>
                    <TableHead>Age</TableHead>
                    <TableHead>House</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Slips</TableHead>
                    <TableHead>Last printed by</TableHead>
                    <TableHead>When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((voter) => {
                    const lastPrint = voter.prints[0];

                    return (
                      <TableRow
                        key={voter.id}
                        className={cn(
                          "cursor-pointer",
                          voter.prints.length === 1 && "bg-[#FFF6EA] dark:bg-[#E46F00]/15",
                          voter.prints.length > 1 && "bg-[#FFEBD6] dark:bg-[#E46F00]/30",
                        )}
                        onClick={() => {
                          setCurrent(voter.srNo);
                          setView("grid");
                        }}
                      >
                        <TableCell className="font-semibold tabular-nums">{voter.srNo}</TableCell>
                        <TableCell>{voter.name ?? voter.localName ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {voter.relativeName ?? "—"}
                        </TableCell>
                        <TableCell className="tabular-nums">{voter.age ?? "—"}</TableCell>
                        <TableCell>{voter.houseNo ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{voter.mobileNo ?? "—"}</TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold",
                              shadeOf(voter),
                            )}
                          >
                            {slipsLabel(voter)}
                          </span>
                        </TableCell>
                        <TableCell>{lastPrint?.by.fullName ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {lastPrint ? when(lastPrint.at) : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="text-muted-foreground flex items-center justify-between gap-3 border-t px-4 py-3 text-sm">
              <span>
                {shown.length
                  ? `Showing ${(pageIndex * PAGE_SIZE + 1).toLocaleString()}–${Math.min(
                      shown.length,
                      pageIndex * PAGE_SIZE + PAGE_SIZE,
                    ).toLocaleString()} of ${shown.length.toLocaleString()}`
                  : "No voters match"}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageIndex === 0}
                  onClick={() => setPage(pageIndex - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pageIndex >= pages - 1}
                  onClick={() => setPage(pageIndex + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  note,
  className,
}: {
  label: string;
  value: number;
  note: string;
  className?: string;
}) {
  return (
    <Card className="gap-1 py-4">
      <CardContent className="px-4">
        <p className="text-muted-foreground text-sm font-medium">{label}</p>
        <p className={cn("text-3xl font-semibold tabular-nums", className)}>
          {value.toLocaleString()}
        </p>
        <p className="text-muted-foreground text-xs">{note}</p>
      </CardContent>
    </Card>
  );
}

function Legend({ shade, label }: { shade: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-3.5 rounded border", shade)} />
      {label}
    </span>
  );
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="bg-muted inline-flex gap-0.5 rounded-lg p-0.5">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
          className={cn(
            "h-8 rounded-md px-3 text-sm whitespace-nowrap transition-colors",
            option.key === value
              ? "bg-background text-foreground font-semibold shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function VoterPanel({ voter }: { voter: WarRoomVoter }) {
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          Serial{" "}
          <strong className="text-foreground text-lg tabular-nums">{voter.srNo}</strong>
        </p>
        <span
          className={cn(
            "inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold",
            shadeOf(voter),
          )}
        >
          {slipsLabel(voter)}
        </span>
      </div>

      <div>
        <p className="font-semibold">{voter.name ?? voter.localName ?? "—"}</p>
        {voter.name && voter.localName ? (
          <p className="text-muted-foreground text-sm">{voter.localName}</p>
        ) : null}
        {voter.relativeName ? (
          <p className="text-muted-foreground text-sm">
            {relationOf(voter.relationType)}: {voter.relativeName}
          </p>
        ) : null}
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Voter ID</dt>
        <dd className="font-mono">{voter.vcardId ?? "—"}</dd>
        <dt className="text-muted-foreground">Age / sex</dt>
        <dd>
          {voter.age ?? "—"} · {voter.sex ?? "—"}
        </dd>
        <dt className="text-muted-foreground">House</dt>
        <dd>{voter.houseNo ?? "—"}</dd>
        <dt className="text-muted-foreground">Mobile</dt>
        <dd className="tabular-nums">{voter.mobileNo ?? "—"}</dd>
      </dl>

      <div className="grid gap-2 border-t pt-3">
        <p className="text-sm font-semibold">Slip prints</p>
        {voter.prints.length === 0 ? (
          <p className="text-muted-foreground text-sm">No slip printed for this voter yet.</p>
        ) : (
          voter.prints.map((print, index) => {
            const place = placeOf(print);

            return (
              <div key={`${print.at}-${index}`} className="text-sm leading-snug">
                <p className="font-medium">
                  {print.by.fullName}{" "}
                  <span className="text-muted-foreground font-normal tabular-nums">
                    · {print.by.mobileNumber}
                  </span>
                </p>
                <p className="text-muted-foreground">
                  {when(print.at)} · {print.method === "dialog" ? "Print dialog" : "Thermal printer"}
                </p>
                {place && print.location ? (
                  <a
                    className="text-muted-foreground inline-flex items-center gap-1 underline-offset-2 hover:underline"
                    href={`https://www.google.com/maps?q=${print.location.latitude},${print.location.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <MapPin className="size-3.5 shrink-0" />
                    {place}
                  </a>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
