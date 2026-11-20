import type { Metadata, Viewport } from "next";

/**
 * The voter app for the web, for agents on an iPhone (the phone app is an
 * Android build). Added to the home screen it opens full screen like an app.
 */
export const metadata: Metadata = {
  title: "Booth Help Desk",
  description: "Search voters, booths and families, and print or share voter slips.",
  manifest: "/web.webmanifest",
  appleWebApp: { title: "Help Desk", capable: true, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0C4EF0",
  width: "device-width",
  initialScale: 1,
  // iOS zooms into any field under 16px; every input here is 16px, so the
  // page can still be pinch-zoomed.
  viewportFit: "cover",
};

export default function AgentLayout({ children }: LayoutProps<"/web">) {
  return (
    <div className="min-h-dvh bg-[#F6F9FF] text-[#041D7A] [padding-bottom:env(safe-area-inset-bottom)]">
      <div className="mx-auto min-h-dvh max-w-xl">{children}</div>
    </div>
  );
}
