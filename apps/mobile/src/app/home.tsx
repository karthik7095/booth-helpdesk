import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LogOutIcon, PrinterIcon } from "@/components/icons";
import { AnnouncementCard, AnnouncementDialog } from "@/components/announcement";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Button, ButtonIcon, ButtonSpinner, ButtonText } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import {
  AddIcon,
  CalendarDaysIcon,
  CheckCircleIcon,
  Icon,
  MessageCircleIcon,
  RepeatIcon,
  SearchIcon,
  SettingsIcon,
} from "@/components/ui/icon";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import {
  acceptAnnouncement,
  activeAnnouncement,
  isAnnouncementAccepted,
} from "@/lib/announcement";
import { useAuth } from "@/lib/auth";
import { usePendingApprovals } from "@/lib/approval-watch";
import { syncVoterPhotos, usePhotoSync } from "@/lib/voter-photos";
import { cachedBannerUri, syncBanner } from "@/lib/banner";
import { syncWardBanners } from "@/lib/ward-banners";
import { followUpCounts, getPendingCounts, printStats } from "@/lib/db";
import { appVersionLabel } from "@/lib/ota";
import { checkPrinterNow, usePrinterStatus } from "@/lib/printer-watch";
import { readCachedSummary, refreshSummary, type CachedSummary } from "@/lib/summary";
import { isOnline, pushPendingChanges } from "@/lib/sync";

/** `route: null` marks a feature that isn't built yet — the tile shows disabled. */
const TILES: {
  label: string;
  icon: React.ComponentProps<typeof Icon>["as"];
  route:
    | "/search"
    | "/enroll"
    | "/booths"
    | "/bulk-print"
    | "/followup"
    | "/printer"
    | "/settings"
    | "/approvals"
    | null;
}[] = [
    { label: "Search Voter", icon: SearchIcon, route: "/search" },
    { label: "Enroll New Voter", icon: AddIcon, route: "/enroll" },
    { label: "Booths", icon: CalendarDaysIcon, route: "/booths" },
    { label: "Bulk Print", icon: PrinterIcon, route: "/bulk-print" },
    { label: "Follow-up", icon: MessageCircleIcon, route: "/followup" },
    { label: "Printer", icon: PrinterIcon, route: "/printer" },
    { label: "Settings", icon: SettingsIcon, route: "/settings" },
    { label: "Approvals", icon: CheckCircleIcon, route: "/approvals" },
  ];

