import { BlurView } from "expo-blur";
import type { ReactNode } from "react";
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
import { Button, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";

/**
 * An in-app confirmation sheet. Used instead of the OS alert so confirmations
 * carry the app's own styling. Without `onCancel` it is mandatory: no cancel
 * button, and tapping outside or pressing back does not dismiss it.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  destructive = false,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Omit to make the dialog mandatory — the only way out is `onConfirm`. */
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const blurTarget = useBlurTarget();

  return (
    <AlertDialog isOpen={open} onClose={onCancel ?? (() => undefined)} size="md">
      {/* No dim: the user asked for blur alone. */}
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
            {title}
          </Heading>
        </AlertDialogHeader>

        <AlertDialogBody className="mt-2 mb-4">
          <VStack space="sm">
            <Text className="text-base text-muted-foreground">
              {message}
            </Text>

            {children}
          </VStack>
        </AlertDialogBody>

        <AlertDialogFooter>
          <HStack space="sm" className="w-full justify-end">
            {onCancel ? (
              <Button
                variant="outline"
                size="lg"
                className="rounded-xl"
                onPress={onCancel}
              >
                <ButtonText>{cancelLabel}</ButtonText>
              </Button>
            ) : null}

            <Button
              size="lg"
              className={`rounded-xl ${destructive ? "bg-destructive" : "bg-primary"
                }`}
              onPress={onConfirm}
            >
              <ButtonText className={destructive ? "text-white" : undefined}>
                {confirmLabel}
              </ButtonText>
            </Button>
          </HStack>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
