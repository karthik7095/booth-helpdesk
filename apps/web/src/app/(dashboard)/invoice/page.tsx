import { InvoiceForm } from "@/app/(dashboard)/invoice/invoice-form";
import { requireSuperAdmin } from "@/lib/session";

export default async function InvoicePage() {
  await requireSuperAdmin();

  return <InvoiceForm />;
}
