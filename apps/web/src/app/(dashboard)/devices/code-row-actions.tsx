"use client";

import type { ActivationCode } from "@voter/shared";
import { Copy, Power, PowerOff, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { EditCodeDialog } from "@/app/(dashboard)/devices/edit-code-dialog";
import { deleteActivationCodeAction, setActivationCodeActiveAction } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function CodeRowActions({ entry }: { entry: ActivationCode }) {
  const { id, code, isActive, deviceCount } = entry;
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success(`Copied ${code}`);
    } catch {
      toast.error("Could not copy the code.");
    }
  };

  const toggle = () => {
    startTransition(async () => {
      const result = await setActivationCodeActiveAction(id, !isActive);
      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteActivationCodeAction(id);
      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
      setConfirmDelete(false);
    });
  };

  return (
    <div className="flex justify-end gap-1">
      <EditCodeDialog code={entry} />
      <Button variant="ghost" size="icon" onClick={copy} aria-label={`Copy ${code}`}>
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        disabled={pending}
        aria-label={isActive ? `Disable ${code}` : `Enable ${code}`}
      >
        {isActive ? <PowerOff className="size-4" /> : <Power className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirmDelete(true)}
        disabled={pending}
        aria-label={`Delete ${code}`}
      >
        <Trash2 className="size-4" />
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deviceCount > 0
                ? `${deviceCount} computer${deviceCount === 1 ? "" : "s"} activated with this code will be locked out the next time the app opens.`
                : "No computer has used this code yet."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={pending}>
              Delete code
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
