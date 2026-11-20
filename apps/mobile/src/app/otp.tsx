import { useCallback, useEffect, useRef, useState } from "react";
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
import { useAuth } from "@/lib/auth";
import { getOtpLength, retryOtp, sendOtp, verifyOtp } from "@/lib/otp";

/** Used until the widget's own setting has been read (MSG91 → OTP → Widget). */
const DEFAULT_OTP_LENGTH = 4;
/** Seconds before the code can be sent again. */
const RESEND_AFTER = 30;

export default function OtpScreen() {
  const insets = useSafeAreaInsets();
  const { mobileNumber, confirmOtp, signOut } = useAuth();
  const [otp, setOtp] = useState("");
  const [otpLength, setOtpLength] = useState(DEFAULT_OTP_LENGTH);
  const [reqId, setReqId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const started = useRef(false);

  // Count down to when "Resend OTP" becomes available.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  const finish = useCallback(
    async (accessToken: string) => {
      await confirmOtp(accessToken);
      // The root layout swaps to the PIN screen once the number is confirmed.
    },
    [confirmOtp],
  );

  const send = useCallback(async () => {
    if (!mobileNumber || sending) return;

    setSending(true);
    setError(null);
    setNotice(null);

    try {
      if (reqId) {
        await retryOtp(reqId);
        setNotice("OTP sent again.");
      } else {
        const result = await sendOtp(mobileNumber);

        if ("accessToken" in result) {
          await finish(result.accessToken);
          return;
        }

        setReqId(result.reqId);
      }
      setWait(RESEND_AFTER);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not send the OTP.");
    } finally {
      setSending(false);
    }
  }, [finish, mobileNumber, reqId, sending]);

  useEffect(() => {
    void getOtpLength().then((length) => length && setOtpLength(length));
  }, []);

  // The code goes out as soon as the screen opens.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void send();
  }, [send]);

  const handleSubmit = async (code = otp) => {
    if (code.length !== otpLength || submitting) return;

    if (!reqId) {
      setError("Tap “Resend OTP” to get a code first.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      await finish(await verifyOtp(reqId, code));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not verify that OTP.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top + 24 }}>
      <KeyboardScreen center>
        <VStack space="xl" className="px-6">
          <VStack space="sm" className="items-center">
            <Box className="h-20 w-20 items-center justify-center rounded-full bg-primary-light">
              <Icon as={ShieldLockIcon} className="h-10 w-10 text-primary" />
            </Box>
            <Heading size="2xl" className="text-center text-primary-dark">
              Verify your mobile
            </Heading>
            <Text className="text-center text-muted-foreground">
              {sending && !reqId
                ? `Sending an OTP to +91 ${mobileNumber ?? ""}…`
                : `Enter the ${otpLength}-digit OTP sent to +91 ${mobileNumber ?? ""}.`}
            </Text>
          </VStack>

          <VStack space="md">
            <Input className="h-16 rounded-2xl border-border bg-card px-4">
              <InputSlot className="mr-1 h-10 w-10 items-center justify-center rounded-full bg-primary-light">
                <Icon as={LockIcon} size="lg" className="text-primary" />
              </InputSlot>
              <InputField
                placeholder="OTP"
                value={otp}
                onChangeText={(text) => {
                  const code = text.replace(/\D/g, "").slice(0, otpLength);
                  setOtp(code);
                  setError(null);
                  // Submits on its own once every digit is in, like the mobile field.
                  if (code.length === otpLength) void handleSubmit(code);
                }}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={otpLength}
                returnKeyType="done"
                onSubmitEditing={() => void handleSubmit()}
                className="text-base tracking-[6px]"
              />
            </Input>

            {error ? <Text className="text-sm text-destructive">{error}</Text> : null}
            {notice && !error ? <Text className="text-sm text-muted-foreground">{notice}</Text> : null}
          </VStack>

          <Button
            size="lg"
            className="h-16 rounded-full"
            isDisabled={otp.length !== otpLength || submitting}
            onPress={() => void handleSubmit()}
          >
            {submitting ? <ButtonSpinner /> : null}
            <ButtonText className="text-base tracking-widest">VERIFY</ButtonText>
          </Button>

          <Pressable onPress={() => void send()} disabled={sending || wait > 0} className="items-center">
            <Text className={`text-sm ${sending || wait > 0 ? "text-muted-foreground" : "text-primary"}`}>
              {sending ? "Sending…" : wait > 0 ? `Resend OTP in ${wait}s` : "Resend OTP"}
            </Text>
          </Pressable>

          <Pressable onPress={() => setConfirmSignOut(true)} className="items-center">
            <Text className="text-sm text-primary">Wrong number? Sign in again</Text>
          </Pressable>
        </VStack>
      </KeyboardScreen>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign in again?"
        message="You can enter a different name or mobile number."
        confirmLabel="Sign in again"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void signOut();
        }}
      />
    </Box>
  );
}
