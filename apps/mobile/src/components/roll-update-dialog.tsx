import { BlurView } from "expo-blur";
import { StyleSheet } from "react-native";

import { useBlurTarget } from "@/components/blur-target";
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogBody,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
} from "@/components/ui/alert-dialog";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";

/**
 * Shown when the admin has re-uploaded the roll since this phone downloaded
 * it. There is no "later": the copy on the phone is of a roll that no longer
 * exists, and a sync against it would be refused, so the only way on is to
 * replace it.
 */
export function RollUpdateDialog({
  open,
  busy,
  assemblyName,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  assemblyName: string | null;
  onConfirm: () => void;
}) {
  const blurTarget = useBlurTarget();

  return (
    <AlertDialog isOpen={open} onClose={() => undefined} closeOnOverlayClick={false} size="md">
      <AlertDialogBackdrop className="bg-transparent">
        <BlurView
          style={StyleSheet.absoluteFill}
          intensity={20}
          tint="systemUltraThinMaterial"
          blurTarget={blurTarget}
          blurMethod="dimezisBlurView"
        />
      </AlertDialogBackdrop>

      <AlertDialogContent className="rounded-2xl border-border bg-card p-5">
        <AlertDialogHeader>
          <Heading size="lg" className="text-primary-dark">
            Voter list updated
          </Heading>
        </AlertDialogHeader>

        <AlertDialogBody className="mt-2 mb-4">
          <VStack space="sm">
            <Text className="text-base text-muted-foreground">
              The admin has uploaded a new voter list for{" "}
              {assemblyName ?? "your constituency"}. The copy on this phone will be removed and
              the new list downloaded.
            </Text>
            <Text className="text-sm text-muted-foreground">
              Keep the app open and stay on a good signal until the download finishes.
            </Text>
          </VStack>
        </AlertDialogBody>

        <AlertDialogFooter>
          <Button size="lg" className="w-full rounded-xl bg-primary" onPress={onConfirm} isDisabled={busy}>
            {busy ? <ButtonSpinner className="text-primary-foreground" /> : null}
            <ButtonText>{busy ? "Removing old list…" : "Download the new list"}</ButtonText>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
