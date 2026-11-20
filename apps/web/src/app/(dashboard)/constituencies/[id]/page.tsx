import {
  voterListQuerySchema,
  voterName,
  voterRelativeName,
  type VoterSort,
} from "@voter/shared";
import { ArrowLeft, KeyRound, Map as MapIcon, Users, UserCheck, X } from "lucide-react";
import Link from "next/link";

import { AdminsCard } from "@/app/(dashboard)/constituencies/[id]/admins-card";
import { AnnouncementCard } from "@/app/(dashboard)/constituencies/[id]/announcement-card";
import { AppFeaturesCard } from "@/app/(dashboard)/constituencies/[id]/app-features-card";
import { AppUsersCard } from "@/app/(dashboard)/constituencies/[id]/app-users-card";
import { BannerCard } from "@/app/(dashboard)/constituencies/[id]/banner-card";
import { VoterPhotosCard } from "@/app/(dashboard)/constituencies/[id]/voter-photos-card";
import { ConstituencyStatus } from "@/app/(dashboard)/constituencies/[id]/constituency-status";
import { ConstituencyTabs } from "@/app/(dashboard)/constituencies/[id]/constituency-tabs";
import { PollDetailsCard } from "@/app/(dashboard)/constituencies/[id]/poll-details-card";
import { StatsVisibilityCard } from "@/app/(dashboard)/constituencies/[id]/stats-visibility-card";
import { TurnoutCharts } from "@/app/(dashboard)/constituencies/[id]/turnout-charts";
import { PrintCell, PrintsCard } from "@/app/(dashboard)/constituencies/[id]/prints";
import { ReuploadRollDialog } from "@/app/(dashboard)/constituencies/[id]/reupload-roll-dialog";
import { ExportButton } from "@/components/export-button";
import { VoterFilters } from "@/components/voter-filters";
import { RowsPerPage, SortableHead } from "@/components/voter-table-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "@/lib/voter-table";

