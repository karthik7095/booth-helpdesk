import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, FlatList, InteractionManager, Modal, Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FamilyIcon, FilterIcon, PrinterIcon } from "@/components/icons";
import { VoterListSkeleton } from "@/components/skeletons";
import { VoterRow } from "@/components/voter-row";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon, Icon, SearchIcon } from "@/components/ui/icon";
import { Input, InputField, InputSlot } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { listBoothVoters, type LocalVoter, type VoterScope } from "@/lib/db";
import type { NameLanguage } from "@/lib/language";
import { syncIfOnline } from "@/lib/sync";
import { useRefreshOpenedVoter } from "@/lib/use-refresh-opened-voter";
import { printVoter, voterFullName, voterRelativeName } from "@/lib/voter-actions";

type Gender = "all" | "M" | "F" | "other";
type FamilySort = "size" | "house";
type Filters = { gender: Gender; min: string; max: string; surname: string; sort: FamilySort };

const NO_FILTERS: Filters = { gender: "all", min: "", max: "", surname: "", sort: "size" };

const GENDERS: { id: Gender; label: string }[] = [
  { id: "all", label: "All" },
  { id: "M", label: "Male" },
  { id: "F", label: "Female" },
  { id: "other", label: "Other" },
];

const AGE_PRESETS: { label: string; min: number; max: number | null }[] = [
  { label: "18–25", min: 18, max: 25 },
  { label: "26–35", min: 26, max: 35 },
  { label: "36–45", min: 36, max: 45 },
  { label: "46–60", min: 46, max: 60 },
  { label: "60+", min: 60, max: null },
  { label: "First-time (18–19)", min: 18, max: 19 },
];

function genderOf(voter: LocalVoter): Gender {
  const sex = (voter.sex ?? "").trim().toUpperCase();

  if (sex.startsWith("M")) return "M";
  if (sex.startsWith("F")) return "F";

  return "other";
}

const surnames = new WeakMap<LocalVoter, string>();

const nameWords = (text: string | null) =>
  (text ?? "")
    .toUpperCase()
    .split(/[\s.,]+/)
    .filter((word) => word.length > 1);

/**
 * Works out every voter's surname on a booth, once. The roll's own surname
 * column wins when it has one. Rolls made by the converter carry the whole name
 * in one field, so there the surname is the word the name shares with the
 * relative's ("BODDU PADMA", "BODDU SRINIVAS"). Where nothing is shared (a wife
 * listed against her husband's first name), it is taken from whichever end of
 * the name the rest of the booth puts it at: first on Telugu rolls, last on
 * English and Marathi ones.
 */
function learnSurnames(voters: LocalVoter[]): void {
  const unresolved: string[][] = [];
  const unresolvedVoters: LocalVoter[] = [];
  let first = 0;
  let last = 0;

  for (const voter of voters) {
    const own = nameWords(voter.eLastName || voter.lLastName)[0];
    const name = nameWords(voterFullName(voter));
    const relative = new Set(nameWords(voterRelativeName(voter)));
    // Given-name parts like RAO or KUMAR are shared too ("SRINIVASA RAO MANDA",
    // "APPALA RAO MANDA"), so a shared word at either end of the name wins.
    const atStart = name.length > 1 && relative.has(name[0]);
    const atEnd = name.length > 1 && relative.has(name[name.length - 1]);
    const shared = name.findIndex((word) => relative.has(word));

    if (own) {
      surnames.set(voter, own);
    } else if (atStart !== atEnd) {
      surnames.set(voter, atStart ? name[0] : name[name.length - 1]);

      if (atStart) first += 1;
      else last += 1;
    } else if (shared >= 0 && !atStart) {
      surnames.set(voter, name[shared]);
    } else {
      unresolved.push(name);
      unresolvedVoters.push(voter);
    }
  }

  unresolvedVoters.forEach((voter, index) => {
    const name = unresolved[index];

    surnames.set(voter, (last > first ? name[name.length - 1] : name[0]) ?? "");
  });
}

