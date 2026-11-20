import {
  AGE_GROUPS,
  appStatsQuerySchema,
  CASTE_CATEGORIES,
  type AppStatsQuery,
  type BoothSummary,
  type StatsBreakdownRow,
} from "@voter/shared";
import {
  CheckCheck,
  HeartCrack,
  KeyRound,
  Phone,
  Printer,
  Smartphone,
  Tags,
  Users,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HourlyChart } from "@/app/(dashboard)/stats/hourly-chart";
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
import { Label } from "@/components/ui/label";
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

const GENDER_LABELS: Record<string, string> = { M: "Male", F: "Female", O: "Other / blank" };
const METHOD_LABELS: Record<string, string> = { printer: "Printer", dialog: "Phone print dialog" };

/** Styled like the dashboard's inputs, but a plain select so the form works without JS. */
const SELECT =
  "border-input bg-background h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

function percent(part: number, whole: number) {
  if (whole === 0) return "0%";
  const share = (part / whole) * 100;
  return `${share < 10 ? share.toFixed(1) : Math.round(share)}%`;
}

const n = (value: number) => value.toLocaleString("en-IN");

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) || undefined;
}

function Breakdown({
  title,
  rows,
  label = (key) => key,
}: {
  title: string;
  rows: StatsBreakdownRow[];
  label?: (key: string) => string;
}) {
  const total = rows.reduce((sum, row) => sum + row.voters, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{title}</TableHead>
              <TableHead className="text-right">Voters</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Voted</TableHead>
              <TableHead className="text-right">Turnout</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  No voters match.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.key}>
                  <TableCell className="font-medium">{label(row.key)}</TableCell>
                  <TableCell className="text-right tabular-nums">{n(row.voters)}</TableCell>
                  <TableCell className="text-muted-foreground text-right tabular-nums">
                    {percent(row.voters, total)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{n(row.voted)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {percent(row.voted, row.voters)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

/** Every constituency's figures in one place, narrowed by any mix of filters. */
export default async function StatsPage({ searchParams }: PageProps<"/stats">) {
  const { admin, token } = await requireAdmin();

  if (admin.role === "constituency_admin") notFound();

  const raw = await searchParams;
  const parsed = appStatsQuerySchema.safeParse({
    assemblyNo: first(raw.assemblyNo),
    partNo: first(raw.partNo),
    from: first(raw.from),
    to: first(raw.to),
    sex: first(raw.sex),
    ageGroup: first(raw.ageGroup),
    community: first(raw.community),
    voted: first(raw.voted),
  });
  const query: AppStatsQuery = parsed.success ? parsed.data : {};

  const assemblies = await api.assemblies(token);
  const assembly = assemblies.find((item) => item.assemblyNo === query.assemblyNo);
  const [stats, booths] = await Promise.all([
    api.appStats(query, token),
    assembly ? api.booths(assembly.id, token) : Promise.resolve([] as BoothSummary[]),
  ]);

  // Recorded values the fixed list does not cover still get an option.
  const communities = [
    ...CASTE_CATEGORIES.map((category) => category.value),
    ...stats.communities
      .map((row) => row.key)
      .filter(
        (key) =>
          key !== "Unknown" &&
          !CASTE_CATEGORIES.some((category) => category.value.toUpperCase() === key),
      ),
  ];
  const { totals } = stats;
  const byBooth = Boolean(assembly);
  const hasRange = Boolean(query.from || query.to);
  const active = Object.values(query).filter((value) => value !== undefined).length;

  const tiles = [
    { label: "Voters", value: n(totals.voters), note: null, icon: Users },
    {
      label: "Voted",
      value: n(totals.voted),
      note: `${percent(totals.voted, totals.voters)} turnout · ${n(totals.voters - totals.voted)} not yet`,
      icon: CheckCheck,
    },
    {
      label: "Slips printed",
      value: n(totals.printedVoters),
      note: `${percent(totals.printedVoters, totals.voters)} of voters · ${n(totals.prints)} prints`,
      icon: Printer,
    },
    {
      label: "Deceased",
      value: n(totals.deceased),
      note: percent(totals.deceased, totals.voters),
      icon: HeartCrack,
    },
    {
      label: "With mobile number",
      value: n(totals.withMobile),
      note: percent(totals.withMobile, totals.voters),
      icon: Phone,
    },
    {
      label: "Community recorded",
      value: n(totals.withCommunity),
      note: percent(totals.withCommunity, totals.voters),
      icon: Tags,
    },
    {
      label: "App users",
      value: n(totals.appUsers),
      note: hasRange ? "Used the app in the date range" : "Ever used the app",
      icon: Smartphone,
    },
    { label: "Active PINs", value: n(totals.activePins), note: null, icon: KeyRound },
  ];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Stats</h1>
        <p className="text-muted-foreground text-sm">
          Voters, turnout, printing and app use across every constituency.
        </p>
      </div>

      <Card>
        <CardContent>
          <form action="/stats" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-1.5">
              <Label htmlFor="assemblyNo">Constituency</Label>
              <select
                id="assemblyNo"
                name="assemblyNo"
                defaultValue={query.assemblyNo ?? ""}
                className={SELECT}
              >
                <option value="">All constituencies</option>
                {assemblies.map((item) => (
                  <option key={item.id} value={item.assemblyNo}>
                    {item.name} ({item.assemblyNo})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="partNo">Booth</Label>
              <select
                id="partNo"
                name="partNo"
                defaultValue={query.partNo ?? ""}
                className={SELECT}
                disabled={!assembly}
              >
                <option value="">{assembly ? "All booths" : "Pick a constituency first"}</option>
                {booths.map((booth) => (
                  <option key={booth.partNo} value={booth.partNo}>
                    {booth.partNo} · {booth.village ?? booth.boothAddress ?? ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="from">From</Label>
              <Input id="from" type="date" name="from" defaultValue={query.from ?? ""} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="to">To</Label>
              <Input id="to" type="date" name="to" defaultValue={query.to ?? ""} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="voted">Voted status</Label>
              <select id="voted" name="voted" defaultValue={query.voted ?? ""} className={SELECT}>
                <option value="">All</option>
                <option value="voted">Voted</option>
                <option value="not_voted">Not voted</option>
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="sex">Gender</Label>
              <select id="sex" name="sex" defaultValue={query.sex ?? ""} className={SELECT}>
                <option value="">All</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
                <option value="O">Other / blank</option>
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ageGroup">Age</Label>
              <select
                id="ageGroup"
                name="ageGroup"
                defaultValue={query.ageGroup ?? ""}
                className={SELECT}
              >
                <option value="">All ages</option>
                {AGE_GROUPS.map((group) => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="community">Community</Label>
              <select
                id="community"
                name="community"
                defaultValue={query.community ?? ""}
                className={SELECT}
              >
                <option value="">All</option>
                {communities.map((community) => (
                  <option key={community} value={community}>
                    {community}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4">
              <Button type="submit">Apply filters</Button>
              <Button asChild variant="outline">
                <Link href="/stats">Reset</Link>
              </Button>
              {active > 0 ? (
                <Badge variant="secondary">
                  {active} filter{active === 1 ? "" : "s"} on
                </Badge>
              ) : null}
              {!parsed.success ? (
                <span className="text-destructive text-sm">
                  {parsed.error.issues[0]?.message ?? "Some filters were ignored."}
                </span>
              ) : null}
            </div>
          </form>
        </CardContent>
      </Card>

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
              {tile.note ? (
                <p className="text-muted-foreground mt-1 text-xs">{tile.note}</p>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Activity by hour</CardTitle>
          <CardDescription>
            Voters marked voted and slips printed in each hour of the day, India time
            {hasRange ? ", across the date range" : ", all days together"}.{" "}
            {hasRange ? `${n(totals.votedInPeriod)} voters marked voted in the range.` : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <HourlyChart hourly={stats.hourly} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{byBooth ? "By booth" : "By constituency"}</CardTitle>
          <CardDescription>
            {byBooth
              ? `${assembly?.name}: every booth with voters matching the filters.`
              : "Pick a constituency above to see its booths."}
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{byBooth ? "Booth" : "Constituency"}</TableHead>
                <TableHead className="text-right">Voters</TableHead>
                <TableHead className="text-right">Voted</TableHead>
                <TableHead className="text-right">Turnout</TableHead>
                <TableHead className="text-right">Slips printed</TableHead>
                <TableHead className="text-right">Printed %</TableHead>
                <TableHead className="text-right">Prints</TableHead>
                <TableHead className="text-right">Deceased</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.areas.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-center">
                    No voters match these filters.
                  </TableCell>
                </TableRow>
              ) : (
                stats.areas.map((row) => (
                  <TableRow key={row.no}>
                    <TableCell className="font-medium">
                      <span className="tabular-nums">{row.no}</span>
                      <span className="text-muted-foreground ml-2 font-normal">{row.name}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{n(row.voters)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(row.voted)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(row.voted, row.voters)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {n(row.printedVoters)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(row.printedVoters, row.voters)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{n(row.prints)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(row.deceased)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown
          title="Gender"
          rows={stats.gender}
          label={(key) => GENDER_LABELS[key] ?? key}
        />
        <Breakdown title="Age" rows={stats.ages} />
        <Breakdown
          title="Community"
          rows={stats.communities}
          label={(key) => (key === "Unknown" ? "Not recorded" : key)}
        />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">How slips were printed</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead className="text-right">Prints</TableHead>
                  <TableHead className="text-right">Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.printMethods.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-muted-foreground text-center">
                      No slips printed.
                    </TableCell>
                  </TableRow>
                ) : (
                  stats.printMethods.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-medium">
                        {METHOD_LABELS[row.key] ?? row.key}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{n(row.prints)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {percent(row.prints, totals.prints)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Most active agents</CardTitle>
          <CardDescription>
            The 50 app users who marked the most voters as voted and printed the most slips
            {hasRange ? " in the date range" : ""}.
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Constituency</TableHead>
                <TableHead className="text-right">Marked voted</TableHead>
                <TableHead className="text-right">Prints</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.agents.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    No agent activity matches these filters.
                  </TableCell>
                </TableRow>
              ) : (
                stats.agents.map((agent) => (
                  <TableRow key={agent.sessionId}>
                    <TableCell className="font-medium">{agent.fullName}</TableCell>
                    <TableCell className="tabular-nums">{agent.mobileNumber}</TableCell>
                    <TableCell>{agent.assemblyName ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(agent.votedMarks)}</TableCell>
                    <TableCell className="text-right tabular-nums">{n(agent.prints)}</TableCell>
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
