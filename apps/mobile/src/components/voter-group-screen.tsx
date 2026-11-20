import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { FlatList, InteractionManager, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FamilyList } from "@/components/family-list";
import { FollowUpList } from "@/components/follow-up-list";
import { VoterListSkeleton } from "@/components/skeletons";
import { VOTER_LIST_PROPS, VoterRow, VoterRowGap } from "@/components/voter-row";
import {
  activeFilterCount,
  FilterButton,
  FilterChips,
  VoterFilterSheet,
} from "@/components/voter-filter-sheet";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, Icon, SearchIcon } from "@/components/ui/icon";
import { Input, InputField, InputSlot } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import {
  boothFilterCounts,
  boothStats,
  houseKey,
  houseSizes,
  listBoothVoters,
  listCommunities,
  NO_LIST_FILTERS,
  type ListFilters,
  type LocalVoter,
  type StatRow,
  type VoterScope,
} from "@/lib/db";
import { useLanguage } from "@/lib/language";
import { useRefreshOpenedVoter } from "@/lib/use-refresh-opened-voter";

type BoothTab = "voters" | "families" | "followup" | "stats";

const TABS: { value: BoothTab; label: string }[] = [
  { value: "voters", label: "Voters" },
  { value: "families", label: "Families" },
  { value: "followup", label: "Follow-up" },
  { value: "stats", label: "Statistics" },
];

/**
 * Horizontal bars: the comparison is length against a shared baseline, and each
 * row carries its own label and count, so nothing depends on colour alone.
 */
