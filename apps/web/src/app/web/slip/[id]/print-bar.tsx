"use client";

import { ArrowLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useRef, useTransition } from "react";

import { recordPrintAction } from "@/app/web/actions";
import { primaryButton } from "@/components/agent/ui";
import { cn } from "@/lib/utils";

/**
 * Opens the print dialog (AirPrint on an iPhone). The slip is logged the first
 * time, the way the phone logs its dialog prints: the browser cannot say
 * whether a page actually came out.
 */
export function PrintBar({ back, voters }: { back: string; voters: { id: string; partNo: number }[] }) {
  const recorded = useRef(false);
  const [, start] = useTransition();

  const print = () => {
    if (!recorded.current) {
      recorded.current = true;
      start(() => recordPrintAction(voters));
    }
    window.print();
  };

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#DBE3F3] bg-white px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] print:hidden">
      <Link href={back} aria-label="Go back" className="-ml-2 grid size-11 place-items-center rounded-xl text-[#041D7A] hover:bg-[#EEF3FF]">
        <ArrowLeft className="size-6" />
      </Link>
      <p className="min-w-0 flex-1 truncate font-bold text-[#041D7A]">{voters.length > 1 ? `${voters.length} slips` : "Voter slip"}</p>
      <button type="button" onClick={print} className={cn(primaryButton, "w-auto shrink-0")}>
        <Printer className="size-5" />
        Print
      </button>
    </div>
  );
}
