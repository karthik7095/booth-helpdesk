"use client";

import type { Announcement } from "@voter/shared";
import { Megaphone } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { applyAnnouncementToAllAction, updateAnnouncementAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * The alert booth agents see over the app's home screen. They have to tick
 * that they have read it before it closes; after that it stays as a card at
 * the top of the home screen. Saving a changed text asks every agent again.
 */
export function AnnouncementCard({
  assemblyId,
  announcement,
  canSendToAll,
}: {
  assemblyId: string;
  announcement: Announcement;
  /** Super admins can copy this alert to every constituency. */
  canSendToAll: boolean;
}) {
  const [enabled, setEnabled] = useState(announcement.announcementEnabled);
  const [title, setTitle] = useState(announcement.announcementTitle ?? "");
  const [body, setBody] = useState(announcement.announcementBody ?? "");
  const [pending, startTransition] = useTransition();

  const dirty =
    title !== (announcement.announcementTitle ?? "") || body !== (announcement.announcementBody ?? "");

  const save = (patch: { enabled?: boolean; title?: string; body?: string }) => {
    startTransition(async () => {
      const result = await updateAnnouncementAction(assemblyId, patch);

      if (result.error) {
        toast.error(result.error);
        setEnabled(announcement.announcementEnabled);
      } else if (result.message) toast.success(result.message);
    });
  };

  const sendToAll = () => {
    if (
      !window.confirm(
        "Send this alert to every constituency and switch it on there? It replaces their current alert, and new constituencies will start with it too.",
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await applyAnnouncementToAllAction(assemblyId);

      if (result.error) toast.error(result.error);
      else {
        setEnabled(true);
        if (result.message) toast.success(result.message);
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="text-muted-foreground size-4" />
          Alert for booth agents
        </CardTitle>
        <CardDescription>
          Shown over the app&apos;s home screen until the agent ticks that they have read it, then
          kept as a card at the top. Saving new text shows it to every agent again.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
          <div className="grid gap-1">
            <Label htmlFor="announcement-enabled">Show the alert in the app</Label>
            <p className="text-muted-foreground text-xs">
              {announcement.announcementUpdatedAt
                ? `Last sent ${new Date(announcement.announcementUpdatedAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}.`
                : "Not sent yet."}
            </p>
          </div>
          <Switch
            id="announcement-enabled"
            checked={enabled}
            disabled={pending || (!enabled && !body.trim())}
            onCheckedChange={(next) => {
              setEnabled(next);
              save(dirty ? { enabled: next, title, body } : { enabled: next });
            }}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="announcement-title">Title</Label>
          <Input
            id="announcement-title"
            value={title}
            maxLength={120}
            placeholder="బూత్ ఏజెంట్లకు ముఖ్యమైన సూచన"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="announcement-body">Message</Label>
          <textarea
            id="announcement-body"
            value={body}
            maxLength={4000}
            rows={10}
            onChange={(event) => setBody(event.target.value)}
            className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-40 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          />
          <p className="text-muted-foreground text-xs">
            Leave a blank line between paragraphs. Start a paragraph with ✅ for a checklist
            item or ⚠️ for a caution; wrap words in **double stars** for bold.
          </p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {canSendToAll ? (
            <Button
              variant="outline"
              disabled={pending || dirty || !(announcement.announcementBody ?? "").trim()}
              title={dirty ? "Save the message first." : undefined}
              onClick={sendToAll}
            >
              Send to all constituencies
            </Button>
          ) : null}
          <Button disabled={pending || !dirty} onClick={() => save({ title, body })}>
            {pending ? "Saving…" : "Save message"}
          </Button>
        </div>
        {canSendToAll ? (
          <p className="text-muted-foreground text-xs">
            New constituencies start with the alert most recently sent, switched on.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
