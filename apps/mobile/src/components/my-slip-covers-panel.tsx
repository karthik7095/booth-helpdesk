import { Image } from "expo-image";
import { File } from "expo-file-system";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Pressable } from "react-native";

import { Box } from "@/components/ui/box";
import { HStack } from "@/components/ui/hstack";
import { CheckIcon, Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { TextCoverEditor } from "@/components/text-cover-editor";
import {
  cachedMySlipCover,
  getCoverChoice,
  getCoverText,
  removeMySlipCover,
  setCoverChoice,
  syncMySlipCovers,
  uploadMySlipCover,
  uploadTextSlipCover,
  type CoverChoice,
  type CoverSlot,
} from "@/lib/my-slip-covers";

/**
 * The user's own two slip covers, beside the constituency's, and which one
 * prints. Shown on the Printer screen where the constituency allows own covers.
 * Each cover is one of two kinds, whichever was saved last: an uploaded image,
 * or typed text drawn as one.
 */
export function MySlipCoversPanel({
  token,
  assemblyNo,
  constituencyUri,
  dimmed,
}: {
  token: string;
  assemblyNo: number;
  constituencyUri: string | null;
  dimmed: boolean;
}) {
  const [covers, setCovers] = useState<Record<CoverSlot, string | null>>(() => ({
    1: cachedMySlipCover(assemblyNo, 1),
    2: cachedMySlipCover(assemblyNo, 2),
  }));
  const [choice, setChoice] = useState<CoverChoice>("constituency");
  const [busy, setBusy] = useState<CoverSlot | null>(null);
  // The text each slot was drawn from on this phone; null for a picture.
  const [texts, setTexts] = useState<Record<CoverSlot, string | null>>({ 1: null, 2: null });
  const [editing, setEditing] = useState<CoverSlot | null>(null);

  useFocusEffect(
    useCallback(() => {
      void getCoverChoice(assemblyNo).then(setChoice);
      void Promise.all([getCoverText(assemblyNo, 1), getCoverText(assemblyNo, 2)]).then(([one, two]) =>
        setTexts({ 1: one, 2: two }),
      );
      syncMySlipCovers(token, assemblyNo)
        .then(setCovers)
        .catch(() => undefined);
    }, [token, assemblyNo]),
  );

  const choose = (next: CoverChoice) => {
    setChoice(next);
    void setCoverChoice(assemblyNo, next);
  };

  const upload = async (slot: CoverSlot) => {
    const picked = await File.pickFileAsync({ mimeTypes: ["image/*"] }).catch(() => null);

    if (!picked || picked.canceled) return;

    setBusy(slot);

    try {
      const uri = await uploadMySlipCover(token, assemblyNo, slot, picked.result.uri);

      setCovers((current) => ({ ...current, [slot]: uri }));
      setTexts((current) => ({ ...current, [slot]: null }));
      choose(String(slot) as CoverChoice);
    } catch (error) {
      Alert.alert("Could not upload", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const saveText = async (slot: CoverSlot, text: string, pngBase64: string) => {
    setBusy(slot);

    try {
      const uri = await uploadTextSlipCover(token, assemblyNo, slot, text, pngBase64);

      setCovers((current) => ({ ...current, [slot]: uri }));
      setTexts((current) => ({ ...current, [slot]: text }));
      setEditing(null);
      choose(String(slot) as CoverChoice);
    } catch (error) {
      Alert.alert("Could not save", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = (slot: CoverSlot) =>
    Alert.alert(`Remove cover ${slot}?`, "It is deleted from your account on every phone.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          setBusy(slot);

          try {
            await removeMySlipCover(token, assemblyNo, slot);
            setCovers((current) => ({ ...current, [slot]: null }));
            setTexts((current) => ({ ...current, [slot]: null }));
            if (choice === String(slot)) choose("constituency");
          } catch (error) {
            Alert.alert("Could not remove", error instanceof Error ? error.message : "Please try again.");
          } finally {
            setBusy(null);
          }
        },
      },
    ]);

  const options: { choice: CoverChoice; label: string; uri: string | null; slot?: CoverSlot }[] = [
    { choice: "constituency", label: "Constituency cover", uri: constituencyUri },
    { choice: "1", label: `My cover 1${covers[1] ? (texts[1] ? " · Text" : " · Image") : ""}`, uri: covers[1], slot: 1 },
    { choice: "2", label: `My cover 2${covers[2] ? (texts[2] ? " · Text" : " · Image") : ""}`, uri: covers[2], slot: 2 },
  ];

  return (
    <VStack space="sm" style={{ opacity: dimmed ? 0.5 : 1 }}>
      <Text className="text-xs font-bold tracking-wider text-muted-foreground">COVER TO PRINT</Text>
      {options.map((option) => {
        const selected = choice === option.choice;
        const empty = !option.uri;

        return (
          <VStack
            key={option.choice}
            space="sm"
            className={`rounded-xl border-2 p-3 ${selected ? "border-primary bg-primary-light" : "border-border"}`}
          >
            <Pressable
              onPress={() => (empty ? undefined : choose(option.choice))}
              disabled={busy !== null || empty}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
            >
              <HStack space="sm" className="items-center">
                <Box
                  className={`h-5 w-5 items-center justify-center rounded-full border-2 ${
                    selected ? "border-primary bg-primary" : "border-border"
                  }`}
                >
                  {selected ? <Icon as={CheckIcon} className="h-3 w-3 text-primary-foreground" /> : null}
                </Box>
                <Text className={`flex-1 text-base font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                  {option.label}
                </Text>
                {busy === option.slot ? <Spinner /> : null}
              </HStack>
            </Pressable>

            {option.slot && editing === option.slot ? (
              <TextCoverEditor
                initialText={texts[option.slot] ?? ""}
                saving={busy === option.slot}
                onSave={(text, png) => void saveText(option.slot!, text, png)}
                onCancel={() => setEditing(null)}
              />
            ) : option.uri ? (
              <Image source={{ uri: option.uri }} contentFit="contain" style={{ width: "100%", aspectRatio: 2 }} />
            ) : (
              <Text className="text-xs text-muted-foreground">
                {option.slot
                  ? "Empty. Upload an image (shrunk to fit, up to 1 MB) or type text."
                  : "Not uploaded by the admin yet."}
              </Text>
            )}

            {option.slot && editing !== option.slot ? (
              <HStack space="sm">
                <Pressable
                  onPress={() => void upload(option.slot!)}
                  disabled={busy !== null || editing !== null}
                  className="h-10 flex-1 items-center justify-center rounded-lg border border-border bg-card"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    {empty || texts[option.slot] ? "Image" : "Replace image"}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setEditing(option.slot!)}
                  disabled={busy !== null || editing !== null}
                  className="h-10 flex-1 items-center justify-center rounded-lg border border-border bg-card"
                >
                  <Text className="text-sm font-semibold text-foreground">
                    {texts[option.slot] ? "Edit text" : "Text"}
                  </Text>
                </Pressable>
                {!empty ? (
                  <Pressable
                    onPress={() => remove(option.slot!)}
                    disabled={busy !== null}
                    className="h-10 flex-1 items-center justify-center rounded-lg border border-border bg-card"
                  >
                    <Text className="text-sm font-semibold text-destructive">Remove</Text>
                  </Pressable>
                ) : null}
              </HStack>
            ) : null}
          </VStack>
        );
      })}
    </VStack>
  );
}
