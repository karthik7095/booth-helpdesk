"use client";

import type { BoothSummary } from "@voter/shared";
import { useState } from "react";
import { Label as ChartLabel, Pie, PieChart } from "recharts";

import { ExportButton } from "@/components/export-button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Two slots of the validated categorical palette, each stepped for its
 * surface: "done" in blue, "not yet" in orange. The same pair in both charts,
 * so a colour means the same thing wherever it appears on the page.
 */
const DONE = { light: "#2a78d6", dark: "#3987e5" };
const NOT_YET = { light: "#eb6834", dark: "#d95926" };

const ALL = "all";

type Slice = { key: string; label: string; value: number; fill: string };

/** The four cells every filter combination is built from. */
type Cells = {
  votedPrinted: number;
  votedNotPrinted: number;
  notVotedPrinted: number;
  notVotedNotPrinted: number;
};

function percent(part: number, whole: number): string {
  if (whole === 0) return "0%";

  const share = (part / whole) * 100;

  // A single decimal below 10% so a slow start still reads as movement.
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
}

function cellsOf(booth: BoothSummary): Cells {
  return {
    votedPrinted: booth.votedPrinted,
    votedNotPrinted: booth.voted - booth.votedPrinted,
    notVotedPrinted: booth.printed - booth.votedPrinted,
    notVotedNotPrinted: booth.total - booth.voted - booth.printed + booth.votedPrinted,
  };
}

/** One donut with the headline share in the middle and the counts beside it. */
function Donut({
  title,
  description,
  done,
  doneLabel,
  notYetLabel,
  total,
}: {
  title: string;
  description: string;
  done: number;
  doneLabel: string;
  notYetLabel: string;
  total: number;
}) {
  const notYet = Math.max(0, total - done);

  const config = {
    done: { label: doneLabel, theme: DONE },
    notYet: { label: notYetLabel, theme: NOT_YET },
  } satisfies ChartConfig;

  const slices: Slice[] = [
    { key: "done", label: doneLabel, value: done, fill: "var(--color-done)" },
    { key: "notYet", label: notYetLabel, value: notYet, fill: "var(--color-notYet)" },
  ];

  return (
    <Card>
      <CardHeader className="pb-0">
        <CardTitle className="text-base">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 sm:flex-row">
        {total === 0 ? (
          <p className="text-muted-foreground py-10 text-sm">No voters match these filters.</p>
        ) : (
          <ChartContainer config={config} className="aspect-square h-44 w-44 shrink-0">
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<ChartTooltipContent nameKey="key" hideLabel />}
              />
              <Pie
                data={slices}
                dataKey="value"
                nameKey="key"
                innerRadius={54}
                outerRadius={78}
                strokeWidth={2}
                stroke="var(--card)"
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                <ChartLabel
                  content={({ viewBox }) => {
                    if (!viewBox || !("cx" in viewBox) || !("cy" in viewBox)) return null;

                    const { cx, cy } = viewBox as { cx: number; cy: number };

                    return (
                      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle">
                        <tspan
                          x={cx}
                          y={cy - 4}
                          className="fill-foreground text-2xl font-semibold tabular-nums"
                        >
                          {percent(done, total)}
                        </tspan>
                        <tspan x={cx} y={cy + 16} className="fill-muted-foreground text-xs">
                          {doneLabel.toLowerCase()}
                        </tspan>
                      </text>
                    );
                  }}
                />
              </Pie>
            </PieChart>
          </ChartContainer>
        )}

        {/* The legend doubles as the table: every value is readable without the colour. */}
        <dl className="grid w-full gap-2 text-sm">
          {slices.map((slice) => (
            <div key={slice.key} className="flex items-center justify-between gap-3">
              <dt className="flex items-center gap-2">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ background: slice.fill }}
                />
                {slice.label}
              </dt>
              <dd className="tabular-nums">
                {slice.value.toLocaleString()}
                <span className="text-muted-foreground"> · {percent(slice.value, total)}</span>
              </dd>
            </div>
          ))}
          <div className="text-muted-foreground flex items-center justify-between gap-3 border-t pt-2">
            <dt>Total</dt>
            <dd className="tabular-nums">{total.toLocaleString()}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-muted-foreground text-xs">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
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

