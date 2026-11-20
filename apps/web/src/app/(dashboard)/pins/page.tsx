import { GeneratePinDialog } from "@/app/(dashboard)/pins/generate-pin-dialog";
import { PinRowActions } from "@/app/(dashboard)/pins/pin-row-actions";
import { SearchInput } from "@/components/search-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

export default async function PinsPage({ searchParams }: PageProps<"/pins">) {
  const { token } = await requireAdmin();
  const search = searchTerm((await searchParams).q);
  const [allPins, assemblies] = await Promise.all([api.pins(token), api.assemblies(token)]);
  const pins = allPins.filter((pin) =>
    matchesSearch(search, pin.pin, pin.label, pin.assemblyName, pin.assemblyNo),
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <CardTitle className="text-base">Access PINs</CardTitle>
          <CardDescription>
            Anyone who signs in with a name and mobile number can read a constituency&apos;s roll by
            entering one of these.
          </CardDescription>
        </div>
        <GeneratePinDialog assemblies={assemblies} />
      </CardHeader>
      <CardContent className="grid gap-4">
        <SearchInput
          initial={search}
          placeholder="Search PIN, issued to, constituency"
          label="Search PINs"
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PIN</TableHead>
              <TableHead>Constituency</TableHead>
              <TableHead>Scope</TableHead>
              <TableHead>Issued to</TableHead>
              <TableHead className="text-right">Uses</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pins.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground text-center">
                  {search ? "No PINs match your search." : "No PINs issued yet."}
                </TableCell>
              </TableRow>
            ) : (
              pins.map((pin) => (
                <TableRow key={pin.id}>
                  <TableCell className="font-mono font-medium">{pin.pin}</TableCell>
                  <TableCell>
                    {pin.assemblyName}{" "}
                    <span className="text-muted-foreground tabular-nums">({pin.assemblyNo})</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {pin.partNos.length > 0 ? `Parts ${pin.partNos.join(", ")}` : "All parts"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{pin.label ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{pin.usageCount}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {formatDate(pin.lastUsedAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={pin.isActive ? "default" : "secondary"}>
                      {pin.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <PinRowActions id={pin.id} pin={pin.pin} isActive={pin.isActive} />
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
