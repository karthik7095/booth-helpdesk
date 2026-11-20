"use client";

import { RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { resetPrintsAction } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Wipes a constituency's slip print records so every count reads zero again,
 * say before polling day after a round of test prints. Recorded in the history.
 */
export function ResetPrintsDialog({
  assemblyId,
  name,
  prints,
}: {
  assemblyId: string;
  name: string;
  /** Slip prints on record right now; the button is disabled at zero. */
  prints: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const reset = () => {
    startTransition(async () => {
      const result = await resetPrintsAction(assemblyId);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      // The confirm button keeps the dialog open (so a failure can be read in
      // place), so close it here once the reset has gone through.
      setOpen(false);
      router.refresh();
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="text-red-600 hover:text-red-700"
          disabled={prints === 0}
        >
          <RotateCcw className="size-4" />
          Reset print count
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reset print counts for {name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2">
              <span>
                This deletes all {prints.toLocaleString()} slip print record
                {prints === 1 ? "" : "s"} in this constituency. Afterwards:
              </span>
              <span className="text-foreground">
                · the totals above and the per-user table read zero
                <br />· every voter on the roll shows as not printed
                <br />· the app&apos;s &ldquo;slips printed&rdquo; count starts again from the
                next sync
              </span>
              <span>
                Voters, PINs, vote marks and usage are untouched. This cannot be undone, and
                phones keep their own record of what they already printed. The reset is recorded
                in the card&apos;s history with your name and the counts it cleared.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              reset();
            }}
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Resetting…" : "Reset print count"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
