import type { Metadata } from "next";
import { headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  History,
  ScanText,
  ShieldCheck,
  WifiOff,
} from "lucide-react";

import {
  downloadUrl,
  formatDate,
  formatSize,
  getDownloadManifest,
  type DownloadPlatform,
} from "@/lib/downloads";
import { getToken } from "@/lib/session";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Download Voter Roll Converter",
  description: "Desktop app that converts electoral roll PDFs into Excel voter lists, on your own computer.",
};

export const dynamic = "force-dynamic";

const platformInfo: Record<Exclude<DownloadPlatform, "android">, { name: string; chip: string; requirement: string; ext: string; note: string }> = {
  mac: {
    name: "macOS",
    chip: "Apple silicon",
    requirement: "macOS 12 or later",
    ext: ".dmg",
    note: "First launch on macOS: if it says the developer cannot be verified, open System Settings › Privacy & Security, scroll down and click Open Anyway.",
  },
  win: {
    name: "Windows",
    chip: "64-bit",
    requirement: "Windows 10 or 11",
    ext: ".exe",
    note: "First launch on Windows: if SmartScreen appears, click More info, then Run anyway.",
  },
};

const features = [
  {
    icon: ScanText,
    title: "Reads any roll",
    text: "Scanned Marathi assembly rolls and Telugu municipal ward lists are recognised automatically and read with on-device OCR.",
  },
  {
    icon: FileSpreadsheet,
    title: "Clean Excel out",
    text: "One row per voter: serial, EPIC, name, relation, house, age, gender, with English transliteration, plus a review sheet of rows worth a second look.",
  },
  {
    icon: ShieldCheck,
    title: "Checked against the cover",
    text: "Serial numbers are rebuilt from box order and totals are verified against the roll's cover page, so a misread digit never shifts the list.",
  },
  {
    icon: History,
    title: "Every run on record",
    text: "A searchable history of every conversion with voters, duration and status, and one click to reopen the Excel or retry a file.",
  },
  {
    icon: WifiOff,
    title: "Nothing leaves the machine",
    text: "The roll and the voter data stay on the computer. Only the licence check talks to the server.",
  },
  {
    icon: Download,
    title: "Licensed per computer",
    text: "Each installation is activated with a code you issue, and can be paused or revoked from the dashboard at any time.",
  },
];

