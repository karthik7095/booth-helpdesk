import { Montserrat } from "next/font/google";
import Image from "next/image";
import { redirect } from "next/navigation";
import { ClipboardCheck, Headset, ShieldCheck } from "lucide-react";

import { LoginForm } from "@/app/login/login-form";
import { getToken } from "@/lib/session";
import { cn } from "@/lib/utils";

const display = Montserrat({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-display",
});

// Accent colours are the app icon's: blue badge, orange and teal ticks.
const features = [
  { icon: Headset, label: "Voter help desk", tone: "bg-[#0C4EF0]/25 text-[#B4D0FE]" },
  { icon: ClipboardCheck, label: "Booth tracking", tone: "bg-[#FE900A]/20 text-[#FFB55C]" },
  { icon: ShieldCheck, label: "Secure PIN access", tone: "bg-[#0EB89A]/20 text-[#5FE3C8]" },
];

export default async function LoginPage() {
  if (await getToken()) redirect("/");

  return (
    <main className={cn(display.variable, "min-h-svh bg-[#F6F9FF] text-[#041D7A]")}>
      <div className="mx-auto grid min-h-svh max-w-7xl grid-cols-[minmax(0,1fr)] content-start gap-6 p-4 sm:p-6 lg:grid-cols-[1.1fr_minmax(0,1fr)] lg:content-stretch lg:gap-12 lg:p-8">
        <section className="relative isolate flex flex-col justify-between overflow-hidden rounded-[28px] bg-[linear-gradient(225deg,#0C4EF0_0%,#041D7A_55%,#01093B_100%)] p-8 text-white sm:p-10 lg:p-14">
          {/* Soft light from the top-right, as on the icon. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_95%_0%,rgba(79,134,255,0.45)_0%,transparent_70%),radial-gradient(40%_35%_at_0%_100%,rgba(1,9,59,0.8)_0%,transparent_70%)]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -right-24 -bottom-24 -z-10 size-96 rounded-full border-[40px] border-white/5"
          />

          <div className="flex items-center gap-4">
            <Image
              src="/login/booth-icon.png"
              alt=""
              width={56}
              height={56}
              className="size-14 rounded-2xl shadow-lg ring-1 ring-white/20"
            />
            <span className="font-display text-xl font-extrabold tracking-tight">Booth Help Desk</span>
          </div>

          <div className="my-10 lg:my-0">
            <Image
              src="/login/booth-logo.png"
              alt=""
              aria-hidden
              width={620}
              height={790}
              priority
              className="mb-8 hidden w-32 drop-shadow-[0_20px_40px_rgba(1,9,59,0.5)] lg:block"
            />
            <div>
              <h1 className="font-display text-[clamp(36px,4.6vw,60px)] leading-[1.02] font-extrabold tracking-tight">
                Every voter,
                <br />
                <span className="text-[#B4D0FE]">the right booth.</span>
              </h1>
              <p className="mt-5 max-w-md text-lg leading-snug text-white/70">
                Manage constituencies, issue access PINs and follow booth work as it happens.
              </p>
            </div>
          </div>

          <ul className="grid gap-3 sm:grid-cols-3">
            {features.map(({ icon: Icon, label, tone }) => (
              <li
                key={label}
                className="flex items-center gap-3 rounded-2xl bg-white/[0.06] p-3 ring-1 ring-white/10 backdrop-blur-sm"
              >
                <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", tone)}>
                  <Icon className="size-5" strokeWidth={2.2} />
                </span>
                <span className="text-sm leading-tight font-medium text-white/90">{label}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="flex items-center justify-center lg:justify-end">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
