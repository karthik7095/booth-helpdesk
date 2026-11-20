"use client";

import type { VoterSort } from "@voter/shared";
import { ArrowDown, ArrowUp, ArrowUpDown, X } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableHead } from "@/components/ui/table";
import { useVoterParams } from "@/components/voter-filters";
import { PAGE_SIZES } from "@/lib/voter-table";

/**
 * A column header that sorts the roll. The arrow shows the current order;
 * the menu offers ascending, descending, or the roll's own order again.
 */
export function SortableHead({
  column,
  label,
  sort,
  dir,
  className,
}: {
  column: VoterSort;
  label: string;
  sort: string;
  dir: string;
  className?: string;
}) {
  const { apply, pending } = useVoterParams();
  const active = sort === column;
  const Arrow = active ? (dir === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;

  return (
    <TableHead className={className}>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={`-ml-2 inline-flex h-8 items-center gap-1 rounded-md px-2 text-left hover:bg-muted ${
            active ? "text-foreground" : ""
          }`}
          disabled={pending}
          aria-label={`Sort by ${label}`}
        >
          {label}
          <Arrow className={`size-3.5 ${active ? "" : "text-muted-foreground/60"}`} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => apply({ sort: column, dir: "asc" })}>
            <ArrowUp className="size-4" />
            Asc
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => apply({ sort: column, dir: "desc" })}>
            <ArrowDown className="size-4" />
            Desc
          </DropdownMenuItem>
          {active ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => apply({ sort: "", dir: "" })}>
                <X className="size-4" />
                Roll order
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </TableHead>
  );
}

/** Rows per page, in the table footer. */
export function RowsPerPage({ limit }: { limit: number }) {
  const { apply, pending } = useVoterParams();

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-sm">Rows per page</span>
      <Select
        value={String(limit)}
        onValueChange={(value) => apply({ limit: value })}
        disabled={pending}
      >
        <SelectTrigger className="h-8 w-20" aria-label="Rows per page">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((size) => (
            <SelectItem key={size} value={String(size)}>
              {size}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
