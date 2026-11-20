"use client";

import { Power, PowerOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";

import { setAssemblyActiveAction } from "@/app/actions";
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
 * Deactivates a constituency instead of deleting it. Everything stays on the
 * server; PINs stop unlocking the app and phones holding the roll are signed
 * out and wiped the next time they open. Reactivating puts it all back.
 */
export function ConstituencyStatus({
  assemblyId,
  name,
  isActive,
  pinCount,
}: {
  assemblyId: string;
  name: string;
  isActive: boolean;
  pinCount: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const apply = (next: boolean) => {
    startTransition(async () => {
      const result = await setAssemblyActiveAction(assemblyId, next);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success(result.message);
      router.refresh();
    });
  };

  if (!isActive) {
    return (
      <Button variant="outline" size="sm" onClick={() => apply(true)} disabled={pending}>
        <Power className="size-4" />
        {pending ? "Activating…" : "Activate"}
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" className="text-red-600 hover:text-red-700">
          <PowerOff className="size-4" />
          Deactivate
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Deactivate {name}?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="grid gap-2">
              <span>From the moment you confirm:</span>
              <span className="text-foreground">
                · its {pinCount} access PIN{pinCount === 1 ? "" : "s"} stop unlocking the app
                <br />· every phone holding this roll is signed out and its downloaded voter list
                removed the next time the app opens
                <br />· anything on those phones that has not synced is lost
              </span>
              <span>
                Nothing on the server is deleted. Voters, PINs, prints and usage stay, and you can
                activate it again at any time.
              </span>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              apply(false);
            }}
            disabled={pending}
            className="bg-red-600 text-white hover:bg-red-700"
          >
            {pending ? "Deactivating…" : "Deactivate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
