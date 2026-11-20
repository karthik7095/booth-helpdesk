import Link from "next/link";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "Overview", path: "" },
  { key: "war-room", label: "War room", path: "/war-room" },
] as const;

/** The constituency's sections, under its header. */
export function ConstituencyTabs({
  id,
  active,
}: {
  id: string;
  active: (typeof TABS)[number]["key"];
}) {
  return (
    <nav aria-label="Constituency" className="flex gap-1 border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={`/constituencies/${id}${tab.path}`}
          aria-current={tab.key === active ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            tab.key === active
              ? "border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground border-transparent",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
