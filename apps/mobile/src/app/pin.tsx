import { APPROVAL_PENDING } from "@voter/shared";
import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ShieldLockIcon } from "@/components/icons";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { KeyboardScreen } from "@/components/keyboard-screen";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Icon, LockIcon } from "@/components/ui/icon";
import { Input, InputField, InputSlot } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

export default function PinScreen() {
  const insets = useSafeAreaInsets();
  const { fullName, submitPin, signOut } = useAuth();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // The constituency requires approval and this user has not been approved
  // yet: the PIN was right, so it is kept and tried again until they are.
  const [waiting, setWaiting] = useState(false);

  const canSubmit = pin.length >= 6;

  const tryPin = useCallback(async () => {
    setSubmitting(true);
    setError(null);

    try {
      await submitPin(pin);
      // The root layout swaps to the voter list once the PIN is accepted.
      setWaiting(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === APPROVAL_PENDING) setWaiting(true);
      else {
        setWaiting(false);
        setError(caught instanceof Error ? caught.message : "Could not verify that PIN.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [pin, submitPin]);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;

    await tryPin();
  };

  // While waiting, check again now and then. Slower than the PIN's rate limit
  // (10 tries in 5 minutes), so the agent can still tap Check again.
  useEffect(() => {
    if (!waiting) return;

    const timer = setInterval(() => void tryPin(), 45_000);

    return () => clearInterval(timer);
  }, [waiting, tryPin]);

  if (waiting) {
    return (
      <Box className="flex-1 bg-background px-6" style={{ paddingTop: insets.top + 48 }}>
        <VStack space="xl" className="flex-1 justify-center">
          <VStack space="sm" className="items-center">
            <Box className="h-20 w-20 items-center justify-center rounded-full bg-primary-light">
              <Icon as={ShieldLockIcon} className="h-10 w-10 text-primary" />
            </Box>
            <Heading size="2xl" className="text-center text-primary-dark">
              Waiting for approval
            </Heading>
            <Text className="text-center text-muted-foreground">
              {fullName ? `${fullName}, your` : "Your"} PIN is correct. An admin of this constituency has to
              approve you before the app opens. Ask them to approve you, then tap Check again. This screen
              also checks by itself.
            </Text>
          </VStack>

          {error ? <Text className="text-center text-sm text-destructive">{error}</Text> : null}

          <Button size="lg" className="h-16 rounded-full" isDisabled={submitting} onPress={() => void tryPin()}>
            {submitting ? <ButtonSpinner /> : null}
            <ButtonText className="text-base tracking-widest">CHECK AGAIN</ButtonText>
          </Button>

          <Pressable
            onPress={() => {
              setWaiting(false);
              setPin("");
            }}
            className="min-h-11 items-center justify-center"
          >
            <Text className="text-sm text-primary">Use a different PIN</Text>
          </Pressable>
        </VStack>
      </Box>
    );
  }

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top + 24 }}>
      <KeyboardScreen center>
        <VStack space="xl" className="px-6">
          <VStack space="sm" className="items-center">
            <Box className="h-20 w-20 items-center justify-center rounded-full bg-primary-light">
              <Icon as={ShieldLockIcon} className="h-10 w-10 text-primary" />
            </Box>
            <Heading size="2xl" className="text-center text-primary-dark">
              Enter your access PIN
            </Heading>
            <Text className="text-center text-muted-foreground">
              {fullName ? `Signed in as ${fullName}. ` : ""}
              This PIN unlocks the constituency it was issued for.
            </Text>
          </VStack>

          <VStack space="md">
            <Input className="h-16 rounded-2xl border-border bg-card px-4">
              <InputSlot className="mr-1 h-10 w-10 items-center justify-center rounded-full bg-primary-light">
                <Icon as={LockIcon} size="lg" className="text-primary" />
              </InputSlot>
              <InputField
                placeholder="e.g. S29GD241B1"
                value={pin}
                onChangeText={(text) => {
                  setPin(text.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 16));
                  setError(null);
                }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                returnKeyType="done"
                onSubmitEditing={handleSubmit}
                className="text-base tracking-[3px]"
              />
            </Input>

            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
          </VStack>

          <Button
            size="lg"
            className="h-16 rounded-full"
            isDisabled={!canSubmit || submitting}
            onPress={handleSubmit}
          >
            {submitting ? <ButtonSpinner /> : null}
            <ButtonText className="text-base tracking-widest">UNLOCK</ButtonText>
          </Button>

          <Pressable onPress={() => setConfirmSignOut(true)} className="items-center">
            <Text className="text-sm text-primary">Not you? Sign in with different details</Text>
          </Pressable>
        </VStack>
      </KeyboardScreen>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign in as someone else?"
        message="This clears the current sign-in on this phone."
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
      />
    </Box>
  );
}
