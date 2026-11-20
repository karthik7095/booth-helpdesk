"use client";

import { Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SearchInput({
  initial,
  placeholder,
  label,
}: {
  initial: string;
  placeholder: string;
  label: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initial);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = (term: string) => {
    const params = new URLSearchParams(searchParams.toString());

    if (term.trim()) params.set("q", term.trim());
    else params.delete("q");

    // A new search always starts from the first page.
    params.delete("page");

    startTransition(() => {
      // Keep the scroll position: the results are right under the box.
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  };

  const onChange = (term: string) => {
    setValue(term);

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => run(term), 350);
  };

  return (
    <div className="relative w-full sm:max-w-sm">
      <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="pl-9"
        aria-label={label}
      />
      {value ? (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-1/2 right-1 size-7 -translate-y-1/2"
          onClick={() => {
            setValue("");
            run("");
          }}
          aria-label="Clear search"
        >
          <X className="size-4" />
        </Button>
      ) : null}
      {pending ? (
        <span className="text-muted-foreground absolute -bottom-5 left-0 text-xs">Searching…</span>
      ) : null}
    </div>
  );
}