function surnameOf(voter: LocalVoter): string {
  if (!surnames.has(voter)) learnSurnames([voter]);

  return surnames.get(voter) ?? "";
}

function matchesFilters(voter: LocalVoter, filters: Filters): boolean {
  if (filters.gender !== "all" && genderOf(voter) !== filters.gender) return false;
  if (filters.surname && surnameOf(voter) !== filters.surname) return false;

  const min = filters.min === "" ? null : Number(filters.min);
  const max = filters.max === "" ? null : Number(filters.max);

  // A voter with no age on the roll can't be placed in a range, so a range hides them.
  if ((min != null || max != null) && voter.age == null) return false;
  if (min != null && (voter.age ?? 0) < min) return false;
  if (max != null && (voter.age ?? 0) > max) return false;

  return true;
}

function ageText(filters: Filters): string | null {
  if (filters.min === "" && filters.max === "") return null;
  if (filters.max === "") return `${filters.min}+ yrs`;
  if (filters.min === "") return `Up to ${filters.max} yrs`;

  return `${filters.min}–${filters.max} yrs`;
}

type Family = {
  key: string;
  houseNo: string | null;
  head: LocalVoter;
  /** Most common first; one house can hold more than one family name. */
  surnames: string[];
  members: LocalVoter[];
  males: number;
  females: number;
};

/**
 * Households on this booth, tied together the way the Family screen does it:
 * the same house number in the same village. Voters with no house number on
 * the roll can't be placed, so they share one group at the end.
 */
function groupFamilies(voters: LocalVoter[]): Family[] {
  const groups = new Map<string, LocalVoter[]>();

  for (const voter of voters) {
    const houseNo = voter.houseNo?.trim().toUpperCase() ?? "";
    const key = houseNo ? `${(voter.eVillage ?? "").trim().toUpperCase()}|${houseNo}` : "";
    const members = groups.get(key);

    if (members) members.push(voter);
    else groups.set(key, [voter]);
  }

  return [...groups.entries()].map(([key, members]) => {
    const byAge = [...members].sort((a, b) => (b.age ?? 0) - (a.age ?? 0));
    const head = byAge.find((member) => genderOf(member) === "M") ?? byAge[0];
    const tally = new Map<string, number>();

    for (const member of members) {
      const surname = surnameOf(member);

      if (surname) tally.set(surname, (tally.get(surname) ?? 0) + 1);
    }

    return {
      key,
      houseNo: key ? (members[0].houseNo?.trim() ?? null) : null,
      head,
      surnames: [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([surname]) => surname),
      members,
      males: members.filter((member) => genderOf(member) === "M").length,
      females: members.filter((member) => genderOf(member) === "F").length,
    };
  });
}

const compareHouse = (a: Family, b: Family) =>
  (a.houseNo ?? "").localeCompare(b.houseNo ?? "", undefined, { numeric: true });

