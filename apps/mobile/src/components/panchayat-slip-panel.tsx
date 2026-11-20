import { DEFAULT_SLIP_TAGLINE, type PanchayatSlip, type WardSummary } from "@voter/shared";
import { File } from "expo-file-system";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Pressable } from "react-native";

import { SlipHeaderRenderer, type SlipHeaderRendererHandle } from "@/components/slip-header-renderer";
import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { ChevronDownIcon, ChevronUpIcon, Icon } from "@/components/ui/icon";
import { Input, InputField } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import {
  cachedPanchayatSlip,
  cachedSymbolUri,
  removeSymbol,
  savePanchayatSlip,
  saveWardCandidate,
  symbolDataUri,
  syncPanchayatSlip,
  topImageData,
  uploadSymbol,
  type SymbolOwner,
} from "@/lib/panchayat-slip";
import { cachedWardBannerUri, cachedWardList, syncWardBanners, uploadWardBannerPng } from "@/lib/ward-banners";

/**
 * A gram panchayat's voter slip header, set up in Settings by anyone holding
 * the PIN: the Sarpanch candidate (one for the whole panchayat) and each
 * ward's member candidate, typed names and an uploaded symbol each. The phone
 * draws every ward's header from them and saves it as that ward's print
 * banner, which every phone then prints at the top of the ward's slips.
 */
