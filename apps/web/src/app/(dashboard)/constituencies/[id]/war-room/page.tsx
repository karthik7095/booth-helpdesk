import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { ConstituencyTabs } from "@/app/(dashboard)/constituencies/[id]/constituency-tabs";
import { WarRoom } from "@/app/(dashboard)/constituencies/[id]/war-room/war-room";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/session";

/** One booth at a time: every serial number, and which ones have had a slip printed. */
export default async function WarRoomPage({
  params,
  searchParams,
}: PageProps<"/constituencies/[id]/war-room">) {
  const { admin, token } = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const isSuper = admin.role !== "constituency_admin";

  const [assembly, booths] = await Promise.all([api.assembly(id, token), api.booths(id, token)]);

  const requested = Number.parseInt(String(query.booth ?? ""), 10);
  const partNo = booths.some((booth) => booth.partNo === requested)
    ? requested
    : booths[0]?.partNo;
  const booth = partNo === undefined ? null : await api.warRoom(id, partNo, token);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex items-center gap-3">
        {isSuper ? (
          <Button asChild variant="ghost" size="icon">
            <Link href="/constituencies" aria-label="Back to constituencies">
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
        ) : null}
        <div className="flex-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold">
            {assembly.name}{" "}
            <span className="text-muted-foreground font-normal tabular-nums">
              ({assembly.assemblyNo})
            </span>
            {assembly.isActive ? null : <Badge variant="destructive">Inactive</Badge>}
          </h1>
          <p className="text-muted-foreground text-sm">
            Pick a booth to see every serial number and which voters already have a slip.
          </p>
        </div>
      </div>

      <ConstituencyTabs id={id} active="war-room" />

      {booth ? (
        <WarRoom
          // A new booth starts with a clean selection and filter.
          key={booth.partNo}
          assemblyNo={assembly.assemblyNo}
          assemblyName={assembly.name}
          booths={booths.map((item) => ({
            partNo: item.partNo,
            total: item.total,
            printed: item.printed,
            place: item.village ?? item.boothAddress,
          }))}
          booth={booth}
        />
      ) : (
        <Card>
          <CardContent className="text-muted-foreground py-10 text-center text-sm">
            This constituency has no voters yet, so there are no booths to show.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
