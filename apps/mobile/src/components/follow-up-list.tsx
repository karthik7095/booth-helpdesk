import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { FlatList, Pressable } from "react-native";

import { DECEASED, StatusTag, VoterRowGap } from "@/components/voter-row";
import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import {
  followUpCounts,
  listFollowUps,
  updateFieldWork,
  type FollowUpStatus,
  type LocalVoter,
  type VoterScope,
} from "@/lib/db";
import type { NameLanguage } from "@/lib/language";
import { syncIfOnline } from "@/lib/sync";
import { voterFullName } from "@/lib/voter-actions";

const PENDING = "#C25E00";
const PENDING_BORDER = "#E08A2E";
const DONE = "#0A9A80";

/** "10:14" today, else "12 Oct, 10:14". */
function when(ms: number | null): string {
  if (!ms) return "";

  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

function FollowUpCard({
  voter,
  language,
  showBooth,
  onOpen,
  onToggle,
}: {
  voter: LocalVoter;
  language: NameLanguage;
  showBooth: boolean;
  onOpen: (id: string) => void;
  onToggle: (voter: LocalVoter) => void;
}) {
  const done = voter.remarkDone;
  const byLine = [voter.remarkBy ? `Added by ${voter.remarkBy}` : null, when(voter.remarkAt)]
    .filter(Boolean)
    .join(" · ");

  return (
    <HStack
      className="overflow-hidden rounded-xl border bg-card"
      style={{ borderColor: done ? DONE : PENDING_BORDER }}
    >
      <Box className="w-1.5" style={{ backgroundColor: done ? DONE : PENDING_BORDER }} />
      <VStack space="sm" className="flex-1 p-3">
        <Pressable onPress={() => onOpen(voter.id)} accessibilityRole="button">
          <HStack space="sm" className="items-center">
            <Text
              className="flex-1 text-base font-semibold uppercase text-foreground"
              numberOfLines={1}
            >
              {voterFullName(voter, language)}
            </Text>
            <Text className="text-xs text-muted-foreground">
              {showBooth ? `Booth ${voter.partNo} · ` : ""}Sr {voter.srNo}
            </Text>
          </HStack>
        </Pressable>

        <Box className="rounded-lg bg-background px-2.5 py-2">
          <Text className="text-sm text-foreground">{voter.remark}</Text>
        </Box>

        <HStack space="xs" className="flex-wrap items-center">
          <StatusTag label={done ? "DONE" : "PENDING"} color={done ? DONE : PENDING} />
          {voter.isDeceased ? <StatusTag label="DECEASED" color={DECEASED} /> : null}
          {voter.isFound ? <StatusTag label="FOUND" color="#E0B100" dark /> : null}
          {voter.hasVoted ? <StatusTag label="VOTED" color={DONE} /> : null}
          <Text className="flex-1 text-[11px] text-muted-foreground" numberOfLines={1}>
            {byLine}
          </Text>
          <Pressable
            onPress={() => onToggle(voter)}
            accessibilityRole="button"
            className="h-9 justify-center rounded-lg border px-3.5"
            style={
              done
                ? { borderColor: "#DBE3F3", backgroundColor: "transparent" }
                : { borderColor: DONE, backgroundColor: DONE }
            }
          >
            <Text
              className={`text-sm font-semibold ${done ? "text-foreground" : ""}`}
              style={done ? undefined : { color: "#FFFFFF" }}
            >
              {done ? "Reopen" : "Mark done"}
            </Text>
          </Pressable>
        </HStack>
      </VStack>
    </HStack>
  );
}

/**
 * Voters with a remark — one booth's, or the whole ward's with `partNo` null —
 * pending first. Orange until marked done, then green. Re-read each time the
 * screen comes back into view, so remarks added on a voter screen show up.
 */
export function FollowUpList({
  partNo,
  language,
  onOpen,
}: {
  /** One booth or one ward; null for every voter the PIN covers. */
  partNo: VoterScope | null;
  language: NameLanguage;
  onOpen: (id: string) => void;
}) {
  const { token } = useAuth();
  const [status, setStatus] = useState<FollowUpStatus>("pending");
  const [rows, setRows] = useState<LocalVoter[]>([]);
  const [counts, setCounts] = useState({ pending: 0, done: 0 });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [list, totals] = await Promise.all([
      listFollowUps(status, partNo),
      followUpCounts(partNo),
    ]);

    setRows(list);
    setCounts(totals);
    setLoaded(true);
  }, [status, partNo]);

  useFocusEffect(
    useCallback(() => {
      load().catch(() => undefined);
    }, [load]),
  );

  const toggle = useCallback(
    async (voter: LocalVoter) => {
      await updateFieldWork(voter.id, { remarkDone: !voter.remarkDone });
      await load();
      void syncIfOnline(token);
    },
    [load, token],
  );

  const tabs: { value: FollowUpStatus; label: string }[] = [
    { value: "pending", label: `Pending ${counts.pending}` },
    { value: "done", label: `Done ${counts.done}` },
    { value: "all", label: `All ${counts.pending + counts.done}` },
  ];

  return (
    <VStack className="flex-1">
      <HStack space="sm" className="px-4 pb-3">
        {tabs.map((tab) => (
          <Pressable key={tab.value} onPress={() => setStatus(tab.value)} accessibilityRole="button">
            <Box
              className={`h-8 justify-center rounded-full px-3.5 ${
                status === tab.value ? "bg-primary" : "bg-secondary"
              }`}
            >
              <Text
                className={`text-sm font-semibold ${
                  status === tab.value ? "text-primary-foreground" : "text-secondary-foreground"
                }`}
              >
                {tab.label}
              </Text>
            </Box>
          </Pressable>
        ))}
      </HStack>

      <FlatList
        data={rows}
        keyExtractor={(voter) => voter.id}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
        ItemSeparatorComponent={VoterRowGap}
        ListEmptyComponent={
          loaded ? (
            <Text className="px-4 py-10 text-center text-sm text-muted-foreground">
              {status === "done"
                ? "Nothing marked done yet."
                : "No follow-ups. Open a voter and add a remark."}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <FollowUpCard
            voter={item}
            language={language}
            showBooth={partNo === null || (typeof partNo === "object" && "wardNo" in partNo)}
            onOpen={onOpen}
            onToggle={(voter) => void toggle(voter)}
          />
        )}
      />
    </VStack>
  );
}