function FamilyCard({
  family,
  hits,
  narrowed,
  expanded,
  onToggle,
  onOpen,
  language,
}: {
  family: Family;
  hits: Set<string>;
  narrowed: boolean;
  expanded: boolean;
  onToggle: () => void;
  onOpen: (id: string) => void;
  language: NameLanguage;
}) {
  const router = useRouter();
  const { token } = useAuth();
  const [printing, setPrinting] = useState(false);
  const matching = family.members.filter((member) => hits.has(member.id)).length;
  const others = family.members.filter((member) => member.id !== family.head.id);

  const runPrint = async () => {
    setPrinting(true);

    const outcome = await printVoter(family.head, others, language);

    if (outcome.kind === "failed") Alert.alert("Could not print", outcome.message);

    setPrinting(false);

    if (outcome.kind !== "failed") void outcome.recorded.then(() => syncIfOnline(token));
  };

  return (
    <Box
      className={`overflow-hidden rounded-2xl border bg-card ${
        expanded ? "border-primary" : "border-border"
      }`}
    >
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`House ${family.houseNo ?? "unknown"}, ${family.members.length} voters`}
      >
        <HStack space="md" className="items-center p-3.5">
          <Box className="h-11 w-11 items-center justify-center rounded-xl bg-primary-light">
            <Icon as={FamilyIcon} className="h-6 w-6 text-primary" />
          </Box>

          <VStack className="flex-1">
            <Text className="text-base font-bold uppercase text-foreground" numberOfLines={1}>
              {family.houseNo
                ? family.surnames.length > 2
                  ? `${family.surnames.slice(0, 2).join(", ")} +${family.surnames.length - 2}`
                  : family.surnames.join(", ") || `H.No ${family.houseNo}`
                : "No house number"}
            </Text>
            <Text className="text-sm uppercase text-muted-foreground" numberOfLines={1}>
              {family.houseNo
                ? `H.No ${family.houseNo} · Head: ${voterFullName(family.head, language)}`
                : "Not on any house"}
            </Text>
            <HStack space="xs" className="mt-1 flex-wrap">
              <Badge className="rounded-full bg-secondary px-2 py-0.5">
                <BadgeText className="text-xs text-secondary-foreground">{family.males} M</BadgeText>
              </Badge>
              <Badge className="rounded-full bg-secondary px-2 py-0.5">
                <BadgeText className="text-xs text-secondary-foreground">
                  {family.females} F
                </BadgeText>
              </Badge>
              {narrowed ? (
                <Badge className="rounded-full bg-warning px-2 py-0.5">
                  <BadgeText className="text-xs text-warning-foreground">
                    {matching} of {family.members.length} match
                  </BadgeText>
                </Badge>
              ) : null}
            </HStack>
          </VStack>

          <VStack className="items-center">
            <Text className="text-2xl font-extrabold text-primary">{family.members.length}</Text>
            <Text className="text-xs text-muted-foreground">voters</Text>
          </VStack>
          <Icon
            as={expanded ? ChevronUpIcon : ChevronDownIcon}
            className="h-5 w-5 text-muted-foreground"
          />
        </HStack>
      </Pressable>

      {expanded ? (
        <VStack space="sm" className="border-t border-border p-3">
          {family.members.map((member) => (
            <Box key={member.id} style={{ opacity: narrowed && !hits.has(member.id) ? 0.45 : 1 }}>
              <VoterRow
                voter={member}
                language={language}
                showBooth={false}
                showHouse={false}
                houseSize={undefined}
                onOpen={onOpen}
              />
            </Box>
          ))}

          {family.houseNo ? (
            <HStack space="sm" className="pt-1">
              <Pressable
                onPress={runPrint}
                disabled={printing}
                accessibilityRole="button"
                className="h-11 flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-card"
              >
                <Icon as={PrinterIcon} className="h-5 w-5 text-foreground" />
                <Text className="text-sm font-semibold text-foreground">
                  {printing ? "Printing…" : "Print family slip"}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => router.push(`/family/${family.head.id}`)}
                accessibilityRole="button"
                className="h-11 flex-1 items-center justify-center rounded-xl bg-primary"
              >
                <Text className="text-sm font-semibold text-primary-foreground">Open family</Text>
              </Pressable>
            </HStack>
          ) : null}
        </VStack>
      ) : null}
    </Box>
  );
}

/** Pill and tile buttons share one selected look. */
function choiceClass(selected: boolean): string {
  return selected ? "border-primary bg-primary-light" : "border-border bg-card";
}

