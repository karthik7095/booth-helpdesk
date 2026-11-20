"use client";

import type { AdminUser } from "@voter/shared";
import { usePathname } from "next/navigation";

import { navItemsFor } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";

export function PageBreadcrumb({ admin }: { admin: AdminUser }) {
  const pathname = usePathname();
  const current = navItemsFor(admin).find((item) =>
    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
  );

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbPage>{current?.label ?? "Dashboard"}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}
