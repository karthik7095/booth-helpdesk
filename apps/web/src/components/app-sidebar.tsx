"use client";

import type { AdminUser } from "@voter/shared";
import { useState, useTransition } from "react";

import {
  Activity,
  BarChart3,
  KeyRound,
  LayoutDashboard,
  LogOut,
  MapPinned,
  Users,
  MonitorSmartphone,
  Download,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { logoutAction } from "@/app/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

export const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/constituencies", label: "Constituencies", icon: MapPinned },
  { href: "/pins", label: "Access PINs", icon: KeyRound },
  { href: "/users", label: "App Users", icon: Users },
  { href: "/usage", label: "Usage", icon: Activity },
  { href: "/stats", label: "Stats", icon: BarChart3 },
] as const;

/** Only the developer sees licence management. */
const developerItems = [
  { href: "/devices", label: "Desktop licences", icon: MonitorSmartphone },
  { href: "/download", label: "App downloads", icon: Download },
] as const;

/**
 * A constituency admin gets a dashboard of its one constituency's turnout and
 * printing, then that constituency's roll, its PINs, app users and usage.
 */
export function navItemsFor(admin: AdminUser) {
  if (admin.role === "developer") return [...navItems, ...developerItems];
  if (admin.role !== "constituency_admin" || !admin.assemblyId) return navItems;

  return [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    {
      href: `/constituencies/${admin.assemblyId}`,
      label: admin.assemblyName ?? "Constituency",
      icon: MapPinned,
    },
    ...navItems.filter((item) => ["/pins", "/users", "/usage"].includes(item.href)),
  ];
}

export function AppSidebar({ admin }: { admin: AdminUser }) {
  const { email } = admin;
  const items = navItemsFor(admin);
  const home = items[0]?.href ?? "/";
  const pathname = usePathname();
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href={home}>
                <Image
                  src="/login/booth-icon.png"
                  alt=""
                  width={32}
                  height={32}
                  className="aspect-square size-8 rounded-lg"
                />
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium">Booth Help Desk</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {admin.role === "developer"
                      ? "Developer"
                      : admin.role === "super_admin"
                        ? "Super admin"
                      : `${admin.assemblyName ?? "Constituency"} admin`}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Manage</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    tooltip={item.label}
                    className="data-[active=true]:bg-black data-[active=true]:text-white data-[active=true]:hover:bg-black data-[active=true]:hover:text-white [&>svg]:data-[active=true]:text-white"
                    // "/" would otherwise light up on every route.
                    isActive={
                      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
                    }
                  >
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <div className="bg-sidebar-accent text-sidebar-accent-foreground flex aspect-square size-8 items-center justify-center rounded-full text-xs font-medium uppercase">
                {email.slice(0, 2)}
              </div>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">Signed in</span>
                <span className="text-muted-foreground truncate text-xs">{email}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>

          <SidebarMenuItem>
            <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
              <AlertDialogTrigger asChild>
                <SidebarMenuButton tooltip="Sign out" className="w-full">
                  <LogOut />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Sign out of the dashboard?</AlertDialogTitle>
                  <AlertDialogDescription>
                    You are signed in as {email}. You will need the admin password to get back in.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={pending}
                    onClick={(event) => {
                      event.preventDefault();
                      startTransition(() => logoutAction());
                    }}
                  >
                    {pending ? "Signing out…" : "Sign out"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
