import { CASTE_CATEGORIES, DEFAULT_PARTY_OPTIONS, type VoterPatch } from "@voter/shared";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FieldWorkPanel } from "@/components/field-work-panel";
import { DECEASED, DECEASED_CARD } from "@/components/voter-row";
import { FamilyIcon, PrinterIcon, WhatsAppIcon } from "@/components/icons";
import { KeyboardScreen } from "@/components/keyboard-screen";
import { VoterDetailSkeleton } from "@/components/skeletons";

import { Box } from "@/components/ui/box";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  Icon,
  MessageCircleIcon,
  PhoneIcon,
} from "@/components/ui/icon";
import { HStack } from "@/components/ui/hstack";
import { Input, InputField } from "@/components/ui/input";
import { Radio, RadioGroup, RadioIcon, RadioIndicator, RadioLabel } from "@/components/ui/radio";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { usePhotoSync, voterPhotoUri } from "@/lib/voter-photos";
import {
  getVoter,
  listVoterPrints,
  patchVoterLocally,
  type LocalPrint,
  type LocalVoter,
} from "@/lib/db";
import { syncIfOnline } from "@/lib/sync";
import { useLanguage } from "@/lib/language";
import {
  callVoter,
  hasMobile,
  printVoter,
  relationLabel,
  smsVoter,
  voterFullName,
  voterRelativeName,
  shareVoterOnWhatsApp,
} from "@/lib/voter-actions";

type FieldKey = "mobileNo1" | "houseNo" | "eVillage" | "religion" | "age";

const FIELDS: {
  key: FieldKey;
  label: string;
  keyboard?: "phone-pad" | "numeric";
}[] = [
  { key: "mobileNo1", label: "MOBILE NUMBER", keyboard: "phone-pad" },
  { key: "houseNo", label: "HOUSE NUMBER" },
  { key: "eVillage", label: "VILLAGE / AREA" },
  { key: "age", label: "AGE", keyboard: "numeric" },
  { key: "religion", label: "RELIGION" },
];

/** Shown for, and picked to return to, no choice at all. */
const NOT_SELECTED = "Not selected";

/**
 * A labelled field that opens a list in place — tap to pick, tap again to
 * close. It starts on "Not selected", which is also the first option, so a
 * choice made by mistake can be taken back.
 */
