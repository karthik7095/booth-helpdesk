import { Image } from "expo-image";
import React, { useRef, useState } from "react";
import { Keyboard, TextInput, TouchableWithoutFeedback } from "react-native";

import { ShieldLockIcon, UserIcon } from "@/components/icons";
import { KeyboardScreen } from "@/components/keyboard-screen";
import { useKeyboardVisible } from "@/lib/use-keyboard-visible";
import { Box } from "@/components/ui/box";
import { Button, ButtonIcon, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Icon, PhoneIcon } from "@/components/ui/icon";
import { Input, InputField, InputSlot } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";

const illustration = require("@/assets/images/Votingbooth.png");

export default function Login() {
  const { signIn } = useAuth();
  const keyboardOpen = useKeyboardVisible();
  // gluestack types InputField's ref loosely; at runtime it is the TextInput.
  const mobileRef = useRef<TextInput>(null);
  const focusMobile = () => mobileRef.current?.focus();
  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmit = fullName.trim().length > 1 && mobileNumber.length === 10;

  const handleLogin = async (name = fullName, mobile = mobileNumber) => {
    if (submitting || name.trim().length < 2 || mobile.length !== 10) return;

    Keyboard.dismiss();
    setSubmitting(true);
    setError(null);

    try {
      await signIn(name.trim(), mobile);
      // The root layout swaps to the PIN screen once a session exists.
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onMobileChange = (text: string) => {
    const digits = text.replace(/\D/g, "").slice(0, 10);
    setMobileNumber(digits);

    // The tenth digit is the last thing to enter — go straight in.
    if (digits.length === 10 && fullName.trim().length > 1) {
      void handleLogin(fullName, digits);
    }
  };

  return (
    <>
      <Box className="flex-1 bg-background">
        <KeyboardScreen center>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <VStack>
              <Box className="w-full overflow-hidden bg-background">
                <Image
                  source={illustration}
                  contentFit="cover"
                  contentPosition="top center"
                  style={{ width: "100%", aspectRatio: 1672 / 941 }}
                />
              </Box>

              <VStack space="xl" className="px-6 pt-6">

                <VStack space="md">
                  <Input className="h-16 rounded-2xl border-border bg-card px-4">
                    <InputSlot className="mr-1 h-10 w-10 items-center justify-center rounded-full bg-primary-light">
                      <Icon as={UserIcon} size="lg" className="text-primary" />
                    </InputSlot>
                    <InputField
                      placeholder="Full Name"
                      value={fullName}
                      onChangeText={setFullName}
                      autoCapitalize="words"
                      autoComplete="name"
                      returnKeyType="next"
                      submitBehavior="submit"
                      onSubmitEditing={focusMobile}
                      className="text-base"
                    />
                  </Input>

                  <Input className="h-16 rounded-2xl border-border bg-card px-4">
                    <InputSlot className="mr-1 h-10 w-10 items-center justify-center rounded-full bg-primary-light">
                      <Icon as={PhoneIcon} size="lg" className="text-primary" />
                    </InputSlot>
                    <InputField
                      ref={mobileRef as unknown as React.Ref<never>}
                      placeholder="Mobile Number"
                      value={mobileNumber}
                      onChangeText={onMobileChange}
                      keyboardType="phone-pad"
                      autoComplete="tel"
                      maxLength={10}
                      returnKeyType="done"
                      onSubmitEditing={() => handleLogin()}
                      className="text-base"
                    />
                  </Input>

                  {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
                </VStack>

                <Button
                  size="lg"
                  className="h-16 rounded-full"
                  isDisabled={!canSubmit || submitting}
                  onPress={() => handleLogin()}
                >
                  {submitting ? (
                    <ButtonSpinner />
                  ) : (
                    <ButtonIcon as={ShieldLockIcon} size="lg" className="h-6 w-6" />
                  )}
                  <ButtonText className="text-base tracking-widest">LOGIN</ButtonText>
                </Button>
              </VStack>
            </VStack>
          </TouchableWithoutFeedback>
        </KeyboardScreen>
      </Box>
    </>
  );
}
