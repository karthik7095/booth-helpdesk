import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { FlatList, InteractionManager, Pressable, Switch } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SelectField, type SelectOption } from "@/components/select-field";
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
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { ArrowLeftIcon, Icon, SearchIcon } from "@/components/ui/icon";
import { HStack } from "@/components/ui/hstack";
import { Input, InputField, InputSlot } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { DEFAULT_PARTY_OPTIONS } from "@voter/shared";

import {
  advancedSearchVoters,
  FAVOURABLE_NONE,
  houseKey,
  houseSizes,
  listFavourable,
  listVillages,
  listCommunities,
  NO_LIST_FILTERS,
  searchVoters,
  type ListFilters,
  type LocalVoter,
  type VoteFilter,
  type VoterFilters,
} from "@/lib/db";
import { useAuth } from "@/lib/auth";
import { useLanguage } from "@/lib/language";
import { useRefreshOpenedVoter } from "@/lib/use-refresh-opened-voter";

/** Shared so an empty result does not hand the row renderer a new map each render. */
const NO_SIZES = new Map<string, number>();

const VOTE_OPTIONS: SelectOption<VoteFilter>[] = [
  { value: "all", label: "Vote status" },
  { value: "voted", label: "Voted" },
  { value: "pending", label: "Not voted" },
];

type Form = {
  name: string;
  relation: string;
  houseNo: string;
  mobile: string;
  partNo: string;
  village: string;
  favourable: string;
  vote: VoteFilter;
};

const EMPTY_FORM: Form = {
  name: "",
  relation: "",
  houseNo: "",
  mobile: "",
  partNo: "",
  village: "",
  favourable: "",
  vote: "all",
};

function toFilters(form: Form): VoterFilters {
  const partNo = Number.parseInt(form.partNo, 10);

  return {
    name: form.name,
    relation: form.relation,
    houseNo: form.houseNo,
    mobile: form.mobile,
    partNo: Number.isFinite(partNo) ? partNo : null,
    village: form.village || null,
    favourable: form.favourable,
    vote: form.vote,
  };
}