function initials(name: string | null): string {
  if (!name) return "?";

  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
}

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { fullName, access, localCount, token, lockPin, refreshLocalCount, refreshSession } =
    useAuth();
  // Null until read: each section shows its own skeleton rather than the
  // whole screen waiting for the slowest query.
  const [pending, setPending] = useState<{ edits: number; enrollments: number; prints: number } | null>(
    null,
  );
  const [printed, setPrinted] = useState<{ slips: number; voters: number } | null>(null);
  /** The server's counters for this PIN's booths: cached copy first, fresh when online. */
  const [summary, setSummary] = useState<CachedSummary | null>(null);
  const [summaryFresh, setSummaryFresh] = useState(false);
  /** The card being opened, shown over the screen until the next one takes over. */
  const [opening, setOpening] = useState<string | null>(null);

  const open = useCallback(
    (route: NonNullable<(typeof TILES)[number]["route"]>, label: string) => {
      setOpening(label);
      // Painted first, then the push: the overlay must be on screen before the
      // next screen's own work takes the JS thread.
      requestAnimationFrame(() => router.push(route));
    },
    [router],
  );

  // Cleared when this screen loses focus (the next one is up) or regains it
  // (the agent came back), with a fallback in case navigation never happened.
  useFocusEffect(
    useCallback(() => {
      setOpening(null);

      return () => setOpening(null);
    }, []),
  );

  useEffect(() => {
    if (!opening) return;

    const timer = setTimeout(() => setOpening(null), 6_000);

    return () => clearTimeout(timer);
  }, [opening]);
  const [syncing, setSyncing] = useState(false);
  /** What the last sync did, shown under the button; null until one runs. */
  const [syncStatus, setSyncStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  // The paired printer: green while connected, amber while it reconnects by
  // itself, red while it is switched off or out of range (printer-watch).
  const printer = usePrinterStatus();

  useFocusEffect(useCallback(() => checkPrinterNow(), []));
  const announcement = activeAnnouncement(access);
  /** Null until read from the phone; the notice covers the screen only once that is known. */
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [readingNotice, setReadingNotice] = useState(false);

  const announcementVersion = announcement?.version;

  useEffect(() => {
    if (!access || !announcementVersion) return;

    let cancelled = false;
    isAnnouncementAccepted(access.assemblyNo, announcementVersion)
      .then((value) => !cancelled && setAccepted(value))
      .catch(() => !cancelled && setAccepted(false));

    return () => {
      cancelled = true;
    };
  }, [access, announcementVersion]);

  const [bannerUri, setBannerUri] = useState<string | null>(
    access ? cachedBannerUri(access.assemblyNo) : null,
  );

  // Each count lands as soon as it is read, independently of the others.
  useEffect(() => {
    getPendingCounts().then(setPending).catch(() => setPending({ edits: 0, enrollments: 0, prints: 0 }));
    printStats().then(setPrinted).catch(() => setPrinted({ slips: 0, voters: 0 }));
  }, []);

  // The cached summary shows at once; a fresh one replaces it when there is signal.
  useEffect(() => {
    let cancelled = false;

    readCachedSummary().then((cached) => {
      if (!cancelled && cached) setSummary((current) => current ?? cached);
    });

    if (!token) return;

    refreshSummary(token).then((fresh) => {
      if (cancelled || !fresh) return;
      setSummary(fresh);
      setSummaryFresh(true);
      // The refresh may have dropped prints an admin reset; re-read the tally.
      printStats().then(setPrinted).catch(() => undefined);
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  /** For app admins: people waiting for approval, for the banner and the Approvals badge. */
  const approvals = usePendingApprovals(token, access?.canApproveUsers ?? false);

  /** Voter photos: downloaded once the voter list is on the phone, progress shown below the header. */
  const photos = usePhotoSync();
  const photoAssemblyNo = access?.assemblyNo;
  // A change of wards replaces the roll, and the photos follow it.
  const wardScope = access?.wardNos.join(",") ?? "";

  useEffect(() => {
    if (!token || !photoAssemblyNo || !localCount) return;

    void syncVoterPhotos(token, photoAssemblyNo);
  }, [token, photoAssemblyNo, wardScope, localCount]);

  /** Pending follow-ups across the ward, for the Follow-up tile's badge. */
  const [followUps, setFollowUps] = useState(0);

  // Prints and remarks happen on other screens; the counts are fresh each time this one shows.
  useFocusEffect(
    useCallback(() => {
      printStats().then(setPrinted).catch(() => undefined);
      followUpCounts()
        .then((counts) => setFollowUps(counts.pending))
        .catch(() => undefined);
    }, []),
  );

  // Downloaded once, then served from the device on every later launch.
  useEffect(() => {
    if (!token || !access) return;

    syncBanner(token, access.assemblyNo, access.bannerUpdatedAt)
      .then(setBannerUri)
      .catch(() => undefined);

    // Fetched here too, so the cover is already on the device by the time an
    // agent prints — there is no network at a polling booth.
    void syncBanner(token, access.assemblyNo, access.slipImageUpdatedAt, "slip").catch(
      () => undefined,
    );
    // Likewise the WhatsApp image, so "Text With Image" works with no signal.
    void syncBanner(token, access.assemblyNo, access.whatsappImageUpdatedAt, "whatsapp").catch(
      () => undefined,
    );
    // A panchayat's ward print banners, for the same reason: each ward's slips
    // print its own, and the booth has no signal to fetch it then.
    if (access.isPanchayat) void syncWardBanners(token, access.assemblyNo).catch(() => undefined);
  }, [token, access]);

  const refresh = useCallback(async () => {
    if (!token) return;

    setSyncing(true);
    setSyncStatus(null);

    if (!(await isOnline())) {
      setSyncStatus({ ok: false, text: "No internet — your changes stay on this phone for now." });
      setSyncing(false);
      return;
    }

    // Also picks up anything an admin changed — a new banner, features, party
    // list — and the latest counters for the booths.
    const [outcome, , fresh] = await Promise.all([
      pushPendingChanges(token),
      refreshSession(),
      refreshSummary(token),
    ]);

    if (fresh) {
      setSummary(fresh);
      setSummaryFresh(true);
    }
    // Prints an admin reset are dropped by the refresh; show the new tally.
    printStats().then(setPrinted).catch(() => undefined);
    const sent = outcome.pushedEdits + outcome.pushedEnrollments + outcome.pushedPrints;

    setSyncStatus(
      outcome.failed.length > 0
        ? { ok: false, text: outcome.failed[0]?.message ?? "Sync failed. Try again." }
        : {
            ok: true,
            text: `Synced at ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${
              sent > 0 ? ` · ${sent} change${sent === 1 ? "" : "s"} sent` : ""
            }`,
          },
    );
    setPending(await getPendingCounts());
    await refreshLocalCount();
    setSyncing(false);
  }, [token, refreshLocalCount, refreshSession]);

  const queued = pending ? pending.edits + pending.enrollments + pending.prints : 0;



  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      {opening ? (
        <Box
          className="absolute inset-0 z-50 items-center justify-center bg-background/85"
          accessibilityLiveRegion="polite"
          accessibilityLabel={`Opening ${opening}`}
        >
          <VStack space="md" className="items-center">
            <Spinner size="large" className="text-primary" />
            <Text className="text-base font-medium text-foreground">Opening {opening}…</Text>
          </VStack>
        </Box>
      ) : null}

      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        refreshControl={<RefreshControl refreshing={syncing} onRefresh={refresh} />}
      >
        {photos.status === "running" || photos.status === "error" ? (
          <Box className="mx-4 mt-3 rounded-2xl border border-border bg-card px-4 py-3">
            <HStack className="items-center justify-between">
              <Text className="text-base font-semibold text-foreground">
                {photos.status === "running" ? "Downloading voter photos" : "Voter photos did not finish"}
              </Text>
              <Text className="text-sm tabular-nums text-muted-foreground">
                {photos.done.toLocaleString()} / {photos.total.toLocaleString()}
              </Text>
            </HStack>
            <Box className="mt-2 h-2 overflow-hidden rounded-full bg-secondary">
              <Box
                className={`h-2 rounded-full ${photos.status === "running" ? "bg-primary" : "bg-warning"}`}
                style={{ width: `${photos.total ? Math.min(100, (photos.done / photos.total) * 100) : 0}%` }}
              />
            </Box>
            {photos.status === "running" ? (
              <Text className="mt-1 text-xs text-muted-foreground">
                {photos.label}. You can keep working; photos appear as they arrive.
              </Text>
            ) : (
              <Pressable
                onPress={() => token && access && void syncVoterPhotos(token, access.assemblyNo)}
                className="mt-1"
              >
                <Text className="text-xs text-muted-foreground">
                  {photos.message} <Text className="text-xs font-semibold text-primary">Tap to try again.</Text>
                </Text>
              </Pressable>
            )}
          </Box>
        ) : null}
        {approvals && approvals.pending > 0 ? (
          <Pressable onPress={() => !opening && open("/approvals", "Approvals")} className="mx-4 mt-3">
            <HStack
              space="md"
              className="items-center rounded-2xl px-4 py-3"
              style={{ backgroundColor: "#C25E00" }}
            >
              <Icon as={CheckCircleIcon} className="h-6 w-6" style={{ color: "#FFFFFF" }} />
              <VStack className="flex-1">
                <Text className="text-base font-bold" style={{ color: "#FFFFFF" }}>
                  {approvals.pending === 1
                    ? "1 person is waiting for approval"
                    : `${approvals.pending} people are waiting for approval`}
                </Text>
                {approvals.latest ? (
                  <Text className="text-sm" style={{ color: "#FFFFFF" }}>
                    Latest: {approvals.latest.name} · {approvals.latest.mobileNumber}. Tap to approve.
                  </Text>
                ) : null}
              </VStack>
            </HStack>
          </Pressable>
        ) : null}
        {(
          <HStack className="items-center justify-between px-5 py-3">
            <Box className="h-12 w-12 items-center justify-center rounded-full bg-primary-light">
              <Text className="text-base font-semibold text-primary-dark">{initials(fullName)}</Text>
            </Box>
            <VStack className="flex-1 px-3">
              <Text className="text-sm text-muted-foreground">Signed in as</Text>
              <Heading size="md" className="text-primary-dark dark:text-foreground">
                {fullName}
              </Heading>
            </VStack>
            {printer.state !== "none" ? (
              <Pressable
                onPress={() => router.push("/printer")}
                accessibilityRole="button"
                accessibilityLabel={`Printer ${printer.name ?? ""} ${
                  printer.state === "connected"
                    ? "connected"
                    : printer.state === "connecting"
                      ? "reconnecting"
                      : "not connected, switch it on and it reconnects by itself"
                }. Opens printer settings.`}
                hitSlop={8}
                className="mr-4 h-11 w-11 items-center justify-center rounded-full bg-primary-light"
              >
                <Icon as={PrinterIcon} className="h-6 w-6 text-primary-dark dark:text-foreground" />
                {/* Green: connected. Amber: reconnecting. Red: off or out of range. */}
                <Box
                  className={`absolute right-1 top-1 h-3 w-3 rounded-full border-2 border-background ${
                    printer.state === "connected"
                      ? "bg-success"
                      : printer.state === "connecting"
                        ? "bg-warning"
                        : "bg-destructive"
                  }`}
                />
              </Pressable>
            ) : null}
            <Pressable onPress={() => setConfirmSignOut(true)} accessibilityLabel="Sign out">
              <Icon as={LogOutIcon} className="h-7 w-7 text-primary-dark dark:text-foreground" />
            </Pressable>
          </HStack>
        )}

        {/* The admin's notice, once accepted, stays at the top to read again. */}
        {announcement && accepted ? (
          <AnnouncementCard announcement={announcement} onOpen={() => setReadingNotice(true)} />
        ) : null}

        {(
          <Box className="mx-5 mb-4 h-44 overflow-hidden rounded-2xl border border-border bg-card">
            {bannerUri ? (
              <Image
                source={{ uri: bannerUri }}
                contentFit="cover"
                style={{ width: "100%", height: "100%" }}
              />
            ) : (
              <Box className="flex-1 items-center justify-center bg-primary-light">
                <Text className="text-sm text-primary-dark">
                  {access?.assemblyName ?? "Constituency"}
                </Text>
                <Text className="text-xs text-muted-foreground">No banner uploaded yet</Text>
              </Box>
            )}
          </Box>
        )}

        {/* Which build and over-the-air update this phone runs, for support calls. */}
        <Text
          className="mx-5 mb-2 text-right text-xs text-muted-foreground"
          accessibilityLabel="App version"
        >
          {appVersionLabel()}
        </Text>

        {(
          <Box className="mx-5 mb-5 rounded-2xl border border-border bg-card p-5">
            <Text className="text-xs uppercase tracking-widest text-muted-foreground">
              Constituency
            </Text>
            <Heading size="xl" className="text-primary-dark dark:text-foreground">
              {access?.assemblyName ?? "—"}
            </Heading>
            <Text className="text-sm text-muted-foreground">
              {access?.partNos.length ? `Parts ${access.partNos.join(", ")}` : "All parts"}
              {access?.wardNos?.length
                ? ` · ${access.wardNos.length === 1 ? "Ward" : "Wards"} ${access.wardNos.join(", ")}`
                : ""}
            </Text>

            {/* What this PIN covers, across every phone working its booths. */}
            <HStack space="md" className="mt-3">
              <VStack className="flex-1 rounded-xl bg-primary-light p-3">
                <Text className="text-2xl font-semibold text-primary-dark">
                  {localCount.toLocaleString()}
                </Text>
                <Text className="text-xs text-muted-foreground">Voters for this PIN</Text>
              </VStack>
              <VStack className="flex-1 rounded-xl bg-primary-light p-3">
                {summary ? (
                  <Text className="text-2xl font-semibold text-primary-dark">
                    {summary.voted.toLocaleString()}
                  </Text>
                ) : (
                  <Skeleton className="my-1 h-6 w-16 rounded" />
                )}
                <Text className="text-xs text-muted-foreground">
                  Voted
                  {summary && summary.total > 0
                    ? ` · ${Math.round((summary.voted / summary.total) * 100)}%`
                    : ""}
                </Text>
              </VStack>
            </HStack>
            <HStack space="md" className="mt-3">
              <VStack className="flex-1 rounded-xl bg-primary-light p-3">
                {summary ? (
                  <Text className="text-2xl font-semibold text-primary-dark">
                    {summary.printed.toLocaleString()}
                  </Text>
                ) : (
                  <Skeleton className="my-1 h-6 w-16 rounded" />
                )}
                <Text className="text-xs text-muted-foreground">Voters printed</Text>
              </VStack>
              <VStack className="flex-1 rounded-xl bg-primary-light p-3">
                {summary && printed ? (
                  <Text className="text-2xl font-semibold text-primary-dark">
                    {Math.max(summary.printedByMe, printed.voters).toLocaleString()}
                  </Text>
                ) : (
                  <Skeleton className="my-1 h-6 w-16 rounded" />
                )}
                <Text className="text-xs text-muted-foreground">
                  Printed by you
                  {printed && printed.slips > printed.voters
                    ? ` · ${printed.slips.toLocaleString()} slips`
                    : ""}
                </Text>
              </VStack>
            </HStack>
            {summary && !summaryFresh ? (
              <Text className="mt-2 text-xs text-muted-foreground">
                Counts as of{" "}
                {new Date(summary.fetchedAt).toLocaleString([], {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}{" "}
                · sync to refresh
              </Text>
            ) : null}

            {queued > 0 ? (
              <HStack space="sm" className="mt-3">
                <Badge className="rounded-full bg-warning/20">
                  <BadgeText className="text-warning-foreground">
                    {queued} change{queued === 1 ? "" : "s"} waiting to sync
                  </BadgeText>
                </Badge>
              </HStack>
            ) : null}

            <Button
              className="mt-4 h-12 rounded-xl"
              isDisabled={syncing}
              onPress={refresh}
              accessibilityLabel="Sync now"
            >
              {syncing ? <ButtonSpinner /> : <ButtonIcon as={RepeatIcon} />}
              <ButtonText>{syncing ? "Syncing…" : "Sync now"}</ButtonText>
            </Button>

            {syncStatus ? (
              <Text
                className={`mt-2 text-xs ${syncStatus.ok ? "text-muted-foreground" : "text-destructive"}`}
              >
                {syncStatus.text}
              </Text>
            ) : null}
          </Box>
        )}

        {(
          <Box className="flex-row flex-wrap px-3">
            {TILES.filter(
              // Enrolling is off until an admin switches it on for the constituency.
              (tile) =>
                (tile.route !== "/enroll" || access?.enableEnrollment) &&
                // Only app admins (marked on the dashboard) approve users.
                (tile.route !== "/approvals" || access?.canApproveUsers),
            )
              // A gram panchayat's Booths screen lists wards too.
              .map((tile) =>
                tile.route === "/booths" && access?.isPanchayat ? { ...tile, label: "Booths & Wards" } : tile,
              )
              .map((tile) => (
              <Box key={tile.label} className="w-1/2 p-2">
                <Pressable
                  disabled={!tile.route}
                  onPress={() => tile.route && !opening && open(tile.route, tile.label)}
                >
                  <VStack
                    space="md"
                    className={`h-40 items-center justify-center rounded-2xl border p-4 ${tile.route ? "border-border bg-card" : "border-border bg-card opacity-50"
                      }`}
                  >
                    <Box
                      className={`h-14 w-14 items-center justify-center rounded-full ${tile.route ? "bg-primary-light" : "bg-secondary"
                        }`}
                    >
                      <Icon
                        as={tile.icon}
                        className={`h-7 w-7 ${tile.route ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </Box>

                    <Text className="text-center text-base font-medium text-foreground">
                      {tile.label}
                    </Text>

                    {tile.route ? null : (
                      <Badge className="absolute right-3 top-3 rounded-full bg-secondary px-2 py-0">
                        <BadgeText className="text-[10px] text-secondary-foreground">SOON</BadgeText>
                      </Badge>
                    )}
                    {tile.route === "/approvals" && approvals && approvals.pending > 0 ? (
                      <Box
                        className="absolute right-3 top-3 h-6 min-w-6 items-center justify-center rounded-full px-1.5"
                        style={{ backgroundColor: "#C25E00" }}
                      >
                        <Text className="text-xs font-bold" style={{ color: "#FFFFFF" }}>
                          {approvals.pending}
                        </Text>
                      </Box>
                    ) : null}
                    {tile.route === "/followup" && followUps > 0 ? (
                      <Box
                        className="absolute right-3 top-3 h-6 min-w-6 items-center justify-center rounded-full px-1.5"
                        style={{ backgroundColor: "#C25E00" }}
                      >
                        <Text className="text-xs font-bold" style={{ color: "#FFFFFF" }}>
                          {followUps}
                        </Text>
                      </Box>
                    ) : null}
                  </VStack>
                </Pressable>
              </Box>
            ))}
          </Box>
        )}
      </ScrollView>

      {announcement ? (
        <AnnouncementDialog
          key={announcement.version}
          announcement={announcement}
          open={accepted === false || readingNotice}
          mustAccept={accepted === false}
          onAccept={() => {
            setAccepted(true);
            if (access) void acceptAnnouncement(access.assemblyNo, announcement.version);
          }}
          onClose={() => setReadingNotice(false)}
        />
      ) : null}

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        message={
          queued > 0
            ? `${queued} change${queued === 1 ? "" : "s"} on this phone have not synced yet. Signing out deletes the downloaded voter list and those changes.`
            : "This deletes the voter list downloaded to this phone. To sign in again you only need your PIN, then the list downloads again."
        }
        confirmLabel="Sign out"
        destructive
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={() => {
          setConfirmSignOut(false);
          void lockPin();
        }}
      />
    </Box>
  );
}
