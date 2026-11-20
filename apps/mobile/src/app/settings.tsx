import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, CheckIcon, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { PanchayatSlipPanel } from "@/components/panchayat-slip-panel";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { sampleNamedVoter, type LocalVoter } from "@/lib/db";
import { useLanguage, type NameLanguage } from "@/lib/language";
import { useTheme, type ThemeMode } from "@/lib/theme";
import { voterFullName } from "@/lib/voter-actions";

const THEMES: { value: ThemeMode; label: string; hint: string }[] = [
  { value: "light", label: "Light", hint: "Light background (default)" },
  { value: "dark", label: "Dark", hint: "Dark background, easier at night" },
];

const OPTIONS: { value: NameLanguage; label: string; hint: string }[] = [
  {
    value: "english",
    label: "English",
    hint: "Names as transliterated on the roll",
  },
  {
    value: "native",
    label: "Native",
    hint: "Names in the script the roll was published in",
  },
];

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { access, token } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { mode, setMode } = useTheme();
  const [sample, setSample] = useState<LocalVoter | null>(null);

  // A real name off the roll answers "which script is native here?" — it is
  // Telugu on one constituency and Hindi on another, and the label cannot say.
  useEffect(() => {
    sampleNamedVoter()
      .then(setSample)
      .catch(() => undefined);
  }, []);

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
            Settings
          </Heading>
          <Text className="text-xs text-muted-foreground">
            {access?.assemblyName ?? "Your constituency"}
          </Text>
        </VStack>
      </HStack>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <VStack space="lg">
          {access?.isPanchayat && token ? (
            <VStack space="sm">
              <Text className="text-xs uppercase tracking-widest text-muted-foreground">
                Gram panchayat
              </Text>
              <PanchayatSlipPanel token={token} assemblyNo={access.assemblyNo} />
            </VStack>
          ) : null}

          <VStack space="sm">
            <Text className="text-xs uppercase tracking-widest text-muted-foreground">
              Voter name language
            </Text>

            {OPTIONS.map((option) => {
              const selected = language === option.value;

              return (
                <Pressable key={option.value} onPress={() => setLanguage(option.value)}>
                  <HStack
                    space="md"
                    className={`items-center rounded-2xl border bg-card p-4 ${
                      selected ? "border-primary" : "border-border"
                    }`}
                  >
                    <VStack className="flex-1">
                      <Text className="text-base font-medium text-foreground">{option.label}</Text>
                      <Text className="text-xs text-muted-foreground">{option.hint}</Text>
                      {sample ? (
                        <Text className="pt-1 text-sm text-primary-dark" numberOfLines={1}>
                          {voterFullName(sample, option.value)}
                        </Text>
                      ) : null}
                    </VStack>

                    {selected ? (
                      <Box className="h-7 w-7 items-center justify-center rounded-full bg-primary">
                        <Icon as={CheckIcon} className="h-4 w-4 text-primary-foreground" />
                      </Box>
                    ) : (
                      <Box className="h-7 w-7 rounded-full border border-border" />
                    )}
                  </HStack>
                </Pressable>
              );
            })}

            <Text className="text-xs text-muted-foreground">
              This changes the names shown in search, voter and family screens, and on printed
              slips. Search still matches either script, whichever is selected. The rest of the app
              stays in English.
            </Text>
          </VStack>

          <VStack space="sm">
            <Text className="text-xs uppercase tracking-widest text-muted-foreground">
              Appearance
            </Text>

            {THEMES.map((option) => {
              const selected = mode === option.value;

              return (
                <Pressable key={option.value} onPress={() => setMode(option.value)}>
                  <HStack
                    space="md"
                    className={`items-center rounded-2xl border bg-card p-4 ${
                      selected ? "border-primary" : "border-border"
                    }`}
                  >
                    <VStack className="flex-1">
                      <Text className="text-base font-medium text-foreground">{option.label}</Text>
                      <Text className="text-xs text-muted-foreground">{option.hint}</Text>
                    </VStack>

                    {selected ? (
                      <Box className="h-7 w-7 items-center justify-center rounded-full bg-primary">
                        <Icon as={CheckIcon} className="h-4 w-4 text-primary-foreground" />
                      </Box>
                    ) : (
                      <Box className="h-7 w-7 rounded-full border border-border" />
                    )}
                  </HStack>
                </Pressable>
              );
            })}
          </VStack>
        </VStack>
      </ScrollView>
    </Box>
  );
}
