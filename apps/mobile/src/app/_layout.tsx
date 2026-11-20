import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";

import { BlurTargetProvider } from "@/components/blur-target";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RollUpdateDialog } from "@/components/roll-update-dialog";
import { HomeSkeleton } from "@/components/skeletons";
import { Box } from "@/components/ui/box";
import { GluestackUIProvider } from "@/components/ui/gluestack-ui-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { LanguageProvider } from "@/lib/language";
import { ThemeProvider } from "@/lib/theme";
import { removeLegacyBundleDatabase } from "@/lib/legacy-cleanup";
import { useOtaUpdates } from "@/lib/ota";
import { startPrinterWatch } from "@/lib/printer-watch";
import { useUsageTracker } from "@/lib/usage-tracker";
import "@/global.css";

function RootNavigator() {
  const { loading, token, otpPending, access, localCount, rollUpdate, replaceRoll } = useAuth();
  const [replacing, setReplacing] = useState(false);
  const ready = access !== null && localCount > 0;

  const onReplaceRoll = async () => {
    setReplacing(true);

    try {
      // Drops the outdated roll; the route guard below then shows the
      // download screen, which starts the new download on its own.
      await replaceRoll();
    } finally {
      setReplacing(false);
    }
  };
  // Usage is only reported once a PIN has unlocked the session.
  useUsageTracker(token, access !== null);
  const ota = useOtaUpdates();

  // Reconnects the agent's printer by itself when it is switched back on.
  useEffect(() => startPrinterWatch(), []);

  if (loading) {
    return (
      <Box className="flex-1 bg-background pt-16">
        <HomeSkeleton />
      </Box>
    );
  }

  return (
    <>
      {/* Dark icons: every screen renders on a light background, and "auto"
          picks light icons on a dark-mode phone, making the clock invisible. */}
      <StatusBar style="dark" />

      {/* A downloaded app update, in the app's own dialog. Mandatory: no "later". */}
      <ConfirmDialog
        open={ota.updateReady}
        title="Update ready"
        message="A new version of the app has been downloaded. Restart now to continue — it only takes a moment and nothing on this phone is lost."
        confirmLabel="Restart now"
        onConfirm={ota.restart}
      />

      {/* Over every screen: a replaced roll must be fetched before any more work. */}
      <RollUpdateDialog
        open={rollUpdate && access !== null && localCount > 0}
        busy={replacing}
        assemblyName={access?.assemblyName ?? null}
        onConfirm={() => void onReplaceRoll()}
      />

      <Stack screenOptions={{ headerShown: false }}>
        {/* Signed out. */}
        <Stack.Protected guard={token === null}>
          <Stack.Screen name="index" />
        </Stack.Protected>

        {/* Signed in, but the mobile number has not been confirmed by OTP yet. */}
        <Stack.Protected guard={token !== null && otpPending}>
          <Stack.Screen name="otp" />
        </Stack.Protected>

        {/* Signed in, but the session has not been unlocked with a PIN yet. */}
        <Stack.Protected guard={token !== null && !otpPending && access === null}>
          <Stack.Screen name="pin" />
        </Stack.Protected>

        {/* PIN accepted but nothing on the device yet — download before working. */}
        <Stack.Protected guard={access !== null && localCount === 0}>
          <Stack.Screen name="download" />
        </Stack.Protected>

        {/* Ready to work, online or off. */}
        <Stack.Protected guard={ready}>
          <Stack.Screen name="home" />
          <Stack.Screen name="search" />
          <Stack.Screen name="voter/[id]" />
          <Stack.Screen name="family/[id]" />
          <Stack.Screen name="booths/index" />
          <Stack.Screen name="booths/[partNo]" />
          <Stack.Screen name="wards/[wardNo]" />
          <Stack.Screen name="bulk-print" />
          <Stack.Screen name="printer" />
          <Stack.Screen name="followup" />
          <Stack.Screen name="settings" />
          <Stack.Screen name="approvals" />
        </Stack.Protected>

        {/* Only where the constituency has enrolling switched on. */}
        <Stack.Protected guard={ready && Boolean(access?.enableEnrollment)}>
          <Stack.Screen name="enroll" />
        </Stack.Protected>
      </Stack>
    </>
  );
}

export default function RootLayout() {
  // One-time: reclaim the old bundle file from phones upgrading to sync.
  removeLegacyBundleDatabase();

  return (
    <KeyboardProvider>
      <ThemeProvider>
        {(mode) => (
          <GluestackUIProvider mode={mode}>
            {/* Screens live inside the blur target; dialogs are portalled out to
                the overlay root above it, so a dialog blurs the app, not itself. */}
            <BlurTargetProvider>
              <AuthProvider>
                <LanguageProvider>
                  <RootNavigator />
                </LanguageProvider>
              </AuthProvider>
            </BlurTargetProvider>
          </GluestackUIProvider>
        )}
      </ThemeProvider>
    </KeyboardProvider>
  );
}