function FormField({
  placeholder,
  value,
  onChangeText,
  onSubmit,
  numeric = false,
}: {
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  numeric?: boolean;
}) {
  return (
    <Input className="h-14 rounded-lg border-border bg-card px-4">
      <InputField
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        onSubmitEditing={onSubmit}
        returnKeyType="search"
        keyboardType={numeric ? "number-pad" : "default"}
        autoCapitalize="characters"
        autoCorrect={false}
        className="text-base uppercase"
      />
    </Input>
  );
}

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useLanguage();
  const { access } = useAuth();
  const [advanced, setAdvanced] = useState(false);
  // Sort, gender and age from the filter sheet; they apply to both searches.
  const [filters, setFilters] = useState<ListFilters>(NO_LIST_FILTERS);
  const [communities, setCommunities] = useState<string[]>([]);
  // Community is sensitive: offered only where the constituency shows it.
  const showCommunity = access?.showCommunityStats ?? false;

  useEffect(() => {
    if (!showCommunity) return;

    let cancelled = false;

    listCommunities()
      .then((rows) => {
        if (!cancelled) setCommunities(rows);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [showCommunity]);
  const [filtering, setFiltering] = useState(false);

  // Quick search: one box, results as you type.
  const [term, setTerm] = useState("");
  const [onlyNew, setOnlyNew] = useState(false);

  // Advanced search: runs only when Search is tapped. The id makes a repeat
  // tap re-run the query even when the filters haven't changed.
  const [form, setForm] = useState<Form>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState<{
    id: number;
    filters: VoterFilters;
  } | null>(null);
  const [villages, setVillages] = useState<SelectOption<string>[]>([]);
  const [recordedFavourable, setRecordedFavourable] = useState<string[]>([]);

  // The constituency's choices, plus any recorded before an admin removed them.
  // An access saved by an older build has no list, so fall back to the default.
  const partyOptions: string[] = access?.partyOptions ?? [...DEFAULT_PARTY_OPTIONS];
  const favourableOptions: SelectOption<string>[] = [
    { value: "", label: "All" },
    ...[
      ...partyOptions,
      ...recordedFavourable.filter((party) => !partyOptions.includes(party)),
    ].map((party) => ({ value: party, label: party })),
    { value: FAVOURABLE_NONE, label: "Not recorded" },
  ];

  // Results are tagged with the query that produced them, so "searching" is
  // simply "the latest results are for a different query".
  const [loaded, setLoaded] = useState<{
    key: string;
    rows: LocalVoter[];
    sizes: Map<string, number>;
  } | null>(null);
  const filterKey = JSON.stringify(filters);
  const queryKey = advanced
    ? submitted
      ? `advanced:${submitted.id}:${filterKey}`
      : null
    : `quick:${onlyNew}:${filterKey}:${term}`;
  const mode = advanced ? "advanced:" : "quick:";
  const results = queryKey && loaded?.key.startsWith(mode) ? loaded.rows : [];
  const sizes = loaded?.sizes ?? NO_SIZES;
  const searching = queryKey !== null && loaded?.key !== queryKey;

  // Only advanced search uses the village list, so it is not read until then.
  const villagesRequested = useRef(false);

  useEffect(() => {
    if (!advanced || villagesRequested.current) return;

    villagesRequested.current = true;
    listVillages()
      .then((rows) =>
        setVillages([
          { value: "", label: "None" },
          ...rows.map((village) => ({ value: village, label: village })),
        ]),
      )
      .catch((error: unknown) => {
        villagesRequested.current = false;
        console.warn("village list failed", error);
      });
    listFavourable()
      .then(setRecordedFavourable)
      .catch((error: unknown) => console.warn("favourable list failed", error));
  }, [advanced]);

  useEffect(() => {
    if (queryKey === null) return;

    let cancelled = false;

    // Quick search is debounced so a long roll isn't queried on every keystroke.
    let task: { cancel: () => void } | null = null;
    const timer = setTimeout(
      () => {
        // The query runs on the JS thread; waiting for the screen's slide-in
        // to finish keeps the opening animation smooth.
        task = InteractionManager.runAfterInteractions(() => {
          if (cancelled) return;

          const query =
            submitted && advanced
              ? advancedSearchVoters(submitted.filters, filters)
              : searchVoters(term, { onlyNew, filters });

          query
            .then(async (rows) => ({
              rows,
              sizes: filters.sort === "house" ? await houseSizes(rows) : new Map<string, number>(),
            }))
            .catch((error: unknown) => {
              // Surface the reason instead of silently showing an empty list.
              console.warn("voter search failed", error);
              return { rows: [], sizes: new Map<string, number>() };
            })
            .then((result) => {
              if (!cancelled) setLoaded({ key: queryKey, ...result });
            });
        });
      },
      advanced ? 0 : 250,
    );

    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [queryKey, advanced, submitted, term, onlyNew, filters]);

  const update = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const runSearch = () =>
    setSubmitted((current) => ({
      id: (current?.id ?? 0) + 1,
      filters: toFilters(form),
    }));

  const reset = () => {
    setForm(EMPTY_FORM);
    setSubmitted(null);
  };

  const countLabel = `${results.length.toLocaleString()}${
    results.length >= (advanced ? 500 : 200) ? "+" : ""
  } voters`;

  const quickSearch = (
    <VStack space="md" className="pb-2">
      <HStack space="sm">
        <Input className="h-12 flex-1 rounded-2xl border-border bg-card px-3">
          <InputSlot>
            <Icon as={SearchIcon} className="text-muted-foreground" />
          </InputSlot>
          <InputField
            placeholder="Name, relative, voter ID, house, mobile, booth"
            value={term}
            onChangeText={setTerm}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            className="text-base"
          />
        </Input>
        <FilterButton filters={filters} onPress={() => setFiltering(true)} />
      </HStack>

      <HStack space="sm">
        <Pressable onPress={() => setOnlyNew(false)}>
          <Badge className={`rounded-full ${onlyNew ? "bg-secondary" : "bg-primary"}`}>
            <BadgeText
              className={onlyNew ? "text-secondary-foreground" : "text-primary-foreground"}
            >
              All voters
            </BadgeText>
          </Badge>
        </Pressable>
        <Pressable onPress={() => setOnlyNew(true)}>
          <Badge className={`rounded-full ${onlyNew ? "bg-primary" : "bg-secondary"}`}>
            <BadgeText
              className={onlyNew ? "text-primary-foreground" : "text-secondary-foreground"}
            >
              Added by us
            </BadgeText>
          </Badge>
        </Pressable>
      </HStack>
    </VStack>
  );

  const advancedForm = (
    <VStack space="lg" className="pb-2">
      <FormField
        placeholder="Name"
        value={form.name}
        onChangeText={(value) => update("name", value)}
        onSubmit={runSearch}
      />
      <FormField
        placeholder="Relation name"
        value={form.relation}
        onChangeText={(value) => update("relation", value)}
        onSubmit={runSearch}
      />
      <FormField
        placeholder="House number"
        value={form.houseNo}
        onChangeText={(value) => update("houseNo", value)}
        onSubmit={runSearch}
      />
      <FormField
        placeholder="Mobile number"
        value={form.mobile}
        onChangeText={(value) => update("mobile", value.replace(/\D/g, ""))}
        onSubmit={runSearch}
        numeric
      />
      <SelectField
        label="Village"
        value={form.village}
        options={villages.length ? villages : [{ value: "", label: "None" }]}
        onChange={(value) => update("village", value)}
      />
      <FormField
        placeholder="Booth number"
        value={form.partNo}
        onChangeText={(value) => update("partNo", value.replace(/\D/g, ""))}
        onSubmit={runSearch}
        numeric
      />
      <SelectField
        label="Favourable"
        value={form.favourable}
        options={favourableOptions}
        onChange={(value) => update("favourable", value)}
      />
      <SelectField
        label="Vote Status"
        value={form.vote}
        options={VOTE_OPTIONS}
        onChange={(value) => update("vote", value)}
      />

      <HStack space="md">
        <FilterButton filters={filters} onPress={() => setFiltering(true)} />
        <Button variant="outline" onPress={reset} className="h-12 w-28 rounded-full border-primary">
          <ButtonText className="text-base text-primary">Reset</ButtonText>
        </Button>
        <Button onPress={runSearch} disabled={searching} className="h-12 flex-1 rounded-full">
          {searching ? <ButtonSpinner className="text-primary-foreground" /> : null}
          <ButtonText className="text-base">Search</ButtonText>
        </Button>
      </HStack>
    </VStack>
  );

  const showSkeleton = searching && results.length === 0 && queryKey !== null;

  const header = (
    <VStack space="md">
      <HStack className="items-center justify-between pb-2">
        <Heading size="2xl" className="text-foreground">
          Search
        </Heading>
        <HStack space="sm" className="items-center">
          <Text className="text-base text-foreground">Advance Search</Text>
          <Switch value={advanced} onValueChange={setAdvanced} />
        </HStack>
      </HStack>

      {advanced ? advancedForm : quickSearch}

      {activeFilterCount(filters) > 0 ? (
        <FilterChips filters={filters} onChange={setFilters} />
      ) : null}

      {!advanced || submitted ? (
        <VStack space="sm" className="pt-2">
          <Text className="text-sm font-medium text-muted-foreground">{countLabel}</Text>
          <HStack className="border-b border-border px-1 pb-2">
            <VStack className="w-16">
              <Text className="text-sm font-semibold text-foreground">Booth</Text>
              <Text className="text-xs text-muted-foreground">S NO</Text>
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
        </VStack>
      ) : null}

      {showSkeleton ? <VoterListSkeleton /> : null}
    </VStack>
  );

  const emptyMessage = advanced
    ? submitted
      ? "No voters match those details."
      : "Fill in any field and tap Search."
    : onlyNew
      ? "No voters have been added from this phone yet."
      : "No voters match that search.";

  const setRows = useCallback(
    (update: SetStateAction<LocalVoter[]>) =>
      setLoaded((prev) =>
        prev ? { ...prev, rows: typeof update === "function" ? update(prev.rows) : update } : prev,
      ),
    [],
  );
  const pushVoter = useCallback((id: string) => router.push(`/voter/${id}`), [router]);
  const openVoter = useRefreshOpenedVoter(setRows, pushVoter);
  const houseMode = filters.sort === "house";
  const renderVoter = useCallback(
    ({ item }: { item: LocalVoter }) => (
      <VoterRow
        voter={item}
        language={language}
        showBooth={true}
        showHouse={houseMode}
        houseSize={
          houseMode && item.houseNo ? sizes.get(houseKey(item.partNo, item.houseNo)) : undefined
        }
        onOpen={openVoter}
      />
    ),
    [language, houseMode, sizes, openVoter],
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
        <Heading size="lg" className="text-foreground">
          Search Voter
        </Heading>
      </HStack>

      <FlatList
        data={showSkeleton ? [] : results}
        keyExtractor={(voter) => voter.id}
        ListHeaderComponent={header}
        ListHeaderComponentStyle={{ marginBottom: 12 }}
        // The first screenful paints before the rest of the 200 rows are laid out.
        renderScrollComponent={(props) => <KeyboardAwareScrollView {...props} bottomOffset={24} />}
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
        ItemSeparatorComponent={VoterRowGap}
        {...VOTER_LIST_PROPS}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        ListEmptyComponent={
          showSkeleton ? null : (
            <Text className="pt-10 text-center text-muted-foreground">{emptyMessage}</Text>
          )
        }
        renderItem={renderVoter}
      />

      <VoterFilterSheet
        open={filtering}
        communities={showCommunity ? communities : []}
        showVoted={access?.enableVoteStatus ?? false}
        filters={filters}
        onClose={() => setFiltering(false)}
        onApply={(next) => {
          setFiltering(false);
          setFilters(next);
        }}
      />
    </Box>
  );
}