function BarChart({ rows, total }: { rows: StatRow[]; total: number }) {
  if (rows.length === 0) {
    return <Text className="text-sm text-muted-foreground">Nothing recorded here yet.</Text>;
  }

  const largest = Math.max(...rows.map((row) => row.count), 1);

  return (
    <VStack space="sm">
      {rows.map((row) => (
        <VStack key={row.label} space="xs">
          <HStack className="justify-between">
            <Text className="flex-1 pr-3 text-sm text-foreground" numberOfLines={1}>
              {row.label}
            </Text>
            <Text className="text-sm text-muted-foreground">
              {row.count.toLocaleString()}
              {total > 0 ? ` · ${Math.round((row.count / total) * 100)}%` : ""}
            </Text>
          </HStack>

          <Box className="h-2.5 w-full overflow-hidden rounded-full bg-secondary">
            <Box
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.max(2, (row.count / largest) * 100)}%` }}
            />
          </Box>
        </VStack>
      ))}
    </VStack>
  );
}

/**
 * One booth's voters, families, follow-ups and statistics; or one gram
 * panchayat ward's, which can span booths, so its rows show the booth too.
 * `scope` must be stable between renders (a number, or a memoized object).
 */
export function VoterGroupScreen({ scope, title }: { scope: VoterScope; title: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useLanguage();
  const { access } = useAuth();
  const booth = scope;
  const isWard = typeof scope === "object" && "wardNo" in scope;
  const noun = isWard ? "ward" : "booth";

  const [tab, setTab] = useState<BoothTab>("voters");
  const [term, setTerm] = useState("");
  const [filters, setFilters] = useState<ListFilters>(NO_LIST_FILTERS);
  const [filtering, setFiltering] = useState(false);
  const [voters, setVoters] = useState<LocalVoter[]>([]);
  /** Voters per house, for the tag shown while sorted by house. */
  const [sizes, setSizes] = useState<Map<string, number>>(new Map());
  const [loadingVoters, setLoadingVoters] = useState(true);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof boothStats>> | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [communities, setCommunities] = useState<string[]>([]);
  // Community is sensitive: offered only where the constituency shows it.
  const showCommunity = access?.showCommunityStats ?? false;

  useEffect(() => {
    if (!showCommunity) return;

    let cancelled = false;

    listCommunities(booth)
      .then((rows) => {
        if (!cancelled) setCommunities(rows);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [booth, showCommunity]);

  useEffect(() => {
    let cancelled = false;

    // Debounced so a long booth roll isn't queried on every keystroke, and
    // held until the screen has slid in, since the query holds the JS thread.
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(() => {
      setLoadingVoters(true);
      task = InteractionManager.runAfterInteractions(() => {
        if (cancelled) return;

        listBoothVoters(booth, { term, filters })
          .then(async (rows) => {
            const houses =
              filters.sort === "house" ? await houseSizes(rows) : new Map<string, number>();

            if (!cancelled) {
              setVoters(rows);
              setSizes(houses);
            }
          })
          .catch((error: unknown) => {
            // Surface the reason instead of showing an empty list.
            console.warn("booth voter list failed", error);
            if (!cancelled) setVoters([]);
          })
          .finally(() => {
            if (!cancelled) setLoadingVoters(false);
          });
      });
    }, 250);

    return () => {
      cancelled = true;
      task?.cancel();
      clearTimeout(timer);
    };
  }, [booth, term, filters]);

  const countFor = useCallback(
    (draft: ListFilters) => boothFilterCounts(booth, term, draft),
    [booth, term],
  );

  useEffect(() => {
    let cancelled = false;

    boothStats(booth)
      .then((rows) => {
        if (!cancelled) setStats(rows);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingStats(false);
      });

    return () => {
      cancelled = true;
    };
  }, [booth]);

  // An access saved by an older build has no switches, so fall back to the defaults.
  const sections = stats
    ? [
        {
          title: "Gender",
          rows: stats.gender,
          show: access?.showGenderStats ?? true,
        },
        { title: "Age", rows: stats.age, show: true },
        {
          title: "Religion",
          rows: stats.religion,
          show: access?.showReligionStats ?? true,
        },
        {
          title: "Community",
          rows: stats.community,
          show: access?.showCommunityStats ?? false,
        },
      ].filter((section) => section.show)
    : [];

  const pushVoter = useCallback((id: string) => router.push(`/voter/${id}`), [router]);
  const openVoter = useRefreshOpenedVoter(setVoters, pushVoter);
  const houseMode = filters.sort === "house";
  const renderVoter = useCallback(
    ({ item }: { item: LocalVoter }) => (
      <VoterRow
        voter={item}
        language={language}
        showBooth={isWard}
        showHouse={houseMode}
        houseSize={
          houseMode && item.houseNo ? sizes.get(houseKey(item.partNo, item.houseNo)) : undefined
        }
        onOpen={openVoter}
      />
    ),
    [language, houseMode, sizes, openVoter, isWard],
  );

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack space="md" className="items-center border-b border-border bg-card px-4 py-3">
        <Pressable
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          hitSlop={16}
          className="-m-2 p-2"
        >
          <Icon as={ArrowLeftIcon} className="h-6 w-6 text-foreground" />
        </Pressable>
        <VStack>
          <Heading size="lg" className="text-foreground">
            {title}
          </Heading>
          {stats ? (
            <Text className="text-xs text-muted-foreground">
              {activeFilterCount(filters) > 0 && !loadingVoters
                ? `${voters.length.toLocaleString()} of ${stats.total.toLocaleString()} voters`
                : `${stats.total.toLocaleString()} voters`}
            </Text>
          ) : null}
        </VStack>
      </HStack>

      <HStack space="sm" className="px-4 py-3">
        {TABS.map((option) => (
          <Pressable key={option.value} onPress={() => setTab(option.value)}>
            <Badge
              className={`rounded-full ${tab === option.value ? "bg-primary" : "bg-secondary"}`}
            >
              <BadgeText
                className={
                  tab === option.value ? "text-primary-foreground" : "text-secondary-foreground"
                }
              >
                {option.label}
              </BadgeText>
            </Badge>
          </Pressable>
        ))}
      </HStack>

      {tab === "families" ? (
        <FamilyList partNo={booth} language={language} />
      ) : tab === "followup" ? (
        <FollowUpList partNo={booth} language={language} onOpen={openVoter} />
      ) : tab === "voters" ? (
        <>
          <HStack space="sm" className="px-4 pb-3">
            <Input className="h-12 flex-1 rounded-2xl border-border bg-card px-3">
              <InputSlot>
                <Icon as={SearchIcon} className="text-muted-foreground" />
              </InputSlot>
              <InputField
                placeholder="Name, relative, voter ID, house, mobile, serial"
                value={term}
                onChangeText={setTerm}
                autoCapitalize="none"
                autoCorrect={false}
                className="text-base"
              />
            </Input>
            <FilterButton filters={filters} onPress={() => setFiltering(true)} />
          </HStack>

          {activeFilterCount(filters) > 0 ? (
            <Box className="px-4 pb-3">
              <FilterChips filters={filters} onChange={setFilters} />
            </Box>
          ) : null}

          <HStack className="border-b border-border px-5 pb-2">
            <VStack className={isWard ? "w-16" : "w-12"}>
              {isWard ? <Text className="text-sm font-semibold text-foreground">BOOTH</Text> : null}
              <Text className={isWard ? "text-xs text-muted-foreground" : "text-sm font-semibold text-foreground"}>
                S NO
              </Text>
            </VStack>
            <VStack className="flex-1">
              <Text className="text-sm font-semibold text-foreground">Name</Text>
              <Text className="text-xs text-muted-foreground">RELATIVE</Text>
            </VStack>
            <VStack className="items-end">
              <Text className="text-sm font-semibold text-foreground">Sex/Age</Text>
              <Text className="text-xs text-muted-foreground">MOBILE</Text>
            </VStack>
          </HStack>

          {loadingVoters && voters.length === 0 ? (
            <VoterListSkeleton />
          ) : (
            <FlatList
              data={voters}
              keyExtractor={(voter) => voter.id}
              contentContainerStyle={{
                padding: 16,
                paddingBottom: insets.bottom + 24,
              }}
              ItemSeparatorComponent={VoterRowGap}
              {...VOTER_LIST_PROPS}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text className="pt-10 text-center text-muted-foreground">
                  {activeFilterCount(filters) > 0
                    ? `No voters in this ${noun} match these filters.`
                    : term
                      ? `No voters in this ${noun} match that search.`
                      : `No voters on this ${noun} yet.`}
                </Text>
              }
              renderItem={renderVoter}
            />
          )}
        </>
      ) : loadingStats ? (
        <VoterListSkeleton rows={5} />
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 20,
            paddingBottom: insets.bottom + 24,
          }}
        >
          <VStack space="xl">
            {sections.length === 0 ? (
              <Text className="text-center text-sm text-muted-foreground">
                Statistics are switched off for this constituency.
              </Text>
            ) : null}
            {sections.map((section) => (
              <VStack key={section.title} space="md">
                <Text className="text-base font-semibold text-foreground">{section.title}</Text>
                <Box className="rounded-2xl border border-border bg-card p-4">
                  <BarChart rows={section.rows} total={stats?.total ?? 0} />
                </Box>
              </VStack>
            ))}
          </VStack>
        </ScrollView>
      )}

      <VoterFilterSheet
        open={filtering}
        communities={showCommunity ? communities : []}
        showVoted={access?.enableVoteStatus ?? false}
        filters={filters}
        countFor={countFor}
        onClose={() => setFiltering(false)}
        onApply={(next) => {
          setFiltering(false);
          setFilters(next);
        }}
      />
    </Box>
  );
}
