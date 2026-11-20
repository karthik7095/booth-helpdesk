import { useRouter } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Alert, BackHandler, FlatList, InteractionManager, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrinterIcon } from "@/components/icons";
import { VoterListSkeleton } from "@/components/skeletons";
import { VOTER_LIST_PROPS, VoterRowGap } from "@/components/voter-row";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronRightIcon,
  Icon,
  SearchIcon,
} from "@/components/ui/icon";
import { Input, InputField, InputSlot } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { fetchBoothPrints, fetchBoothPrintTotals } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  boothPrintCounts,
  listBooths,
  listBoothVoters,
  printedVotersPerBooth,
  type BoothRow,
  type LocalVoter,
} from "@/lib/db";
import { useLanguage, type NameLanguage } from "@/lib/language";
import { syncIfOnline } from "@/lib/sync";
import { printVotersSeparately, voterFullName, voterRelativeName } from "@/lib/voter-actions";

/** Voters per run: each gets their own slip, fed out one after another. */
const PER_SLIP = 10;

/** The war room's shades, so a printed serial looks the same on the phone and the dashboard. */
const PRINTED_ONCE = { backgroundColor: "#FFE7C7", borderColor: "#F5B25A" };
const PRINTED_AGAIN = { backgroundColor: "#F9B866", borderColor: "#E46F00" };
const PRINTED_TEXT = "#7A3D00";

type Show = "all" | "left" | "printed";

const SHOW: { value: Show; label: string }[] = [
  { value: "all", label: "All" },
  { value: "left", label: "Not printed" },
  { value: "printed", label: "Printed" },
];

function printedCard(prints: number) {
  if (prints === 0) return undefined;

  return prints === 1 ? PRINTED_ONCE : PRINTED_AGAIN;
}

