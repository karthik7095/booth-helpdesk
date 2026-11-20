"use client";

import { Building2, Home, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { href: "/web", label: "Home", icon: Home, match: (path: string) => path === "/web" },
  { href: "/web/search", label: "Search", icon: Search, match: (path: string) => path.startsWith("/web/search") },
  { href: "/web/booths", label: "Booths", icon: Building2, match: (path: string) => path.startsWith("/web/booths") },
];

export function BottomNav() {
  const path = usePathname();

  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[#DBE3F3] bg-white pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto grid max-w-xl grid-cols-3">
        {TABS.map(({ href, label, icon: Icon, match }) => {
          const active = match(path);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-xs font-semibold",
                active ? "text-[#0C4EF0]" : "text-[#637094]",
              )}
            >
              <Icon className="size-6" strokeWidth={active ? 2.4 : 2} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
