import { AppSidebar } from "@/components/app-sidebar";
import { PageBreadcrumb } from "@/components/page-breadcrumb";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { requireAdmin } from "@/lib/session";

export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const { admin } = await requireAdmin();

  return (
    <TooltipProvider>
      <SidebarProvider>
        <AppSidebar admin={admin} />
        <SidebarInset>
          <header className="bg-background sticky top-0 z-10 flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
            <PageBreadcrumb admin={admin} />
          </header>

          <div className="flex-1 p-6">{children}</div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