export default async function DownloadPage() {
  // Public: anyone can download the app; it only works with an activation code.
  // Signed-in admins also get links back into the dashboard.
  const signedIn = Boolean(await getToken());
  const manifest = await getDownloadManifest();
  const mac = manifest?.files.mac;
  const win = manifest?.files.win;
  // Lead with the installer for the visitor's own computer; the other platform is one link away.
  const agent = (await headers()).get("user-agent") ?? "";
  const visitorPlatform: "mac" | "win" = /Windows/i.test(agent) ? "win" : "mac";
  const primary: "mac" | "win" = manifest?.files[visitorPlatform] ? visitorPlatform : mac ? "mac" : "win";
  const primaryFile = primary === "mac" ? mac : win;
  const secondary: "mac" | "win" = primary === "mac" ? "win" : "mac";
  const secondaryFile = secondary === "mac" ? mac : win;

  return (
    <main className="min-h-svh bg-white text-slate-900">
      {/* ---------- hero */}
      <section className="relative overflow-hidden bg-[#0b3a3a] text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_80%_20%,#145c5c_0%,transparent_60%),radial-gradient(40%_50%_at_10%_100%,#0f4f4f_0%,transparent_60%)]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-40 -bottom-56 size-[520px] rounded-full bg-[#124a4a]"
        />

        <div className="relative mx-auto max-w-7xl px-6 lg:px-12">
          <header className="flex items-center justify-between gap-6 py-7">
            <span className="flex items-center gap-3 text-lg font-semibold tracking-tight">
              <Image
                src="/download/app-icon.png"
                alt=""
                width={44}
                height={44}
                unoptimized
                className="-m-1 size-11"
              />
              Voter Roll Converter
            </span>
            {signedIn ? (
              <Link
                href="/"
                className="inline-flex h-10 items-center gap-2 rounded-md border border-white/40 px-4 text-sm font-semibold tracking-wide uppercase transition-colors hover:bg-white/10"
              >
                Back to dashboard <ArrowRight className="size-4" />
              </Link>
            ) : null}
          </header>

          <div className="grid items-center gap-12 pt-6 pb-24 lg:grid-cols-[0.95fr_1.25fr] lg:gap-10 lg:pt-10 lg:pb-32">
            <div>
              <h1 className="text-[clamp(44px,6vw,76px)] leading-[1.02] font-extrabold tracking-tight text-balance">
                Voter Roll Converter for desktop
              </h1>
              <p className="mt-6 max-w-md text-xl leading-relaxed text-white/85">
                Turn an electoral roll PDF into a clean Excel voter list in a couple of minutes, entirely
                on your own computer.
              </p>

              <div className="mt-9">
                {primaryFile ? (
                  <a
                    href={downloadUrl(primaryFile)}
                    download
                    className="inline-flex h-14 items-center gap-3 rounded-md bg-white px-8 text-sm font-bold tracking-[0.12em] text-[#0b3a3a] uppercase shadow-[0_18px_40px_-16px_rgba(0,0,0,0.6)] transition-colors hover:bg-[#e3f4f4]"
                  >
                    <Download className="size-5" />
                    Download for {platformInfo[primary].name} ({platformInfo[primary].chip})
                  </a>
                ) : (
                  <span className="inline-flex h-14 items-center rounded-md bg-white/15 px-8 text-sm font-bold tracking-[0.12em] uppercase">
                    Installer not published yet
                  </span>
                )}
              </div>
              {primaryFile ? (
                <p className="mt-3 text-sm text-white/70">
                  {platformInfo[primary].ext} · {formatSize(primaryFile.size)} · {platformInfo[primary].requirement}
                </p>
              ) : null}

              <p className="mt-10 text-lg text-white/85">
                Also for{" "}
                {secondaryFile ? (
                  <a href={downloadUrl(secondaryFile)} download className="font-semibold underline underline-offset-4">
                    {platformInfo[secondary].name}
                  </a>
                ) : (
                  <span className="font-semibold">{platformInfo[secondary].name} (coming soon)</span>
                )}
                .
              </p>
            </div>

            {/* app screenshot in a window frame */}
            <div className="relative lg:-mr-24 lg:-mb-40">
              <div className="overflow-hidden rounded-2xl bg-[#1c2a2a] shadow-[0_40px_80px_-30px_rgba(0,0,0,0.7)] ring-1 ring-white/15">
                <div className="flex items-center gap-2 bg-[#243535] px-4 py-3">
                  <span className="size-3 rounded-full bg-[#ff5f57]" />
                  <span className="size-3 rounded-full bg-[#febc2e]" />
                  <span className="size-3 rounded-full bg-[#28c840]" />
                  <Image src="/download/app-icon.png" alt="" width={16} height={16} unoptimized className="ml-3 size-4" />
                  <span className="text-xs font-medium text-white/60">Voter Roll Converter</span>
                </div>
                <Image
                  src="/download/app-screenshot.png"
                  alt="Voter Roll Converter converting a roll, with the conversion history below"
                  width={2280}
                  height={2168}
                  unoptimized
                  priority
                  className="block h-auto w-full"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- version strip */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-6 py-6 text-sm lg:px-12">
          {manifest ? (
            <>
              <span className="font-bold tracking-wide uppercase">
                Version {manifest.version}
                <span className="font-normal text-slate-500 normal-case"> · published {formatDate(manifest.publishedAt)}</span>
              </span>
              {(["mac", "win"] as const).map((p) => {
                const f = manifest.files[p];
                return f ? (
                  <a key={p} href={downloadUrl(f)} download className="inline-flex items-center gap-1.5 font-medium underline underline-offset-4 hover:text-[#0f6e6e]">
                    Download for {platformInfo[p].name} ({platformInfo[p].chip}) <Download className="size-4" />
                    <span className="text-slate-500 no-underline">{formatSize(f.size)}</span>
                  </a>
                ) : (
                  <span key={p} className="text-slate-400">
                    {platformInfo[p].name}: coming soon
                  </span>
                );
              })}
            </>
          ) : (
            <span className="text-slate-500">
              {signedIn ? (
                <>No installers have been staged yet. Run <code className="rounded bg-slate-100 px-1.5 py-0.5">npm run desktop:stage</code> and deploy.</>
              ) : (
                "Installers are not available yet. Please check back soon."
              )}
            </span>
          )}
        </div>
      </section>

      {/* ---------- features */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-12">
        <h2 className="text-3xl font-extrabold tracking-tight text-balance">Built for polling-day deadlines</h2>
        <p className="mt-3 max-w-2xl text-lg text-slate-600">
          A 42-page assembly part takes about two minutes; an 85-page municipal ward list about five.
        </p>
        <ul className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <li key={title} className="grid gap-3">
              <span className="grid size-11 place-items-center rounded-xl bg-[#e3f4f4] text-[#0f6e6e]">
                <Icon className="size-5" />
              </span>
              <h3 className="text-lg font-semibold">{title}</h3>
              <p className="leading-relaxed text-slate-600">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------- second visual */}
      <section className="bg-[#f5fbfb]">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-20 lg:grid-cols-2 lg:px-12">
          <div className="overflow-hidden rounded-2xl shadow-[0_30px_60px_-30px_rgba(15,110,110,0.45)] ring-1 ring-[#d7e6e6]">
            <Image
              src="/download/app-cards.png"
              alt="A roll being converted with live progress, and another waiting in the queue"
              width={2280}
              height={607}
              unoptimized
              className="block h-auto w-full"
            />
          </div>
          <div>
            <h2 className="text-3xl font-extrabold tracking-tight text-balance">Drop the PDFs, press Convert</h2>
            <p className="mt-4 text-lg leading-relaxed text-slate-600">
              Queue as many parts as you like. Each file shows its page progress, voters found so far and
              elapsed time, then the voter count checked against the cover page, the number of rows to
              review, and buttons to open the Excel or save a copy elsewhere.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- install notes */}
      <section className="mx-auto max-w-7xl px-6 py-20 lg:px-12">
        <h2 className="text-3xl font-extrabold tracking-tight">Installing and activating</h2>
        <ol className="mt-8 grid gap-4 sm:grid-cols-3">
          {[
            "Download the installer for the computer's platform and open it. Drag the app to Applications on macOS, or run the setup on Windows.",
            "On first launch the app asks for an activation code. Issue one from Desktop licences in the dashboard; each code allows a set number of computers.",
            "The app verifies its licence every time it opens and before every conversion, so it needs an internet connection; conversions themselves run offline.",
          ].map((step, i) => (
            <li key={step} className="rounded-2xl border border-slate-200 p-6">
              <span className="text-sm font-bold text-[#0f6e6e]">Step {i + 1}</span>
              <p className="mt-2 leading-relaxed text-slate-700">{step}</p>
            </li>
          ))}
        </ol>
        <div className={cn("mt-8 grid gap-3 text-sm text-slate-600 sm:grid-cols-2")}>
          <p className="rounded-xl bg-slate-50 p-4">{platformInfo.mac.note}</p>
          <p className="rounded-xl bg-slate-50 p-4">{platformInfo.win.note}</p>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-slate-500 lg:px-12">
          <span>Voter Roll Converter · © {new Date().getFullYear()}</span>
          {signedIn ? (
            <Link href="/devices" className="font-medium text-[#0f6e6e] hover:underline">
              Manage licences
            </Link>
          ) : (
            <span>Activation codes are issued by IRA Media Concepts.</span>
          )}
        </div>
      </footer>
    </main>
  );
}
