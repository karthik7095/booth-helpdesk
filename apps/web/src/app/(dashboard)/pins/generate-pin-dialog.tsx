"use client";

import type { Assembly } from "@voter/shared";
import { Plus } from "lucide-react";
import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { createPinAction } from "@/app/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function GeneratePinDialog({ assemblies }: { assemblies: Assembly[] }) {
  const [open, setOpen] = useState(false);
  const [assemblyId, setAssemblyId] = useState(assemblies[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createPinAction({}, formData);

      if (result.error) {
        setError(result.error);
        return;
      }

      // The action returns the generated PIN so it can be read out immediately.
      toast.success(`PIN generated: ${result.message}`, { duration: 10000 });
      setError(null);
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={assemblies.length === 0}>
          <Plus className="size-4" />
          Generate PIN
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Generate an access PIN</DialogTitle>
            <DialogDescription>
              The PIN is created for you from the constituency codes — you only choose its scope.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="assembly">Constituency</Label>
              <input type="hidden" name="assemblyId" value={assemblyId} />
              <Select value={assemblyId} onValueChange={setAssemblyId}>
                <SelectTrigger id="assembly" className="w-full">
                  <SelectValue placeholder="Choose a constituency" />
                </SelectTrigger>
                <SelectContent>
                  {assemblies.map((assembly) => (
                    <SelectItem key={assembly.id} value={assembly.id}>
                      {assembly.name} ({assembly.assemblyNo})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="partNos">Parts (optional)</Label>
              <Input id="partNos" name="partNos" placeholder="1, 2, 3" />
              <p className="text-muted-foreground text-xs">
                Comma separated part numbers. Leave blank to grant the whole constituency.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="label">Issued to (optional)</Label>
              <Input id="label" name="label" placeholder="Booth 1 volunteer" />
            </div>

            {error ? (
              <p className="text-destructive text-sm" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending || !assemblyId}>
              {pending ? "Generating…" : "Generate PIN"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
