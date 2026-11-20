import { useState } from "react";
import { Pressable } from "react-native";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DECEASED, DECEASED_CARD, FOUND_CARD, StatusTag } from "@/components/voter-row";
import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { SearchIcon, Icon } from "@/components/ui/icon";
import { Input, InputField } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { updateFieldWork, type LocalVoter } from "@/lib/db";
import { syncIfOnline } from "@/lib/sync";
import { voterFullName } from "@/lib/voter-actions";

const PENDING = "#C25E00";
const DONE = "#0A9A80";

/**
 * "Mark as found", "Mark as deceased" and the follow-up remark on the voter screen. Each change is
 * saved the moment it is made — apart from the edit form and its Save button —
 * and goes to the server on the next sync, so the whole ward sees it.
 */
export function FieldWorkPanel({
  voter,
  onChanged,
}: {
  voter: LocalVoter;
  onChanged: () => Promise<void>;
}) {
  const { token, fullName } = useAuth();
  const [draft, setDraft] = useState(voter.remark ?? "");
  const [busy, setBusy] = useState(false);
  const [confirmDeceased, setConfirmDeceased] = useState(false);

  const saved = voter.remark ?? "";
  const hasRemark = saved.trim().length > 0;
  const changed = draft.trim() !== saved.trim();

  const run = async (change: Parameters<typeof updateFieldWork>[1]) => {
    setBusy(true);
    await updateFieldWork(voter.id, change);
    await onChanged();
    setBusy(false);
    void syncIfOnline(token);
  };

  return (
    <VStack space="md">
      <Pressable
        disabled={busy}
        onPress={() => void run({ isFound: !voter.isFound })}
        accessibilityRole="button"
        accessibilityState={{ selected: voter.isFound }}
      >
        <HStack
          space="sm"
          className="h-14 items-center justify-center rounded-2xl border border-border bg-card"
          style={voter.isFound ? FOUND_CARD : undefined}
        >
          <Icon as={SearchIcon} className="h-5 w-5 text-foreground" />
          <Text className="text-base font-semibold text-foreground">
            {voter.isFound ? "Found ✓  (tap to undo)" : "Mark as found"}
          </Text>
        </HStack>
      </Pressable>

      {/* Marking asks first: it changes how the voter shows for every agent.
          Undoing a mistaken mark is one tap. */}
      <Pressable
        disabled={busy}
        onPress={() =>
          voter.isDeceased
            ? void run({ isDeceased: false, by: fullName })
            : setConfirmDeceased(true)
        }
        accessibilityRole="button"
        accessibilityState={{ selected: voter.isDeceased }}
      >
        <VStack
          className="min-h-14 items-center justify-center rounded-2xl border border-border bg-card px-4 py-2"
          style={voter.isDeceased ? DECEASED_CARD : undefined}
        >
          <Text
            className="text-base font-semibold text-foreground"
            style={voter.isDeceased ? { color: DECEASED } : undefined}
          >
            {voter.isDeceased ? "Deceased ✓  (tap to undo)" : "Mark as deceased"}
          </Text>
          {voter.isDeceased && (voter.deceasedBy || voter.deceasedAt) ? (
            <Text className="text-xs text-muted-foreground">
              Marked
              {voter.deceasedBy ? ` by ${voter.deceasedBy}` : ""}
              {voter.deceasedAt ? ` on ${new Date(voter.deceasedAt).toLocaleDateString()}` : ""}
            </Text>
          ) : null}
        </VStack>
      </Pressable>

      <ConfirmDialog
        open={confirmDeceased}
        title="Mark as deceased?"
        message={`${voterFullName(voter, "english")} will show as DECEASED to every agent in this ward. The voter stays on the roll, and you can undo this.`}
        confirmLabel="Mark deceased"
        destructive
        onConfirm={() => {
          setConfirmDeceased(false);
          void run({ isDeceased: true, by: fullName });
        }}
        onCancel={() => setConfirmDeceased(false)}
      />

      <VStack space="sm" className="rounded-2xl border border-border bg-card p-4">
        <HStack space="sm" className="items-center">
          <Text className="flex-1 text-base font-semibold text-foreground">Remark</Text>
          {hasRemark ? (
            <StatusTag
              label={voter.remarkDone ? "DONE" : "PENDING"}
              color={voter.remarkDone ? DONE : PENDING}
            />
          ) : null}
        </HStack>

        <Input className="h-auto min-h-20 rounded-xl border-border bg-background px-3 py-2">
          <InputField
            value={draft}
            onChangeText={setDraft}
            placeholder="e.g. Coming from Hyderabad on 10th"
            multiline
            maxLength={300}
            textAlignVertical="top"
            className="min-h-16 text-base"
          />
        </Input>

        {hasRemark && voter.remarkBy ? (
          <Text className="text-xs text-muted-foreground">Added by {voter.remarkBy}</Text>
        ) : null}

        <HStack space="sm">
          <Pressable
            className="flex-1"
            disabled={busy || !changed}
            onPress={() => void run({ remark: draft, by: fullName })}
            accessibilityRole="button"
          >
            <Box
              className={`h-12 items-center justify-center rounded-xl ${
                changed ? "bg-primary" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-base font-semibold ${
                  changed ? "text-primary-foreground" : "text-muted-foreground"
                }`}
              >
                {draft.trim() || !hasRemark ? "Save remark" : "Remove remark"}
              </Text>
            </Box>
          </Pressable>

          {hasRemark && !changed ? (
            <Pressable
              disabled={busy}
              onPress={() => void run({ remarkDone: !voter.remarkDone })}
              accessibilityRole="button"
            >
              <Box
                className="h-12 items-center justify-center rounded-xl border px-4"
                style={
                  voter.remarkDone
                    ? { borderColor: "#DBE3F3" }
                    : { borderColor: DONE, backgroundColor: DONE }
                }
              >
                <Text
                  className={`text-base font-semibold ${voter.remarkDone ? "text-foreground" : ""}`}
                  style={voter.remarkDone ? undefined : { color: "#FFFFFF" }}
                >
                  {voter.remarkDone ? "Reopen" : "Mark done"}
                </Text>
              </Box>
            </Pressable>
          ) : null}
        </HStack>

        <Text className="text-xs text-muted-foreground">
          Shared with every agent in this ward. It stays under Follow-up until marked done.
        </Text>
      </VStack>
    </VStack>
  );
}
