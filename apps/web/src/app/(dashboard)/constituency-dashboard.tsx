import { Users, UserCheck, Printer } from "lucide-react";
import Link from "next/link";

import { PrintsCard } from "@/app/(dashboard)/constituencies/[id]/prints";
import { TurnoutCharts } from "@/app/(dashboard)/constituencies/[id]/turnout-charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";

/**
 * A constituency admin's home: how its one constituency is doing today —
 * turnout and slip printing by booth, then who has been printing. The roll
 * itself lives on the constituency page.
 */
export async function ConstituencyDashboard({
  assemblyId,
  token,
}: {
  assemblyId: string;
  token: string;
}) {
  const [assembly, booths, prints] = await Promise.all([
    api.assembly(assemblyId, token),
    api.booths(assemblyId, token),
    api.printReport(assemblyId, token),
  ]);

  const voted = booths.reduce((sum, booth) => sum + booth.voted, 0);

  const tiles = [
    { label: "Voters on roll", value: assembly.voterCount, icon: Users },
    { label: "Marked as voted", value: voted, icon: UserCheck },
    { label: "Voters with a slip printed", value: prints.totals.voters, icon: Printer },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {assembly.name}{" "}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({assembly.assemblyNo})
            </span>
            {assembly.isActive ? null : <Badge variant="destructive">Inactive</Badge>}
          </h1>
          <p className="text-muted-foreground text-sm">
            Turnout and slip printing across {booths.length.toLocaleString()} booth
            {booths.length === 1 ? "" : "s"}.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/constituencies/${assemblyId}`}>
            <Users className="size-4" />
            Voter roll
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-muted-foreground text-sm font-medium">
                {tile.label}
              </CardTitle>
              <tile.icon className="text-muted-foreground size-4" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tabular-nums">{tile.value.toLocaleString()}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <TurnoutCharts assemblyId={assemblyId} booths={booths} />

      <PrintsCard report={prints} assemblyId={assemblyId} name={assembly.name} canReset />
    </div>
  );
}