export function PanchayatSlipPanel({ token, assemblyNo }: { token: string; assemblyNo: number }) {
  const renderer = useRef<SlipHeaderRendererHandle>(null);
  const fetched = useRef(false);
  const [wards, setWards] = useState<WardSummary[] | null>(null);
  const [slip, setSlip] = useState<PanchayatSlip | null>(null);
  const [banners, setBanners] = useState<Record<number, string | null>>({});
  const [symbols, setSymbols] = useState<Record<string, string | null>>({});
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  // The header form, edited locally until saved.
  const [heading, setHeading] = useState("");
  const [tagline, setTagline] = useState("");
  const [sarpanch, setSarpanch] = useState("");
  const [sarpanchEn, setSarpanchEn] = useState("");
  const [municipal, setMunicipal] = useState(false);
  // Each ward's member names, keyed by ward.
  const [members, setMembers] = useState<Record<number, { name: string; nameEn: string }>>({});

  const refreshLocal = useCallback(
    (list: WardSummary[]) => {
      setBanners(Object.fromEntries(list.map((ward) => [ward.wardNo, cachedWardBannerUri(assemblyNo, ward.wardNo)])));
      setSymbols({
        sarpanch: cachedSymbolUri(assemblyNo, "sarpanch"),
        top: cachedSymbolUri(assemblyNo, "top"),
        ...Object.fromEntries(list.map((ward) => [String(ward.wardNo), cachedSymbolUri(assemblyNo, ward.wardNo)])),
      });
    },
    [assemblyNo],
  );

  const applySlip = useCallback((next: PanchayatSlip) => {
    setSlip(next);
    setHeading(next.heading ?? "");
    setTagline(next.tagline ?? "");
    setSarpanch(next.sarpanchName ?? "");
    setSarpanchEn(next.sarpanchNameEn ?? "");
    setMunicipal(next.municipal);
    setMembers(
      Object.fromEntries(next.wards.map((ward) => [ward.wardNo, { name: ward.name ?? "", nameEn: ward.nameEn ?? "" }])),
    );
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void Promise.all([cachedWardList(assemblyNo), cachedPanchayatSlip(assemblyNo)]).then(([list, cached]) => {
        if (cancelled) return;
        setWards((current) => current ?? list);
        // The cached copy fills the form only until the server's arrives.
        if (!fetched.current) applySlip(cached);
        refreshLocal(list);
      });
      void Promise.all([syncWardBanners(token, assemblyNo), syncPanchayatSlip(token, assemblyNo)])
        .then(([list, fresh]) => {
          if (cancelled) return;
          fetched.current = true;
          setWards(list);
          applySlip(fresh);
          refreshLocal(list);
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
      };
    }, [token, assemblyNo, refreshLocal, applySlip]),
  );

  /** Draws one ward's header from the saved details and uploads it as the ward's print banner. */
  const redraw = async (current: PanchayatSlip, wardNo: number) => {
    if (!renderer.current) throw new Error("The slip drawer is not ready. Try again.");

    const member = current.wards.find((ward) => ward.wardNo === wardNo);
    const png = await renderer.current.render({
      heading: current.heading,
      tagline: current.tagline,
      sarpanchName: current.sarpanchName,
      sarpanchNameEn: current.sarpanchNameEn,
      sarpanchSymbol: await symbolDataUri(assemblyNo, "sarpanch"),
      wardNo,
      memberName: member?.name ?? null,
      memberNameEn: member?.nameEn ?? null,
      memberSymbol: await symbolDataUri(assemblyNo, wardNo),
      municipal: current.municipal,
      topImage: await topImageData(assemblyNo),
    });
    const uri = await uploadWardBannerPng(token, assemblyNo, wardNo, png);

    setBanners((existing) => ({ ...existing, [wardNo]: uri }));
  };

  /** After a Sarpanch change every ward's header changes, one after another. */
  const redrawAll = async (current: PanchayatSlip) => {
    const list = wards ?? [];

    for (const [index, ward] of list.entries()) {
      setProgress(`Updating ward slips ${index + 1} of ${list.length}…`);
      await redraw(current, ward.wardNo);
    }

    setProgress(null);
  };

  const fail = (title: string) => (error: unknown) => {
    setProgress(null);
    Alert.alert(title, error instanceof Error ? error.message : "Please try again.");
  };

  const saveHeader = async () => {
    setBusy("header");

    try {
      const saved = await savePanchayatSlip(token, assemblyNo, {
        heading,
        tagline,
        sarpanchName: sarpanch,
        sarpanchNameEn: sarpanchEn,
        municipal,
      });

      applySlip(saved);
      await redrawAll(saved);
    } catch (error) {
      fail("Could not save")(error);
    } finally {
      setBusy(null);
    }
  };

  const saveMember = async (wardNo: number) => {
    const names = members[wardNo] ?? { name: "", nameEn: "" };

    setBusy(`ward-${wardNo}`);

    try {
      const saved = await saveWardCandidate(token, assemblyNo, wardNo, { name: names.name, nameEn: names.nameEn });

      setSlip(saved);
      await redraw(saved, wardNo);
    } catch (error) {
      fail("Could not save")(error);
    } finally {
      setBusy(null);
    }
  };

  const pickSymbol = async (owner: SymbolOwner) => {
    const picked = await File.pickFileAsync({ mimeTypes: ["image/*"] }).catch(() => null);

    if (!picked || picked.canceled || !slip) return;

    const key = String(owner);

    setBusy(`symbol-${key}`);

    try {
      const uri = await uploadSymbol(token, assemblyNo, owner, picked.result.uri);

      setSymbols((existing) => ({ ...existing, [key]: uri }));
      if (typeof owner === "string") await redrawAll(slip);
      else await redraw(slip, owner);
    } catch (error) {
      fail("Could not upload")(error);
    } finally {
      setBusy(null);
    }
  };

  const dropSymbol = (owner: SymbolOwner) => {
    const key = String(owner);
    const thing = slip?.municipal ? "photo" : "symbol";
    const who =
      owner === "sarpanch"
        ? `the ${slip?.municipal ? "Mayor" : "Sarpanch"} ${thing}`
        : owner === "top"
          ? "the top image"
          : `ward ${owner}'s ${thing}`;

    Alert.alert(`Remove ${who}?`, "It is removed for everyone, and the slip headers are drawn again without it.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (!slip) return;
          setBusy(`symbol-${key}`);

          try {
            await removeSymbol(token, assemblyNo, owner);
            setSymbols((existing) => ({ ...existing, [key]: null }));
            if (typeof owner === "string") await redrawAll(slip);
            else await redraw(slip, owner);
          } catch (error) {
            fail("Could not remove")(error);
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (wards === null || slip === null) {
    return (
      <HStack space="sm" className="items-center rounded-2xl border border-border bg-card p-4">
        <Spinner />
        <Text className="text-sm text-muted-foreground">Loading wards…</Text>
      </HStack>
    );
  }

  const total = wards.reduce((sum, ward) => sum + ward.total, 0);
  const ready = wards.filter((ward) => banners[ward.wardNo]).length;
  const working = busy !== null || progress !== null;
  // Labels follow the saved choice, so the form matches what prints.
  const head = slip.municipal ? "Mayor" : "Sarpanch";
  const member = slip.municipal ? "Corporator" : "Ward member";
  const mark = slip.municipal ? "Photo" : "Party symbol";

  return (
    <VStack space="sm">
      <SlipHeaderRenderer ref={renderer} />

      <HStack className="overflow-hidden rounded-2xl border border-border bg-card">
        <VStack className="flex-1 border-r border-border p-3">
          <Text className="text-xs text-muted-foreground">Wards</Text>
          <Text className="text-2xl font-bold text-foreground">{wards.length}</Text>
        </VStack>
        <VStack className="flex-1 p-3">
          <Text className="text-xs text-muted-foreground">Voters</Text>
          <Text className="text-2xl font-bold text-foreground">{total.toLocaleString()}</Text>
        </VStack>
      </HStack>

      {progress ? (
        <HStack space="sm" className="items-center rounded-xl bg-primary-light p-3">
          <Spinner />
          <Text className="flex-1 text-sm font-semibold text-primary-dark">{progress}</Text>
        </HStack>
      ) : null}

      {/* Shared by every ward's slip. */}
      <Text className="pt-2 text-xs uppercase tracking-widest text-muted-foreground">Slip header · all wards</Text>
      <VStack space="md" className="rounded-2xl border border-border bg-card p-4">
        <Field label="Heading" value={heading} onChange={setHeading} placeholder="వెంగళ రావు నగర్ గ్రామ పంచాయతీ ఎన్నికలు" />

        <Pressable
          onPress={() => setMunicipal((value) => !value)}
          disabled={working}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: municipal }}
          className="flex-row items-center gap-3 rounded-xl border border-border bg-background p-3"
        >
          <Box className={`h-6 w-6 items-center justify-center rounded-md border-2 ${municipal ? "border-primary bg-primary" : "border-border"}`}>
            {municipal ? <Text className="text-sm font-bold text-primary-foreground">✓</Text> : null}
          </Box>
          <VStack className="flex-1">
            <Text className="text-sm font-semibold text-foreground">Municipal corporation</Text>
            <Text className="text-xs text-muted-foreground">Print MAYOR and WARD CORPORATOR, with photos. Applies when you save.</Text>
          </VStack>
        </Pressable>

        <SymbolSlot
          label="Image above the candidates (optional)"
          uri={symbols.top ?? null}
          busy={busy === "symbol-top"}
          disabled={working}
          onPick={() => void pickSymbol("top")}
          onRemove={() => dropSymbol("top")}
        />

        <VStack space="sm">
          <Text className="text-sm font-semibold text-foreground">{head} candidate</Text>
          <SymbolSlot
            label={mark}
            uri={symbols.sarpanch ?? null}
            busy={busy === "symbol-sarpanch"}
            disabled={working}
            onPick={() => void pickSymbol("sarpanch")}
            onRemove={() => dropSymbol("sarpanch")}
          />
          <Field label="Name (Telugu)" value={sarpanch} onChange={setSarpanch} placeholder="సర్పంచ్ అభ్యర్థి పేరు" />
          <Field label="Name (English)" value={sarpanchEn} onChange={setSarpanchEn} placeholder={`${head.toUpperCase()} CANDIDATE`} />
        </VStack>

        <Field label="Line under the candidates" value={tagline} onChange={setTagline} placeholder={DEFAULT_SLIP_TAGLINE} />

        <SaveButton label="Save and update every ward's slip" busy={busy === "header"} disabled={working} onPress={() => void saveHeader()} />
      </VStack>

      <HStack className="items-baseline justify-between pt-2">
        <Text className="text-xs uppercase tracking-widest text-muted-foreground">{member} candidates</Text>
        <Text className="text-xs font-semibold text-primary-dark">
          {ready} of {wards.length} slips ready
        </Text>
      </HStack>

      {wards.length === 0 ? (
        <Text className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
          No wards yet. The roll needs a WARD_NO column; ask your admin to re-upload it.
        </Text>
      ) : (
        <VStack className="overflow-hidden rounded-2xl border border-border bg-card">
          {wards.map((ward, index) => {
            const expanded = open === ward.wardNo;
            const saved = slip.wards.find((row) => row.wardNo === ward.wardNo);
            const names = members[ward.wardNo] ?? { name: "", nameEn: "" };
            const banner = banners[ward.wardNo] ?? null;

            return (
              <VStack key={ward.wardNo} className={index ? "border-t border-border" : undefined}>
                <Pressable
                  onPress={() => setOpen(expanded ? null : ward.wardNo)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded }}
                  accessibilityLabel={`Ward ${ward.wardNo}${saved?.name ? `, ${saved.name}` : ", no candidate yet"}`}
                  className="min-h-16 flex-row items-center gap-3 px-4 py-3"
                >
                  <Box className="h-10 w-10 items-center justify-center rounded-xl bg-primary-light">
                    <Text className="text-base font-bold text-primary-dark">{ward.wardNo}</Text>
                  </Box>
                  <VStack className="flex-1">
                    <Text className="text-base font-semibold text-foreground" numberOfLines={1}>
                      {saved?.name || `Ward ${ward.wardNo}`}
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      Ward {ward.wardNo} · {ward.total.toLocaleString()} voters · booth{ward.booths.length > 1 ? "s" : ""}{" "}
                      {ward.booths.join(", ")}
                    </Text>
                  </VStack>
                  <Text className={`text-xs font-semibold ${banner ? "text-primary-dark" : "text-muted-foreground"}`}>
                    {banner ? "Slip ✓" : "Not set"}
                  </Text>
                  <Icon as={expanded ? ChevronUpIcon : ChevronDownIcon} className="h-5 w-5 text-muted-foreground" />
                </Pressable>

                {expanded ? (
                  <VStack space="md" className="px-4 pb-4">
                    <SymbolSlot
                      label={`${member} ${mark.toLowerCase()}`}
                      uri={symbols[String(ward.wardNo)] ?? null}
                      busy={busy === `symbol-${ward.wardNo}`}
                      disabled={working}
                      onPick={() => void pickSymbol(ward.wardNo)}
                      onRemove={() => dropSymbol(ward.wardNo)}
                    />
                    <Field
                      label="Name (Telugu)"
                      value={names.name}
                      onChange={(name) => setMembers((all) => ({ ...all, [ward.wardNo]: { ...names, name } }))}
                      placeholder="వార్డు సభ్యుని పేరు"
                    />
                    <Field
                      label="Name (English)"
                      value={names.nameEn}
                      onChange={(nameEn) => setMembers((all) => ({ ...all, [ward.wardNo]: { ...names, nameEn } }))}
                      placeholder="WARD MEMBER CANDIDATE"
                    />
                    <SaveButton
                      label={`Save ward ${ward.wardNo}'s slip`}
                      busy={busy === `ward-${ward.wardNo}`}
                      disabled={working}
                      onPress={() => void saveMember(ward.wardNo)}
                    />

                    <Text className="text-xs uppercase tracking-widest text-muted-foreground">Printed at the top of the slip</Text>
                    {banner ? (
                      <Image
                        source={{ uri: banner }}
                        contentFit="contain"
                        accessibilityLabel={`Slip header for ward ${ward.wardNo}`}
                        style={{ width: "100%", aspectRatio: symbols.top ? 576 / 1120 : 576 / 560, backgroundColor: "#fff", borderRadius: 12 }}
                      />
                    ) : (
                      <Text className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                        {"Not drawn yet. Save the ward’s candidate to make it."}
                      </Text>
                    )}
                    {saved?.updatedBy ? (
                      <Text className="text-xs text-muted-foreground">Last changed by {saved.updatedBy}</Text>
                    ) : null}
                  </VStack>
                ) : null}
              </VStack>
            );
          })}
        </VStack>
      )}
    </VStack>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <VStack space="xs">
      <Text className="text-xs font-semibold text-muted-foreground">{label}</Text>
      <Input className="h-12 rounded-xl border-border bg-background px-3">
        <InputField value={value} onChangeText={onChange} placeholder={placeholder} maxLength={80} accessibilityLabel={label} />
      </Input>
    </VStack>
  );
}

