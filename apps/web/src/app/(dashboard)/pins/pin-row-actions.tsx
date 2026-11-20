"use client";

import { Copy, Power, PowerOff } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { setPinActiveAction } from "@/app/actions";
import { Button } from "@/components/ui/button";

export function PinRowActions({
  id,
  pin,
  isActive,
}: {
  id: string;
  pin: string;
  isActive: boolean;
}) {
  const [pending, startTransition] = useTransition();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(pin);
      toast.success(`Copied ${pin}`);
    } catch {
      toast.error("Could not copy the PIN.");
    }
  };

  const toggle = () => {
    startTransition(async () => {
      const result = await setPinActiveAction(id, !isActive);

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="icon" onClick={copy} aria-label={`Copy ${pin}`}>
        <Copy className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggle}
        disabled={pending}
        aria-label={isActive ? `Deactivate ${pin}` : `Reactivate ${pin}`}
      >
        {isActive ? <PowerOff className="size-4" /> : <Power className="size-4" />}
      </Button>
    </div>
  );
}