function Dropdown({
  label,
  placeholder,
  value,
  options,
  onSelect,
}: {
  label: string;
  placeholder: string;
  value: string | null;
  options: { value: string; label: string }[];
  onSelect: (value: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  // A value from the roll that is not one of the options still shows as-is.
  const selected = options.find((option) => option.value === value)?.label ?? value;

  return (
    <VStack space="xs" className="pt-2">
      <Text className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Text>
      <Pressable onPress={() => setOpen((current) => !current)} accessibilityLabel={placeholder}>
        <HStack className="h-12 items-center justify-between rounded-xl border border-border bg-card px-3">
          <Text className={`text-base ${selected ? "text-foreground" : "text-muted-foreground"}`}>
            {selected ?? NOT_SELECTED}
          </Text>
          <Icon
            as={open ? ChevronUpIcon : ChevronDownIcon}
            className="h-5 w-5 text-muted-foreground"
          />
        </HStack>
      </Pressable>

      {open ? (
        <VStack className="overflow-hidden rounded-xl border border-border bg-card">
          {[{ value: null, label: NOT_SELECTED }, ...options].map((option) => (
            <Pressable
              key={option.value ?? ""}
              onPress={() => {
                setOpen(false);
                if (option.value !== value) onSelect(option.value);
              }}
            >
              <HStack className="h-12 items-center justify-between border-b border-border px-3">
                <Text
                  className={`text-base ${
                    option.value === null ? "text-muted-foreground" : "text-foreground"
                  }`}
                >
                  {option.label}
                </Text>
                {option.value === value ? (
                  <Icon as={CheckIcon} className="h-4 w-4 text-primary" />
                ) : null}
              </HStack>
            </Pressable>
          ))}
        </VStack>
      ) : null}
    </VStack>
  );
}

/** The English name as the edit field shows it: the roll's first and last name together. */
function englishName(voter: LocalVoter): string {
  return [voter.eFirstName, voter.eLastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** Every editable value as the screen holds it — text fields stay strings while typing. */
type Form = Record<FieldKey, string> & {
  /** The English name as one line, first and last together. */
  name: string;
  community: string | null;
  subCategory: string | null;
  caste: string;
  partyLoyalty: string | null;
  hasVoted: boolean;
};

function formFrom(voter: LocalVoter): Form {
  return {
    name: englishName(voter),
    mobileNo1: voter.mobileNo1 ?? "",
    houseNo: voter.houseNo ?? "",
    eVillage: voter.eVillage ?? "",
    age: voter.age === null ? "" : String(voter.age),
    religion: voter.religion ?? "",
    community: voter.community,
    subCategory: voter.subCategory,
    caste: voter.caste ?? "",
    partyLoyalty: voter.partyLoyalty,
    hasVoted: voter.hasVoted,
  };
}

/** "today 14:05", "yesterday 09:30" or "12 Oct 09:30", for the print history line. */
function printedWhen(at: number): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const today = new Date();
  const dayDiff = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000,
  );

  if (dayDiff === 0) return `today ${time}`;
  if (dayDiff === 1) return `yesterday ${time}`;

  return `${date.toLocaleDateString([], { day: "numeric", month: "short" })} ${time}`;
}

/** Only what differs from the saved voter, in the shape `patchVoterLocally` takes. */
function changesBetween(saved: Form, next: Form): VoterPatch {
  const patch: VoterPatch = {};
  const text = (value: string) => value.trim() || null;
  const name = next.name.trim().replace(/\s+/g, " ");

  if (name && name !== saved.name.trim().replace(/\s+/g, " ")) patch.eFirstName = name;

  for (const key of ["mobileNo1", "houseNo", "eVillage", "religion"] as const) {
    if (text(next[key]) !== text(saved[key])) patch[key] = text(next[key]);
  }

  if (next.age.trim() !== saved.age.trim()) {
    patch.age = next.age.trim() ? Number(next.age.trim()) : null;
  }

  if (next.community !== saved.community) patch.community = next.community;
  if (next.subCategory !== saved.subCategory) patch.subCategory = next.subCategory;
  if (text(next.caste) !== text(saved.caste)) patch.caste = text(next.caste);
  if (next.partyLoyalty !== saved.partyLoyalty) patch.partyLoyalty = next.partyLoyalty;
  if (next.hasVoted !== saved.hasVoted) patch.hasVoted = next.hasVoted;

  return patch;
}

export default function VoterDetail() {
  const insets = useSafeAreaInsets();
  // Re-renders as photos arrive, so one downloading now shows up on this screen.
  usePhotoSync();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token, access } = useAuth();
  const { language } = useLanguage();

  const [voter, setVoter] = useState<LocalVoter | null>(null);
  /** What is on screen; compared with `voter` to know what changed. */
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [prints, setPrints] = useState<LocalPrint[]>([]);

  // Disabled while the write is in flight: the printer gives no feedback and a
  // second tap prints a second slip.
  const runPrint = useCallback(
    async (target: LocalVoter) => {
      setPrinting(true);

      const outcome = await printVoter(target, [], language);

      if (outcome.kind === "failed") Alert.alert("Could not print", outcome.message);

      setPrinting(false);

      // The print is logged in the background, once the GPS fix is in. Only
      // then is there anything to push, so the sync waits for it; the history
      // line below refreshes at the same moment.
      if (outcome.kind !== "failed") {
        void outcome.recorded.then(() => {
          void listVoterPrints(target.id).then(setPrints);
          return syncIfOnline(token);
        });
      }
    },
    [language, token],
  );

  const load = useCallback(async () => {
    const [loaded, printed] = await Promise.all([
      getVoter(String(id)),
      listVoterPrints(String(id)).catch(() => []),
    ]);

    setVoter(loaded);
    setForm(loaded ? formFrom(loaded) : null);
    setPrints(printed);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // After a found mark or remark: the voter again, but not the form, so edits
  // typed into the form and not yet saved are kept.
  const refreshVoter = useCallback(async () => {
    const fresh = await getVoter(String(id));

    if (fresh) setVoter(fresh);
  }, [id]);

  if (!voter || !form) {
    return (
      <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
        <VoterDetailSkeleton />
      </Box>
    );
  }

  const name = voterFullName(voter, language);
  const photo = voterPhotoUri(voter.assemblyNo, voter.vcardId);
  const reachable = hasMobile(voter);
  const category = CASTE_CATEGORIES.find((option) => option.value === form.community);
  // An access saved offline by an older build has no list; fall back to the default.
  const partyOptions: string[] = access?.partyOptions ?? [...DEFAULT_PARTY_OPTIONS];
  // Keeps a choice the admin has since removed visible instead of silently unselected.
  const partyChoices =
    form.partyLoyalty && !partyOptions.includes(form.partyLoyalty)
      ? [...partyOptions, form.partyLoyalty]
      : partyOptions;

  const patch = changesBetween(formFrom(voter), form);
  const dirty = Object.keys(patch).length > 0;

  // A slip or message for a voter marked deceased is usually a mistake, so it asks first.
  const unlessDeceased = (action: () => void) => {
    if (!voter.isDeceased) {
      action();
      return;
    }

    Alert.alert("Voter marked deceased", "This voter is marked deceased. Continue anyway?", [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", onPress: action },
    ]);
  };

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

  const saveAll = async () => {
    if (patch.age !== undefined && patch.age !== null) {
      if (!Number.isInteger(patch.age) || patch.age < 18 || patch.age > 120) {
        Alert.alert("Check the age", "Age must be a whole number between 18 and 120.");
        return;
      }
    }

    if (!form.name.trim()) {
      Alert.alert("Check the name", "The voter's name cannot be left empty.");
      return;
    }

    setSaving(true);

    // Saved locally first so it sticks with no connection, then pushed.
    await patchVoterLocally(voter.id, patch);
    await load();
    void syncIfOnline(token);

    setSaving(false);
  };

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
        <Heading size="lg" className="flex-1 uppercase text-foreground" numberOfLines={1}>
          {name}
        </Heading>
      </HStack>

      <KeyboardScreen contentContainerStyle={{ padding: 20 }} extraBottom={32}>
        <VStack space="xl">
          {photo ? (
            <Box className="items-center">
              <Image
                source={{ uri: photo }}
                style={{ width: 132, height: 168, borderRadius: 16 }}
                contentFit="cover"
                contentPosition="top"
                accessibilityLabel="Voter photo"
              />
            </Box>
          ) : null}
          {voter.isDeceased ? (
            <Box className="rounded-2xl border p-3" style={DECEASED_CARD}>
              <Text className="text-base font-bold" style={{ color: DECEASED }}>
                DECEASED
              </Text>
              <Text className="text-xs text-muted-foreground">
                Marked by an agent{voter.deceasedBy ? ` (${voter.deceasedBy})` : ""}. Undo it below
                if this is wrong.
              </Text>
            </Box>
          ) : null}

          <HStack space="sm">
            <Pressable
              className="flex-1"
              disabled={!reachable}
              onPress={() => callVoter(voter)}
              accessibilityLabel="Call this voter"
            >
              <Box
                className={`h-14 items-center justify-center rounded-2xl ${
                  reachable ? "bg-primary" : "bg-secondary"
                }`}
              >
                <Icon
                  as={PhoneIcon}
                  className={`h-6 w-6 ${reachable ? "text-primary-foreground" : "text-muted-foreground"}`}
                />
              </Box>
            </Pressable>

            <Pressable
              className="flex-1"
              onPress={() => unlessDeceased(() => void shareVoterOnWhatsApp(voter, access))}
              accessibilityLabel="Send a WhatsApp message"
            >
              <Box className="h-14 items-center justify-center rounded-2xl bg-success">
                <Icon as={WhatsAppIcon} className="h-6 w-6 text-success-foreground" />
              </Box>
            </Pressable>

            <Pressable
              className="flex-1"
              disabled={!reachable}
              onPress={() => unlessDeceased(() => void smsVoter(voter, access))}
              accessibilityLabel="Send a text message"
            >
              <Box
                className={`h-14 items-center justify-center rounded-2xl ${
                  reachable ? "bg-primary" : "bg-secondary"
                }`}
              >
                <Icon
                  as={MessageCircleIcon}
                  className={`h-6 w-6 ${reachable ? "text-primary-foreground" : "text-muted-foreground"}`}
                />
              </Box>
            </Pressable>
          </HStack>

          <HStack space="sm">
            <Pressable
              className="flex-1"
              disabled={printing}
              onPress={() => unlessDeceased(() => void runPrint(voter))}
            >
              <HStack
                space="sm"
                className="h-14 items-center justify-center rounded-2xl bg-primary"
              >
                <Icon as={PrinterIcon} className="h-6 w-6 text-primary-foreground" />
                <Text className="text-base font-medium text-primary-foreground">Print</Text>
              </HStack>
            </Pressable>

            <Pressable className="flex-1" onPress={() => router.push(`/family/${voter.id}`)}>
              <HStack
                space="sm"
                className="h-14 items-center justify-center rounded-2xl bg-primary"
              >
                <Icon as={FamilyIcon} className="h-6 w-6 text-primary-foreground" />
                <Text className="text-base font-medium text-primary-foreground">Family</Text>
              </HStack>
            </Pressable>
          </HStack>

          {reachable ? null : (
            <Text className="-mt-3 text-xs text-muted-foreground">
              Add a mobile number below to call or message this voter.
            </Text>
          )}

          {prints.length > 0 ? (
            <HStack space="sm" className="-mt-3 items-center">
              <Icon as={PrinterIcon} className="h-4 w-4 text-muted-foreground" />
              <Text className="flex-1 text-xs text-muted-foreground">
                Slip printed {prints.length === 1 ? "once" : `${prints.length} times`} from this
                phone · last {printedWhen(prints[0]!.printedAt)}
                {prints[0]!.latitude !== null ? " · location captured" : ""}
                {prints.some((print) => print.pending) ? " · waiting to sync" : ""}
              </Text>
            </HStack>
          ) : null}

          <FieldWorkPanel voter={voter} onChanged={refreshVoter} />

          <VStack space="sm">
            <Text className="text-base font-semibold text-foreground">Voter&apos;s Info</Text>
            <VStack space="sm" className="rounded-2xl bg-brand-accent p-5">
              <Text className="text-xl font-semibold uppercase text-brand-accent-foreground">
                {name}
              </Text>
              {voter.eFirstNameRoll ? (
                <Box className="self-start rounded-full bg-white/25 px-2.5 py-0.5">
                  <Text className="text-xs font-bold text-brand-accent-foreground">
                    NAME CORRECTED · Roll: {voter.eFirstNameRoll}
                  </Text>
                </Box>
              ) : null}
              <Text className="text-base text-brand-accent-foreground">
                {voter.sex === "F" ? "Female" : voter.sex === "M" ? "Male" : (voter.sex ?? "—")}{" "}
                {voter.age ?? "—"}
              </Text>
              <Text className="text-base text-brand-accent-foreground">
                {relationLabel(voter)}: {voterRelativeName(voter, language) ?? "—"}
              </Text>
              <Text className="text-base text-brand-accent-foreground">
                House No: {voter.houseNo ?? "—"}
              </Text>
              <Text className="text-base text-brand-accent-foreground">
                Street / Area: {voter.streetArea ?? voter.lAddress ?? voter.eVillage ?? "—"}
              </Text>
              {voter.wardNo !== null ? (
                <Text className="text-base font-semibold text-brand-accent-foreground">
                  Ward: {voter.wardNo}
                </Text>
              ) : (
                <Text className="text-base text-brand-accent-foreground">
                  Section: {voter.sectionNo ?? "—"}
                </Text>
              )}
              <Text className="text-base font-semibold text-brand-accent-foreground">
                Polling Station: Booth {voter.partNo}
                {voter.eBoothAddress ? ` · ${voter.eBoothAddress}` : ""}
              </Text>
            </VStack>
          </VStack>

          <VStack space="sm">
            <Text className="text-base font-semibold text-foreground">Voting Info</Text>
            <VStack space="sm" className="rounded-2xl bg-primary p-5">
              <HStack className="justify-between">
                <Text className="text-base text-primary-foreground">WARD:</Text>
                <Text className="text-base font-medium text-primary-foreground">
                  {voter.eVillage ?? "—"}
                </Text>
              </HStack>
              <HStack className="justify-between">
                <Text className="text-base text-primary-foreground">EPIC ID:</Text>
                <Text className="text-base font-medium text-primary-foreground">
                  {voter.vcardId ?? "—"}
                </Text>
              </HStack>

              <HStack space="xl" className="pt-1">
                <VStack space="xs">
                  <Text className="text-base text-primary-foreground">BOOTH NO:</Text>
                  <Box className="self-start rounded-lg bg-success px-3 py-1">
                    <Text className="text-base font-semibold text-success-foreground">
                      {voter.partNo}
                    </Text>
                  </Box>
                </VStack>
                <VStack space="xs">
                  <Text className="text-base text-primary-foreground">SERIAL NO:</Text>
                  <Box className="self-start rounded-lg bg-destructive px-3 py-1">
                    <Text className="text-base font-semibold text-white">{voter.srNo}</Text>
                  </Box>
                </VStack>
              </HStack>

              <Text className="pt-1 text-base text-primary-foreground">
                BOOTH ADDRESS: {voter.eBoothAddress ?? "—"}
              </Text>
            </VStack>
          </VStack>

          <VStack space="sm">
            <Text className="text-base font-semibold text-foreground">Additional Info</Text>
            <Text className="text-sm text-muted-foreground">
              Anything missing here can be filled in. Tap Save changes below — it saves on this
              phone and syncs when you are back online.
            </Text>

            <VStack space="xs" className="pt-2">
              <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                VOTER NAME (ENGLISH)
              </Text>
              <Input
                className={`h-12 rounded-xl bg-card px-3 ${
                  patch.eFirstName !== undefined ? "border-brand-accent" : "border-border"
                }`}
              >
                <InputField
                  value={form.name}
                  placeholder="Voter's name"
                  autoCapitalize="characters"
                  autoCorrect={false}
                  onChangeText={(text) => set("name", text)}
                  className="text-base font-semibold uppercase"
                />
              </Input>
              {voter.eFirstNameRoll ? (
                <HStack className="items-center justify-between">
                  <Text className="flex-1 text-xs text-muted-foreground">
                    On the roll: {voter.eFirstNameRoll}
                  </Text>
                  <Pressable
                    onPress={() => set("name", voter.eFirstNameRoll ?? "")}
                    accessibilityRole="button"
                    className="py-1.5 pl-3"
                  >
                    <Text className="text-xs font-semibold text-primary">Use roll name</Text>
                  </Pressable>
                </HStack>
              ) : (
                <Text className="text-xs text-muted-foreground">
                  Fix a misspelt name here. The roll&apos;s spelling is kept.
                </Text>
              )}
            </VStack>

            {FIELDS.map((field) => {
              const stored = voter[field.key];
              const filled = stored !== null && stored !== undefined && String(stored).length > 0;

              return (
                <VStack key={field.key} space="xs" className="pt-2">
                  <HStack space="sm" className="items-center">
                    <Box
                      className={`h-5 w-5 items-center justify-center rounded-full ${
                        filled ? "bg-success" : "border border-border bg-background"
                      }`}
                    >
                      {filled ? (
                        <Icon as={CheckIcon} className="h-3 w-3 text-success-foreground" />
                      ) : null}
                    </Box>
                    <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                      {field.label}
                    </Text>
                  </HStack>

                  <Input className="h-12 rounded-xl border-border bg-card px-3">
                    <InputField
                      value={form[field.key]}
                      placeholder={filled ? "" : "Not on the roll — add it"}
                      keyboardType={field.keyboard ?? "default"}
                      onChangeText={(text) => set(field.key, text)}
                      className="text-base"
                    />
                  </Input>
                </VStack>
              );
            })}
          </VStack>

          {access?.enableCasteEntry ? (
            <VStack space="sm">
              <Text className="text-base font-semibold text-foreground">Caste</Text>

              <Dropdown
                label="CATEGORY"
                placeholder="Select category"
                value={form.community}
                options={CASTE_CATEGORIES.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                onSelect={(value) =>
                  // A sub-category belongs to one category, so it cannot survive a
                  // change; "Not selected" clears the caste too rather than hide it.
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          community: value,
                          subCategory: null,
                          caste: value === null ? "" : prev.caste,
                        }
                      : prev,
                  )
                }
              />

              {category && category.subCategories.length > 0 ? (
                <Dropdown
                  label="SUB-CATEGORY"
                  placeholder="Select sub-category"
                  value={form.subCategory}
                  options={category.subCategories.map((sub) => ({
                    value: sub,
                    label: sub,
                  }))}
                  onSelect={(value) => set("subCategory", value)}
                />
              ) : null}

              {category && (category.subCategories.length === 0 || form.subCategory) ? (
                <VStack space="xs" className="pt-2">
                  <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                    {category.casteLabel.toUpperCase()}
                  </Text>
                  <Input className="h-12 rounded-xl border-border bg-card px-3">
                    <InputField
                      value={form.caste}
                      placeholder={`Enter the ${category.casteLabel.toLowerCase()}`}
                      onChangeText={(text) => set("caste", text)}
                      className="text-base"
                    />
                  </Input>
                </VStack>
              ) : null}
            </VStack>
          ) : null}

          {access?.enablePartyLoyalty ? (
            <VStack space="sm">
              <HStack className="items-center justify-between">
                <Text className="text-base font-semibold text-foreground">Favourable</Text>
                {form.partyLoyalty ? (
                  <Pressable onPress={() => set("partyLoyalty", null)}>
                    <Text className="text-sm text-primary">Clear</Text>
                  </Pressable>
                ) : null}
              </HStack>
              <RadioGroup
                value={form.partyLoyalty ?? ""}
                onChange={(value: string) => set("partyLoyalty", value)}
              >
                <HStack className="flex-wrap gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-4">
                  {partyChoices.map((party) => (
                    <Radio key={party} value={party} size="md">
                      <RadioIndicator>
                        <RadioIcon />
                      </RadioIndicator>
                      <RadioLabel className="text-base">{party}</RadioLabel>
                    </Radio>
                  ))}
                </HStack>
              </RadioGroup>
            </VStack>
          ) : null}

          {access?.enableVoteStatus ? (
            <VStack space="sm">
              <Text className="text-base font-semibold text-foreground">Vote Status</Text>
              <RadioGroup
                value={form.hasVoted ? "voted" : "not_voted"}
                onChange={(value: string) => set("hasVoted", value === "voted")}
              >
                <HStack className="gap-x-8 rounded-xl border border-border bg-card p-4">
                  <Radio value="voted" size="md">
                    <RadioIndicator>
                      <RadioIcon />
                    </RadioIndicator>
                    <RadioLabel className="text-base">Voted</RadioLabel>
                  </Radio>
                  <Radio value="not_voted" size="md">
                    <RadioIndicator>
                      <RadioIcon />
                    </RadioIndicator>
                    <RadioLabel className="text-base">Not voted</RadioLabel>
                  </Radio>
                </HStack>
              </RadioGroup>
            </VStack>
          ) : null}
        </VStack>
      </KeyboardScreen>

      {/* One save for every field, pinned so it is reachable from anywhere on the page. */}
      <Box
        className="border-t border-border bg-card px-5 pt-3"
        style={{ paddingBottom: insets.bottom + 12 }}
      >
        <Button
          className="h-14 rounded-2xl"
          isDisabled={!dirty || saving}
          onPress={saveAll}
          accessibilityLabel="Save changes"
        >
          <ButtonText>{saving ? "Saving…" : dirty ? "Save changes" : "No changes"}</ButtonText>
        </Button>
      </Box>
    </Box>
  );
}
