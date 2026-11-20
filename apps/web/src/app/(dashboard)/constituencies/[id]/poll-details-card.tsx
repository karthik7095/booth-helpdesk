"use client";

import { CalendarClock } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";

import { updatePollDetailsAction, type ActionState } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: ActionState = {};

/** The election heading and polling day/hours printed on every WhatsApp slip. */
export function PollDetailsCard({
  assemblyId,
  electionTitle,
  pollDate,
  pollTime,
}: {
  assemblyId: string;
  electionTitle: string | null;
  pollDate: string | null;
  pollTime: string | null;
}) {
  const [state, action, pending] = useActionState(
    updatePollDetailsAction.bind(null, assemblyId),
    initialState,
  );

  useEffect(() => {
    if (state.error) toast.error(state.error);
    if (state.message) toast.success(state.message);
  }, [state]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="text-muted-foreground size-4" />
          Poll details
        </CardTitle>
        <CardDescription>
          Sent with every voter&apos;s details when an agent shares them on WhatsApp or SMS.
          Leave a field blank to leave it off the message.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={action} className="grid gap-4 sm:grid-cols-4">
          <div className="grid gap-2 sm:col-span-2">
            <Label htmlFor="electionTitle">Election heading</Label>
            <Input
              id="electionTitle"
              name="electionTitle"
              defaultValue={electionTitle ?? ""}
              placeholder="KARIMNAGAR MUNICIPAL CORPORATION-2026"
              maxLength={120}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pollDate">Vote on</Label>
            <Input id="pollDate" name="pollDate" type="date" defaultValue={pollDate ?? ""} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pollTime">Voting time</Label>
            <Input
              id="pollTime"
              name="pollTime"
              defaultValue={pollTime ?? ""}
              placeholder="7.00AM-5.00PM"
              maxLength={60}
            />
          </div>
          <div className="sm:col-span-4">
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save poll details"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
