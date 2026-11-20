"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Select values meaning "every user" and "signed in but no PIN entered yet". */
export const ALL_CONSTITUENCIES = "all";
export const NO_CONSTITUENCY = "none";

/**
 * Narrows the app users to one constituency. Kept in the URL (`?c=`), like
 * the search term, so a filtered list can be reloaded and shared.
 */
export function ConstituencyFilter({
  value,
  options,
}: {
  value: string;
  options: { value: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const onChange = (next: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (next === ALL_CONSTITUENCIES) params.delete("c");
    else params.set("c", next);

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <div className="grid w-full gap-1.5 sm:max-w-xs">
      <Label htmlFor="users-constituency" className="text-muted-foreground text-xs">
        Constituency
      </Label>
      <Select value={value || ALL_CONSTITUENCIES} onValueChange={onChange} disabled={pending}>
        <SelectTrigger id="users-constituency" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
