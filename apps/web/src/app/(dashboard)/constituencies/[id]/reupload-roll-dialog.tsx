"use client";

import type { ImportResult, RollWipeImpact } from "@voter/shared";
import { AlertTriangle, FileSpreadsheet, Loader2, RefreshCw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { rollWipeImpactAction, wipeRollAction } from "@/app/actions";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { parseWorkbook } from "@/lib/parse-roll";

/** Rows per request — the same chunking as a first import. */
const CHUNK_SIZE = 2500;

function plural(count: number, noun: string, nouns = `${noun}s`) {
  return `${count.toLocaleString()} ${count === 1 ? noun : nouns}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** What the admin sees while the roll is being replaced. */
type Progress = {
  stage: string;
  /** 0–100 while importing; null while reading the file or clearing the roll. */
  percent: number | null;
  /** Rows found in the sheet, once it has been read. */
  rows: number | null;
};

/**
 * Covers the whole screen while a roll is replaced. Nothing underneath can be
 * clicked, the dialog cannot be closed, and the stage is always in view — a
 * large roll takes a while to read, wipe and send.
 */
function ReplacingOverlay({ name, progress }: { name: string; progress: Progress }) {
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-live="polite"
      aria-label={`Replacing the roll for ${name}`}
      className="bg-background/90 fixed inset-0 z-[60] flex items-center justify-center p-6 backdrop-blur-sm"
    >
      <div className="bg-card text-card-foreground grid w-full max-w-md gap-5 rounded-xl border p-8 shadow-lg">
        <div className="flex items-center gap-4">
          <Loader2 className="text-primary size-8 shrink-0 animate-spin" />
          <div className="grid gap-1">
            <p className="text-lg font-semibold">Replacing the roll for {name}</p>
            <p className="text-muted-foreground text-sm">
              Keep this tab open until it finishes. There is no undo.
            </p>
          </div>
        </div>

        <div className="grid gap-2">
          <div className="bg-muted h-2 w-full overflow-hidden rounded-full">
            <div
              className={`bg-primary h-full transition-all ${
                progress.percent === null ? "w-1/3 animate-pulse" : ""
              }`}
              style={progress.percent === null ? undefined : { width: `${progress.percent}%` }}
            />
          </div>
          <p className="text-sm tabular-nums">
            {progress.stage}
            {progress.percent !== null ? ` ${progress.percent}%` : ""}
          </p>
          {progress.rows !== null ? (
            <p className="text-muted-foreground text-xs tabular-nums">
              {plural(progress.rows, "voter")} in the new sheet
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Replaces a constituency's roll with a corrected sheet. The existing roll is
 * wiped first, so before anything is sent the admin sees exactly what goes —
 * including the work agents did in the field — and must confirm it in words.
 * The sheet is only read after that confirmation, under a full-screen
 * progress overlay: a large file would otherwise freeze the dialog the moment
 * it was chosen. If the sheet turns out unusable, nothing has been wiped.
 */
export function ReuploadRollDialog({ assemblyId, name }: { assemblyId: string; name: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<RollWipeImpact | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = progress !== null;
  /** Typed in full so a stray click cannot wipe a roll. */
  const confirmed = confirmation.trim().toUpperCase() === "REPLACE";

  const reset = () => {
    setImpact(null);
    setFile(null);
    setConfirmation("");
    setProgress(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  // The counts are read when the dialog opens, so they describe the roll as
  // it is now rather than as it was when the page loaded.
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    void rollWipeImpactAction(assemblyId).then((result) => {
      if (cancelled) return;
      if (result.error) setError(result.error);
      else setImpact(result.impact ?? null);
    });

    return () => {
      cancelled = true;
    };
  }, [open, assemblyId]);

  const submit = async () => {
    if (!file || !confirmed || busy) return;

    setError(null);
    setProgress({ stage: "Reading the sheet…", percent: null, rows: null });

    // Let the overlay paint before the (synchronous, heavy) parse starts.
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const workbook = await parseWorkbook(file);

      if (!workbook.roll) {
        throw new Error(
          `No sheet in this file has the roll columns (PART_NO and SLNO). Found: ${workbook.sheets
            .map((sheet) => `"${sheet.name}"`)
            .join(", ")}. The current roll has not been touched.`,
        );
      }

      const parsed = workbook.roll;

      if (parsed.rows.length === 0) {
        throw new Error(
          `"${parsed.sheetName}" has no rows with a part and serial number. The current roll has not been touched.`,
        );
      }

      setProgress({ stage: "Clearing the existing roll…", percent: null, rows: parsed.rows.length });
      const wiped = await wipeRollAction(assemblyId);

      if (wiped.error) throw new Error(wiped.error);

      setProgress({ stage: "Importing the new roll…", percent: 0, rows: parsed.rows.length });

      let inserted = 0;
      let skipped = 0;

      for (let index = 0; index < parsed.rows.length; index += CHUNK_SIZE) {
        const chunk = parsed.rows.slice(index, index + CHUNK_SIZE);

        const response = await fetch("/api/import/voters", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ assemblyId, rows: chunk }),
        });

        const payload = (await response.json()) as ImportResult & { message?: string };

        // The old roll is already gone: say so, and that re-running finishes the job.
        if (!response.ok) {
          throw new Error(
            `${payload.message ?? "Could not import some rows."} The old roll has been removed; ${inserted.toLocaleString()} voters are in so far. Upload the same file again to add the rest — rows already in are skipped.`,
          );
        }

        inserted += payload.inserted;
        skipped += payload.skipped;
        setProgress({
          stage: "Importing the new roll…",
          percent: Math.round(((index + chunk.length) / parsed.rows.length) * 100),
          rows: parsed.rows.length,
        });
      }

      toast.success(
        `${name}: roll replaced with ${inserted.toLocaleString()} voters${
          skipped > 0 ? ` (${skipped.toLocaleString()} duplicate rows skipped)` : ""
        }${
          parsed.droppedRows > 0
            ? `, ${parsed.droppedRows.toLocaleString()} rows without part/serial ignored`
            : ""
        }. Phones will be asked to download it again.`,
      );

      setOpen(false);
      reset();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not finish the re-upload.");
      setProgress(null);
    }
  };

  const canSubmit = !busy && file !== null && confirmed && impact !== null;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <RefreshCw className="size-4" />
            Re-upload roll
          </Button>
        </DialogTrigger>

        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Re-upload the roll for {name}</DialogTitle>
            <DialogDescription>
              The roll on file is removed and the new sheet imported in its place. Use this for a
              corrected or updated electoral roll. There is no undo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-2">
            <div className="grid gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/40">
              <p className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                <AlertTriangle className="size-4" />
                This will permanently remove
              </p>
              {impact ? (
                <ul className="grid gap-1 text-sm">
                  <li>
                    <strong>{plural(impact.voters, "voter")}</strong> on the current roll
                  </li>
                  <li>
                    <strong>{plural(impact.enrollments, "voter")}</strong> enrolled from the app in
                    the field — they are not in any sheet and cannot be recovered
                  </li>
                  <li>
                    <strong>{plural(impact.votedMarks, "voted mark")}</strong> and{" "}
                    <strong>{plural(impact.fieldEdits, "field edit")}</strong> (mobile, house,
                    caste, party and other details agents entered)
                  </li>
                  <li>
                    <strong>{plural(impact.slipPrints, "slip print record")}</strong>, with their
                    locations
                  </li>
                </ul>
              ) : (
                <div className="grid gap-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-4 w-3/5" />
                </div>
              )}
              {impact ? (
                <p className="text-muted-foreground text-xs">
                  Kept: {plural(impact.pins, "access PIN")}, admin logins, the banner and usage
                  history. {plural(impact.appUsers, "app user")} who unlocked this constituency
                  will be asked to download the new roll the next time they sync. Anything they
                  have not synced by then is lost.
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 rounded-lg border p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv"
                  className="hidden"
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (!chosen) return;
                    setFile(chosen);
                    setError(null);
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                >
                  <FileSpreadsheet className="size-4" />
                  {file ? "Change file" : "Choose the new roll"}
                </Button>
                <span className="text-muted-foreground text-sm">
                  {file ? (
                    <>
                      <span className="text-foreground font-medium">{file.name}</span> ·{" "}
                      {fileSize(file.size)}
                    </>
                  ) : (
                    ".xlsx or .csv with the roll headers"
                  )}
                </span>
              </div>
              <p className="text-muted-foreground text-xs">
                The sheet is read after you confirm. In a workbook with several tabs, the one with
                the roll columns and the most rows is used. If it cannot be read, the current roll
                stays as it is.
              </p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="reupload-confirm">
                Type <span className="font-mono font-semibold">REPLACE</span> to confirm
              </Label>
              <input
                id="reupload-confirm"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                disabled={busy}
                autoComplete="off"
                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm font-mono uppercase sm:w-64"
              />
            </div>

            {error ? (
              <p className="text-destructive flex items-start gap-2 text-sm" role="alert">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </p>
            ) : null}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              <Upload className="size-4" />
              {busy ? "Replacing…" : "Wipe and import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {progress ? <ReplacingOverlay name={name} progress={progress} /> : null}
    </>
  );
}