const SelectRow = memo(function SelectRow({
  voter,
  language,
  prints,
  selected,
  onToggle,
}: {
  voter: LocalVoter;
  language: NameLanguage;
  prints: number;
  selected: boolean;
  onToggle: (voter: LocalVoter) => void;
}) {
  return (
    <Pressable
      onPress={() => onToggle(voter)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
    >
      <HStack
        className={`items-center overflow-hidden rounded-xl border bg-card p-3 ${
          selected ? "border-2 border-primary" : "border-border"
        }`}
        style={selected ? undefined : printedCard(prints)}
      >
        <Box
          className={`mr-3 h-6 w-6 items-center justify-center rounded-md border-2 ${
            selected ? "border-primary bg-primary" : "border-muted-foreground bg-card"
          }`}
        >
          {selected ? <Icon as={CheckIcon} className="h-4 w-4 text-primary-foreground" /> : null}
        </Box>

        <Text className="w-12 text-base font-semibold text-foreground">{voter.srNo}</Text>

        <VStack className="flex-1 pr-2">
          <Text className="text-base font-semibold uppercase text-foreground" numberOfLines={1}>
            {voterFullName(voter, language)}
          </Text>
          <Text className="text-sm uppercase text-muted-foreground" numberOfLines={1}>
            {voterRelativeName(voter, language) ?? "—"}
          </Text>
        </VStack>

        <VStack className="items-end">
          <Text className="text-sm font-semibold text-foreground">
            {(voter.sex ?? "?").toUpperCase()}/{voter.age ?? "?"}
          </Text>
          {prints > 0 ? (
            <Box
              className="mt-1 rounded-full px-2 py-0.5"
              style={{ backgroundColor: prints === 1 ? "#F5B25A" : "#E46F00" }}
            >
              <Text className="text-[10px] font-bold" style={{ color: "#FFFFFF" }}>
                {prints === 1 ? "PRINTED" : `PRINTED ×${prints}`}
              </Text>
            </Box>
          ) : null}
        </VStack>
      </HStack>
    </Pressable>
  );
});

/**
 * Pick a booth, tick up to ten of its voters, and print each one their own
 * slip, cover image and all, one after another to be torn apart.
 * Printed voters are shaded, with how many times, counting every phone's
 * prints when online and this phone's own when not.
 */
export default function BulkPrintScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useLanguage();
  const { token } = useAuth();

  const [booths, setBooths] = useState<BoothRow[]>([]);
  const [printedByBooth, setPrintedByBooth] = useState<Map<number, number>>(new Map());
  const [loadingBooths, setLoadingBooths] = useState(true);

  const [booth, setBooth] = useState<number | null>(null);
  const [voters, setVoters] = useState<LocalVoter[]>([]);
  const [prints, setPrints] = useState<Map<string, number>>(new Map());
  const [loadingVoters, setLoadingVoters] = useState(false);
  const [term, setTerm] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [selected, setSelected] = useState<LocalVoter[]>([]);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The server's counts win over this phone's, whichever arrives last.
    let fromServer = false;

    const task = InteractionManager.runAfterInteractions(() => {
      Promise.all([listBooths(), printedVotersPerBooth()])
        .then(([rows, printed]) => {
          if (cancelled) return;

          setBooths(rows);
          if (!fromServer) setPrintedByBooth(printed);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoadingBooths(false);
        });

      // Every phone's prints, when online. A print still waiting to be pushed
      // is not on the server yet, so the larger of the two counts is shown.
      if (token) {
        Promise.all([fetchBoothPrintTotals(token), printedVotersPerBooth()])
          .then(([server, local]) => {
            if (cancelled) return;

            const merged = new Map(server);

            for (const [partNo, voters] of local) {
              merged.set(partNo, Math.max(voters, merged.get(partNo) ?? 0));
            }
            fromServer = true;
            setPrintedByBooth(merged);
          })
          .catch(() => undefined);
      }
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [token]);

  useEffect(() => {
    if (booth === null) return;

    let cancelled = false;
    let fromServer = false;

    Promise.all([listBoothVoters(booth), boothPrintCounts(booth)])
      .then(([rows, counts]) => {
        if (cancelled) return;

        setVoters(rows);
        if (!fromServer) setPrints(counts);
      })
      .catch((error: unknown) => {
        console.warn("bulk print voter list failed", error);
        if (!cancelled) setVoters([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingVoters(false);
      });

    // Then every phone's prints from the server, plus this phone's prints not
    // yet pushed. Offline, this phone's own counts above stay.
    if (token) {
      Promise.all([fetchBoothPrints(booth, token), boothPrintCounts(booth, { pending: true })])
        .then(([server, pending]) => {
          if (cancelled) return;

          const merged = new Map(server);

          for (const [voterId, count] of pending) {
            merged.set(voterId, (merged.get(voterId) ?? 0) + count);
          }
          fromServer = true;
          setPrints(merged);
        })
        .catch(() => undefined);
    }

    return () => {
      cancelled = true;
    };
  }, [booth, token]);

  const openBooth = useCallback((partNo: number) => {
    setLoadingVoters(true);
    setBooth(partNo);
  }, []);

  const leaveBooth = useCallback(() => {
    setBooth(null);
    setVoters([]);
    setPrints(new Map());
    setSelected([]);
    setTerm("");
    setShow("all");
  }, []);

  const goBack = useCallback(() => {
    if (booth === null) router.back();
    else leaveBooth();
  }, [booth, router, leaveBooth]);

  // Android's back button steps out of the booth first, like the arrow does.
  useEffect(() => {
    if (booth === null) return;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      leaveBooth();

      return true;
    });

    return () => subscription.remove();
  }, [booth, leaveBooth]);

  const toggle = useCallback((voter: LocalVoter) => {
    setSelected((current) => {
      if (current.some((item) => item.id === voter.id)) {
        return current.filter((item) => item.id !== voter.id);
      }

      if (current.length >= PER_SLIP) {
        Alert.alert(
          `Up to ${PER_SLIP} voters`,
          `One run prints up to ${PER_SLIP} slips. Print these first, or untick one.`,
        );

        return current;
      }

      return [...current, voter];
    });
  }, []);

  const printedCount = useMemo(
    () => voters.filter((voter) => (prints.get(voter.id) ?? 0) > 0).length,
    [voters, prints],
  );

  const shown = useMemo(() => {
    const query = term.trim().toLowerCase();

    return voters.filter((voter) => {
      const count = prints.get(voter.id) ?? 0;

      if (show === "left" && count > 0) return false;
      if (show === "printed" && count === 0) return false;
      if (!query) return true;

      return (
        String(voter.srNo) === query ||
        voterFullName(voter, "english").toLowerCase().includes(query) ||
        voterFullName(voter, language).toLowerCase().includes(query) ||
        (voter.vcardId ?? "").toLowerCase().includes(query) ||
        (voter.houseNo ?? "").toLowerCase() === query
      );
    });
  }, [voters, prints, show, term, language]);

  const runPrint = useCallback(async () => {
    if (selected.length === 0 || printing) return;

    setPrinting(true);

    // In serial order, as the voters stand on the roll.
    const rows = [...selected].sort((a, b) => (a.srNo ?? 0) - (b.srNo ?? 0));
    const outcome = await printVotersSeparately(rows, language);

    setPrinting(false);

    const done = outcome.kind === "failed" ? (outcome.printed ?? []) : rows;

    // Shaded straight away; the rows themselves are written once the GPS fix is in.
    const newlyPrinted = done.filter((row) => (prints.get(row.id) ?? 0) === 0).length;

    setPrints((current) => {
      const next = new Map(current);

      for (const row of done) next.set(row.id, (next.get(row.id) ?? 0) + 1);

      return next;
    });
    if (booth !== null && newlyPrinted > 0) {
      setPrintedByBooth((current) =>
        new Map(current).set(booth, (current.get(booth) ?? 0) + newlyPrinted),
      );
    }

    if (outcome.kind === "failed") {
      // The ones that did not come out stay ticked, ready to print again.
      setSelected((current) => current.filter((voter) => !done.some((row) => row.id === voter.id)));
      Alert.alert("Could not print", outcome.message);

      return;
    }

    setSelected([]);

    void outcome.recorded.then(() => syncIfOnline(token));
  }, [selected, printing, language, prints, booth, token]);

  const selectedIds = useMemo(() => new Set(selected.map((voter) => voter.id)), [selected]);

  const renderVoter = useCallback(
    ({ item }: { item: LocalVoter }) => (
      <SelectRow
        voter={item}
        language={language}
        prints={prints.get(item.id) ?? 0}
        selected={selectedIds.has(item.id)}
        onToggle={toggle}
      />
    ),
    [language, prints, selectedIds, toggle],
  );

  const current = booths.find((item) => item.partNo === booth);

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack space="md" className="items-center border-b border-border bg-card px-4 py-3">
        <Pressable onPress={goBack} accessibilityLabel="Go back" hitSlop={16} className="-m-2 p-2">
          <Icon as={ArrowLeftIcon} className="h-6 w-6 text-foreground" />
        </Pressable>
        <VStack className="flex-1">
          <Heading size="lg" className="text-foreground">
            {booth === null ? "Bulk Print" : `Bulk Print · Booth ${booth}`}
          </Heading>
          <Text className="text-xs text-muted-foreground">
            {booth === null
              ? "Pick a booth"
              : `Tick up to ${PER_SLIP} voters, one slip each`}
          </Text>
        </VStack>
      </HStack>

      {booth === null ? (
        loadingBooths ? (
          <VoterListSkeleton rows={6} />
        ) : (
          <FlatList
            data={booths}
            keyExtractor={(item) => String(item.partNo)}
            contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
            ItemSeparatorComponent={VoterRowGap}
            ListEmptyComponent={
              <Text className="pt-10 text-center text-muted-foreground">
                No voters on this phone yet.
              </Text>
            }
            renderItem={({ item }) => {
              const printed = printedByBooth.get(item.partNo) ?? 0;

              return (
                <Pressable
                  onPress={() => openBooth(item.partNo)}
                  accessibilityRole="button"
                  accessibilityLabel={`Booth ${item.partNo}, ${printed} of ${item.total} printed`}
                >
                  <VStack space="sm" className="rounded-2xl border border-border bg-card p-4">
                    <HStack className="items-center justify-between">
                      <Heading size="md" className="text-primary-dark">
                        Booth {item.partNo}
                      </Heading>
                      <HStack space="sm" className="items-center">
                        <Box className="rounded-full px-2.5 py-1" style={PRINTED_ONCE}>
                          <Text className="text-xs font-bold" style={{ color: PRINTED_TEXT }}>
                            {printed.toLocaleString()} / {item.total.toLocaleString()} printed
                          </Text>
                        </Box>
                        <Icon as={ChevronRightIcon} className="h-5 w-5 text-muted-foreground" />
                      </HStack>
                    </HStack>
                    {item.boothAddress ? (
                      <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                        {item.boothAddress}
                      </Text>
                    ) : null}
                  </VStack>
                </Pressable>
              );
            }}
          />
        )
      ) : (
        <>
          <HStack space="sm" className="px-4 pt-3">
            {[
              { label: "Voters", value: voters.length, style: undefined },
              { label: "Printed", value: printedCount, style: PRINTED_ONCE },
              { label: "Left", value: voters.length - printedCount, style: undefined },
            ].map((stat) => (
              <VStack
                key={stat.label}
                className="flex-1 items-center rounded-xl border border-border bg-card py-2"
                style={stat.style}
              >
                <Text className="text-lg font-bold text-foreground">
                  {stat.value.toLocaleString()}
                </Text>
                <Text className="text-xs text-muted-foreground">{stat.label}</Text>
              </VStack>
            ))}
          </HStack>

          <Box className="px-4 pt-3">
            <Input className="h-12 rounded-2xl border-border bg-card px-3">
              <InputSlot>
                <Icon as={SearchIcon} className="text-muted-foreground" />
              </InputSlot>
              <InputField
                placeholder="Serial, name, voter ID, house"
                value={term}
                onChangeText={setTerm}
                autoCapitalize="none"
                autoCorrect={false}
                className="text-base"
              />
            </Input>
          </Box>

          <HStack space="sm" className="px-4 py-3">
            {SHOW.map((option) => (
              <Pressable key={option.value} onPress={() => setShow(option.value)}>
                <Badge
                  className={`rounded-full ${show === option.value ? "bg-primary" : "bg-secondary"}`}
                >
                  <BadgeText
                    className={
                      show === option.value
                        ? "text-primary-foreground"
                        : "text-secondary-foreground"
                    }
                  >
                    {option.label}
                  </BadgeText>
                </Badge>
              </Pressable>
            ))}
          </HStack>

          {loadingVoters ? (
            <VoterListSkeleton />
          ) : (
            <FlatList
              data={shown}
              keyExtractor={(voter) => voter.id}
              extraData={selectedIds}
              contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16 }}
              ItemSeparatorComponent={VoterRowGap}
              {...VOTER_LIST_PROPS}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text className="pt-10 text-center text-muted-foreground">
                  {term
                    ? "No voters in this booth match that search."
                    : show === "left"
                      ? "Every voter in this booth has been printed."
                      : show === "printed"
                        ? "Nobody in this booth has been printed yet."
                        : "No voters on this booth yet."}
                </Text>
              }
              renderItem={renderVoter}
            />
          )}

          <HStack
            space="md"
            className="items-center border-t border-border bg-card px-4 pt-3"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <VStack className="flex-1">
              <Text className="text-base font-semibold text-foreground">
                {selected.length} / {PER_SLIP} selected
              </Text>
              {selected.length > 0 ? (
                <Pressable onPress={() => setSelected([])} hitSlop={8}>
                  <Text className="text-sm text-primary">Clear</Text>
                </Pressable>
              ) : (
                <Text className="text-sm text-muted-foreground" numberOfLines={1}>
                  {current?.boothAddress ?? `Booth ${booth}`}
                </Text>
              )}
            </VStack>

            <Pressable disabled={selected.length === 0 || printing} onPress={runPrint}>
              <HStack
                space="sm"
                className={`h-12 items-center justify-center rounded-xl px-5 ${
                  selected.length === 0 || printing ? "bg-secondary" : "bg-primary"
                }`}
              >
                <Icon
                  as={PrinterIcon}
                  className={`h-5 w-5 ${
                    selected.length === 0 || printing
                      ? "text-muted-foreground"
                      : "text-primary-foreground"
                  }`}
                />
                <Text
                  className={`text-base font-medium ${
                    selected.length === 0 || printing
                      ? "text-muted-foreground"
                      : "text-primary-foreground"
                  }`}
                >
                  {printing ? "Printing…" : `Print ${selected.length || ""}`.trim()}
                </Text>
              </HStack>
            </Pressable>
          </HStack>
        </>
      )}
    </Box>
  );
}
