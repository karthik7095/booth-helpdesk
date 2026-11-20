import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * The web app's look, taken from the Booth Help Desk app's theme
 * (apps/mobile/src/global.css): blue primary, navy text, soft cards.
 * Inputs are 16px so iOS does not zoom into them.
 */
export const field =
  "h-12 w-full rounded-xl border border-[#DBE3F3] bg-white px-4 text-base text-[#041D7A] outline-none placeholder:text-[#637094] focus:border-[#0C4EF0] focus:ring-2 focus:ring-[#0C4EF0]/20";

export const primaryButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#0C4EF0] px-4 text-base font-semibold text-white transition-colors hover:bg-[#0A3FC4] disabled:opacity-60";

export const secondaryButton =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-[#DBE3F3] bg-white px-4 text-base font-semibold text-[#041D7A] transition-colors hover:bg-[#EEF3FF] disabled:opacity-60";

export const card = "rounded-2xl border border-[#DBE3F3] bg-white";

export const muted = "text-[#637094]";

/** The bar at the top of a screen, with a back link when there is somewhere to go back to. */
export function ScreenHeader({ title, subtitle, back, action }: { title: string; subtitle?: string; back?: string; action?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-[#DBE3F3] bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
      {back ? (
        <Link href={back} aria-label="Go back" className="-ml-2 grid size-11 place-items-center rounded-xl hover:bg-[#EEF3FF]">
          <ArrowLeft className="size-6" />
        </Link>
      ) : null}
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-lg font-bold">{title}</h1>
        {subtitle ? <p className={cn("truncate text-xs", muted)}>{subtitle}</p> : null}
      </div>
      {action}
    </header>
  );
}

/** Previous / Next between pages of a long list. */
export function Pager({ page, pages, href }: { page: number; pages: number; href: (page: number) => string }) {
  if (pages <= 1) return null;

  return (
    <nav aria-label="Pages" className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      {page > 1 ? (
        <Link href={href(page - 1)} className={secondaryButton}>
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className={cn("text-sm", muted)}>
        {page} / {pages}
      </span>
      {page < pages ? (
        <Link href={href(page + 1)} className={secondaryButton}>
          Next
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function Notice({ tone, children }: { tone: "error" | "ok"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-xl px-4 py-3 text-sm",
        tone === "error" ? "bg-[#FDECEC] text-[#9F1C1C]" : "bg-[#E7F7EE] text-[#17663D]",
      )}
    >
      {children}
    </p>
  );
}
