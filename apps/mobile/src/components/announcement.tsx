import { BlurView } from "expo-blur";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet } from "react-native";

import { useBlurTarget } from "@/components/blur-target";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from "@/components/ui/alert-dialog";
import { Box } from "@/components/ui/box";
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { AlertCircleIcon, CheckIcon, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { noticeParagraphs, type ActiveAnnouncement } from "@/lib/announcement";

/** The notice's paragraphs: plain text, ✅ items with a tick, ⚠️ in a caution box. */
function NoticeBody({ body }: { body: string }) {
  return (
    <VStack space="md">
      {noticeParagraphs(body).map((paragraph, index) => {
        const text = (
          <Text
            className={`text-base ${paragraph.kind === "caution" ? "text-warning-foreground" : "text-foreground"}`}
            // Set directly: the leading-* classes come out many times too tall
            // here, spreading a paragraph's lines down the screen. Telugu's
            // stacked vowel signs need a little more room than Latin text.
            style={{ lineHeight: 26 }}
          >
            {paragraph.spans.map((span, i) => (
              <Text key={i} className={span.bold ? "font-bold" : undefined}>
                {span.text}
              </Text>
            ))}
          </Text>
        );

        if (paragraph.kind === "tick") {
          return (
            <HStack key={index} space="sm" className="items-start">
              <Box className="mt-1 h-5 w-5 items-center justify-center rounded-full bg-success/15">
                <Icon as={CheckIcon} className="h-3.5 w-3.5 text-success" />
              </Box>
              <Box className="flex-1">{text}</Box>
            </HStack>
          );
        }

        if (paragraph.kind === "caution") {
          return (
            <Box key={index} className="rounded-xl bg-warning/15 p-3">
              {text}
            </Box>
          );
        }

        return <Box key={index}>{text}</Box>;
      })}
    </VStack>
  );
}

/**
 * The notice over the home screen. Until the agent has accepted it there is no
 * way out but ticking the box, which is what brings up the button; reopened
 * from the home card afterwards it simply closes.
 */
export function AnnouncementDialog({
  announcement,
  open,
  mustAccept,
  onAccept,
  onClose,
}: {
  announcement: ActiveAnnouncement;
  open: boolean;
  mustAccept: boolean;
  onAccept: () => void;
  onClose: () => void;
}) {
  const blurTarget = useBlurTarget();
  // Keyed on the notice's version by the caller, so a new notice starts unticked.
  const [checked, setChecked] = useState(false);

  return (
    <AlertDialog isOpen={open} onClose={mustAccept ? () => undefined : onClose} size="lg">
      <AlertDialogBackdrop className="bg-black/40">
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={20}
          tint="systemUltraThinMaterial"
          blurTarget={blurTarget}
          blurMethod="dimezisBlurView"
        />
      </AlertDialogBackdrop>

      <AlertDialogContent className="max-h-[85%] rounded-2xl border-border bg-card p-5">
        <AlertDialogHeader>
          <HStack space="sm" className="flex-1 items-center">
            <Box className="h-9 w-9 items-center justify-center rounded-xl bg-warning/15">
              <Icon as={AlertCircleIcon} className="h-5 w-5 text-warning-foreground" />
            </Box>
            <Heading size="md" className="flex-1 text-primary-dark">
              {announcement.title}
            </Heading>
          </HStack>
        </AlertDialogHeader>

        <ScrollView className="mt-3" contentContainerStyle={{ paddingBottom: 4 }}>
          <NoticeBody body={announcement.body} />
        </ScrollView>

        <AlertDialogFooter className="mt-4">
          {mustAccept ? (
            <VStack space="md" className="w-full">
              <Pressable
                onPress={() => setChecked((value) => !value)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel="I have read these instructions and will follow them"
              >
                <HStack space="md" className="items-center rounded-xl border border-border bg-background p-3">
                  <Box
                    className={`h-6 w-6 items-center justify-center rounded-md border-2 ${checked ? "border-primary bg-primary" : "border-muted-foreground bg-card"}`}
                  >
                    {checked ? <Icon as={CheckIcon} className="h-4 w-4 text-white" /> : null}
                  </Box>
                  <Text className="flex-1 text-sm font-medium text-foreground">
                    నేను పై సూచనలను చదివాను, తప్పకుండా పాటిస్తాను.
                  </Text>
                </HStack>
              </Pressable>

              {/* Only once the box is ticked: the agent cannot skip past unread. */}
              {checked ? (
                <Button size="lg" className="h-12 w-full rounded-xl bg-primary" onPress={onAccept}>
                  <ButtonText>అర్థమైంది</ButtonText>
                </Button>
              ) : null}
            </VStack>
          ) : (
            <Button size="lg" variant="outline" className="w-full rounded-xl" onPress={onClose}>
              <ButtonText>Close</ButtonText>
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The accepted notice, kept at the top of the home screen; tapping it reopens the full text. */
export function AnnouncementCard({
  announcement,
  onOpen,
}: {
  announcement: ActiveAnnouncement;
  onOpen: () => void;
}) {
  const first = noticeParagraphs(announcement.body)[0]?.spans.map((span) => span.text).join("") ?? "";

  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`Read: ${announcement.title}`}>
      <HStack space="md" className="mx-5 mb-4 items-start rounded-2xl border border-warning/40 bg-warning/10 p-4">
        <Box className="h-9 w-9 items-center justify-center rounded-xl bg-warning/20">
          <Icon as={AlertCircleIcon} className="h-5 w-5 text-warning-foreground" />
        </Box>
        <VStack className="flex-1" space="xs">
          <Text className="text-base font-semibold text-primary-dark">{announcement.title}</Text>
          <Text className="text-sm text-muted-foreground" numberOfLines={2}>
            {first}
          </Text>
          <Text className="text-sm font-semibold text-primary">పూర్తిగా చదవండి</Text>
        </VStack>
      </HStack>
    </Pressable>
  );
}
