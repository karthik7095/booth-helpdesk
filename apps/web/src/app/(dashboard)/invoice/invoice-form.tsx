"use client";

import { Plus, Printer, Trash2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Item = { description: string; qty: string; unitPrice: string; taxPercent: string };

const BLANK: Item = { description: "", qty: "1", unitPrice: "0", taxPercent: "0" };

const num = (value: string) => {
  const parsed = Number.parseFloat(value);

  return Number.isFinite(parsed) ? parsed : 0;
};

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Area({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="border-input bg-transparent placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 w-full rounded-md border px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
      />
    </div>
  );
}

export function InvoiceForm() {
  const logoRef = useRef<HTMLInputElement>(null);

  const [currency, setCurrency] = useState("USD");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [issued, setIssued] = useState("");
  const [due, setDue] = useState("");

  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [taxIdLabel, setTaxIdLabel] = useState("IN GST");
  const [taxId, setTaxId] = useState("");

  const [toName, setToName] = useState("");
  const [toAddress, setToAddress] = useState("");
  const [toEmail, setToEmail] = useState("");

  const [memo, setMemo] = useState("");
  const [payUrl, setPayUrl] = useState("");
  const [taxLabel, setTaxLabel] = useState("IGST - India");
  const [taxNote, setTaxNote] = useState("");
  const [logo, setLogo] = useState<string | null>(null);

  const [items, setItems] = useState<Item[]>([{ ...BLANK }]);

  const money = useMemo(() => {
    // Falls back to plain grouping if the code is not a real ISO currency, so a
    // typo never blanks the whole invoice.
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency });
    } catch {
      return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2 });
    }
  }, [currency]);

  const fmt = (value: number) => money.format(value);

  const date = (value: string) => {
    if (!value) return "—";

    const parsed = new Date(`${value}T00:00:00`);

    return Number.isNaN(parsed.getTime())
      ? value
      : parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  };

  const lines = items.map((item) => {
    const amount = num(item.qty) * num(item.unitPrice);

    return { ...item, amount, tax: (amount * num(item.taxPercent)) / 100 };
  });

  const subtotal = lines.reduce((sum, line) => sum + line.amount, 0);

  // One row per distinct rate: a single "Tax" line would be wrong the moment
  // two items are taxed differently.
  const taxGroups = Object.values(
    lines.reduce<Record<string, { percent: number; base: number; amount: number }>>(
      (groups, line) => {
        const percent = num(line.taxPercent);

        if (percent === 0) return groups;

        const key = String(percent);
        const group = groups[key] ?? { percent, base: 0, amount: 0 };

        return {
          ...groups,
          [key]: { percent, base: group.base + line.amount, amount: group.amount + line.tax },
        };
      },
      {},
    ),
  ).sort((a, b) => a.percent - b.percent);

  const taxTotal = taxGroups.reduce((sum, group) => sum + group.amount, 0);
  const total = subtotal + taxTotal;

  const setItem = (index: number, patch: Partial<Item>) =>
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  const readLogo = (file: File) => {
    const reader = new FileReader();

    reader.onload = () => setLogo(String(reader.result));
    reader.readAsDataURL(file);
  };

  const addressLines = (value: string) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  return (
    <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
      {/* ---------------- inputs ---------------- */}
      <div className="grid gap-4 print:hidden">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Invoice details</CardTitle>
            <Button size="sm" onClick={() => window.print()}>
              <Printer className="size-4" />
              Save as PDF
            </Button>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Invoice number" value={invoiceNumber} onChange={setInvoiceNumber} placeholder="BAFBB58A-0001" />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of issue" type="date" value={issued} onChange={setIssued} />
              <Field label="Date due" type="date" value={due} onChange={setDue} />
            </div>
            <Field label="Currency (ISO code)" value={currency} onChange={(v) => setCurrency(v.toUpperCase())} placeholder="USD" />
            <Field label="Memo" value={memo} onChange={setMemo} placeholder="Manual purchase" />
            <Field label="Pay online link (optional)" value={payUrl} onChange={setPayUrl} placeholder="https://…" />

            <input
              ref={logoRef}
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) readLogo(file);
              }}
            />
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => logoRef.current?.click()}>
                <Upload className="size-4" />
                {logo ? "Replace logo" : "Add logo"}
              </Button>
              {logo ? (
                <Button variant="ghost" size="sm" onClick={() => setLogo(null)}>
                  Remove
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">From</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Name" value={fromName} onChange={setFromName} placeholder="OpenAI OpCo, LLC" />
            <Area label="Address" value={fromAddress} onChange={setFromAddress} placeholder={"1455 3rd Street\nSan Francisco, California 94158\nUnited States"} />
            <Field label="Email" value={fromEmail} onChange={setFromEmail} />
            <div className="grid grid-cols-[110px_1fr] gap-3">
              <Field label="Tax ID label" value={taxIdLabel} onChange={setTaxIdLabel} />
              <Field label="Tax ID" value={taxId} onChange={setTaxId} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bill to</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Name" value={toName} onChange={setToName} />
            <Area label="Address" value={toAddress} onChange={setToAddress} />
            <Field label="Email" value={toEmail} onChange={setToEmail} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Items</CardTitle>
            <Button variant="outline" size="sm" onClick={() => setItems((c) => [...c, { ...BLANK }])}>
              <Plus className="size-4" />
              Add
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4">
            {items.map((item, index) => (
              <div key={index} className="grid gap-2 rounded-md border p-3">
                <Area label="Description" rows={2} value={item.description} onChange={(v) => setItem(index, { description: v })} />
                <div className="grid grid-cols-3 gap-2">
                  <Field label="Qty" value={item.qty} onChange={(v) => setItem(index, { qty: v })} />
                  <Field label="Unit price" value={item.unitPrice} onChange={(v) => setItem(index, { unitPrice: v })} />
                  <Field label="Tax %" value={item.taxPercent} onChange={(v) => setItem(index, { taxPercent: v })} />
                </div>
                {items.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-self-end"
                    onClick={() => setItems((c) => c.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
            ))}
            <Field label="Tax row label" value={taxLabel} onChange={setTaxLabel} placeholder="IGST - India" />
            <Field label="Tax note (optional)" value={taxNote} onChange={setTaxNote} placeholder="(₹172.27)" />
          </CardContent>
        </Card>
      </div>

      {/* ---------------- the invoice itself ---------------- */}
      <div className="flex justify-center">
        <div
          id="invoice-sheet"
          className="w-full max-w-[820px] bg-white p-12 text-[15px] leading-6 text-black shadow-sm print:max-w-none print:p-0 print:shadow-none"
        >
          <div className="flex items-start justify-between">
            <h1 className="text-4xl font-bold tracking-tight">Invoice</h1>
            {logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="" className="h-14 w-auto object-contain" />
            ) : null}
          </div>

          <table className="mt-6 border-separate border-spacing-x-4 border-spacing-y-0 text-[15px]">
            <tbody>
              <tr>
                <td className="font-semibold">Invoice number</td>
                <td className="font-semibold">{invoiceNumber || "—"}</td>
              </tr>
              <tr>
                <td className="font-semibold">Date of issue</td>
                <td className="font-semibold">{date(issued)}</td>
              </tr>
              <tr>
                <td className="font-semibold">Date due</td>
                <td className="font-semibold">{date(due)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-10 grid grid-cols-2 gap-10">
            <div>
              <p className="font-semibold">{fromName || "—"}</p>
              {addressLines(fromAddress).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {fromEmail ? <p>{fromEmail}</p> : null}
              {taxId ? (
                <p className="mt-4">
                  {taxIdLabel} {taxId}
                </p>
              ) : null}
            </div>
            <div>
              <p className="font-semibold">Bill to</p>
              <p>{toName || "—"}</p>
              {addressLines(toAddress).map((line) => (
                <p key={line}>{line}</p>
              ))}
              {toEmail ? <p>{toEmail}</p> : null}
            </div>
          </div>

          <h2 className="mt-12 text-2xl font-bold">
            {fmt(total)} {currency} due {date(due)}
          </h2>

          {payUrl ? (
            <p className="mt-4">
              <a href={payUrl} className="font-medium text-indigo-600 underline">
                Pay online
              </a>
            </p>
          ) : null}

          {memo ? <p className="mt-5">{memo}</p> : null}

          <table className="mt-12 w-full text-[15px]">
            <thead>
              <tr className="border-b border-black text-[13px]">
                <th className="pb-2 text-left font-normal">Description</th>
                <th className="pb-2 text-right font-normal">Qty</th>
                <th className="pb-2 text-right font-normal">Unit price</th>
                <th className="pb-2 text-right font-normal">Tax</th>
                <th className="pb-2 text-right font-normal">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => (
                <tr key={index}>
                  <td className="py-3 pr-6 align-top">{line.description || "—"}</td>
                  <td className="py-3 text-right align-top tabular-nums">{line.qty}</td>
                  <td className="py-3 text-right align-top tabular-nums">{fmt(num(line.unitPrice))}</td>
                  <td className="py-3 text-right align-top tabular-nums">{num(line.taxPercent)}%</td>
                  <td className="py-3 text-right align-top tabular-nums">{fmt(line.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end">
            <table className="w-[58%] text-[15px]">
              <tbody>
                <tr className="border-t">
                  <td className="py-2">Subtotal</td>
                  <td className="py-2 text-right tabular-nums">{fmt(subtotal)}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-2">Total excluding tax</td>
                  <td className="py-2 text-right tabular-nums">{fmt(subtotal)}</td>
                </tr>
                {taxGroups.map((group) => (
                  <tr key={group.percent} className="border-t">
                    <td className="py-2">
                      {taxLabel} ({group.percent}% on {fmt(group.base)})
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {fmt(group.amount)}
                      {taxNote ? <div className="text-black">{taxNote}</div> : null}
                    </td>
                  </tr>
                ))}
                <tr className="border-t">
                  <td className="py-2">Total</td>
                  <td className="py-2 text-right tabular-nums">{fmt(total)}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-2 font-semibold">Amount due</td>
                  <td className="py-2 text-right font-semibold tabular-nums">
                    {fmt(total)} {currency}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
