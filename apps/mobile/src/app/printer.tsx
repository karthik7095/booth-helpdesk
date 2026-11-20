import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Switch } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BluetoothIcon, PrinterIcon } from "@/components/icons";
import { MySlipCoversPanel } from "@/components/my-slip-covers-panel";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Button, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, CheckIcon, Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { cachedBannerUri, syncBanner } from "@/lib/banner";
import { syncWardBanners } from "@/lib/ward-banners";
import { pausePrinterWatch } from "@/lib/printer-watch";
import {
  cancelDiscovery,
  connectPrinter,
  connectedPrinter,
  disconnectPrinter,
  discoverDevices,
  DISCOVERY_SUPPORTED,
  enableBluetooth,
  ensureBluetoothPermissions,
  isBluetoothEnabled,
  isCutNoteEnabled,
  isImagePrintEnabled,
  onBluetoothStateChanged,
  onDeviceDisconnected,
  onDeviceDiscovered,
  openBluetoothSettings,
  pairedDevices,
  rememberedPrinterAddress,
  setCutNoteEnabled,
  setImagePrintEnabled,
  testPrint,
  type PrinterDevice,
} from "@/lib/printer";

function mergeDevice(
  list: PrinterDevice[],
  device: PrinterDevice,
): PrinterDevice[] {
  return list.some((known) => known.address === device.address)
    ? list
    : [...list, device];
}

/** Paired devices with the connected printer first, listed even when the bonded list could not be read. */
function withConnected(
  list: PrinterDevice[],
  connected: PrinterDevice | null,
): PrinterDevice[] {
  if (!connected) return list;

  return [
    connected,
    ...list.filter((device) => device.address !== connected.address),
  ];
}

function DeviceRow({
  device,
  busy,
  connected,
  remembered,
  onPress,
}: {
  device: PrinterDevice;
  busy: boolean;
  connected: boolean;
  remembered: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable disabled={busy} onPress={onPress}>
      <HStack
        space="md"
        className={`items-center rounded-2xl border border-border bg-card p-4 ${busy ? "opacity-60" : ""}`}
      >
        <Box
          className={`h-10 w-10 items-center justify-center rounded-full ${connected ? "bg-success/20" : "bg-primary-light"}`}
        >
          <Icon
            as={PrinterIcon}
            className={`h-5 w-5 ${connected ? "text-success" : "text-primary"}`}
          />
        </Box>

        <VStack className="flex-1">
          <Text
            className="text-base font-medium text-foreground"
            numberOfLines={1}
          >
            {device.name}
          </Text>
          <Text className="text-xs text-muted-foreground">
            {device.address}
          </Text>
        </VStack>

        {busy ? <Spinner size="small" /> : null}

        {!busy && connected ? (
          <Icon as={CheckIcon} className="h-5 w-5 text-success" />
        ) : null}

        {!busy && !connected && remembered ? (
          <Badge className="rounded-full bg-secondary">
            <BadgeText className="text-[10px] text-secondary-foreground">
              LAST USED
            </BadgeText>
          </Badge>
        ) : null}
      </HStack>
    </Pressable>
  );
}

