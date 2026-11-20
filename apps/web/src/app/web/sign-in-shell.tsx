import type { ReactNode } from "react";

import { card, muted } from "@/components/agent/ui";

/** The frame of the three sign-in steps. */
export function SignInShell({ step, title, hint, children }: { step: string; title: string; hint: string; children: ReactNode }) {
  return (
    <main className="grid min-h-dvh content-center gap-6 px-5 py-10">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a fixed 48px icon from public/ */}
        <img src="/web-icon.png" alt="" width={48} height={48} className="size-12 rounded-xl" />
        <div>
          <p className={`text-xs font-semibold tracking-wider uppercase ${muted}`}>{step}</p>
          <h1 className="text-2xl font-bold">{title}</h1>
        </div>
      </div>
      <p className={muted}>{hint}</p>
      <div className={`${card} p-5`}>{children}</div>
    </main>
  );
}
