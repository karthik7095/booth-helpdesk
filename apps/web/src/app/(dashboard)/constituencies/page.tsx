import Link from "next/link";

import { AddConstituencyDialog } from "@/app/(dashboard)/constituencies/add-constituency-dialog";
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
import { requireSuperAdmin } from "@/lib/session";
import { matchesSearch, searchTerm } from "@/lib/utils";

export default async function ConstituenciesPage({
  searchParams,
}: PageProps<"/constituencies">) {
  const { token } = await requireSuperAdmin();
  const search = searchTerm((await searchParams).q);
  const assemblies = (await api.assemblies(token)).filter((assembly) =>
    matchesSearch(
      search,
      assembly.name,
      assembly.assemblyNo,
      `${assembly.stateCode}${assembly.code}${assembly.assemblyNo}`,
    ),
  );

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle className="text-base">Constituencies</CardTitle>
            <CardDescription>
              Open one to browse and search its roll. Add a constituency by uploading its
              electoral roll.
            </CardDescription>
          </div>
          <AddConstituencyDialog />
        </CardHeader>
        <CardContent className="grid gap-4">
          <SearchInput
            initial={search}
            placeholder="Search name, number, PIN prefix"
            label="Search constituencies"
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>No.</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>PIN prefix</TableHead>
                <TableHead className="text-right">Voters</TableHead>
                <TableHead className="text-right">PINs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assemblies.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground text-center">
                    {search ? "No constituencies match your search." : "No constituencies yet."}
                  </TableCell>
                </TableRow>
              ) : (
                assemblies.map((assembly) => (
                  <TableRow key={assembly.id}>
                    <TableCell className="tabular-nums">{assembly.assemblyNo}</TableCell>
                    <TableCell className="font-medium">
                      <Link href={`/constituencies/${assembly.id}`} className="hover:underline">
                        {assembly.name}
                      </Link>
                      {assembly.isActive ? null : (
                        <Badge variant="destructive" className="ml-2">
                          Inactive
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {assembly.stateCode}
                      {assembly.code}
                      {assembly.assemblyNo}…
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {assembly.voterCount.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{assembly.pinCount}</TableCell>
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