export default function PrinterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [enabled, setEnabled] = useState(false);
  const [granted, setGranted] = useState(false);
  const [paired, setPaired] = useState<PrinterDevice[]>([]);
  const [found, setFound] = useState<PrinterDevice[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [connected, setConnected] = useState<PrinterDevice | null>(null);
  const [remembered, setRemembered] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printImages, setPrintImages] = useState(false);
  const [printCutNote, setPrintCutNote] = useState(true);
  const { token, access } = useAuth();
  const [coverUri, setCoverUri] = useState<string | null>(() =>
    access ? cachedBannerUri(access.assemblyNo, "slip") : null,
  );

  // Checked each time the screen opens, so a cover replaced on the dashboard
  // shows (and prints) here without waiting for the home screen to fetch it.
  useFocusEffect(
    useCallback(() => {
      if (!token || !access) return;

      syncBanner(token, access.assemblyNo, access.slipImageUpdatedAt, "slip")
        .then(setCoverUri)
        .catch(() => undefined);
      if (access.isPanchayat) void syncWardBanners(token, access.assemblyNo).catch(() => undefined);
    }, [token, access]),
  );

  // This screen pairs and connects by hand; automatic reconnects wait until it closes.
  useFocusEffect(useCallback(() => pausePrinterWatch(), []));

  // Discovery keeps running natively after the screen closes unless cancelled.
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const on = await isBluetoothEnabled();

    setEnabled(on);
    setRemembered(await rememberedPrinterAddress());
    setPrintImages(await isImagePrintEnabled());
    setPrintCutNote(await isCutNoteEnabled());

    if (!on) {
      setPaired([]);
      setConnected(null);
      return;
    }

    const current = await connectedPrinter();

    setConnected(current);

    try {
      setPaired(withConnected(await pairedDevices(), current));
    } catch {
      // Permission not granted yet — the Connect button asks for it.
      setPaired(withConnected([], current));
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();

    const discovered = onDeviceDiscovered((device) => {
      if (!device.paired) setFound((current) => mergeDevice(current, device));
    });
    const state = onBluetoothStateChanged((on) => {
      setEnabled(on);
      if (!on) {
        setConnected(null);
        setFound([]);
      }
    });
    const dropped = onDeviceDisconnected((address) => {
      setConnected((current) =>
        current?.address === address ? null : current,
      );
    });

    return () => {
      mounted.current = false;
      discovered.remove();
      state.remove();
      dropped.remove();
      void cancelDiscovery();
    };
  }, [refresh]);

  /** The Connect button: permissions, then the adapter, then a scan. */
  const scan = useCallback(async () => {
    setError(null);

    if (!DISCOVERY_SUPPORTED) {
      setError("Bluetooth printers can only be set up on Android.");
      return;
    }

    const ok = await ensureBluetoothPermissions();

    setGranted(ok);

    if (!ok) {
      setError(
        "Bluetooth permission was denied. Allow it in Settings to find printers.",
      );
      return;
    }

    if (!(await isBluetoothEnabled())) {
      setStatus("Turning Bluetooth on…");

      const turnedOn = await enableBluetooth();

      setStatus(null);

      if (!turnedOn) {
        setError("Bluetooth stayed off, so no printers can be found.");
        return;
      }

      setEnabled(true);
    }

    setScanning(true);
    setFound([]);

    try {
      const bonded = await pairedDevices();
      let current = await connectedPrinter();

      // The socket closes whenever Android stops the app, though the phone is
      // still paired with the printer. Reopen it first, so the printer this
      // phone already uses shows as connected instead of only after a search.
      const address = await rememberedPrinterAddress();
      const known = bonded.find((device) => device.address === address);

      if (!current && known) {
        setStatus(`Reconnecting to ${known.name}…`);
        current = await connectedPrinter({ reconnect: true });
        setStatus(null);
      }

      setConnected(current);
      setPaired(withConnected(bonded, current));

      // Connected again: the list already shows it, and a search would only
      // slow the printer link down.
      if (current) return;

      const devices = await discoverDevices();

      if (mounted.current)
        setFound((current) => devices.reduce(mergeDevice, current));
    } catch (caught) {
      if (mounted.current) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Could not search for printers.",
        );
      }
    } finally {
      if (mounted.current) setScanning(false);
    }
  }, []);

  const stopScan = useCallback(async () => {
    await cancelDiscovery();
    setScanning(false);
  }, []);

  const connect = useCallback(async (device: PrinterDevice) => {
    setError(null);
    setConnecting(device.address);
    setScanning(false);

    try {
      const printer = await connectPrinter(device.address);

      setConnected(printer);
      setRemembered(printer.address);
      setPaired((current) => withConnected(current, printer));
      setFound((current) =>
        current.filter((item) => item.address !== printer.address),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? `Could not connect to ${device.name}. ${caught.message}`
          : `Could not connect to ${device.name}.`,
      );
    } finally {
      setConnecting(null);
    }
  }, []);

  const disconnect = useCallback(async () => {
    if (!connected) return;

    await disconnectPrinter(connected.address);
    setConnected(null);
    setRemembered(null);
  }, [connected]);

  const runTestPrint = useCallback(async () => {
    if (!connected) return;

    setError(null);
    setStatus("Sending test slip…");

    try {
      await testPrint(connected.address);
      setStatus("Test slip sent.");
    } catch (caught) {
      setStatus(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "The printer did not accept the slip.",
      );
    }
  }, [connected]);

  const unpaired = found.filter(
    (device) => !paired.some((known) => known.address === device.address),
  );

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack
        space="md"
        className="items-center border-b border-border bg-card px-4 py-3"
      >
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
            Printer
          </Heading>
          <Text className="text-xs text-muted-foreground">
            {connected
              ? `Connected to ${connected.name}`
              : "No printer connected"}
          </Text>
        </VStack>
      </HStack>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={refresh} />
        }
      >
        <VStack space="lg">
          <VStack
            space="md"
            className="rounded-2xl border border-border bg-card p-5"
          >
            <HStack space="md" className="items-center">
              <Box
                className={`h-12 w-12 items-center justify-center rounded-full ${connected ? "bg-success/20" : enabled ? "bg-primary-light" : "bg-secondary"}`}
              >
                <Icon
                  as={BluetoothIcon}
                  className={`h-6 w-6 ${connected ? "text-success" : enabled ? "text-primary" : "text-muted-foreground"}`}
                />
              </Box>
              <VStack className="flex-1">
                <Text className="text-base font-medium text-foreground">
                  {connected
                    ? connected.name
                    : enabled
                      ? "Bluetooth is on"
                      : "Bluetooth is off"}
                </Text>
                <Text className="text-xs text-muted-foreground">
                  {connected
                    ? connected.address
                    : "Turn on the printer and hold it close to this phone."}
                </Text>
              </VStack>
            </HStack>

            {connected ? (
              <HStack space="sm">
                <Button
                  variant="outline"
                  className="h-12 flex-1 rounded-full"
                  onPress={runTestPrint}
                >
                  <ButtonText>Test print</ButtonText>
                </Button>
                <Button
                  variant="outline"
                  className="h-12 flex-1 rounded-full border-destructive"
                  onPress={disconnect}
                >
                  <ButtonText className="text-destructive">
                    Disconnect
                  </ButtonText>
                </Button>
              </HStack>
            ) : (
              <Button
                size="lg"
                className="h-14 w-full rounded-full"
                isDisabled={scanning}
                onPress={scan}
              >
                {scanning ? <ButtonSpinner /> : null}
                <ButtonText>{scanning ? "Searching…" : "Connect"}</ButtonText>
              </Button>
            )}

            {scanning ? (
              <Pressable onPress={stopScan} className="items-center">
                <Text className="text-sm text-primary">Stop searching</Text>
              </Pressable>
            ) : null}
          </VStack>

          {access?.printSlipImage ? (
            <VStack
              space="md"
              className="rounded-2xl border border-border bg-card p-4"
            >
              <HStack space="md" className="items-center">
                <VStack className="flex-1">
                  <Text className="text-base font-medium text-foreground">
                    Print cover image
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    {access?.allowUserSlipCovers
                      ? "Adds the cover you pick below above each slip. Slower to print and uses more paper."
                      : "Adds the constituency cover image above each slip. Slower to print and uses more paper."}
                  </Text>
                </VStack>
                <Switch
                  value={printImages}
                  onValueChange={(next) => {
                    setPrintImages(next);
                    void setImagePrintEnabled(next);
                  }}
                />
              </HStack>
              {access?.allowUserSlipCovers && token ? (
                <MySlipCoversPanel
                  token={token}
                  assemblyNo={access.assemblyNo}
                  constituencyUri={coverUri}
                  dimmed={!printImages}
                />
              ) : coverUri ? (
                <Image
                  source={{ uri: coverUri }}
                  contentFit="contain"
                  style={{
                    width: "100%",
                    aspectRatio: 2,
                    opacity: printImages ? 1 : 0.4,
                  }}
                />
              ) : (
                <Text className="text-xs text-muted-foreground">
                  No cover image uploaded for this constituency yet.
                </Text>
              )}
              {printImages ? (
                <HStack
                  space="md"
                  className="items-center border-t border-border pt-3"
                >
                  <VStack className="flex-1">
                    <Text className="text-base font-medium text-foreground">
                      Print caution note
                    </Text>
                    <Text className="text-xs text-muted-foreground">
                      The Telugu note under the cover image asking voters to cut
                      it off before entering the polling station.
                    </Text>
                  </VStack>
                  <Switch
                    value={printCutNote}
                    onValueChange={(next) => {
                      setPrintCutNote(next);
                      void setCutNoteEnabled(next);
                    }}
                  />
                </HStack>
              ) : null}
            </VStack>
          ) : (
            <VStack className="rounded-2xl border border-border bg-card p-4">
              <Text className="text-base font-medium text-foreground">
                Cover image
              </Text>
              <Text className="text-xs text-muted-foreground">
                Switched off for this constituency. Slips print the voter
                details only.
              </Text>
            </VStack>
          )}

          {error ? (
            <Text className="text-sm text-destructive">{error}</Text>
          ) : null}
          {status && !error ? (
            <Text className="text-sm text-muted-foreground">{status}</Text>
          ) : null}

          {paired.length > 0 ? (
            <VStack space="sm">
              <Text className="text-xs uppercase tracking-widest text-muted-foreground">
                Paired devices
              </Text>
              {paired.map((device) => (
                <DeviceRow
                  key={device.address}
                  device={device}
                  busy={connecting === device.address}
                  connected={connected?.address === device.address}
                  remembered={remembered === device.address}
                  onPress={() => connect(device)}
                />
              ))}
            </VStack>
          ) : null}

          {scanning || unpaired.length > 0 ? (
            <VStack space="sm">
              <HStack space="sm" className="items-center">
                <Text className="text-xs uppercase tracking-widest text-muted-foreground">
                  Available devices
                </Text>
                {scanning ? <Spinner size="small" /> : null}
              </HStack>

              {unpaired.map((device) => (
                <DeviceRow
                  key={device.address}
                  device={device}
                  busy={connecting === device.address}
                  connected={false}
                  remembered={remembered === device.address}
                  onPress={() => connect(device)}
                />
              ))}

              {scanning && unpaired.length === 0 ? (
                <Text className="text-sm text-muted-foreground">
                  Searching for nearby printers…
                </Text>
              ) : null}
            </VStack>
          ) : null}

          {!scanning &&
          granted &&
          paired.length === 0 &&
          unpaired.length === 0 ? (
            <Text className="text-sm text-muted-foreground">
              No printers found. Check the printer is on and in pairing range,
              then search again.
            </Text>
          ) : null}

          {DISCOVERY_SUPPORTED ? (
            <Pressable
              onPress={openBluetoothSettings}
              className="items-center pt-2"
            >
              <Text className="text-sm text-primary">
                Open Bluetooth settings
              </Text>
            </Pressable>
          ) : null}
        </VStack>
      </ScrollView>
    </Box>
  );
}
