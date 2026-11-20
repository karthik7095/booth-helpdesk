import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FilterIcon } from "@/components/icons";
import { Box } from "@/components/ui/box";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { CloseIcon, Icon } from "@/components/ui/icon";
import { Input, InputField } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import {
  NO_LIST_FILTERS,
  type GenderFilter,
  type ListFilters,
  type ListSort,
  type VotedFilter,
} from "@/lib/db";

const SORTS: { value: ListSort; label: string; hint: string }[] = [
  { value: "serial", label: "Serial no.", hint: "Roll order" },
  { value: "house", label: "Biggest houses", hint: "Most voters first" },
];

const GENDERS: { value: GenderFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "other", label: "Third gender" },
];

const VOTED: { value: VotedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "voted", label: "Voted" },
  { value: "not_voted", label: "Not voted" },
];

const AGE_PRESETS: { label: string; min: number; max: number | null }[] = [
  { label: "18–25", min: 18, max: 25 },
  { label: "26–35", min: 26, max: 35 },
  { label: "36–45", min: 36, max: 45 },
  { label: "46–60", min: 46, max: 60 },
  { label: "60+", min: 60, max: null },
  { label: "First-time (18–19)", min: 18, max: 19 },
];

/** "18–25 yrs", "60+ yrs", "Up to 30 yrs", or null for any age. */
export function ageRangeLabel(filters: Pick<ListFilters, "minAge" | "maxAge">): string | null {
  const { minAge, maxAge } = filters;

  if (minAge === null && maxAge === null) return null;
  if (maxAge === null) return `${minAge}+ yrs`;
  if (minAge === null) return `Up to ${maxAge} yrs`;

  return `${minAge}–${maxAge} yrs`;
}

/** How many of the sheet's choices differ from the plain roll-order list. */
export function activeFilterCount(filters: ListFilters): number {
  return (
    (filters.sort === "house" ? 1 : 0) +
    (filters.gender !== "all" ? 1 : 0) +
    (ageRangeLabel(filters) ? 1 : 0) +
    (filters.remarksOnly ? 1 : 0) +
    (filters.community ? 1 : 0) +
    (filters.voted !== "all" ? 1 : 0)
  );
}

const ageText = (value: number | null) => (value === null ? "" : String(value));

function parseAge(text: string): number | null {
  const value = Number.parseInt(text, 10);

  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 120) : null;
}

/** A pill or tile that shows whether it is picked; tapping it picks it. */
function Choice({
  selected,
  onPress,
  className,
  children,
}: {
  selected: boolean;
  onPress: () => void;
  className: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      className={`border-[1.5px] ${selected ? "border-primary bg-primary-light" : "border-border bg-card"} ${className}`}
    >
      {children}
    </Pressable>
  );
}

/** The square button beside the search box; filled in once any choice is on. */
export function FilterButton({ filters, onPress }: { filters: ListFilters; onPress: () => void }) {
  const active = activeFilterCount(filters);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? `Filters, ${active} on` : "Filters"}
    >
      <Box
        className={`h-12 w-12 items-center justify-center rounded-2xl border ${
          active ? "border-primary bg-primary" : "border-border bg-card"
        }`}
      >
        <Icon
          as={FilterIcon}
          className={`h-5 w-5 ${active ? "text-primary-foreground" : "text-foreground"}`}
        />
        {active ? (
          <Box className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand-accent px-1">
            <Text className="text-[11px] font-bold text-brand-accent-foreground">{active}</Text>
          </Box>
        ) : null}
      </Box>
    </Pressable>
  );
}

/** "H.No 4-12 · 6 voters" under a voter while the list is sorted by house. */
export function HouseTag({ houseNo, size }: { houseNo: string; size: number | undefined }) {
  return (
    <Box className="mt-1 self-start rounded-full bg-brand-accent/15 px-2 py-0.5">
      <Text className="text-xs font-semibold text-foreground" numberOfLines={1}>
        H.No {houseNo}
        {size ? ` · ${size} ${size === 1 ? "voter" : "voters"}` : ""}
      </Text>
    </Box>
  );
}