function FamilyFilterSheet({
  visible,
  initial,
  voters,
  families,
  onClose,
  onApply,
}: {
  visible: boolean;
  initial: Filters;
  voters: LocalVoter[];
  families: Family[];
  onClose: () => void;
  onApply: (filters: Filters) => void;
}) {
  const insets = useSafeAreaInsets();
  // Remounted on each open (see its key), so it starts from what is applied.
  const [draft, setDraft] = useState(initial);

  const update = (patch: Partial<Filters>) => setDraft((current) => ({ ...current, ...patch }));
  const count = (filters: Filters) =>
    voters.filter((voter) => matchesFilters(voter, filters)).length;
  const familyCount = families.filter((family) =>
    family.members.some((member) => matchesFilters(member, draft)),
  ).length;

  const [surnameTerm, setSurnameTerm] = useState("");
  // Every surname on the booth with its voter count, biggest first.
  const surnameCounts = useMemo(() => {
    const tally = new Map<string, number>();

    for (const voter of voters) {
      const surname = surnameOf(voter);

      if (surname) tally.set(surname, (tally.get(surname) ?? 0) + 1);
    }

    return [...tally.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([surname, total]) => ({ surname, total }));
  }, [voters]);

  const surnameQuery = surnameTerm.trim().toUpperCase();
  const surnameOptions = surnameCounts
    .filter(
      (option) =>
        option.surname !== draft.surname &&
        (!surnameQuery || option.surname.includes(surnameQuery)),
    )
    .slice(0, draft.surname ? 11 : 12);
  const selectedSurname = surnameCounts.find((option) => option.surname === draft.surname);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable className="flex-1 bg-black/40" onPress={onClose} accessibilityLabel="Close filters" />
      <Box className="rounded-t-3xl bg-card px-5 pt-3" style={{ paddingBottom: insets.bottom + 16 }}>
        <Box className="mb-1 h-1.5 w-10 self-center rounded-full bg-border" />
        <HStack className="items-center justify-between">
          <Heading size="lg" className="text-foreground">
            Filter families
          </Heading>
          <Pressable onPress={onClose} accessibilityLabel="Close" className="p-2">
            <Icon as={CloseIcon} className="h-5 w-5 text-muted-foreground" />
          </Pressable>
        </HStack>

        <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 520 }}>
          <VStack space="lg" className="pt-3">
            <VStack space="sm">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">
                SORT FAMILIES BY
              </Text>
              <HStack space="sm">
                {(
                  [
                    { id: "size", label: "Most voters", hint: "Biggest first" },
                    { id: "house", label: "House no.", hint: "Street order" },
                  ] as const
                ).map((option) => (
                  <Pressable
                    key={option.id}
                    onPress={() => update({ sort: option.id })}
                    accessibilityState={{ selected: draft.sort === option.id }}
                    className={`h-14 flex-1 justify-center rounded-2xl border-2 px-3.5 ${choiceClass(
                      draft.sort === option.id,
                    )}`}
                  >
                    <Text
                      className={`text-base font-semibold ${
                        draft.sort === option.id ? "text-primary" : "text-foreground"
                      }`}
                    >
                      {option.label}
                    </Text>
                    <Text className="text-xs text-muted-foreground">{option.hint}</Text>
                  </Pressable>
                ))}
              </HStack>
            </VStack>

            <VStack space="sm">
              <HStack className="items-baseline justify-between">
                <Text className="text-xs font-bold tracking-wider text-muted-foreground">SURNAME</Text>
                <Text className="text-sm font-semibold uppercase text-primary">
                  {draft.surname || "Any surname"}
                </Text>
              </HStack>
              <Input className="h-12 rounded-xl border-border bg-background px-3">
                <InputSlot>
                  <Icon as={SearchIcon} className="text-muted-foreground" />
                </InputSlot>
                <InputField
                  value={surnameTerm}
                  onChangeText={setSurnameTerm}
                  placeholder="Type a surname"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  className="text-base"
                />
              </Input>
              <HStack className="flex-wrap" style={{ gap: 8 }}>
                {[...(selectedSurname ? [selectedSurname] : []), ...surnameOptions].map((option) => {
                  const selected = option.surname === draft.surname;

                  return (
                    <Pressable
                      key={option.surname}
                      onPress={() => update({ surname: selected ? "" : option.surname })}
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${option.surname}, ${option.total} voters`}
                      className={`h-10 flex-row items-center gap-1.5 rounded-full border-2 px-3.5 ${choiceClass(
                        selected,
                      )}`}
                    >
                      <Text
                        className={`text-sm font-semibold uppercase ${
                          selected ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {option.surname}
                      </Text>
                      <Text className={`text-xs ${selected ? "text-primary" : "text-muted-foreground"}`}>
                        {option.total.toLocaleString()}
                      </Text>
                      {selected ? <Icon as={CloseIcon} className="h-3.5 w-3.5 text-primary" /> : null}
                    </Pressable>
                  );
                })}
              </HStack>
              {surnameQuery && surnameOptions.length === 0 && !selectedSurname ? (
                <Text className="text-sm text-muted-foreground">
                  No surname on this booth matches “{surnameTerm.trim()}”.
                </Text>
              ) : null}
            </VStack>

            <VStack space="sm">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">GENDER</Text>
              <HStack className="flex-wrap" style={{ gap: 10 }}>
                {GENDERS.map((gender) => {
                  const selected = draft.gender === gender.id;

                  return (
                    <Pressable
                      key={gender.id}
                      onPress={() => update({ gender: gender.id })}
                      accessibilityState={{ selected }}
                      className={`h-12 flex-row items-center justify-between rounded-2xl border-2 px-3.5 ${choiceClass(
                        selected,
                      )}`}
                      style={{ width: "48%" }}
                    >
                      <Text
                        className={`text-base font-semibold ${
                          selected ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {gender.label}
                      </Text>
                      <Text className={`text-sm ${selected ? "text-primary" : "text-muted-foreground"}`}>
                        {count({ ...draft, gender: gender.id }).toLocaleString()}
                      </Text>
                    </Pressable>
                  );
                })}
              </HStack>
            </VStack>

            <VStack space="sm">
              <HStack className="items-baseline justify-between">
                <Text className="text-xs font-bold tracking-wider text-muted-foreground">AGE</Text>
                <Text className="text-sm font-semibold text-primary">{ageText(draft) ?? "Any age"}</Text>
              </HStack>
              <HStack className="flex-wrap" style={{ gap: 8 }}>
                {AGE_PRESETS.map((preset) => {
                  const min = String(preset.min);
                  const max = preset.max == null ? "" : String(preset.max);
                  const selected = draft.min === min && draft.max === max;

                  return (
                    <Pressable
                      key={preset.label}
                      onPress={() => update(selected ? { min: "", max: "" } : { min, max })}
                      accessibilityState={{ selected }}
                      className={`h-10 justify-center rounded-full border-2 px-3.5 ${choiceClass(selected)}`}
                    >
                      <Text
                        className={`text-sm font-semibold ${
                          selected ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </HStack>
              <HStack space="sm" className="items-end">
                <VStack space="xs" className="flex-1">
                  <Text className="text-xs font-semibold text-muted-foreground">From age</Text>
                  <Input className="h-12 rounded-xl border-border bg-background px-3">
                    <InputField
                      value={draft.min}
                      onChangeText={(text) => update({ min: text.replace(/\D/g, "") })}
                      placeholder="18"
                      keyboardType="number-pad"
                      className="text-base"
                    />
                  </Input>
                </VStack>
                <Text className="pb-3 text-muted-foreground">–</Text>
                <VStack space="xs" className="flex-1">
                  <Text className="text-xs font-semibold text-muted-foreground">To age</Text>
                  <Input className="h-12 rounded-xl border-border bg-background px-3">
                    <InputField
                      value={draft.max}
                      onChangeText={(text) => update({ max: text.replace(/\D/g, "") })}
                      placeholder="120"
                      keyboardType="number-pad"
                      className="text-base"
                    />
                  </Input>
                </VStack>
              </HStack>
            </VStack>
          </VStack>
        </ScrollView>

        <HStack space="md" className="pt-4">
          <Pressable
            onPress={() => setDraft({ ...NO_FILTERS, sort: draft.sort })}
            className="flex-1 items-center justify-center rounded-2xl border-2 border-border py-3.5"
          >
            <Text className="text-base font-semibold text-foreground">Reset</Text>
          </Pressable>
          <Pressable
            onPress={() => onApply(draft)}
            className="flex-[2] items-center justify-center rounded-2xl bg-primary py-3.5"
          >
            <Text className="text-base font-bold text-primary-foreground">
              Apply · {familyCount.toLocaleString()} families
            </Text>
          </Pressable>
        </HStack>
      </Box>
    </Modal>
  );
}

/**
 * A booth's voters grouped by house, with its own search box and a sheet for
 * sorting families and narrowing them by surname, gender and age.
 */
export function FamilyList({ partNo, language }: { partNo: VoterScope; language: NameLanguage }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [term, setTerm] = useState("");
  const [allVoters, setAllVoters] = useState<LocalVoter[]>([]);
  const [loading, setLoading] = useState(true);
  // The last search that finished, and the ids it matched.
  const [search, setSearch] = useState<{ query: string; ids: Set<string> } | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // The whole roll is loaded once (held until the screen has settled, since the
  // query holds the JS thread); families are grouped from it in memory.
  useEffect(() => {
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;

      listBoothVoters(partNo)
        .then((rows) => {
          if (!cancelled) setAllVoters(rows);
        })
        .catch((error: unknown) => {
          // Surface the reason instead of showing an empty list.
          console.warn("booth family list failed", error);
          if (!cancelled) setAllVoters([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [partNo]);

  // Search runs through the indexed query, debounced so a long roll isn't
  // queried on every keystroke; its hits then narrow the in-memory roll.
  useEffect(() => {
    const query = term.trim();

    if (!query) return;

    let cancelled = false;

    const timer = setTimeout(() => {
      listBoothVoters(partNo, { term: query })
        .then((rows) => {
          if (!cancelled) setSearch({ query, ids: new Set(rows.map((row) => row.id)) });
        })
        .catch((error: unknown) => {
          console.warn("booth family search failed", error);
          if (!cancelled) setSearch({ query, ids: new Set() });
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [partNo, term]);

  const pushVoter = useCallback((id: string) => router.push(`/voter/${id}`), [router]);
  const openVoter = useRefreshOpenedVoter(setAllVoters, pushVoter);

  const allFamilies = useMemo(() => {
    learnSurnames(allVoters);

    return groupFamilies(allVoters);
  }, [allVoters]);

  const query = term.trim();
  // Null while the search box is empty; the previous hits stay up while a new search runs.
  const matchedIds = query ? (search?.ids ?? null) : null;
  const searching = query !== "" && search?.query !== query;

  const filtered = filters.gender !== "all" || ageText(filters) !== null || filters.surname !== "";
  const narrowed = filtered || matchedIds !== null;

  const hits = useMemo(
    () =>
      new Set(
        allVoters
          .filter(
            (voter) =>
              (matchedIds === null || matchedIds.has(voter.id)) && matchesFilters(voter, filters),
          )
          .map((voter) => voter.id),
      ),
    [allVoters, matchedIds, filters],
  );

  const families = useMemo(() => {
    const shown = narrowed
      ? allFamilies.filter((family) => family.members.some((member) => hits.has(member.id)))
      : [...allFamilies];

    return shown.sort((a, b) => {
      // The voters with no house number aren't a household; keep them last.
      if (!a.key !== !b.key) return a.key ? -1 : 1;

      return filters.sort === "size"
        ? b.members.length - a.members.length || compareHouse(a, b)
        : compareHouse(a, b);
    });
  }, [allFamilies, hits, narrowed, filters.sort]);

  const toggleFamily = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);

      if (next.has(key)) next.delete(key);
      else next.add(key);

      return next;
    });

  const chips: { label: string; clear: () => void }[] = [];

  if (filters.sort === "house") {
    chips.push({
      label: "By house no.",
      clear: () => setFilters((current) => ({ ...current, sort: "size" })),
    });
  }

  if (filters.surname) {
    chips.push({
      label: filters.surname,
      clear: () => setFilters((current) => ({ ...current, surname: "" })),
    });
  }

  if (filters.gender !== "all") {
    chips.push({
      label: GENDERS.find((gender) => gender.id === filters.gender)?.label ?? "",
      clear: () => setFilters((current) => ({ ...current, gender: "all" })),
    });
  }

  const age = ageText(filters);

  if (age) {
    chips.push({
      label: `Age ${age}`,
      clear: () => setFilters((current) => ({ ...current, min: "", max: "" })),
    });
  }

  const loadingList = loading || (searching && matchedIds === null);

  return (
    <>
      <HStack space="sm" className="px-4 pb-3">
        <Input className="h-12 flex-1 rounded-2xl border-border bg-card px-3">
          <InputSlot>
            <Icon as={SearchIcon} className="text-muted-foreground" />
          </InputSlot>
          <InputField
            placeholder="House no., surname, name, mobile"
            value={term}
            onChangeText={setTerm}
            autoCapitalize="none"
            autoCorrect={false}
            className="text-base"
          />
        </Input>
        <Pressable
          onPress={() => setSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={chips.length ? `Sort and filter, ${chips.length} active` : "Sort and filter"}
          className={`h-12 w-12 items-center justify-center rounded-2xl border ${
            chips.length ? "border-primary bg-primary" : "border-border bg-card"
          }`}
        >
          <Icon
            as={FilterIcon}
            className={`h-5 w-5 ${chips.length ? "text-primary-foreground" : "text-foreground"}`}
          />
          {chips.length ? (
            <Box className="absolute -right-1.5 -top-1.5 h-5 min-w-5 items-center justify-center rounded-full bg-brand-accent px-1">
              <Text className="text-[11px] font-bold text-brand-accent-foreground">{chips.length}</Text>
            </Box>
          ) : null}
        </Pressable>
      </HStack>

      {chips.length ? (
        <HStack className="flex-wrap px-4 pb-2.5" style={{ gap: 8 }}>
          {chips.map((chip) => (
            <Pressable
              key={chip.label}
              onPress={chip.clear}
              accessibilityLabel={`Remove ${chip.label} filter`}
              className="h-8 flex-row items-center gap-1.5 rounded-full border border-primary bg-primary-light pl-3 pr-2.5"
            >
              <Text className="text-[13px] font-semibold text-primary">{chip.label}</Text>
              <Icon as={CloseIcon} className="h-3.5 w-3.5 text-primary" />
            </Pressable>
          ))}
          <Pressable onPress={() => setFilters(NO_FILTERS)} className="h-8 justify-center px-2">
            <Text className="text-[13px] font-semibold text-muted-foreground underline">Clear all</Text>
          </Pressable>
        </HStack>
      ) : null}

      {loadingList ? (
        <VoterListSkeleton rows={5} />
      ) : (
        <FlatList
          data={families}
          keyExtractor={(family) => family.key || "__none__"}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: insets.bottom + 24 }}
          ItemSeparatorComponent={() => <Box className="h-3" />}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <HStack className="justify-between px-1 pb-3">
              <Text className="text-xs font-bold tracking-wider text-muted-foreground">
                {narrowed ? "FAMILIES WITH A MATCH" : `${families.length.toLocaleString()} FAMILIES`}
              </Text>
              <Text className="text-xs text-muted-foreground">
                {filters.sort === "size" ? "Most voters first" : "By house no."}
              </Text>
            </HStack>
          }
          ListEmptyComponent={
            <Text className="pt-10 text-center text-muted-foreground">
              {narrowed ? "No families in this booth match that search." : "No voters on this booth yet."}
            </Text>
          }
          renderItem={({ item }) => (
            <FamilyCard
              family={item}
              hits={hits}
              narrowed={narrowed}
              expanded={expanded.has(item.key)}
              onToggle={() => toggleFamily(item.key)}
              onOpen={openVoter}
              language={language}
            />
          )}
        />
      )}

      <FamilyFilterSheet
        key={sheetOpen ? "open" : "closed"}
        visible={sheetOpen}
        initial={filters}
        voters={allVoters}
        families={allFamilies}
        onClose={() => setSheetOpen(false)}
        onApply={(next) => {
          setFilters(next);
          setSheetOpen(false);
        }}
      />
    </>
  );
}
