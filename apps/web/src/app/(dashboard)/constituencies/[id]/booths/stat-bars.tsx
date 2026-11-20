"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export type Slice = { label: string; count: number };

/**
 * Ranked magnitudes read best as horizontal bars: the labels are words of
 * varying length, and the comparison is length against a shared baseline.
 */
export function StatBars({
  data,
  color = "var(--chart-1)",
  height,
}: {
  data: Slice[];
  color?: string;
  height?: number;
}) {
  if (data.length === 0) {
    return <p className="text-muted-foreground text-sm">Nothing recorded for this booth.</p>;
  }

  const config = { count: { label: "Voters", color } } satisfies ChartConfig;

  return (
    <ChartContainer
      config={config}
      className="w-full"
      style={{ height: height ?? Math.max(160, data.length * 34) }}
    >
      <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 8, right: 44 }}>
        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
        <YAxis
          dataKey="label"
          type="category"
          tickLine={false}
          axisLine={false}
          width={120}
          tickMargin={6}
          className="fill-muted-foreground text-xs"
        />
        <XAxis dataKey="count" type="number" hide />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        {/* 4px rounded data-end, anchored to the baseline. */}
        <Bar dataKey="count" fill={color} radius={[0, 4, 4, 0]} barSize={18} />
      </BarChart>
    </ChartContainer>
  );
}