export default async function ConstituencyPage({
  params,
  searchParams,
}: PageProps<"/constituencies/[id]">) {
  const { admin, token } = await requireAdmin();
  const { id } = await params;
  const query = await searchParams;
  const isSuper = admin.role !== "constituency_admin";

  const search = typeof query.q === "string" ? query.q : "";
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  // "true" / "false" in the URL; anything else means no filter.
  const flag = (value: unknown) => (value === "true" ? true : value === "false" ? false : undefined);
  const printed = flag(query.printed);
  const voted = flag(query.voted);
  const deceased = flag(query.deceased);
  const partNo = Number.parseInt(String(query.part ?? ""), 10);
  const part = Number.isFinite(partNo) ? partNo : undefined;
  const wardParam = Number.parseInt(String(query.ward ?? ""), 10);
  const ward = Number.isFinite(wardParam) ? wardParam : undefined;
  const agent = typeof query.agent === "string" && query.agent !== "" ? query.agent : undefined;
  const filtered =
    search !== "" ||
    printed !== undefined ||
    voted !== undefined ||
    deceased !== undefined ||
    part !== undefined ||
    ward !== undefined ||
    agent !== undefined;

  const sortParsed = voterListQuerySchema.pick({ sort: true, dir: true }).safeParse(query);
  const sort = sortParsed.success ? sortParsed.data.sort : undefined;
  const dir = sortParsed.success ? sortParsed.data.dir : undefined;
  const requestedLimit = Number.parseInt(String(query.limit ?? ""), 10);
  const limit = (PAGE_SIZES as readonly number[]).includes(requestedLimit)
    ? requestedLimit
    : DEFAULT_PAGE_SIZE;

  const [assembly, result, admins, prints, booths, appUsers, photos] = await Promise.all([
    api.assembly(id, token),
    api.assemblyVoters(
      id,
      {
        search,
        printed,
        hasVoted: voted,
        deceased,
        partNo: part,
        wardNo: ward,
        printedBy: agent,
        sort,
        dir,
        limit,
        offset: (page - 1) * limit,
      },
      token,
    ),
    isSuper ? api.constituencyAdmins(id, token) : null,
    api.printReport(id, token),
    api.booths(id, token),
    api.appUsers(id, token),
    api.voterPhotos(id, token).catch(() => null),
  ]);

  const pageCount = Math.max(1, Math.ceil(result.total / limit));
  const votedCount = result.voters.filter((voter) => voter.hasVoted).length;

  /** The page's filters as URL params, for links and the export. */
  const filterParams = {
    search: search || undefined,
    printed: printed === undefined ? undefined : String(printed),
    hasVoted: voted === undefined ? undefined : String(voted),
    deceased: deceased === undefined ? undefined : String(deceased),
    partNo: part === undefined ? undefined : String(part),
    wardNo: ward === undefined ? undefined : String(ward),
    printedBy: agent,
  };

  const linkTo = (next: number) => {
    const params = new URLSearchParams();
    if (search) params.set("q", search);
    if (printed !== undefined) params.set("printed", String(printed));
    if (voted !== undefined) params.set("voted", String(voted));
    if (deceased !== undefined) params.set("deceased", String(deceased));
    if (part !== undefined) params.set("part", String(part));
    if (ward !== undefined) params.set("ward", String(ward));
    if (agent !== undefined) params.set("agent", agent);
    if (sort) params.set("sort", sort);
    if (dir) params.set("dir", dir);
    if (limit !== DEFAULT_PAGE_SIZE) params.set("limit", String(limit));
    if (next > 1) params.set("page", String(next));
    const qs = params.toString();
    return `/constituencies/${id}${qs ? `?${qs}` : ""}`;
  };

  const sortable = (column: VoterSort, label: string, className?: string) => (
    <SortableHead column={column} label={label} sort={sort ?? ""} dir={dir ?? ""} className={className} />
  );

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
            PINs for this constituency look like{" "}
            <span className="font-mono">
              {assembly.stateCode}
              {assembly.code}
              {assembly.assemblyNo}B1
            </span>
            .
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href={`/constituencies/${id}/booths`}>
            <Users className="size-4" />
            Booths
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/pins">
            <KeyRound className="size-4" />
            PINs
          </Link>
        </Button>
        {isSuper ? <ReuploadRollDialog assemblyId={id} name={assembly.name} /> : null}
        {isSuper ? (
          <ConstituencyStatus
            assemblyId={id}
            name={assembly.name}
            isActive={assembly.isActive}
            pinCount={assembly.pinCount}
          />
        ) : null}
      </div>

      <ConstituencyTabs id={id} active="overview" />

      {appUsers.wards.length > 0 ? (
        <WardsCard
          assemblyId={id}
          wards={appUsers.wards}
          users={appUsers.users}
          selected={ward}
        />
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Total voters
            </CardTitle>
            <Users className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {assembly.voterCount.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              {filtered ? "Matching these filters" : "Shown on this page"}
            </CardTitle>
            <UserCheck className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">
              {filtered ? result.total.toLocaleString() : result.voters.length.toLocaleString()}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-muted-foreground text-sm font-medium">
              Access PINs
            </CardTitle>
            <KeyRound className="text-muted-foreground size-4" />
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{assembly.pinCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Constituency admins have these on their Dashboard tab; super admins only here. */}
      {isSuper ? (
        <>
          <TurnoutCharts assemblyId={id} booths={booths} />
          <PrintsCard report={prints} assemblyId={id} name={assembly.name} canReset />
        </>
      ) : null}

      {admins ? <AdminsCard assemblyId={id} admins={admins} /> : null}

      <PollDetailsCard
        assemblyId={id}
        electionTitle={assembly.electionTitle}
        pollDate={assembly.pollDate}
        pollTime={assembly.pollTime}
      />

      <StatsVisibilityCard
        assemblyId={id}
        visibility={{
          showGenderStats: assembly.showGenderStats,
          showReligionStats: assembly.showReligionStats,
          showCommunityStats: assembly.showCommunityStats,
        }}
      />

      {isSuper ? (
        <AppFeaturesCard
          assemblyId={id}
          features={{
            enableVoteStatus: assembly.enableVoteStatus,
            enableEnrollment: assembly.enableEnrollment,
            enableCasteEntry: assembly.enableCasteEntry,
            enablePartyLoyalty: assembly.enablePartyLoyalty,
            partyOptions: assembly.partyOptions,
            printCautionNote: assembly.printCautionNote,
            allowUserSlipCovers: assembly.allowUserSlipCovers,
            printSlipImage: assembly.printSlipImage,
            isPanchayat: assembly.isPanchayat,
            requireLoginApproval: assembly.requireLoginApproval,
          }}
        />
      ) : null}

      <AppUsersCard assemblyId={id} list={appUsers} canEditLimit={isSuper} />

      <AnnouncementCard
        assemblyId={id}
        canSendToAll={isSuper}
        announcement={{
          announcementEnabled: assembly.announcementEnabled,
          announcementTitle: assembly.announcementTitle,
          announcementBody: assembly.announcementBody,
          announcementUpdatedAt: assembly.announcementUpdatedAt,
        }}
      />

      {photos ? <VoterPhotosCard assemblyId={id} summary={photos} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <BannerCard assemblyId={id} bannerUpdatedAt={assembly.bannerUpdatedAt} />
        <BannerCard
          assemblyId={id}
          bannerUpdatedAt={assembly.slipImageUpdatedAt}
          kind="slip"
        />
        <BannerCard
          assemblyId={id}
          bannerUpdatedAt={assembly.whatsappImageUpdatedAt}
          kind="whatsapp"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="text-base">
            Voters{" "}
            <span className="text-muted-foreground text-sm font-normal tabular-nums">
              {result.total.toLocaleString()} {filtered ? "matches" : "on the roll"}
            </span>
            {ward !== undefined ? (
              <Badge variant="secondary" className="ml-2 gap-1 align-middle">
                Ward {ward}
                <Link href={`/constituencies/${id}`} scroll={false} aria-label="Show every ward">
                  <X className="size-3" />
                </Link>
              </Badge>
            ) : null}
          </CardTitle>
          {result.total > 0 ? (
            <ExportButton
              kind="voters"
              params={{ assemblyId: id, ...filterParams }}
              label={filtered ? "Export matches" : "Export CSV"}
            />
          ) : null}
        </CardHeader>
        <CardContent className="grid gap-4">
          <VoterFilters
            booths={booths.map((booth) => booth.partNo)}
            agents={prints.users.map((user) => ({
              sessionId: user.sessionId,
              fullName: user.fullName,
              mobileNumber: user.mobileNumber,
            }))}
            partNo={part === undefined ? "" : String(part)}
            printed={printed === undefined ? "" : String(printed)}
            voted={voted === undefined ? "" : String(voted)}
            deceased={deceased === undefined ? "" : String(deceased)}
            agent={agent ?? ""}
            search={search}
          />

          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  {sortable("part", "Part")}
                  {sortable("sr", "Sr")}
                  <TableHead>Section</TableHead>
                  {sortable("name", "Name")}
                  <TableHead>Local name</TableHead>
                  <TableHead>Relative</TableHead>
                  <TableHead>Sex</TableHead>
                  {sortable("age", "Age")}
                  {sortable("voterId", "Voter ID")}
                  {sortable("house", "House")}
                  <TableHead>Street / area</TableHead>
                  {sortable("village", "Village")}
                  {sortable("mobile", "Mobile")}
                  {sortable("voted", "Status")}
                  {sortable("printed", "Slip printed")}
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.voters.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={15} className="text-muted-foreground text-center">
                      {filtered ? "No voters match these filters." : "No voters imported yet."}
                    </TableCell>
                  </TableRow>
                ) : (
                  result.voters.map((voter) => (
                    <TableRow key={voter.id}>
                      <TableCell className="tabular-nums">{voter.partNo}</TableCell>
                      <TableCell className="tabular-nums">{voter.srNo}</TableCell>
                      <TableCell className="tabular-nums">{voter.sectionNo ?? "—"}</TableCell>
                      <TableCell className="font-medium whitespace-nowrap">
                        {voterName(voter) || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {[voter.lFirstName, voter.lLastName].filter(Boolean).join(" ") || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {voterRelativeName(voter) || voter.lMiddleName || "—"}
                      </TableCell>
                      <TableCell>{voter.sex ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{voter.age ?? "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{voter.vcardId ?? "—"}</TableCell>
                      <TableCell>{voter.houseNo ?? "—"}</TableCell>
                      <TableCell>{voter.streetArea ?? "—"}</TableCell>
                      <TableCell>{voter.eVillage ?? "—"}</TableCell>
                      <TableCell>{voter.mobileNo1 ?? "—"}</TableCell>
                      <TableCell>
                        {voter.isDeceased ? (
                          <Badge variant="destructive">Deceased</Badge>
                        ) : (
                          <Badge variant={voter.hasVoted ? "default" : "secondary"}>
                            {voter.hasVoted ? "Voted" : "Pending"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <PrintCell summary={voter.prints} />
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {result.total > 0 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <RowsPerPage limit={limit} />
              <p className="text-muted-foreground text-sm tabular-nums">
                {(page - 1) * limit + 1}–{Math.min(page * limit, result.total)} of{" "}
                {result.total.toLocaleString()}
                {votedCount > 0 ? ` · ${votedCount} voted on this page` : ""}
              </p>
              <div className="flex items-center gap-2">
                <Button asChild={page > 1} variant="outline" size="sm" disabled={page <= 1}>
                  {page > 1 ? <Link href={linkTo(page - 1)} scroll={false}>Previous</Link> : <span>Previous</span>}
                </Button>
                <span className="text-muted-foreground text-sm tabular-nums">
                  {page} / {pageCount}
                </span>
                <Button
                  asChild={page < pageCount}
                  variant="outline"
                  size="sm"
                  disabled={page >= pageCount}
                >
                  {page < pageCount ? <Link href={linkTo(page + 1)} scroll={false}>Next</Link> : <span>Next</span>}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * The constituency's wards, where its voters carry ward numbers: voters in
 * each, and how many approved app users may download it. A ward's row filters
 * the voter list below to it.
 */
function WardsCard({
  assemblyId,
  wards,
  users,
  selected,
}: {
  assemblyId: string;
  wards: { wardNo: number; voters: number }[];
  users: { status: string; wardNos: number[] }[];
  selected: number | undefined;
}) {
  const approved = users.filter((user) => user.status === "approved");
  const total = wards.reduce((sum, ward) => sum + ward.voters, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MapIcon className="text-muted-foreground size-4" />
          Wards
          <span className="text-muted-foreground text-sm font-normal tabular-nums">
            {wards.length} wards · {total.toLocaleString()} voters
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead>Ward</TableHead>
                <TableHead className="text-right">Voters</TableHead>
                <TableHead className="text-right">App users with access</TableHead>
                <TableHead className="text-right">Voter list</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {wards.map((ward) => {
                const withAccess = approved.filter(
                  (user) => user.wardNos.length === 0 || user.wardNos.includes(ward.wardNo),
                ).length;
                const active = selected === ward.wardNo;

                return (
                  <TableRow key={ward.wardNo} data-state={active ? "selected" : undefined}>
                    <TableCell className="font-medium">Ward {ward.wardNo}</TableCell>
                    <TableCell className="text-right tabular-nums">{ward.voters.toLocaleString()}</TableCell>
                    <TableCell className="text-right tabular-nums">{withAccess}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant={active ? "default" : "outline"}>
                        <Link href={active ? `/constituencies/${assemblyId}` : `/constituencies/${assemblyId}?ward=${ward.wardNo}`} scroll={false}>
                          {active ? "Showing" : "Show voters"}
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
