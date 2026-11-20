import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { DownloadIcon, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { countVoters, setMeta } from "@/lib/db";
import { firstSync } from "@/lib/sync-watermelon";

export default function DownloadScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, access, localCount, refreshLocalCount, autoDownload, consumeAutoDownload } =
    useAuth();
  const [downloading, setDownloading] = useState(false);
  const [saved, setSaved] = useState(0);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The app can land here with a full database already on the phone — an
  // update, or a count that failed once at startup and was read as zero. Ask
  // again on mount rather than making the user re-download 106 MB.
  useEffect(() => {
    void refreshLocalCount();
  }, [refreshLocalCount]);

  // Navigate off the count, not off the end of download(): `router.replace`
  // fired in the same tick as the state update races the route guard, and
  // loses — which leaves a finished download sitting on this screen.
  useEffect(() => {
    if (localCount > 0) router.replace("/home");
  }, [localCount, router]);

  const download = useCallback(async () => {
    if (!token || downloading) return;

    setDownloading(true);
    setError(null);
    setSaved(0);
    setStatus(null);

    try {
      // One turbo sync: the server streams the whole roll as JSON and
      // WatermelonDB loads it natively, without it ever passing through JS.
      // `total` only arrives with the seed's first page, so the bar is driven
      // from the progress callback rather than from a count taken up front.
      await firstSync(token, (stage, progress) => {
        setStatus(stage);

        if (progress) {
          setSaved(progress.loaded);
          setTotal(progress.total);
        }
      });

      setSaved(await countVoters());

      await setMeta("lastDownloadAt", new Date().toISOString());
      await setMeta("assemblyNo", String(access?.assemblyNo ?? ""));
      // The effect above moves to the home screen once the count lands.
      await refreshLocalCount();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not download the voter list.");
    } finally {
      setStatus(null);
      setDownloading(false);
    }
  }, [token, downloading, access, refreshLocalCount]);

  // After a forced replacement the agent has already agreed to the download in
  // the dialog, so it starts without a second tap.
  useEffect(() => {
    if (!autoDownload || downloading) return;

    // Deferred a tick: the effect only schedules the start, so React's render
    // of this screen is not interrupted by the download's own state updates.
    const timer = setTimeout(() => {
      consumeAutoDownload();
      void download();
    }, 0);

    return () => clearTimeout(timer);
  }, [autoDownload, downloading, consumeAutoDownload, download]);

  const percent = total > 0 ? Math.min(100, Math.round((saved / total) * 100)) : 0;

  return (
    <Box
      className="flex-1 items-center justify-center bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <VStack space="xl" className="w-full max-w-sm items-center">
        <Box className="h-20 w-20 items-center justify-center rounded-full bg-primary-light">
          <Icon as={DownloadIcon} className="h-10 w-10 text-primary" />
        </Box>

        <VStack space="xs" className="items-center">
          <Heading size="2xl" className="text-center text-primary-dark">
            Download voter data
          </Heading>
          <Text className="text-center text-muted-foreground">
            {access?.assemblyName ?? "Your constituency"} is saved to this phone so search keeps
            working without internet.
          </Text>
        </VStack>

        {downloading || saved > 0 || status ? (
          <VStack space="xs" className="w-full">
            <Box className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <Box className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
            </Box>
            <Text className="text-center text-sm text-muted-foreground">
              {status ??
                `${saved.toLocaleString()}${total > 0 ? ` of ${total.toLocaleString()}` : ""} voters saved`}
            </Text>
          </VStack>
        ) : null}

        {error ? <Text className="text-center text-sm text-destructive">{error}</Text> : null}

        <Button size="lg" className="h-14 w-full rounded-full" isDisabled={downloading} onPress={download}>
          {downloading ? <ButtonSpinner /> : null}
          <ButtonText>{downloading ? "Downloading…" : "Download now"}</ButtonText>
        </Button>

        <Text className="text-center text-xs text-muted-foreground">
          Keep the app open until this finishes. You can re-download any time from the home screen.
        </Text>
      </VStack>
    </Box>
  );
}
