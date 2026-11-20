"use client";

import type { StatsVisibility } from "@voter/shared";
import { ChartBar } from "lucide-react";
import { useOptimistic, useTransition } from "react";
import { toast } from "sonner";

import { updateStatsVisibilityAction } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const OPTIONS: { key: keyof StatsVisibility; label: string; hint: string }[] = [
  { key: "showGenderStats", label: "Gender", hint: "Male and female voters per booth." },
  { key: "showReligionStats", label: "Religion", hint: "From the roll's Religion column." },
  { key: "showCommunityStats", label: "Community", hint: "From the roll's Community column. Off by default." },
];

/** Switches for the booth breakdowns shown on the dashboard and in the app. */
export function StatsVisibilityCard({
  assemblyId,
  visibility,
}: {
  assemblyId: string;
  visibility: StatsVisibility;
}) {
  const [optimistic, setOptimistic] = useOptimistic(visibility);
  const [pending, startTransition] = useTransition();

  const toggle = (key: keyof StatsVisibility, next: boolean) => {
    startTransition(async () => {
      setOptimistic((current) => ({ ...current, [key]: next }));
      const result = await updateStatsVisibilityAction(assemblyId, { [key]: next });

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ChartBar className="text-muted-foreground size-4" />
          Booth statistics
        </CardTitle>
        <CardDescription>
          Choose which breakdowns appear on booth pages here and in the app&apos;s Statistics tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        {OPTIONS.map((option) => (
          <div
            key={option.key}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <div className="grid gap-1">
              <Label htmlFor={option.key}>{option.label}</Label>
              <p className="text-muted-foreground text-xs">{option.hint}</p>
            </div>
            <Switch
              id={option.key}
              checked={optimistic[option.key]}
              disabled={pending}
              onCheckedChange={(next) => toggle(option.key, next)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
