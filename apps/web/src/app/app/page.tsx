import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import Image from "next/image";
import { ChevronRight, ClipboardCheck, Download, Globe, Headset, Printer, ShieldCheck, Smartphone } from "lucide-react";

import { downloadUrl, formatDate, formatSize, getDownloadManifest } from "@/lib/downloads";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Download Booth Help Desk",
  description: "Android app for booth agents: voter search, slips and booth tracking.",
};

export const dynamic = "force-dynamic";

const display = Montserrat({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
});

// Accent colours are the app icon's, as on the login page.
const features = [
  { icon: Headset, label: "Find any voter in seconds", tone: "bg-[#0C4EF0]/25 text-[#B4D0FE]" },
  { icon: Printer, label: "Print slips on a thermal printer", tone: "bg-[#FE900A]/20 text-[#FFB55C]" },
  { icon: ClipboardCheck, label: "Works offline at the booth", tone: "bg-[#0EB89A]/20 text-[#5FE3C8]" },
];

const steps = [
  "Tap Download and wait for the file to finish.",
  "Open Booth-Help-Desk.apk from the notification or your Downloads folder.",
  "If Android asks, allow installing apps from this source (Chrome or Files), then tap Install.",
  "Open the app, sign in with your name and mobile number, and enter the PIN for your constituency.",
];

/** Public: agents open this on their phones. The app only works with a constituency PIN. */
export default async function AppDownloadPage() {
  const manifest = await getDownloadManifest();
  const apk = manifest?.files.android;

  return (
    <main className={cn(display.variable, "min-h-svh bg-[#F6F9FF] text-[#041D7A]")}>
      <div className="mx-auto grid max-w-3xl gap-6 p-4 sm:p-6 lg:py-12">
        <section className="relative isolate overflow-hidden rounded-[28px] bg-[linear-gradient(225deg,#0C4EF0_0%,#041D7A_55%,#01093B_100%)] p-7 text-white sm:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_95%_0%,rgba(79,134,255,0.45)_0%,transparent_70%),radial-gradient(40%_35%_at_0%_100%,rgba(1,9,59,0.8)_0%,transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -bottom-24 -z-10 size-96 rounded-full border-[40px] border-white/5"
          />

          <div className="flex items-center gap-4">
            <Image src="/login/booth-icon.png" alt="" width={64} height={64} unoptimized className="size-16 rounded-2xl" />
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight sm:text-3xl">
                Booth Help Desk
              </h1>
              <p className="text-sm text-white/70">Android app for booth agents</p>
            </div>
          </div>

          <ul className="mt-8 grid gap-3">
            {features.map(({ icon: Icon, label, tone }) => (
              <li key={label} className="flex items-center gap-3">
                <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone)}>
                  <Icon className="size-4" />
                </span>
                <span className="font-medium">{label}</span>
              </li>
            ))}
          </ul>

          {apk ? (
            <div className="mt-9">
              <a
                href={downloadUrl(apk)}
                download
                className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-white text-lg font-bold text-[#041D7A] shadow-[0_12px_30px_-12px_rgba(1,9,59,0.8)] transition-transform active:scale-[0.98] sm:w-auto sm:px-10"
              >
                <Download className="size-5" />
                Download for Android
              </a>
              <p className="mt-3 text-sm text-white/70">
                {[`Version ${manifest!.version}`, formatSize(apk.size), formatDate(manifest!.publishedAt), "Android 7 or later, 64-bit"]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          ) : (
            <p className="mt-9 rounded-2xl bg-white/10 p-4 text-white/80">The app is not available for download yet. Please check back soon.</p>
          )}
        </section>

        {/* iPhones cannot install the Android build; the web app is the same work in Safari. */}
        <a
          href="/web"
          className="flex items-center gap-4 rounded-[28px] bg-white p-6 shadow-[0_1px_0_rgba(4,29,122,0.06)] ring-1 ring-[#E3EAFB] transition-colors hover:bg-[#F4F7FF] sm:px-10"
        >
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#E8EFFF] text-[#0C4EF0]">
            <Globe className="size-6" />
          </span>
          <span className="flex-1">
            <span className="block font-[family-name:var(--font-display)] text-lg font-extrabold">On an iPhone?</span>
            <span className="block text-sm text-[#2B3A67]">Use Booth Help Desk in Safari: search voters, families and booths, and print or share slips. Needs internet.</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-[#637094]" />
        </a>

        <section className="rounded-[28px] bg-white p-7 shadow-[0_1px_0_rgba(4,29,122,0.06)] ring-1 ring-[#E3EAFB] sm:p-10">
          <h2 className="flex items-center gap-2 font-[family-name:var(--font-display)] text-xl font-extrabold">
            <Smartphone className="size-5 text-[#0C4EF0]" /> How to install
          </h2>
          <ol className="mt-6 grid gap-4">
            {steps.map((step, i) => (
              <li key={step} className="flex gap-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#E8EFFF] text-sm font-bold text-[#0C4EF0]">
                  {i + 1}
                </span>
                <p className="pt-1 leading-relaxed text-[#2B3A67]">{step}</p>
              </li>
            ))}
          </ol>
          <p className="mt-6 flex items-start gap-2 rounded-xl bg-[#F6F9FF] p-4 text-sm text-[#2B3A67]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#0EB89A]" />
            Already installed? Installing this over it keeps your data. The app also updates itself when it opens.
          </p>
        </section>

        <footer className="pb-4 text-center text-sm text-[#2B3A67]/70">Booth Help Desk · © {new Date().getFullYear()}</footer>
      </div>
    </main>
  );
}
