import { BottomNav } from "@/app/web/(signed-in)/bottom-nav";
import { requireAgent } from "@/lib/agent-session";

/** Every screen past sign-in: a PIN is required, and the tabs sit at the bottom. */
export default async function SignedInLayout({ children }: LayoutProps<"/web">) {
  await requireAgent();

  return (
    <>
      <div className="pb-[calc(5rem+env(safe-area-inset-bottom))]">{children}</div>
      <BottomNav />
    </>
  );
}
