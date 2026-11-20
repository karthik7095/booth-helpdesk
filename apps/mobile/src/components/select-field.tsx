import { useState } from "react";
import { FlatList, Modal, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { CheckIcon, ChevronDownIcon, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";

export type SelectOption<T extends string> = { value: T; label: string };

/**
 * An outlined dropdown with its label sitting on the border, as on the
 * printed-form style search screen. Options open in a bottom sheet so long
 * lists (villages) stay scrollable.
 */
export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
}) {
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${selected?.label ?? ""}`}
      >
        <HStack className="h-14 items-center rounded-lg border border-border bg-card px-4">
          <Text className="flex-1 text-base uppercase text-foreground" numberOfLines={1}>
            {selected?.label ?? ""}
          </Text>
          <Icon as={ChevronDownIcon} className="h-5 w-5 text-muted-foreground" />
        </HStack>
        <Box className="absolute -top-2.5 left-3 bg-background px-1">
          <Text className="text-xs text-muted-foreground">{label}</Text>
        </Box>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <Pressable className="flex-1 bg-black/40" onPress={() => setOpen(false)} />
        <Box
          className="max-h-[60%] rounded-t-3xl bg-card pt-4"
          style={{ paddingBottom: insets.bottom + 8 }}
        >
          <Heading size="md" className="px-5 pb-2 text-foreground">
            {label}
          </Heading>
          <FlatList
            data={options}
            keyExtractor={(option) => option.value}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => {
                  onChange(item.value);
                  setOpen(false);
                }}
              >
                <HStack className="items-center px-5 py-3.5">
                  <Text
                    className={`flex-1 text-base uppercase ${
                      item.value === value ? "font-semibold text-primary" : "text-foreground"
                    }`}
                  >
                    {item.label}
                  </Text>
                  {item.value === value ? (
                    <Icon as={CheckIcon} className="h-5 w-5 text-primary" />
                  ) : null}
                </HStack>
              </Pressable>
            )}
          />
        </Box>
      </Modal>
    </>
  );
}
