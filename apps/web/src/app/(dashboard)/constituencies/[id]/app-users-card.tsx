"use client";

import type { AppUserAction, AppUserList, AppUserStatus } from "@voter/shared";
import { ShieldCheck, UserCheck } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { appUserAction, setAppUserLimitAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

const FILTERS: { status: AppUserStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "approved", label: "Approved" },
  { status: "removed", label: "Removed" },
];

const wardLabel = (wardNos: number[]) =>
  wardNos.length === 0 ? "All wards" : `${wardNos.length === 1 ? "Ward" : "Wards"} ${wardNos.join(", ")}`;

/** The actions that need the wards chosen, where the constituency has wards. */
type WardAction = "approve" | "make-admin" | "set-wards";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";

/**
 * Who may use the app for this constituency: approve people waiting after the
 * PIN (when Login approval is on), remove anyone (they are signed out and
 * cannot sign in here again until allowed), and choose app admins, who can do
 * the same from the app's Approvals screen. The Mayor, an app admin chosen
 * here, also manages the other admins from the app. Where the constituency has wards,
 * approving asks which wards the person may download.
 */
export function AppUsersCard({
  assemblyId,
  list,
  canEditLimit,
}: {
  assemblyId: string;
  list: AppUserList;
  /** Super admins set how many users the constituency may have. */
  canEditLimit: boolean;
}) {
  const [limitDraft, setLimitDraft] = useState(String(list.limit));
  const [filter, setFilter] = useState<AppUserStatus>(() =>
    list.users.some((user) => user.status === "pending") ? "pending" : "approved",
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [picking, setPicking] = useState<{ mobile: string; name: string; action: WardAction; wardNos: number[] } | null>(null);
  const hasWards = list.wards.length > 0;

  const count = (status: AppUserStatus) => list.users.filter((user) => user.status === status).length;
  const shown = list.users.filter((user) => user.status === filter);
  const full = list.approved >= list.limit;

  const run = (mobile: string, action: AppUserAction, wardNos?: number[]) => {
    setBusy(`${mobile}:${action}`);
    startTransition(async () => {
      const result = await appUserAction(assemblyId, mobile, action, wardNos);

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
      setBusy(null);
    });
  };

  const saveLimit = () => {
    const limit = Number.parseInt(limitDraft, 10);

    if (!Number.isInteger(limit) || limit < 1) {
      toast.error("Enter a number of users, 1 or more.");
      return;
    }

    setBusy("limit");
    startTransition(async () => {
      const result = await setAppUserLimitAction(assemblyId, limit);

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
      setBusy(null);
    });
  };

  const button = (mobile: string, action: AppUserAction, label: string, variant: "default" | "outline" | "destructive" = "outline", disabled = false) => (
    <Button
      size="sm"
      variant={variant}
      disabled={busy !== null || disabled}
      onClick={() => {
        const user = list.users.find((row) => row.mobileNumber === mobile);

        // Letting someone in where there are wards means choosing theirs first.
        if (hasWards && (action === "approve" || action === "set-wards" || (action === "make-admin" && user?.status !== "approved"))) {
          setPicking({ mobile, name: user?.fullName ?? mobile, action, wardNos: user?.wardNos ?? [] });
        } else {
          run(mobile, action);
        }
      }}
    >
      {busy === `${mobile}:${action}` ? "…" : label}
    </Button>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="text-muted-foreground size-4" />
          App users
        </CardTitle>
        <CardDescription>
          {`${list.approved} of ${list.limit} users. `}
          {list.requireLoginApproval
            ? "Login approval is on: new users wait after the PIN until an admin approves them, up to the limit."
            : "Login approval is off: new users with a PIN get in by themselves until the limit is reached, then they are turned away."}{" "}
          Removed users cannot sign in here until allowed again. App admins approve and remove users from the app too.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-end gap-3 rounded-lg border p-3">
          <div className="grid gap-1">
            <Label htmlFor="app-user-limit">User limit</Label>
            <p className="text-muted-foreground text-xs">
              {canEditLimit
                ? "The most users approved here at once, admins included. Lowering it keeps everyone already approved."
                : "Set by a super admin."}
            </p>
          </div>
          <Input
            id="app-user-limit"
            type="number"
            min={1}
            max={500}
            inputMode="numeric"
            className="w-24"
            value={limitDraft}
            disabled={!canEditLimit || busy !== null}
            onChange={(event) => setLimitDraft(event.target.value)}
          />
          {canEditLimit ? (
            <Button size="sm" disabled={busy !== null || limitDraft === String(list.limit)} onClick={saveLimit}>
              {busy === "limit" ? "Saving…" : "Save limit"}
            </Button>
          ) : null}
        </div>

        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {FILTERS.map((option) => (
            <Button
              key={option.status}
              size="sm"
              variant={filter === option.status ? "default" : "outline"}
              aria-pressed={filter === option.status}
              onClick={() => setFilter(option.status)}
            >
              {option.label} · {option.status === "approved" ? `${count("approved")}/${list.limit}` : count(option.status)}
            </Button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {filter === "pending"
              ? "Nobody is waiting for approval."
              : filter === "approved"
                ? "Nobody has been approved yet."
                : "Nobody has been removed."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Mobile</TableHead>
                  {hasWards ? <TableHead>Wards</TableHead> : null}
                  <TableHead>{filter === "pending" ? "Asked" : "Decided"}</TableHead>
                  <TableHead>Last seen</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((user) => (
                  <TableRow key={user.mobileNumber}>
                    <TableCell className="font-medium">
                      <span className="flex items-center gap-2">
                        {user.fullName}
                        {user.isAdmin ? (
                          <Badge variant={user.isMayor ? "default" : "secondary"} className="gap-1">
                            <ShieldCheck className="size-3" />
                            {user.isMayor ? "Mayor" : "App admin"}
                          </Badge>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="tabular-nums">{user.mobileNumber}</TableCell>
                    {hasWards ? (
                      <TableCell className="text-muted-foreground">
                        {user.status === "approved" ? wardLabel(user.wardNos) : "—"}
                      </TableCell>
                    ) : null}
                    <TableCell className="text-muted-foreground">
                      {filter === "pending" ? when(user.requestedAt) : when(user.decidedAt)}
                      {filter !== "pending" && user.decidedBy ? <span className="block text-xs">by {user.decidedBy}</span> : null}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{when(user.lastSeenAt)}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-2">
                        {user.status === "pending" ? (
                          <>
                            {button(user.mobileNumber, "approve", full ? `Approve (${list.limit} max)` : "Approve", "default", full)}
                            {button(user.mobileNumber, "remove", "Remove", "destructive")}
                          </>
                        ) : user.status === "approved" ? (
                          <>
                            {hasWards ? button(user.mobileNumber, "set-wards", "Change wards") : null}
                            {user.isMayor
                              ? button(user.mobileNumber, "unmake-mayor", "Remove Mayor")
                              : button(user.mobileNumber, "make-mayor", "Make Mayor")}
                            {user.isAdmin
                              ? button(user.mobileNumber, "unmake-admin", "Remove admin")
                              : button(user.mobileNumber, "make-admin", "Make admin")}
                            {button(user.mobileNumber, "remove", "Remove", "destructive")}
                          </>
                        ) : (
                          button(user.mobileNumber, "allow", "Allow again")
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <WardDialog
        picking={picking}
        wards={list.wards}
        onCancel={() => setPicking(null)}
        onDone={(wardNos) => {
          const target = picking;

          setPicking(null);
          if (target) run(target.mobile, target.action, wardNos);
        }}
      />
    </Card>
  );
}

/** Which wards the person may download: some, or all of them. */
function WardDialog({
  picking,
  wards,
  onCancel,
  onDone,
}: {
  picking: { name: string; action: WardAction; wardNos: number[] } | null;
  wards: { wardNo: number; voters: number }[];
  onCancel: () => void;
  onDone: (wardNos: number[]) => void;
}) {
  const [all, setAll] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [openFor, setOpenFor] = useState<typeof picking>(null);

  // Starts from the person's current wards each time it opens.
  if (picking !== openFor) {
    setOpenFor(picking);
    setAll(picking?.action === "set-wards" && picking.wardNos.length === 0);
    setChosen(new Set(picking?.wardNos ?? []));
  }

  const toggle = (wardNo: number) => {
    setAll(false);
    setChosen((prev) => {
      const next = new Set(prev);

      if (next.has(wardNo)) next.delete(wardNo);
      else next.add(wardNo);

      return next;
    });
  };

  const voters = wards
    .filter((ward) => all || chosen.has(ward.wardNo))
    .reduce((sum, ward) => sum + ward.voters, 0);
  const ready = all || chosen.size > 0;

  return (
    <Dialog open={picking !== null} onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {picking?.action === "set-wards" ? `Wards for ${picking.name}` : `Approve ${picking?.name ?? ""}`}
          </DialogTitle>
          <DialogDescription>Choose the wards they may download. They see only those voters.</DialogDescription>
        </DialogHeader>

        <Button
          variant={all ? "default" : "outline"}
          aria-pressed={all}
          onClick={() => {
            setAll((prev) => !prev);
            setChosen(new Set());
          }}
        >
          All wards ({wards.length})
        </Button>

        <div className="grid max-h-80 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {wards.map((ward) => {
            const on = !all && chosen.has(ward.wardNo);

            return (
              <Button
                key={ward.wardNo}
                variant={on ? "default" : "outline"}
                aria-pressed={on}
                className="h-auto flex-col gap-0 py-2"
                onClick={() => toggle(ward.wardNo)}
              >
                <span>Ward {ward.wardNo}</span>
                <span className="text-xs font-normal opacity-70">{ward.voters.toLocaleString()} voters</span>
              </Button>
            );
          })}
        </div>

        <p className="text-muted-foreground text-sm">
          {ready
            ? `${all ? "All wards" : `${chosen.size} ward${chosen.size === 1 ? "" : "s"}`} · ${voters.toLocaleString()} voters`
            : "Choose at least one ward."}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => onDone(all ? [] : [...chosen].sort((a, b) => a - b))}>
            {picking?.action === "set-wards" ? "Save" : picking?.action === "make-admin" ? "Make admin" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
