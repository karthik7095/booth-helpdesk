import type { PrintLocation, PrintReport, VoterPrintSummary } from "@voter/shared";
import { History, MapPin, Printer } from "lucide-react";

import { ResetPrintsDialog } from "@/app/(dashboard)/constituencies/[id]/reset-prints-dialog";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Prints are stamped with the phone's clock, shown in India time like usage. */
const TIME_ZONE = "Asia/Kolkata";

function when(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** A link to the fix on a map, labelled with the place name when one is known. */
function Place({ location }: { location: PrintLocation | null }) {
  if (!location) return <span className="text-muted-foreground">No location</span>;

  const label =
    location.placeName ?? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;

  return (
    <a
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      href={`https://www.google.com/maps?q=${location.latitude},${location.longitude}`}
      target="_blank"
      rel="noreferrer"
      title={`${location.latitude}, ${location.longitude}${
        location.accuracy ? ` (±${Math.round(location.accuracy)} m)` : ""
      }`}
    >
      <MapPin className="size-3.5 shrink-0" />
      {label}
    </a>
  );
}

/** One voter's cell on the roll: how many times, and the latest print's who, when and where. */
export function PrintCell({ summary }: { summary: VoterPrintSummary | undefined }) {
  if (!summary || summary.count === 0 || !summary.last) {
    return <span className="text-muted-foreground">—</span>;
  }

  return (
    <div className="grid gap-0.5 text-sm">
      <span>
        <Badge variant="secondary" className="mr-1 tabular-nums">
          {summary.count}×
        </Badge>
        {summary.last.by.fullName}
        <span className="text-muted-foreground"> · {summary.last.by.mobileNumber}</span>
      </span>
      <span className="text-muted-foreground text-xs">
        {when(summary.last.at)} · <Place location={summary.last.location} />
      </span>
    </div>
  );
}

/**
 * The constituency's printing: totals, then one row per app user who printed,
 * then every time the counts were reset. The reset wipes the records and
 * starts the counts over; both kinds of admin can do it for this constituency.
 */
export function PrintsCard({
  report,
  assemblyId,
  name,
  canReset,
}: {
  report: PrintReport;
  assemblyId: string;
  name: string;
  canReset: boolean;
}) {
  const { totals, users, resets } = report;
  const lastReset = resets[0];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-base">
            <Printer className="size-4" />
            Slip prints
          </CardTitle>
          <CardDescription>
            Every voter slip printed from the app, with where the phone was at the time. A
            household slip counts once per voter on it.
            {lastReset ? ` Counting since the reset on ${when(lastReset.at)}.` : ""}
          </CardDescription>
        </div>
        {canReset ? (
          <ResetPrintsDialog assemblyId={assemblyId} name={name} prints={totals.prints} />
        ) : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { label: "Slips printed", value: totals.prints },
            { label: "Voters covered", value: totals.voters },
            { label: "Printed today", value: totals.today },
            { label: "App users printing", value: totals.users },
          ].map((stat) => (
            <div key={stat.label} className="rounded-lg border p-3">
              <p className="text-muted-foreground text-xs">{stat.label}</p>
              <p className="text-2xl font-semibold tabular-nums">{stat.value.toLocaleString()}</p>
            </div>
          ))}
        </div>

        {users.length === 0 ? (
          <p className="text-muted-foreground text-sm">No slips have been printed yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>App user</TableHead>
                  <TableHead>PIN</TableHead>
                  <TableHead className="text-right">Slips</TableHead>
                  <TableHead className="text-right">Voters</TableHead>
                  <TableHead>Last print</TableHead>
                  <TableHead>Last location</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.sessionId}>
                    <TableCell className="whitespace-nowrap">
                      <span className="font-medium">{user.fullName}</span>
                      <span className="text-muted-foreground block text-xs tabular-nums">
                        {user.mobileNumber}
                      </span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {user.pinLabel ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.prints.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.voters.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                      {when(user.lastPrintedAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      <Place location={user.lastLocation} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {resets.length > 0 ? (
          <div className="grid gap-2 border-t pt-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              <History className="size-4" />
              Reset history
            </p>
            <p className="text-muted-foreground text-xs">
              Each reset cleared the records and started the counts above from zero. The numbers
              are what the counts read just before.
            </p>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reset on</TableHead>
                    <TableHead>By</TableHead>
                    <TableHead className="text-right">Slips cleared</TableHead>
                    <TableHead className="text-right">Voters</TableHead>
                    <TableHead className="text-right">App users</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {resets.map((reset) => (
                    <TableRow key={reset.id}>
                      <TableCell className="whitespace-nowrap">{when(reset.at)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="font-medium">{reset.by.name}</span>
                        <span className="text-muted-foreground block text-xs">
                          {reset.by.email}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {reset.prints.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {reset.voters.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {reset.users.toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
