import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FollowUpList } from "@/components/follow-up-list";
import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useLanguage } from "@/lib/language";

/** Every booth's follow-ups in one list; each booth also has its own tab. */
export default function FollowUpScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { language } = useLanguage();
  const openVoter = useCallback((id: string) => router.push(`/voter/${id}`), [router]);

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
            Follow-up
          </Heading>
          <Text className="text-xs text-muted-foreground">All booths</Text>
        </VStack>
      </HStack>

      <Box className="flex-1 pt-3" style={{ paddingBottom: insets.bottom }}>
        <FollowUpList partNo={null} language={language} onOpen={openVoter} />
      </Box>
    </Box>
  );
}
