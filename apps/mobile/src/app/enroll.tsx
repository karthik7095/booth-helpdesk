import { voterEnrollmentSchema } from "@voter/shared";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { KeyboardScreen } from "@/components/keyboard-screen";

import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, Icon } from "@/components/ui/icon";
import { Input, InputField } from "@/components/ui/input";
import { Radio, RadioGroup, RadioIcon, RadioIndicator, RadioLabel } from "@/components/ui/radio";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { enrollVoterLocally } from "@/lib/db";
import { isOnline, syncIfOnline } from "@/lib/sync";

type Form = {
  eFirstName: string;
  eMiddleName: string;
  sex: string;
  age: string;
  partNo: string;
  vcardId: string;
  houseNo: string;
  mobileNo1: string;
  eVillage: string;
};

const EMPTY: Form = {
  eFirstName: "",
  eMiddleName: "",
  sex: "",
  age: "",
  partNo: "",
  vcardId: "",
  houseNo: "",
  mobileNo1: "",
  eVillage: "",
};

export default function EnrollScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { access, token, refreshLocalCount } = useAuth();

  const [form, setForm] = useState<Form>({
    ...EMPTY,
    // A PIN scoped to one part can only add to that part, so fill it in.
    partNo: access?.partNos.length === 1 ? String(access.partNos[0]) : "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const set = (key: keyof Form) => (value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    if (!access || saving) return;

    setSaving(true);
    setError(null);

    const parsed = voterEnrollmentSchema.safeParse({
      clientRef: Crypto.randomUUID(),
      partNo: form.partNo,
      eFirstName: form.eFirstName,
      eMiddleName: form.eMiddleName || null,
      sex: form.sex || null,
      age: form.age || null,
      vcardId: form.vcardId || null,
      houseNo: form.houseNo || null,
      mobileNo1: form.mobileNo1 || null,
      eVillage: form.eVillage || null,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the details you entered.");
      setSaving(false);
      return;
    }

    try {
      // Saved to this phone first, so enrolment works with no signal at all.
      await enrollVoterLocally(parsed.data, {
        assemblyNo: access.assemblyNo,
        assemblyName: access.assemblyName,
      });
      await refreshLocalCount();

      const online = await isOnline();
      if (online) await syncIfOnline(token);

      setDone(
        online
          ? `${parsed.data.eFirstName} was enrolled and synced.`
          : `${parsed.data.eFirstName} was saved on this phone and will sync when you are back online.`,
      );
      setForm({ ...EMPTY, partNo: form.partNo });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this voter.");
    } finally {
      setSaving(false);
    }
  };

  const fields: {
    key: keyof Form;
    label: string;
    keyboard?: "numeric" | "phone-pad";
  }[] = [
    { key: "eFirstName", label: "Full name *" },
    { key: "eMiddleName", label: "Relative's name (father / husband)" },
    { key: "age", label: "Age", keyboard: "numeric" },
    { key: "partNo", label: "Booth / part number *", keyboard: "numeric" },
    { key: "vcardId", label: "Voter ID (EPIC)" },
    { key: "houseNo", label: "House number" },
    { key: "mobileNo1", label: "Mobile number", keyboard: "phone-pad" },
    { key: "eVillage", label: "Village / area" },
  ];

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
          Enroll new voter
        </Heading>
      </HStack>

      <KeyboardScreen contentContainerStyle={{ padding: 20 }} extraBottom={32}>
        <VStack space="md">
          <Text className="text-sm text-muted-foreground">
            Added to {access?.assemblyName ?? "your constituency"}. The serial number is assigned
            when this reaches the server.
          </Text>

          {fields.map((field) => (
            <VStack key={field.key} space="xs">
              <Text className="text-xs uppercase tracking-wider text-muted-foreground">
                {field.label}
              </Text>
              <Input className="h-12 rounded-xl border-border bg-card px-3">
                <InputField
                  value={form[field.key]}
                  onChangeText={set(field.key)}
                  keyboardType={field.keyboard ?? "default"}
                  autoCapitalize={field.key === "vcardId" ? "characters" : "words"}
                  className="text-base"
                />
              </Input>
            </VStack>
          ))}

          <VStack space="xs">
            <Text className="text-xs uppercase tracking-wider text-muted-foreground">Sex</Text>
            <RadioGroup value={form.sex} onChange={(value: string) => set("sex")(value)}>
              <HStack space="xl">
                {[
                  { label: "Male", value: "M" },
                  { label: "Female", value: "F" },
                  { label: "Other", value: "O" },
                ].map((option) => (
                  <Radio key={option.value} value={option.value} size="md">
                    <RadioIndicator>
                      <RadioIcon />
                    </RadioIndicator>
                    <RadioLabel className="text-base">{option.label}</RadioLabel>
                  </Radio>
                ))}
              </HStack>
            </RadioGroup>
          </VStack>

          {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          {done ? <Text className="text-sm text-success">{done}</Text> : null}

          <Button size="lg" className="mt-2 h-14 rounded-full" isDisabled={saving} onPress={submit}>
            {saving ? <ButtonSpinner /> : null}
            <ButtonText>Save voter</ButtonText>
          </Button>
        </VStack>
      </KeyboardScreen>
    </Box>
  );
}
