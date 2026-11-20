import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { StatBars } from "@/app/(dashboard)/constituencies/[id]/booths/stat-bars";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/session";

export default async function BoothStatsPage({
  params,
}: PageProps<"/constituencies/[id]/booths/[partNo]">) {
  const { token } = await requireAdmin();
  const { id, partNo } = await params;

  const [assembly, stats] = await Promise.all([
    api.assembly(id, token),
    api.boothStats(id, Number(partNo), token),
  ]);

  const sections = [
    {
      show: assembly.showGenderStats,
      title: "Gender",
      description: "Male and female voters registered at this booth.",
      data: stats.gender,
      // Two identities, so two validated hues; every bar is labelled as well.
      color: "#4F35C9",
    },
    {
      show: true,
      title: "Age",
      description: "Voters by age group, from the roll's Age column.",
      data: stats.age,
      color: "#4F35C9",
    },
    {
      show: assembly.showReligionStats,
      title: "Religion",
      description: "As recorded in the roll's Religion column.",
      data: stats.religion,
      color: "#4F35C9",
    },
    {
      show: assembly.showCommunityStats,
      title: "Community",
      description: "As recorded in the roll's Community column.",
      data: stats.community,
      color: "#4F35C9",
    },
  ].filter((section) => section.show);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/constituencies/${id}/booths`} aria-label="Back to booths">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">
            Booth {stats.partNo}{" "}
            <span className="text-muted-foreground font-normal">· {assembly.name}</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            {stats.total.toLocaleString()} voters on this booth&apos;s roll.
          </p>
        </div>
      </div>

      {sections.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            Every breakdown is switched off for this constituency. Turn them on under Booth
            statistics on the constituency page.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        {sections.map((section) => (
          <Card key={section.title}>
            <CardHeader>
              <CardTitle className="text-base">{section.title}</CardTitle>
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <StatBars data={section.data} color={section.color} />

              {/* A table view alongside every chart: identity is never colour alone. */}
              {section.data.length > 0 ? (
                <div className="text-muted-foreground grid gap-1 text-sm">
                  {section.data.slice(0, 7).map((slice) => (
                    <div key={slice.label} className="flex justify-between">
                      <span>{slice.label}</span>
                      <span className="text-foreground tabular-nums">
                        {slice.count.toLocaleString()}
                        <span className="text-muted-foreground">
                          {" "}
                          ({Math.round((slice.count / Math.max(1, stats.total)) * 100)}%)
                        </span>
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