/**
 * Voting and slip-printing progress with their own filters: booth, voting
 * status and slip status. All three narrow both charts, so "Voted" plus the
 * printing chart answers "of those who voted, how many had a slip". Fed from
 * the per-booth summary the page already loads, so the numbers match the
 * booths page exactly.
 */
export function TurnoutCharts({
  assemblyId,
  booths,
}: {
  assemblyId: string;
  booths: BoothSummary[];
}) {
  const [booth, setBooth] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [slip, setSlip] = useState(ALL);

  const scoped = booth === ALL ? booths : booths.filter((row) => String(row.partNo) === booth);

  const cells = scoped.map(cellsOf).reduce<Cells>(
    (sum, row) => ({
      votedPrinted: sum.votedPrinted + row.votedPrinted,
      votedNotPrinted: sum.votedNotPrinted + row.votedNotPrinted,
      notVotedPrinted: sum.notVotedPrinted + row.notVotedPrinted,
      notVotedNotPrinted: sum.notVotedNotPrinted + row.notVotedNotPrinted,
    }),
    { votedPrinted: 0, votedNotPrinted: 0, notVotedPrinted: 0, notVotedNotPrinted: 0 },
  );

  // Keep only the cells the status and slip filters allow.
  const keep = (voted: boolean, printed: boolean) =>
    (status === ALL || (status === "voted") === voted) &&
    (slip === ALL || (slip === "printed") === printed);

  const picked = [
    { voted: true, printed: true, count: cells.votedPrinted },
    { voted: true, printed: false, count: cells.votedNotPrinted },
    { voted: false, printed: true, count: cells.notVotedPrinted },
    { voted: false, printed: false, count: cells.notVotedNotPrinted },
  ].filter((cell) => keep(cell.voted, cell.printed));

  const total = picked.reduce((sum, cell) => sum + cell.count, 0);
  const voted = picked.filter((cell) => cell.voted).reduce((sum, cell) => sum + cell.count, 0);
  const printed = picked.filter((cell) => cell.printed).reduce((sum, cell) => sum + cell.count, 0);

  const where = [
    booth === ALL ? "all booths" : `booth ${booth}`,
    status === ALL ? null : status === "voted" ? "voted" : "not voted",
    slip === ALL ? null : slip === "printed" ? "slip printed" : "no slip printed",
  ]
    .filter(Boolean)
    .join(", ");

  /** The same filters as the roll's search, so the export holds exactly the voters charted. */
  const exportParams = {
    assemblyId,
    partNo: booth === ALL ? undefined : booth,
    hasVoted: status === ALL ? undefined : String(status === "voted"),
    printed: slip === ALL ? undefined : String(slip === "printed"),
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="grid gap-3 sm:grid-cols-3 lg:max-w-2xl lg:flex-1">
          <FilterSelect
            id="chart-booth"
            label="Booth"
            value={booth}
            onChange={setBooth}
            options={[
              { value: ALL, label: "All booths" },
              ...booths.map((row) => ({ value: String(row.partNo), label: `Booth ${row.partNo}` })),
            ]}
          />
          <FilterSelect
            id="chart-status"
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: ALL, label: "Voted or not" },
              { value: "voted", label: "Voted" },
              { value: "notVoted", label: "Not voted" },
            ]}
          />
          <FilterSelect
            id="chart-slip"
            label="Slip"
            value={slip}
            onChange={setSlip}
            options={[
              { value: ALL, label: "Printed or not" },
              { value: "printed", label: "Slip printed" },
              { value: "notPrinted", label: "Not printed" },
            ]}
          />
        </div>
        {total > 0 ? (
          <ExportButton
            kind="voters"
            params={exportParams}
            label={`Export ${total.toLocaleString()} voters`}
          />
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Donut
          title="Voting status"
          description={`Voters marked as voted — ${where}.`}
          done={voted}
          doneLabel="Voted"
          notYetLabel="Not voted"
          total={total}
        />
        <Donut
          title="Slip printing"
          description={`Voters with at least one slip printed — ${where}.`}
          done={printed}
          doneLabel="Printed"
          notYetLabel="Not printed"
          total={total}
        />
      </div>
    </div>
  );
}
