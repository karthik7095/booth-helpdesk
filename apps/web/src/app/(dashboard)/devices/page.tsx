import { CreateCodeDialog } from "@/app/(dashboard)/devices/create-code-dialog";
import { CodeRowActions } from "@/app/(dashboard)/devices/code-row-actions";
import { DeviceRowActions } from "@/app/(dashboard)/devices/device-row-actions";
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
import { requireDeveloper } from "@/lib/session";

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" }) : "—";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const platformLabel = { darwin: "macOS", win32: "Windows", linux: "Linux" } as const;

export default async function DevicesPage() {
  const { token } = await requireDeveloper();
  const [codes, devices] = await Promise.all([api.activationCodes(token), api.devices(token)]);

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="grid gap-1">
            <CardTitle className="text-base">Activation codes</CardTitle>
            <CardDescription>
              The desktop converter only runs on a computer activated with one of these codes, and it
              checks with this server every time it opens. Disable a code to lock out every computer
              that used it.
            </CardDescription>
          </div>
          <CreateCodeDialog />
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Issued to</TableHead>
                <TableHead className="text-right">Computers</TableHead>
                <TableHead>Valid until</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {codes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-muted-foreground text-center">
                    No activation codes yet.
                  </TableCell>
                </TableRow>
              ) : (
                codes.map((code) => (
                  <TableRow key={code.id}>
                    <TableCell className="font-mono font-medium">{code.code}</TableCell>
                    <TableCell>{code.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {code.activeDeviceCount} / {code.maxDevices}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(code.expiresAt)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDate(code.createdAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          !code.isActive
                            ? "secondary"
                            : code.expiresAt && new Date(code.expiresAt) < new Date()
                              ? "destructive"
                              : "default"
                        }
                      >
                        {!code.isActive
                          ? "Inactive"
                          : code.expiresAt && new Date(code.expiresAt) < new Date()
                            ? "Expired"
                            : "Active"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <CodeRowActions entry={code} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="grid gap-1">
          <CardTitle className="text-base">Activated computers</CardTitle>
          <CardDescription>
            Every computer that has activated the desktop converter. Block one to lock it out on its
            next launch; remove it to free its slot on the code.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Computer</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>App</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="text-right">Conversions</TableHead>
                <TableHead className="text-right">Voters</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground text-center">
                    No computer has activated the app yet.
                  </TableCell>
                </TableRow>
              ) : (
                devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>
                      <div className="font-medium">{device.name}</div>
                      <div className="text-muted-foreground text-xs">
                        {platformLabel[device.platform]}
                        {device.osVersion ? ` ${device.osVersion}` : ""} · id {device.fingerprintHint}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-mono text-sm">{device.code}</div>
                      <div className="text-muted-foreground text-xs">{device.codeLabel}</div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">{device.appVersion ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{formatDateTime(device.lastSeenAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">{device.conversions}</TableCell>
                    <TableCell className="text-right tabular-nums">{device.voters.toLocaleString("en-IN")}</TableCell>
                    <TableCell>
                      <Badge variant={device.status === "active" ? "default" : "destructive"}>
                        {device.status === "active" ? "Active" : "Blocked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DeviceRowActions id={device.id} name={device.name} status={device.status} />
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
