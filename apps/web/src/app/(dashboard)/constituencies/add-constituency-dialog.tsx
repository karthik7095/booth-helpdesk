"use client";

import {
  createConstituencyAdminRequestSchema,
  type Assembly,
  type ImportResult,
} from "@voter/shared";
import {
  AlertTriangle,
  FileSpreadsheet,
  ImageIcon,
  Plus,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  AdminFields,
  emptyAdminFields,
} from "@/app/(dashboard)/constituencies/[id]/admins-card";
import { createConstituencyAdminAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  parseSheet,
  parseWorkbook,
  type ParsedRoll,
  type SheetSummary,
} from "@/lib/parse-roll";

/** Rows per request — large enough to be quick, small enough for one body. */
const CHUNK_SIZE = 2500;
const PAGE_SIZE = 10;

/** "Gandhinagar South" -> "GS"; the code is what makes PINs readable. */
function generateCode(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();

  if (initials.length >= 2) return initials.slice(0, 4);

  return name.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 2).padEnd(2, "X");
}

function cell(value: unknown) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

export function AddConstituencyDialog() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [assemblyNo, setAssemblyNo] = useState("");
  const [code, setCode] = useState("");
  const [codeEdited, setCodeEdited] = useState(false);
  const [stateCode, setStateCode] = useState("S29");
  const [electionTitle, setElectionTitle] = useState("");
  const [pollDate, setPollDate] = useState("");
  const [pollTime, setPollTime] = useState("");
  const [adminFields, setAdminFields] = useState(emptyAdminFields);

  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [sheets, setSheets] = useState<SheetSummary[]>([]);
  const [parsed, setParsed] = useState<ParsedRoll | null>(null);
  const [page, setPage] = useState(0);

  const [banner, setBanner] = useState<{ dataUrl: string; name: string } | null>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const totalRows = parsed?.rows.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
  const pageRows = useMemo(
    () => parsed?.rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE) ?? [],
    [parsed, page],
  );

  const reset = () => {
    setName("");
    setAssemblyNo("");
    setCode("");
    setCodeEdited(false);
    setStateCode("S29");
    setElectionTitle("");
    setPollDate("");
    setPollTime("");
    setAdminFields(emptyAdminFields);
    setFile(null);
    setBanner(null);
    setSheets([]);
    setParsed(null);
    setPage(0);
    setProgress(0);
    setError(null);
  };

  const applyName = (value: string) => {
    setName(value);
    if (!codeEdited) setCode(generateCode(value));
  };

  const applyRoll = (roll: ParsedRoll) => {
    setParsed(roll);
    setPage(0);

    // Prefill from the sheet — the admin usually just confirms.
    if (roll.detectedAssemblyName) applyName(roll.detectedAssemblyName);
    if (roll.detectedAssemblyNo) setAssemblyNo(String(roll.detectedAssemblyNo));
  };

  /** Read as a data URL so it can be posted as JSON, no multipart needed. */
  const handleBanner = (chosen: File) => {
    const reader = new FileReader();

    reader.onload = () => setBanner({ dataUrl: String(reader.result), name: chosen.name });
    reader.onerror = () => setError("Could not read that image.");
    reader.readAsDataURL(chosen);
  };

  const handleFile = async (chosen: File) => {
    setParsing(true);
    setError(null);
    setPage(0);
    setFile(chosen);
    setParsed(null);

    try {
      const workbook = await parseWorkbook(chosen);
      setSheets(workbook.sheets);

      if (!workbook.roll) {
        setError(
          `No sheet in this file has the roll columns (part_no and srno). Found: ${workbook.sheets
            .map((sheet) => `"${sheet.name}"`)
            .join(", ")}.`,
        );
        return;
      }

      applyRoll(workbook.roll);
    } catch (caught) {
      setParsed(null);
      setError(caught instanceof Error ? caught.message : "Could not read that file.");
    } finally {
      setParsing(false);
    }
  };

  /** Workbooks often hold a summary tab next to the roll; let the admin switch. */
  const handleSheetChange = async (sheetName: string) => {
    if (!file || sheetName === parsed?.sheetName) return;

    setParsing(true);
    setError(null);

    try {
      const roll = await parseSheet(file, sheetName);

      if (roll.missingColumns.length > 0) {
        setParsed(null);
        setError(
          `"${sheetName}" is missing required columns: ${roll.missingColumns.join(", ")}.`,
        );
        return;
      }

      applyRoll(roll);
    } catch (caught) {
      setParsed(null);
      setError(caught instanceof Error ? caught.message : "Could not read that sheet.");
    } finally {
      setParsing(false);
    }
  };

  const submit = async () => {
    // The admin login is optional, but a half-filled one is caught before anything is saved.
    const wantsAdmin = Object.values(adminFields).some((value) => value.trim() !== "");
    const adminInput = createConstituencyAdminRequestSchema.safeParse(adminFields);

    if (wantsAdmin && !adminInput.success) {
      setError(adminInput.error.issues[0]?.message ?? "Check the admin login details.");
      return;
    }

    setBusy(true);
    setProgress(0);
    setError(null);

    try {
      const assemblyResponse = await fetch("/api/import/assembly", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ assemblyNo, name, code, stateCode, electionTitle, pollDate, pollTime }),
      });

      const assembly = (await assemblyResponse.json()) as Assembly & { message?: string };

      if (!assemblyResponse.ok) {
        throw new Error(assembly.message ?? "Could not save the constituency.");
      }

      if (banner) {
        const bannerResponse = await fetch("/api/import/banner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assemblyId: assembly.id, dataUrl: banner.dataUrl }),
        });

        if (!bannerResponse.ok) {
          const payload = (await bannerResponse.json()) as { message?: string };
          // The constituency is already saved; the banner is the only casualty.
          toast.error(payload.message ?? "The banner could not be saved.");
        }
      }

      if (wantsAdmin) {
        const result = await createConstituencyAdminAction(assembly.id, adminFields);

        // Like the banner, a failed login doesn't undo the constituency; add it from its page.
        if (result.error) toast.error(`Admin login not created: ${result.error}`);
        else if (result.message) toast.success(result.message);
      }

      if (!parsed || parsed.rows.length === 0) {
        toast.success(`${assembly.name} (${assembly.assemblyNo}) added.`);
        setOpen(false);
        reset();
        router.refresh();
        return;
      }

      let inserted = 0;
      let skipped = 0;

      for (let index = 0; index < parsed.rows.length; index += CHUNK_SIZE) {
        const chunk = parsed.rows.slice(index, index + CHUNK_SIZE);

        const response = await fetch("/api/import/voters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assemblyId: assembly.id, rows: chunk }),
        });

        const payload = (await response.json()) as ImportResult & { message?: string };

        if (!response.ok) throw new Error(payload.message ?? "Could not import some rows.");

        inserted += payload.inserted;
        skipped += payload.skipped;
        setProgress(Math.round(((index + chunk.length) / parsed.rows.length) * 100));
      }

      toast.success(
        `${assembly.name}: ${inserted.toLocaleString()} voters imported${
          skipped > 0 ? `, ${skipped.toLocaleString()} already on file` : ""
        }.`,
      );

      // Phones pick the new voters up on their next sync.
      setProgress(100);
      setOpen(false);
      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finish the import.");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = !busy && !parsing && name.trim().length > 1 && assemblyNo !== "" && code.length >= 2;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" />
          Add constituency
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Add a constituency</DialogTitle>
          <DialogDescription>
            Upload the electoral roll to fill these in automatically, or enter the details and add
            voters later.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 py-2">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="assemblyNo">Assembly number</Label>
              <Input
                id="assemblyNo"
                value={assemblyNo}
                onChange={(event) => setAssemblyNo(event.target.value.replace(/\D/g, ""))}
                placeholder="241"
                inputMode="numeric"
              />
            </div>

            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={name}
                onChange={(event) => applyName(event.target.value)}
                placeholder="Gandhinagar South"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="stateCode">State</Label>
                <Input
                  id="stateCode"
                  value={stateCode}
                  onChange={(event) => setStateCode(event.target.value.toUpperCase())}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="code">Code</Label>
                <Input
                  id="code"
                  value={code}
                  onChange={(event) => {
                    setCodeEdited(true);
                    setCode(event.target.value.toUpperCase());
                  }}
                  placeholder="GS"
                />
              </div>
            </div>

            <p className="text-muted-foreground text-xs sm:col-span-4">
              Generated from the name — PINs for this constituency will look like{" "}
              <span className="font-mono">
                {stateCode || "S29"}
                {code || "XX"}
                {assemblyNo || "000"}B1
              </span>
              .
            </p>
          </div>

          {/* Common to every voter, so set once here and sent on each WhatsApp slip. */}
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="electionTitle">Election heading</Label>
              <Input
                id="electionTitle"
                value={electionTitle}
                onChange={(event) => setElectionTitle(event.target.value)}
                placeholder="KARIMNAGAR MUNICIPAL CORPORATION-2026"
                maxLength={120}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pollDate">Vote on</Label>
              <Input
                id="pollDate"
                type="date"
                value={pollDate}
                onChange={(event) => setPollDate(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pollTime">Voting time</Label>
              <Input
                id="pollTime"
                value={pollTime}
                onChange={(event) => setPollTime(event.target.value)}
                placeholder="7.00AM-5.00PM"
                maxLength={60}
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.csv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void handleFile(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileRef.current?.click()}
                disabled={parsing || busy}
              >
                <FileSpreadsheet className="size-4" />
                {parsing ? "Reading…" : "Upload voter list"}
              </Button>
              <span className="text-muted-foreground text-sm">
                {file?.name ?? ".xlsx or .csv with the roll headers — nothing is sent until you import"}
              </span>
            </div>

            {sheets.length > 1 ? (
              <div className="grid gap-2">
                <Label htmlFor="sheet">Sheet</Label>
                <Select
                  value={parsed?.sheetName ?? ""}
                  onValueChange={(value) => void handleSheetChange(value)}
                  disabled={parsing || busy}
                >
                  <SelectTrigger id="sheet" className="w-full sm:w-96">
                    <SelectValue placeholder="Choose the sheet holding the roll" />
                  </SelectTrigger>
                  <SelectContent>
                    {sheets.map((sheet) => (
                      <SelectItem key={sheet.name} value={sheet.name}>
                        {sheet.name} — {sheet.rowCount.toLocaleString()} rows
                        {sheet.isRoll ? "" : " (no roll columns)"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {parsed ? (
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{totalRows.toLocaleString()} rows ready</Badge>
                {parsed.droppedRows > 0 ? (
                  <Badge variant="outline">{parsed.droppedRows} rows without part/serial</Badge>
                ) : null}
                {parsed.unknownColumns.length > 0 ? (
                  <Badge variant="outline">
                    Ignoring: {parsed.unknownColumns.slice(0, 3).join(", ")}
                    {parsed.unknownColumns.length > 3 ? "…" : ""}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center gap-3">
              <input
                ref={bannerRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const chosen = event.target.files?.[0];
                  if (chosen) handleBanner(chosen);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => bannerRef.current?.click()}
                disabled={busy}
              >
                <ImageIcon className="size-4" />
                {banner ? "Change banner" : "Upload banner"}
              </Button>
              <span className="text-muted-foreground text-sm">
                {banner?.name ?? "Shown at the top of the app's home screen (PNG/JPEG/WebP, max 4 MB)"}
              </span>
            </div>

            {banner ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={banner.dataUrl}
                alt="Banner preview"
                className="h-32 w-full rounded-md border object-cover"
              />
            ) : null}
          </div>

          <div className="grid gap-3 rounded-lg border p-4">
            <div className="grid gap-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="text-muted-foreground size-4" />
                Constituency admin login (optional)
              </p>
              <p className="text-muted-foreground text-xs">
                They sign in to this dashboard and see only this constituency. You can add more
                later from its page.
              </p>
            </div>
            <AdminFields values={adminFields} onChange={setAdminFields} />
          </div>

          {parsed && totalRows > 0 ? (
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  Preview{" "}
                  <span className="text-muted-foreground font-normal">
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalRows)} of{" "}
                    {totalRows.toLocaleString()}
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.max(0, current - 1))}
                    disabled={page === 0}
                  >
                    Previous
                  </Button>
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {page + 1} / {pageCount}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}
                    disabled={page >= pageCount - 1}
                  >
                    Next
                  </Button>
                </div>
              </div>

              <div className="max-h-[45vh] overflow-auto rounded-md border">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0">
                    <TableRow>
                      <TableHead>Part</TableHead>
                      <TableHead>Sr</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Local name</TableHead>
                      <TableHead>Relative</TableHead>
                      <TableHead>Sex</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead>Voter ID</TableHead>
                      <TableHead>House</TableHead>
                      <TableHead>Village</TableHead>
                      <TableHead>Mobile</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRows.map((row, index) => (
                      <TableRow key={`${row.partNo}-${row.srNo}-${index}`}>
                        <TableCell className="tabular-nums">{cell(row.partNo)}</TableCell>
                        <TableCell className="tabular-nums">{cell(row.srNo)}</TableCell>
                        <TableCell className="font-medium whitespace-nowrap">
                          {cell(row.eFirstName)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {cell(row.lFirstName)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {cell(row.eMiddleName || row.lMiddleName)}
                        </TableCell>
                        <TableCell>{cell(row.sex)}</TableCell>
                        <TableCell className="tabular-nums">{cell(row.age)}</TableCell>
                        <TableCell className="font-mono text-xs">{cell(row.vcardId)}</TableCell>
                        <TableCell>{cell(row.houseNo)}</TableCell>
                        <TableCell>{cell(row.eVillage)}</TableCell>
                        <TableCell>{cell(row.mobileNo1)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          {busy && totalRows > 0 ? (
            <div className="grid gap-2">
              <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
                <div className="bg-primary h-full transition-all" style={{ width: `${progress}%` }} />
              </div>
              <p className="text-muted-foreground text-sm tabular-nums">{progress}% imported</p>
            </div>
          ) : null}

          {error ? (
            <p className="text-destructive flex items-start gap-2 text-sm" role="alert">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" onClick={submit} disabled={!canSubmit}>
            <Upload className="size-4" />
            {busy
              ? "Saving…"
              : totalRows > 0
                ? `Import ${totalRows.toLocaleString()} voters`
                : "Create constituency"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
