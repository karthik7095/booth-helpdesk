import {
  ALL_CONSTITUENCIES,
  ConstituencyFilter,
  NO_CONSTITUENCY,
} from "@/app/(dashboard)/users/constituency-filter";
import { UserActiveButton } from "@/app/(dashboard)/users/user-active-button";
import { SearchInput } from "@/components/search-input";
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
import { api } from "@/lib/api";
import { requireAdmin } from "@/lib/session";
import { searchTerm } from "@/lib/utils";

function when(value: string | null) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export default async function UsersPage({ searchParams }: PageProps<"/users">) {
  const { token } = await requireAdmin();
  const params = await searchParams;
  const search = searchTerm(params.q);
  const constituency = typeof params.c === "string" ? params.c : "";
  const [allUsers, assemblies] = await Promise.all([
    api.sessions(token, search || undefined),
    api.assemblies(token),
  ]);

  // Sessions carry the constituency's name only, so that is what the filter matches.
  const users = allUsers.filter((user) =>
    !constituency
      ? true
      : constituency === NO_CONSTITUENCY
        ? user.assemblyName === null
        : user.assemblyName === constituency,
  );
  const countFor = (name: string | null) => allUsers.filter((user) => user.assemblyName === name).length;
  const options = [
    { value: ALL_CONSTITUENCIES, label: `All constituencies (${allUsers.length})` },
    ...[...assemblies]
      .sort((a, b) => a.assemblyNo - b.assemblyNo)
      .map((assembly) => ({
        value: assembly.name,
        label: `${assembly.assemblyNo} · ${assembly.name}${assembly.isActive ? "" : " (off)"} (${countFor(assembly.name)})`,
      })),
    { value: NO_CONSTITUENCY, label: `No PIN entered yet (${countFor(null)})` },
  ];

  const verified = users.filter((user) => user.verifiedAt !== null).length;
  const prints = users.reduce((sum, user) => sum + user.prints, 0);

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">App users</CardTitle>
          <CardDescription>
            Everyone who has signed in to the mobile app. Anyone may sign in with a name and
            mobile number; only those who then entered a valid PIN can read voter data.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <ConstituencyFilter value={constituency} options={options} />
            <SearchInput
              initial={search}
              placeholder="Search name, mobile, PIN, constituency"
              label="Search app users"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {users.length} {search || constituency ? "matches" : "sign-ins"}
            </Badge>
            <Badge variant="secondary">{verified} unlocked with a PIN</Badge>
            <Badge variant="secondary">{prints.toLocaleString()} slips printed</Badge>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Mobile</TableHead>
                <TableHead>Constituency</TableHead>
                <TableHead>PIN used</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Slips printed</TableHead>
                <TableHead className="text-right">Voters printed</TableHead>
                <TableHead>Last active</TableHead>
                <TableHead className="text-right">Access</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-muted-foreground text-center">
                    {search || constituency
                      ? "No app users match these filters."
                      : "Nobody has signed in yet."}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.fullName}</TableCell>
                    <TableCell className="tabular-nums">{user.mobileNumber}</TableCell>
                    <TableCell>{user.assemblyName ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {user.pin ?? "—"}
                      {user.pinLabel ? (
                        <span className="text-muted-foreground block font-sans">
                          {user.pinLabel}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {user.deactivated ? (
                        <Badge variant="destructive">Deactivated</Badge>
                      ) : (
                        <Badge variant={user.verifiedAt ? "default" : "secondary"}>
                          {user.verifiedAt ? "Unlocked" : "PIN not entered"}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.prints.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.votersPrinted.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {when(user.lastSeenAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <UserActiveButton
                        fullName={user.fullName}
                        mobileNumber={user.mobileNumber}
                        deactivated={user.deactivated}
                      />
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
