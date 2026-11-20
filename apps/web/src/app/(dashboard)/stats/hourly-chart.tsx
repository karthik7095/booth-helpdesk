"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/** The same blue and orange as the constituency turnout charts. */
const config = {
  votedMarks: { label: "Marked voted", theme: { light: "#2a78d6", dark: "#3987e5" } },
  prints: { label: "Slips printed", theme: { light: "#eb6834", dark: "#d95926" } },
} satisfies ChartConfig;

function hourLabel(hour: number) {
  const suffix = hour < 12 ? "am" : "pm";
  return `${hour % 12 === 0 ? 12 : hour % 12}${suffix}`;
}

export function HourlyChart({
  hourly,
}: {
  hourly: { hour: number; votedMarks: number; prints: number }[];
}) {
  // Night hours with nothing in them only squeeze the day's bars.
  const busy = hourly.filter((row) => row.votedMarks > 0 || row.prints > 0).map((row) => row.hour);
  const first = Math.min(6, ...busy);
  const last = Math.max(20, ...busy);
  const data = hourly
    .filter((row) => row.hour >= first && row.hour <= last)
    .map((row) => ({ ...row, label: hourLabel(row.hour) }));

  return (
    <ChartContainer config={config} className="aspect-auto h-72 w-full">
      <BarChart data={data} margin={{ left: 0, right: 8 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={48} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <ChartLegend content={<ChartLegendContent />} />
        <Bar dataKey="votedMarks" fill="var(--color-votedMarks)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="prints" fill="var(--color-prints)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartContainer>
  );
}
