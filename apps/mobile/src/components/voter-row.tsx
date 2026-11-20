import { Image } from "expo-image";
import { memo } from "react";
import { Pressable } from "react-native";

import { HouseTag } from "@/components/voter-filter-sheet";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import type { LocalVoter } from "@/lib/db";
import type { NameLanguage } from "@/lib/language";
import { voterFullName, voterRelativeName } from "@/lib/voter-actions";
import { voterPhotoUri } from "@/lib/voter-photos";

/** Only the last four digits are shown, as on the printed rolls. */
function maskMobile(mobile: string | null): string {
  if (!mobile) return "—";

  return mobile.length > 4 ? `..${mobile.slice(-4)}` : mobile;
}

/**
 * Card colours for field work: grey for a deceased voter (whatever else is
 * marked), green once voted, yellow once found, else plain.
 */
export const VOTED_CARD = { backgroundColor: "#DCF5EC", borderColor: "#0A9A80" };
export const FOUND_CARD = { backgroundColor: "#FFF3C4", borderColor: "#E0B100" };
export const DECEASED_CARD = { backgroundColor: "#ECEDF1", borderColor: "#8A8FA3" };
export const DECEASED = "#B42318";
const PENDING_REMARK = "#C25E00";
const DONE_REMARK = "#0A9A80";

export function fieldWorkCard(voter: Pick<LocalVoter, "hasVoted" | "isFound" | "isDeceased">) {
  if (voter.isDeceased) return DECEASED_CARD;

  return voter.hasVoted ? VOTED_CARD : voter.isFound ? FOUND_CARD : undefined;
}

/** A small filled tag: DECEASED, FOUND, VOTED, REMARK. */
export function StatusTag({ label, color, dark }: { label: string; color: string; dark?: boolean }) {
  return (
    <Box className="rounded-full px-2 py-0.5" style={{ backgroundColor: color }}>
      <Text className="text-[10px] font-bold" style={{ color: dark ? "#3A2E00" : "#FFFFFF" }}>
        {label}
      </Text>
    </Box>
  );
}

/** DECEASED / FOUND / VOTED / REMARK tags for a voter, or nothing when none applies. */
export function FieldWorkTags({ voter }: { voter: LocalVoter }) {
  const hasRemark = Boolean(voter.remark?.trim());

  if (!voter.isDeceased && !voter.isFound && !voter.hasVoted && !hasRemark) return null;

  return (
    <HStack space="xs" className="mt-1 flex-wrap">
      {voter.isDeceased ? <StatusTag label="DECEASED" color={DECEASED} /> : null}
      {voter.isFound ? <StatusTag label="FOUND" color="#E0B100" dark /> : null}
      {voter.hasVoted ? <StatusTag label="VOTED" color={DONE_REMARK} /> : null}
      {hasRemark ? (
        <StatusTag
          label={voter.remarkDone ? "REMARK ✓" : "REMARK"}
          color={voter.remarkDone ? DONE_REMARK : PENDING_REMARK}
        />
      ) : null}
    </HStack>
  );
}

/**
 * One voter in a list. Memoised, with plain props, so a booth list of a
 * thousand rows only renders the rows that come into view: rendered inline,
 * every row re-rendered on each change to the screen, and the rows still being
 * laid out off-screen kept the JS thread busy enough to hold up the back
 * button for seconds.
 */
export const VoterRow = memo(function VoterRow({
  voter,
  language,
  showBooth,
  houseSize,
  showHouse,
  onOpen,
}: {
  voter: LocalVoter;
  language: NameLanguage;
  /** Booth and serial (search), or the serial alone (one booth's list). */
  showBooth: boolean;
  /** The "H.No · N voters" tag, while the list is sorted by house. */
  showHouse: boolean;
  houseSize: number | undefined;
  onOpen: (id: string) => void;
}) {
  const photo = voterPhotoUri(voter.assemblyNo, voter.vcardId);

  return (
    <Pressable onPress={() => onOpen(voter.id)}>
      <HStack
        className="overflow-hidden rounded-xl border border-border bg-card"
        style={fieldWorkCard(voter)}
      >
        <Box className="w-1.5 bg-success" />
        <HStack className="flex-1 items-center p-3">
          <VStack className={showBooth ? "w-16" : "w-12"}>
            {showBooth ? (
              <>
                <Text className="text-base font-semibold text-foreground">{voter.partNo}</Text>
                <Text className="text-sm text-muted-foreground">{voter.srNo}</Text>
              </>
            ) : (
              <Text className="text-base font-semibold text-foreground">{voter.srNo}</Text>
            )}
          </VStack>

          {photo ? (
            <Image
              source={{ uri: photo }}
              recyclingKey={voter.id}
              style={{ width: 40, height: 50, borderRadius: 8, marginRight: 10 }}
              contentFit="cover"
              contentPosition="top"
            />
          ) : null}

          <VStack className="flex-1 pr-2">
            <HStack space="xs" className="items-center">
              <Text
                className="shrink text-base font-semibold uppercase text-foreground"
                numberOfLines={1}
              >
                {voterFullName(voter, language)}
              </Text>
              {voter.isNewEnrollment ? (
                <Badge className="rounded-full bg-success px-2 py-0">
                  <BadgeText className="text-[10px] text-success-foreground">NEW</BadgeText>
                </Badge>
              ) : null}
              {voter.pendingEnroll || voter.dirty ? (
                <Box className="h-2 w-2 rounded-full bg-warning" />
              ) : null}
            </HStack>
            <Text className="text-sm uppercase text-muted-foreground" numberOfLines={1}>
              {voterRelativeName(voter, language) ?? "—"}
            </Text>
            {showHouse && voter.houseNo?.trim() ? (
              <HouseTag houseNo={voter.houseNo} size={houseSize} />
            ) : null}
            <FieldWorkTags voter={voter} />
          </VStack>

          <VStack className="items-end">
            <Text className="text-base font-semibold text-foreground">
              {(voter.sex ?? "?").toUpperCase()}/{voter.age ?? "?"}
            </Text>
            <Text className="text-sm text-muted-foreground">{maskMobile(voter.mobileNo1)}</Text>
          </VStack>
        </HStack>
      </HStack>
    </Pressable>
  );
});

/** The gap between rows, defined once so FlatList does not see a new component each render. */
export function VoterRowGap() {
  return <Box className="h-3" />;
}

/** FlatList settings for voter lists: a screenful first, then small batches. */
export const VOTER_LIST_PROPS = {
  initialNumToRender: 12,
  maxToRenderPerBatch: 10,
  windowSize: 7,
  removeClippedSubviews: true,
} as const;
