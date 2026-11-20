"use client";

import type { AppFeatures, UpdateAppFeaturesRequest } from "@voter/shared";
import { Plus, Smartphone, X } from "lucide-react";
import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateAppFeaturesAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type FeatureFlag = Exclude<keyof AppFeatures, "partyOptions">;

const OPTIONS: { key: FeatureFlag; label: string; hint: string }[] = [
  {
    key: "enableVoteStatus",
    label: "Vote status",
    hint: "A button on the voter screen to record that the voter has voted.",
  },
  {
    key: "enableEnrollment",
    label: "Enroll new voter",
    hint: "The home screen tile for adding a voter who is not on the roll.",
  },
  {
    key: "enableCasteEntry",
    label: "Caste",
    hint: "Category (OC, BC, SC, ST, North Indian), BC sub-category (BC-A to BC-E), then the caste.",
  },
  {
    key: "enablePartyLoyalty",
    label: "Favourable",
    hint: "Radio buttons to record the voter's leaning, from the party list below.",
  },
  {
    key: "printSlipImage",
    label: "Print slip image",
    hint: "Print the slip cover image at the top of every voter slip, including bulk prints. Off: slips print the voter details only.",
  },
  {
    key: "allowUserSlipCovers",
    label: "Own slip covers",
    hint: "Each app user can upload two slip cover images of their own (up to 1 MB each) and pick which one prints. A new upload replaces the old one.",
  },
  {
    key: "requireLoginApproval",
    label: "Login approval",
    hint: "New app users wait after entering the PIN until an admin approves them, here under App users or in the app by an app admin. The user limit (App users) applies either way. Users already approved keep working.",
  },
  {
    key: "isPanchayat",
    label: "Gram panchayat (wards)",
    hint: "The roll's WARD_NO column groups voters by ward. The app lists wards beside booths, and anyone signed in with this PIN can upload a print banner for each ward (its candidate's symbol). A ward's slips print its own banner.",
  },
];

/** Super-admin switches for the optional voter-screen features in the app. All start off. */
export function AppFeaturesCard({
  assemblyId,
  features,
}: {
  assemblyId: string;
  features: AppFeatures;
}) {
  const [optimistic, setOptimistic] = useOptimistic(features);
  const [pending, startTransition] = useTransition();
  const [newParty, setNewParty] = useState("");

  const save = (patch: UpdateAppFeaturesRequest) => {
    startTransition(async () => {
      setOptimistic((current) => ({ ...current, ...patch }));
      const result = await updateAppFeaturesAction(assemblyId, patch);

      if (result.error) toast.error(result.error);
      else if (result.message) toast.success(result.message);
    });
  };

  const addParty = () => {
    const name = newParty.trim();

    if (!name) return;

    if (optimistic.partyOptions.some((party) => party.toLowerCase() === name.toLowerCase())) {
      toast.error(`${name} is already in the list.`);
      return;
    }

    save({ partyOptions: [...optimistic.partyOptions, name] });
    setNewParty("");
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Smartphone className="text-muted-foreground size-4" />
          App features
        </CardTitle>
        <CardDescription>
          Extra fields on the app&apos;s voter screen for this constituency. Hidden until
          switched on here.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        {OPTIONS.map((option) => (
          <div
            key={option.key}
            className="flex items-start justify-between gap-3 rounded-lg border p-3"
          >
            <div className="grid gap-1">
              <Label htmlFor={option.key}>{option.label}</Label>
              <p className="text-muted-foreground text-xs">{option.hint}</p>
            </div>
            <Switch
              id={option.key}
              checked={optimistic[option.key]}
              disabled={pending}
              onCheckedChange={(next) => save({ [option.key]: next })}
            />
          </div>
        ))}

        <div className="grid gap-3 rounded-lg border p-3 sm:col-span-2">
          <div className="grid gap-1">
            <Label htmlFor="new-party">Party list</Label>
            <p className="text-muted-foreground text-xs">
              The choices agents see under Favourable, in this order. Removing a party does not
              clear it from voters already recorded with it.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {optimistic.partyOptions.map((party) => (
              <Badge key={party} variant="secondary" className="gap-1 py-1 pr-1 pl-2.5 text-sm">
                {party}
                <button
                  type="button"
                  aria-label={`Remove ${party}`}
                  disabled={pending || optimistic.partyOptions.length === 1}
                  onClick={() =>
                    save({ partyOptions: optimistic.partyOptions.filter((p) => p !== party) })
                  }
                  className="hover:bg-muted-foreground/20 rounded-full p-0.5 disabled:opacity-40"
                >
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>

          <form
            className="flex max-w-sm gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              addParty();
            }}
          >
            <Input
              id="new-party"
              value={newParty}
              maxLength={40}
              placeholder="Add a party, e.g. Cycle"
              onChange={(event) => setNewParty(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={pending || !newParty.trim()}>
              <Plus />
              Add
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
