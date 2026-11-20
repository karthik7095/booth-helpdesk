import { KeyRound, MapPinned, Users, UserCheck } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ConstituencyDashboard } from "@/app/(dashboard)/constituency-dashboard";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/session";

export default async function OverviewPage() {
  const { admin, token } = await requireAdmin();

  if (admin.role === "constituency_admin" && admin.assemblyId) {
    return <ConstituencyDashboard assemblyId={admin.assemblyId} token={token} />;
  }

  const [stats, pins] = await Promise.all([api.stats(token), api.pins(token)]);

  const tiles = [
    { label: "Constituencies", value: stats.assemblies, icon: MapPinned },
    { label: "Voters on roll", value: stats.voters, icon: Users },
    { label: "Active PINs", value: stats.activePins, icon: KeyRound },
    { label: "Verified sign-ins", value: stats.sessions, icon: UserCheck },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Welcome back, {admin.name}</h1>
        <p className="text-muted-foreground text-sm">
          Issue an access PIN for a constituency and anyone holding it can read that roll.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Recently issued PINs</CardTitle>
          <Button asChild size="sm" variant="outline">
            <Link href="/pins">Manage PINs</Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-2">
          {pins.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              No PINs yet. Create a constituency, then generate one.
            </p>
          ) : (
            pins.slice(0, 5).map((pin) => (
              <div
                key={pin.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <div className="grid">
                  <span className="font-mono text-sm font-medium">{pin.pin}</span>
                  <span className="text-muted-foreground text-xs">
                    {pin.assemblyName} ({pin.assemblyNo}) ·{" "}
                    {pin.partNos.length > 0 ? `Parts ${pin.partNos.join(", ")}` : "All parts"}
                  </span>
                </div>
                <Badge variant={pin.isActive ? "default" : "secondary"}>
                  {pin.isActive ? "Active" : "Disabled"}
                </Badge>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
