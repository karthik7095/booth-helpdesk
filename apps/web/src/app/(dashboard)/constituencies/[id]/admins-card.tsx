"use client";

import type { ConstituencyAdmin } from "@voter/shared";
import { KeySquare, Plus, Power, PowerOff, ShieldCheck } from "lucide-react";
import { useState, useTransition, type ChangeEvent, type FormEvent } from "react";
import { toast } from "sonner";

import {
  createConstituencyAdminAction,
  resetConstituencyAdminPasswordAction,
  setConstituencyAdminActiveAction,
} from "@/app/actions";
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
  DialogTrigger,
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

function when(value: string | null) {
  return value
    ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : "Never";
}

/** Dashboard logins limited to this constituency. Only super admins see this card. */
export function AdminsCard({
  assemblyId,
  admins,
}: {
  assemblyId: string;
  admins: ConstituencyAdmin[];
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="text-muted-foreground size-4" />
            Constituency admins
          </CardTitle>
          <CardDescription>
            They sign in to this dashboard with email and password and see only this
            constituency — its voters, booths, PINs and app users.
          </CardDescription>
        </div>
        <AddAdminDialog assemblyId={assemblyId} />
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Last sign-in</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admins.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-muted-foreground text-center">
                  No admin logins yet.
                </TableCell>
              </TableRow>
            ) : (
              admins.map((admin) => (
                <TableRow key={admin.id}>
                  <TableCell className="font-medium">{admin.name}</TableCell>
                  <TableCell>{admin.email}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {when(admin.lastLoginAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={admin.isActive ? "default" : "secondary"}>
                      {admin.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <AdminRowActions assemblyId={assemblyId} admin={admin} />
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

export type AdminFieldValues = { name: string; email: string; password: string };

export const emptyAdminFields: AdminFieldValues = { name: "", email: "", password: "" };

function AddAdminDialog({ assemblyId }: { assemblyId: string }) {
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState(emptyAdminFields);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      const result = await createConstituencyAdminAction(assemblyId, fields);

      if (result.error) {
        setError(result.error);
        return;
      }

      toast.success(result.message);
      setFields(emptyAdminFields);
      setError(null);
      setOpen(false);
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setFields(emptyAdminFields);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add admin
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add a constituency admin</DialogTitle>
            <DialogDescription>
              Share the email and password with them — they sign in at this dashboard&apos;s login
              page.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <AdminFields values={fields} onChange={setFields} />

            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create login"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Name, email and password inputs, shared with the onboarding dialog. */
export function AdminFields({
  values,
  onChange,
}: {
  values: AdminFieldValues;
  onChange: (next: AdminFieldValues) => void;
}) {
  const bind = (field: keyof AdminFieldValues) => ({
    value: values[field],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      onChange({ ...values, [field]: event.target.value }),
  });

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="grid gap-2">
        <Label htmlFor="adminName">Admin name</Label>
        <Input id="adminName" name="adminName" placeholder="Ravi Kumar" {...bind("name")} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="adminEmail">Email</Label>
        <Input
          id="adminEmail"
          name="adminEmail"
          type="email"
          autoComplete="off"
          placeholder="ravi@example.com"
          {...bind("email")}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="adminPassword">Password</Label>
        <Input
          id="adminPassword"
          name="adminPassword"
          type="text"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          {...bind("password")}
        />
      </div>
    </div>
  );
}

function AdminRowActions({ assemblyId, admin }: { assemblyId: string; admin: ConstituencyAdmin }) {
  const [pending, startTransition] = useTransition();
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const toggle = () => {
    startTransition(async () => {
      const result = await setConstituencyAdminActiveAction(assemblyId, admin.id, !admin.isActive);

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  const reset = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    startTransition(async () => {
      const result = await resetConstituencyAdminPasswordAction(admin.id, password);

      if (result.error) {
        setError(result.error);
        return;
      }

      toast.success(`${result.message} Share the new password with ${admin.name}.`);
      setPassword("");
      setError(null);
      setResetOpen(false);
    });
  };

  return (
    <div className="flex justify-end gap-1">
      <Dialog
        open={resetOpen}
        onOpenChange={(next) => {
          setResetOpen(next);
          if (!next) {
            setPassword("");
            setError(null);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`Reset password for ${admin.email}`}>
            <KeySquare className="size-4" />
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={reset}>
            <DialogHeader>
              <DialogTitle>Reset password</DialogTitle>
              <DialogDescription>
                Set a new password for {admin.email}. Their current one stops working.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-2 py-4">
              <Label htmlFor={`password-${admin.id}`}>New password</Label>
              <Input
                id={`password-${admin.id}`}
                type="text"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="At least 8 characters"
              />
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <DialogFooter>
              <Button type="submit" disabled={pending || password.length < 8}>
                {pending ? "Saving…" : "Reset password"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        disabled={pending}
        aria-label={admin.isActive ? `Deactivate ${admin.email}` : `Reactivate ${admin.email}`}
      >
        {admin.isActive ? <PowerOff className="size-4" /> : <Power className="size-4" />}
      </Button>
    </div>
  );
}
