import { ChevronLeft, ChevronRight, Clock, MapPin, MousePointerClick, Users } from "lucide-react";
import Link from "next/link";

import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/session";
import { matchesSearch, searchTerm } from "@/lib/utils";

/** The API buckets days in India time, so times are shown in it too. */
const TIME_ZONE = "Asia/Kolkata";

function duration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return seconds > 0 ? "< 1m" : "0m";
}

function time(value: string) {
  return new Date(value).toLocaleTimeString("en-IN", { timeZone: TIME_ZONE, timeStyle: "short" });
}

function shiftDate(date: string, days: number) {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

export default async function UsagePage({ searchParams }: PageProps<"/usage">) {
  const { token } = await requireAdmin();
  const query = await searchParams;
  const requested = typeof query.date === "string" ? query.date : undefined;
  const search = searchTerm(query.q);
  // Keeps the search term when moving between days.
  const dayHref = (date: string) =>
    `/usage?date=${date}${search ? `&q=${encodeURIComponent(search)}` : ""}`;

  const report = await api.usage(token, requested);
  const users = report.users.filter((user) =>
    matchesSearch(
      search,
      user.fullName,
      user.mobileNumber,
      user.assemblyName,
      user.location?.placeName,
      ...user.pinLabels,
    ),
  );
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date());
  const heading = new Date(`${report.date}T00:00:00Z`).toLocaleDateString("en-IN", {
    timeZone: "UTC",
    dateStyle: "full",
  });

  const tiles = [
    { label: "People using the app", value: report.totals.users.toLocaleString(), icon: Users },
    { label: "Times opened", value: report.totals.opens.toLocaleString(), icon: MousePointerClick },
    { label: "Total time in app", value: duration(report.totals.activeSeconds), icon: Clock },
    {
      label: "Shared their location",
      value: `${report.totals.withLocation} / ${report.totals.users}`,
      icon: MapPin,
    },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">App usage</h1>
          <p className="text-muted-foreground text-sm">{heading}</p>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="icon" aria-label="Previous day">
            <Link href={dayHref(shiftDate(report.date, -1))}>
              <ChevronLeft className="size-4" />
            </Link>
          </Button>
          <form action="/usage" className="flex items-center gap-2">
            <Input
              type="date"
              name="date"
              defaultValue={report.date}
              max={today}
              className="w-40"
              aria-label="Date"
            />
            {search ? <input type="hidden" name="q" value={search} /> : null}
            <Button type="submit" variant="outline" size="sm">
              Show
            </Button>
          </form>
          <Button
            asChild={report.date < today}
            variant="outline"
            size="icon"
            aria-label="Next day"
            disabled={report.date >= today}
          >
            {report.date < today ? (
              <Link href={dayHref(shiftDate(report.date, 1))}>
                <ChevronRight className="size-4" />
              </Link>
            ) : (
              <span>
                <ChevronRight className="size-4" />
              </span>
            )}
          </Button>
        </div>
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
              <p className="text-3xl font-semibold tabular-nums">{tile.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="grid gap-1">
            <CardTitle className="text-base">
              Who used the app{" "}
              {search ? (
                <span className="text-muted-foreground text-sm font-normal tabular-nums">
                  {users.length} of {report.users.length} match
                </span>
              ) : null}
            </CardTitle>
            <CardDescription>
              Counted while the app is open on screen. Location is the last GPS fix the phone sent
              that day; it is blank when the user denied location access.
            </CardDescription>
          </div>
          <SearchInput
            initial={search}
            placeholder="Search name, mobile, constituency, place"
            label="Search app usage"
          />
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Constituency</TableHead>
                <TableHead className="text-right">Opened</TableHead>
                <TableHead className="text-right">Time in app</TableHead>
                <TableHead>First seen</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead>Last location</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-center">
                    {search && report.users.length > 0
                      ? "Nobody matches your search on this day."
                      : "Nobody used the app on this day."}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.mobileNumber}>
                    <TableCell className="font-medium">
                      {user.fullName}
                      {user.pinLabels.length > 0 ? (
                        <span className="text-muted-foreground block text-xs font-normal">
                          {user.pinLabels.join(", ")}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{user.mobileNumber}</TableCell>
                    <TableCell>{user.assemblyName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{user.opens}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {duration(user.activeSeconds)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {time(user.firstSeenAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm tabular-nums">
                      {time(user.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {user.location ? (
                        <a
                          href={`https://www.google.com/maps?q=${user.location.latitude},${user.location.longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-start gap-1 hover:underline"
                        >
                          <MapPin className="mt-0.5 size-3.5 shrink-0" />
                          <span className="grid">
                            <span className="font-medium">
                              {user.location.placeName ?? "Finding place…"}
                            </span>
                            <span className="text-muted-foreground font-mono text-xs">
                              {user.location.latitude.toFixed(5)},{" "}
                              {user.location.longitude.toFixed(5)}
                            </span>
                          </span>
                        </a>
                      ) : (
                        <Badge variant="secondary">Not shared</Badge>
                      )}
                      {user.location ? (
                        <span className="text-muted-foreground block text-xs">
                          at {time(user.location.at)}
                          {user.location.accuracy !== null
                            ? ` · ±${Math.round(user.location.accuracy)} m`
                            : ""}
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
