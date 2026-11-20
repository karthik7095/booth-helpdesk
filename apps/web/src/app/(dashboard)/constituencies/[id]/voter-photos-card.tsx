"use client";

import { Camera, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { VoterPhotoSummary } from "@/lib/api";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

type UploadResult = {
  received: number;
  matched: number;
  unmatchedCount: number;
  unmatched: string[];
  tooLarge: string[];
  message?: string;
};

/**
 * Voter photos for the app: a zip of <EPIC>.jpg files (the roll converter's
 * --photos folder, zipped). Each phone downloads only its user's wards.
 */
export function VoterPhotosCard({ assemblyId, summary }: { assemblyId: string; summary: VoterPhotoSummary }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "delete" | null>(null);
  const [last, setLast] = useState<UploadResult | null>(null);
  const bytes = summary.packs.reduce((sum, pack) => sum + pack.bytes, 0);

  const upload = async (file: File) => {
    setBusy("upload");
    try {
      const response = await fetch(`/api/voter-photos/${assemblyId}`, {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: file,
      });
      const result = (await response.json()) as UploadResult;

      if (!response.ok) {
        toast.error(result.message ?? "Could not upload those photos.");
        return;
      }

      setLast(result);
      toast.success(`${result.matched.toLocaleString()} photos saved. Phones download them on their next sync.`);
      router.refresh();
    } catch {
      toast.error("The upload did not finish. Check the connection and try again.");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    if (!window.confirm("Delete every voter photo for this constituency? Phones drop them on their next sync.")) return;
    setBusy("delete");
    const response = await fetch(`/api/voter-photos/${assemblyId}`, { method: "DELETE" });
    setBusy(null);
    if (response.ok) {
      setLast(null);
      toast.success("Voter photos deleted.");
      router.refresh();
    } else toast.error("Could not delete the photos.");
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Camera className="size-4" />
            Voter photos
          </CardTitle>
          <CardDescription>
            A zip of photos named by voter ID (<span className="font-mono">EPIC.jpg</span>), small ones like the roll
            converter makes with <span className="font-mono">--photos</span>. Phones download only their user&apos;s wards,
            once, and show them offline. Uploading again adds to or replaces photos by voter ID.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <input
            ref={input}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
          {summary.total > 0 ? (
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void remove()}>
              <Trash2 className="size-4" />
              {busy === "delete" ? "Deleting…" : "Delete"}
            </Button>
          ) : null}
          <Button size="sm" disabled={busy !== null} onClick={() => input.current?.click()}>
            <Upload className="size-4" />
            {busy === "upload" ? "Uploading…" : "Upload zip"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <p>
          <span className="font-semibold tabular-nums">{summary.total.toLocaleString()}</span> of{" "}
          <span className="tabular-nums">{summary.voters.toLocaleString()}</span> voters have a photo
          {summary.total > 0 ? <span className="text-muted-foreground"> · {mb(bytes)}</span> : null}.
        </p>
        {last ? (
          <p className="text-muted-foreground">
            Last upload: {last.received.toLocaleString()} photos, {last.matched.toLocaleString()} matched to voters
            {last.unmatchedCount > 0
              ? `, ${last.unmatchedCount.toLocaleString()} with voter IDs not on this roll (${last.unmatched.slice(0, 5).join(", ")}${last.unmatchedCount > 5 ? "…" : ""})`
              : ""}
            {last.tooLarge.length > 0 ? `, ${last.tooLarge.length} too large (over 150 KB) and skipped` : ""}.
          </p>
        ) : null}
        {summary.packs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {summary.packs.map((pack) => (
              <span key={`${pack.kind}-${pack.no}`} className="bg-muted rounded-md px-2 py-1 text-xs tabular-nums">
                {pack.kind === "ward" ? "Ward" : "Booth"} {pack.no}: {pack.count.toLocaleString()} · {mb(pack.bytes)}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
