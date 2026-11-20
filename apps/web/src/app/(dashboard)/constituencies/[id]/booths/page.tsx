import { ArrowLeft, MapPin, Users } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/session";

export default async function BoothsPage({ params }: PageProps<"/constituencies/[id]/booths">) {
  const { token } = await requireAdmin();
  const { id } = await params;

  const [assembly, booths] = await Promise.all([api.assembly(id, token), api.booths(id, token)]);
  const totalVoters = booths.reduce((sum, booth) => sum + booth.total, 0);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={`/constituencies/${id}`} aria-label="Back to constituency">
            <ArrowLeft className="size-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">Booths — {assembly.name}</h1>
          <p className="text-muted-foreground text-sm">
            {booths.length} booths · {totalVoters.toLocaleString()} voters.
          </p>
        </div>
      </div>

      {booths.length === 0 ? (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            No voters imported yet, so there are no booths to show.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {booths.map((booth) => (
            <Card key={booth.partNo} className="h-full">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-base">Booth {booth.partNo}</CardTitle>
                <Badge variant="secondary">{booth.total.toLocaleString()}</Badge>
              </CardHeader>
              <CardContent className="grid gap-2">
                <div className="text-muted-foreground flex items-center gap-4 text-sm">
                  <span className="flex items-center gap-1">
                    <Users className="size-3.5" />
                    {booth.male.toLocaleString()} M · {booth.female.toLocaleString()} F
                  </span>
                </div>
                {booth.boothAddress ? (
                  <p className="text-muted-foreground flex items-start gap-1 text-xs">
                    <MapPin className="mt-0.5 size-3.5 shrink-0" />
                    <span className="line-clamp-2">{booth.boothAddress}</span>
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
