"use client";

import type { ActivationCode } from "@voter/shared";
import { Pencil } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { updateActivationCodeAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
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

function toDateInput(iso: string | null) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : "";
}

export function EditCodeDialog({ code }: { code: ActivationCode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateActivationCodeAction(code.id, {}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success(result.message ?? "Saved.");
      setError(null);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Edit ${code.code}`} title="Edit validity and limits">
          <Pencil className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit {code.code}</DialogTitle>
            <DialogDescription>
              Changes apply the next time each computer checks in, within ten minutes while the app
              is open.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor={`label-${code.id}`}>Issued to</Label>
              <Input id={`label-${code.id}`} name="label" defaultValue={code.label} required maxLength={120} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`max-${code.id}`}>Computers allowed</Label>
              <Input id={`max-${code.id}`} name="maxDevices" type="number" min={1} max={500} defaultValue={code.maxDevices} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor={`exp-${code.id}`}>Valid until (leave empty for no expiry)</Label>
              <Input id={`exp-${code.id}`} name="expiresAt" type="date" defaultValue={toDateInput(code.expiresAt)} />
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