/** The choices in force, each removable on its own, under the search box. */
export function FilterChips({
  filters,
  onChange,
}: {
  filters: ListFilters;
  onChange: (filters: ListFilters) => void;
}) {
  const age = ageRangeLabel(filters);
  const chips: { label: string; clear: Partial<ListFilters> }[] = [
    ...(filters.sort === "house"
      ? [{ label: "Biggest houses first", clear: { sort: "serial" as const } }]
      : []),
    ...(filters.gender !== "all"
      ? [
          {
            label: GENDERS.find((option) => option.value === filters.gender)?.label ?? "",
            clear: { gender: "all" as const },
          },
        ]
      : []),
    ...(age ? [{ label: `Age ${age}`, clear: { minAge: null, maxAge: null } }] : []),
    ...(filters.remarksOnly ? [{ label: "Has remark", clear: { remarksOnly: false } }] : []),
    ...(filters.community ? [{ label: filters.community, clear: { community: null } }] : []),
    ...(filters.voted !== "all"
      ? [
          {
            label: filters.voted === "voted" ? "Voted" : "Not voted",
            clear: { voted: "all" as const },
          },
        ]
      : []),
  ];

  if (chips.length === 0) return null;

  return (
    <HStack className="flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <Pressable
          key={chip.label}
          onPress={() => onChange({ ...filters, ...chip.clear })}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${chip.label}`}
        >
          <HStack
            space="xs"
            className="h-8 items-center rounded-full border border-primary bg-primary-light pl-3 pr-2.5"
          >
            <Text className="text-sm font-semibold text-primary">{chip.label}</Text>
            <Icon as={CloseIcon} className="h-3.5 w-3.5 text-primary" />
          </HStack>
        </Pressable>
      ))}
      <Pressable onPress={() => onChange(NO_LIST_FILTERS)} accessibilityRole="button">
        <Text className="px-1 py-1.5 text-sm font-semibold text-muted-foreground underline">
          Clear all
        </Text>
      </Pressable>
    </HStack>
  );
}

/**
 * Sort, gender and age for a voter list, in a bottom sheet. Choices are a
 * draft until Apply, so the list behind does not re-query on every tap. With
 * `countFor` each gender option, and the Apply button, show how many voters
 * the choice would leave. `communities` adds a community choice; pass it only
 * where the constituency has community switched on, and `showVoted` a voted
 * choice where it has vote status switched on.
 */
type SheetProps = {
  filters: ListFilters;
  communities?: string[];
  showVoted?: boolean;
  onApply: (filters: ListFilters) => void;
  onClose: () => void;
  countFor?: (filters: ListFilters) => Promise<Record<GenderFilter, number>>;
};

export function VoterFilterSheet({ open, ...props }: SheetProps & { open: boolean }) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
      statusBarTranslucent
    >
      {/* Mounted per opening, so each starts from what is applied, not an abandoned draft. */}
      {open ? <SheetBody {...props} /> : null}
    </Modal>
  );
}

function SheetBody({
  filters,
  communities = [],
  showVoted = false,
  onApply,
  onClose,
  countFor,
}: SheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(filters);
  // Typed text, kept apart from the numbers so a half-typed age is not rewritten.
  const [minText, setMinText] = useState(ageText(filters.minAge));
  const [maxText, setMaxText] = useState(ageText(filters.maxAge));
  const [counts, setCounts] = useState<Record<GenderFilter, number> | null>(null);

  useEffect(() => {
    if (!countFor) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      countFor(draft)
        .then((next) => {
          if (!cancelled) setCounts(next);
        })
        .catch(() => undefined);
    }, 150);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [countFor, draft]);

  const update = (patch: Partial<ListFilters>) => setDraft((current) => ({ ...current, ...patch }));

  const setAges = (minAge: number | null, maxAge: number | null) => {
    update({ minAge, maxAge });
    setMinText(ageText(minAge));
    setMaxText(ageText(maxAge));
  };

  const apply = () => {
    // "From 60 to 40" is read as the range it plainly means.
    const { minAge, maxAge } = draft;
    const swapped = minAge !== null && maxAge !== null && minAge > maxAge;

    onApply(swapped ? { ...draft, minAge: maxAge, maxAge: minAge } : draft);
  };

  const age = ageRangeLabel(draft);
  const matching = counts ? counts[draft.gender] : null;

  return (
    <KeyboardAvoidingView behavior="padding" className="flex-1">
      <Pressable
        className="flex-1 bg-black/40"
        onPress={onClose}
        accessibilityLabel="Close filters"
      />
      <Box
        className="max-h-[90%] rounded-t-3xl bg-card"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <Box className="mt-2.5 h-1.5 w-10 self-center rounded-full bg-border" />

        <HStack className="items-center justify-between px-5 pt-2">
          <Heading size="lg" className="text-foreground">
            Filter voters
          </Heading>
          <Pressable onPress={onClose} accessibilityLabel="Close" className="p-2.5">
            <Icon as={CloseIcon} className="h-5 w-5 text-muted-foreground" />
          </Pressable>
        </HStack>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 20,
            paddingBottom: 8,
            gap: 20,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <VStack space="sm">
            <Text className="text-xs font-bold tracking-wider text-muted-foreground">SORT BY</Text>
            <HStack space="sm">
              {SORTS.map((option) => (
                <Choice
                  key={option.value}
                  selected={draft.sort === option.value}
                  onPress={() => update({ sort: option.value })}
                  className="h-14 flex-1 justify-center rounded-xl px-3.5"
                >
                  <Text
                    className={`text-base font-semibold ${
                      draft.sort === option.value ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {option.label}
                  </Text>
                  <Text className="text-xs text-muted-foreground">{option.hint}</Text>
                </Choice>
              ))}
            </HStack>
          </VStack>

          <VStack space="sm">
            <Text className="text-xs font-bold tracking-wider text-muted-foreground">GENDER</Text>
            <HStack className="flex-wrap gap-2.5">
              {GENDERS.map((option) => (
                <Choice
                  key={option.value}
                  selected={draft.gender === option.value}
                  onPress={() => update({ gender: option.value })}
                  className="h-13 basis-[47%] grow flex-row items-center justify-between rounded-xl px-3.5"
                >
                  <Text
                    className={`text-base font-semibold ${
                      draft.gender === option.value ? "text-primary" : "text-foreground"
                    }`}
                  >
                    {option.label}
                  </Text>
                  {counts ? (
                    <Text
                      className={`text-sm font-semibold ${
                        draft.gender === option.value ? "text-primary" : "text-muted-foreground"
                      }`}
                    >
                      {counts[option.value].toLocaleString()}
                    </Text>
                  ) : null}
                </Choice>
              ))}
            </HStack>
          </VStack>

          <VStack space="sm">
            <HStack className="items-baseline justify-between">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">AGE</Text>
              <Text className="text-sm font-semibold text-primary">{age ?? "Any age"}</Text>
            </HStack>
            <HStack className="flex-wrap gap-2">
              {AGE_PRESETS.map((preset) => {
                const selected = draft.minAge === preset.min && draft.maxAge === preset.max;

                return (
                  <Choice
                    key={preset.label}
                    selected={selected}
                    onPress={() =>
                      selected ? setAges(null, null) : setAges(preset.min, preset.max)
                    }
                    className="h-10 justify-center rounded-full px-3.5"
                  >
                    <Text
                      className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}
                    >
                      {preset.label}
                    </Text>
                  </Choice>
                );
              })}
            </HStack>
            <HStack space="sm" className="items-end pt-1">
              <VStack space="xs" className="flex-1">
                <Text className="text-xs font-semibold text-muted-foreground">From age</Text>
                <Input className="h-12 rounded-xl border-border bg-background px-3">
                  <InputField
                    value={minText}
                    placeholder="18"
                    keyboardType="number-pad"
                    maxLength={3}
                    onChangeText={(text) => {
                      const digits = text.replace(/\D/g, "");
                      setMinText(digits);
                      update({ minAge: parseAge(digits) });
                    }}
                    className="text-base"
                  />
                </Input>
              </VStack>
              <Text className="h-12 pt-3 text-muted-foreground">–</Text>
              <VStack space="xs" className="flex-1">
                <Text className="text-xs font-semibold text-muted-foreground">To age</Text>
                <Input className="h-12 rounded-xl border-border bg-background px-3">
                  <InputField
                    value={maxText}
                    placeholder="120"
                    keyboardType="number-pad"
                    maxLength={3}
                    onChangeText={(text) => {
                      const digits = text.replace(/\D/g, "");
                      setMaxText(digits);
                      update({ maxAge: parseAge(digits) });
                    }}
                    className="text-base"
                  />
                </Input>
              </VStack>
            </HStack>
          </VStack>

          {showVoted ? (
            <VStack space="sm">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">
                VOTED STATUS
              </Text>
              <HStack space="sm">
                {VOTED.map((option) => {
                  const selected = draft.voted === option.value;

                  return (
                    <Choice
                      key={option.value}
                      selected={selected}
                      onPress={() => update({ voted: option.value })}
                      className="h-12 flex-1 items-center justify-center rounded-xl px-2"
                    >
                      <Text
                        className={`text-base font-semibold ${selected ? "text-primary" : "text-foreground"}`}
                      >
                        {option.label}
                      </Text>
                    </Choice>
                  );
                })}
              </HStack>
            </VStack>
          ) : null}

          {communities.length > 0 ? (
            <VStack space="sm">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">
                COMMUNITY
              </Text>
              <HStack className="flex-wrap gap-2">
                {[null, ...communities].map((community) => {
                  const selected = draft.community === community;

                  return (
                    <Choice
                      key={community ?? "all"}
                      selected={selected}
                      onPress={() => update({ community })}
                      className="h-10 justify-center rounded-full px-3.5"
                    >
                      <Text
                        className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}
                      >
                        {community ?? "All"}
                      </Text>
                    </Choice>
                  );
                })}
              </HStack>
            </VStack>
          ) : null}

          <VStack space="sm">
            <Text className="text-xs font-bold tracking-wider text-muted-foreground">REMARKS</Text>
            <Choice
              selected={draft.remarksOnly}
              onPress={() => update({ remarksOnly: !draft.remarksOnly })}
              className="h-14 justify-center rounded-xl px-3.5"
            >
              <Text
                className={`text-base font-semibold ${
                  draft.remarksOnly ? "text-primary" : "text-foreground"
                }`}
              >
                Has remark
              </Text>
              <Text className="text-xs text-muted-foreground">
                Only voters with a follow-up remark, pending or done
              </Text>
            </Choice>
          </VStack>
        </ScrollView>

        <HStack space="md" className="px-5 pt-3">
          <Button
            variant="outline"
            className="h-13 flex-1 rounded-xl border-border"
            onPress={() => {
              update({
                sort: "serial",
                gender: "all",
                remarksOnly: false,
                community: null,
                voted: "all",
              });
              setAges(null, null);
            }}
          >
            <ButtonText className="text-foreground">Reset</ButtonText>
          </Button>
          <Button className="h-13 flex-[2] rounded-xl" onPress={apply}>
            <ButtonText>
              {matching === null ? "Apply" : `Apply · ${matching.toLocaleString()} voters`}
            </ButtonText>
          </Button>
        </HStack>
      </Box>
    </KeyboardAvoidingView>
  );
}