function SymbolSlot({
  label,
  uri,
  busy,
  disabled,
  onPick,
  onRemove,
}: {
  label: string;
  uri: string | null;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  return (
    <HStack space="md" className="items-center">
      <Box className="h-20 w-20 items-center justify-center overflow-hidden rounded-xl border-2 border-foreground bg-white">
        {uri ? (
          <Image source={{ uri }} contentFit="contain" accessibilityLabel={label} style={{ width: 72, height: 72 }} />
        ) : (
          <Text className="px-1 text-center text-[10px] text-muted-foreground">None</Text>
        )}
      </Box>
      <VStack space="xs" className="flex-1">
        <Text className="text-sm font-semibold text-foreground">{label}</Text>
        <HStack space="sm">
          <Pressable
            onPress={onPick}
            disabled={disabled}
            className="h-11 flex-1 items-center justify-center rounded-xl border border-border bg-card"
          >
            {busy ? <Spinner /> : <Text className="text-sm font-semibold text-foreground">{uri ? "Replace" : "Upload"}</Text>}
          </Pressable>
          {uri ? (
            <Pressable
              onPress={onRemove}
              disabled={disabled}
              className="h-11 items-center justify-center rounded-xl border border-border px-4"
            >
              <Text className="text-sm font-semibold text-destructive">Remove</Text>
            </Pressable>
          ) : null}
        </HStack>
      </VStack>
    </HStack>
  );
}

function SaveButton({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={`h-12 items-center justify-center rounded-xl bg-primary ${disabled && !busy ? "opacity-60" : ""}`}
    >
      {busy ? <Spinner /> : <Text className="text-base font-semibold text-primary-foreground">{label}</Text>}
    </Pressable>
  );
}
