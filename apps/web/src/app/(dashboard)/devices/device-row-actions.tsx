"use client";

import { Ban, CircleCheck, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteDeviceAction, setDeviceStatusAction } from "@/app/actions";
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

export function DeviceRowActions({
  id,
  name,
  status,
}: {
  id: string;
  name: string;
  status: "active" | "revoked";
}) {
  const [pending, startTransition] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const toggle = () => {
    startTransition(async () => {
      const result = await setDeviceStatusAction(id, status === "active" ? "revoked" : "active");
      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  const remove = () => {
    startTransition(async () => {
      const result = await deleteDeviceAction(id);
      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
      setConfirmDelete(false);
    });
  };

  return (
    <div className="flex justify-end gap-1">
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        disabled={pending}
        aria-label={status === "active" ? `Block ${name}` : `Unblock ${name}`}
        title={status === "active" ? "Block this computer" : "Unblock this computer"}
      >
        {status === "active" ? <Ban className="size-4" /> : <CircleCheck className="size-4" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirmDelete(true)}
        disabled={pending}
        aria-label={`Remove ${name}`}
        title="Remove this computer"
      >
        <Trash2 className="size-4" />
      </Button>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The app on that computer will ask for an activation code the next time it opens, and
              its slot on the code becomes free.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={remove} disabled={pending}>
              Remove computer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
