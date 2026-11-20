"use client";

import { Power, PowerOff } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { setAppUserActiveAction } from "@/app/actions";
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

/** Deactivate asks first; activating again needs no confirmation. */
export function UserActiveButton({
  fullName,
  mobileNumber,
  deactivated,
}: {
  fullName: string;
  mobileNumber: string;
  deactivated: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  const apply = (active: boolean) => {
    startTransition(async () => {
      const result = await setAppUserActiveAction(mobileNumber, active);

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
      setConfirming(false);
    });
  };

  if (deactivated) {
    return (
      <Button variant="outline" size="sm" disabled={pending} onClick={() => apply(true)}>
        <Power className="size-4" />
        Activate
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="text-destructive"
        disabled={pending}
        onClick={() => setConfirming(true)}
      >
        <PowerOff className="size-4" />
        Deactivate
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {fullName} ({mobileNumber})?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They are signed out the next time the app opens or comes back on screen, and the
              voter list is removed from the phone. Nobody can sign in with this number, or on
              the phones it was used on, until you activate it again. Reinstalling the app lifts
              the phone block but not the number&apos;s.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(event) => {
                event.preventDefault();
                apply(false);
              }}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
