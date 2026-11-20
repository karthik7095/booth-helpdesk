"use client";

import { Plus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { createActivationCodeAction } from "@/app/actions";
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

export function CreateCodeDialog() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createActivationCodeAction({}, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      toast.success(`Activation code: ${result.message}`, { duration: 15000 });
      setError(null);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          New code
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create an activation code</DialogTitle>
            <DialogDescription>
              The code is generated for you. Give it to the client; each computer they activate with
              it takes one of its slots.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="label">Issued to</Label>
              <Input id="label" name="label" placeholder="e.g. Maan constituency office" required maxLength={120} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="maxDevices">Computers allowed</Label>
              <Input id="maxDevices" name="maxDevices" type="number" min={1} max={500} defaultValue={1} required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="expiresAt">Expires on (optional)</Label>
              <Input id="expiresAt" name="expiresAt" type="date" />
            </div>
            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create code"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
