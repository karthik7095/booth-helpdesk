import { appUserListSchema, type AppUserAction, type AppUserList, type AppUserStatus } from "@voter/shared";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, Modal, Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, Icon } from "@/components/ui/icon";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { request } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const FILTERS: { status: AppUserStatus; label: string }[] = [
  { status: "pending", label: "Waiting" },
  { status: "approved", label: "Approved" },
  { status: "removed", label: "Removed" },
];

const wardLabel = (wardNos: number[]) =>
  wardNos.length === 0 ? "All wards" : `${wardNos.length === 1 ? "Ward" : "Wards"} ${wardNos.join(", ")}`;

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "—";

/**
 * For app admins (chosen on the dashboard): approve the people waiting after
 * the PIN, remove anyone (signed out, and kept out of this constituency until
 * allowed again), and allow removed people back. At most 5 approved at once.
 * Where the constituency has wards, approving asks which wards the person may
 * download, and "Change wards" changes it later; they see only those voters.
 * The Mayor (chosen on the dashboard) also changes other admins and makes or
 * unmakes them; other app admins change ordinary users only. Needs a connection.
 */
export default function ApprovalsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { token, access, mobileNumber } = useAuth();
  const [list, setList] = useState<AppUserList | null>(null);
  const [filter, setFilter] = useState<AppUserStatus>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** The ward picker, open for one user: approving them, or changing their wards. */
  const [picking, setPicking] = useState<{ mobile: string; name: string; action: "approve" | "set-wards"; wardNos: number[] } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;

    setLoading(true);

    try {
      setList(appUserListSchema.parse(await request<unknown>("/api/voters/app-users", { token })));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load the users.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const act = async (mobile: string, action: AppUserAction, wardNos?: number[]) => {
    if (!token) return;

    setBusy(`${mobile}:${action}`);

    try {
      setList(
        appUserListSchema.parse(
          await request<unknown>(`/api/voters/app-users/${mobile}/${action}`, {
            method: "POST",
            token,
            ...(wardNos ? { body: { wardNos } } : {}),
          }),
        ),
      );
    } catch (caught) {
      Alert.alert("Could not change that user", caught instanceof Error ? caught.message : "Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const confirmRemove = (name: string, mobile: string) =>
    Alert.alert(`Remove ${name}?`, "They are signed out and cannot sign in to this constituency until allowed again.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => void act(mobile, "remove") },
    ]);

  const hasWards = (list?.wards.length ?? 0) > 0;
  const meMayor = list?.users.find((user) => user.mobileNumber === mobileNumber)?.isMayor ?? false;

  /** Approve straight away, or first choose wards where there are any. */
  const approve = (name: string, mobile: string) => {
    if (hasWards) setPicking({ mobile, name, action: "approve", wardNos: [] });
    else void act(mobile, "approve");
  };

  const users = list?.users.filter((user) => user.status === filter) ?? [];
  const count = (status: AppUserStatus) => list?.users.filter((user) => user.status === status).length ?? 0;
  const full = list ? list.approved >= list.limit : false;

  const button = (label: string, onPress: () => void, tone: "primary" | "plain" | "danger", key: string, disabled = false) => (
    <Pressable
      key={key}
      onPress={onPress}
      disabled={busy !== null || disabled}
      accessibilityRole="button"
      className={`h-11 flex-1 items-center justify-center rounded-xl px-3 ${
        tone === "primary" ? "bg-primary" : "border border-border bg-card"
      } ${disabled ? "opacity-50" : ""}`}
    >
      {busy === key ? (
        <Spinner />
      ) : (
        <Text
          className={`text-sm font-semibold ${
            tone === "primary" ? "text-primary-foreground" : tone === "danger" ? "text-destructive" : "text-foreground"
          }`}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack space="md" className="items-center border-b border-border bg-card px-4 py-3">
        <Pressable onPress={() => router.back()} accessibilityLabel="Go back" hitSlop={16} className="-m-2 p-2">
          <Icon as={ArrowLeftIcon} className="h-6 w-6 text-foreground" />
        </Pressable>
        <VStack className="flex-1">
          <Heading size="lg" className="text-foreground">
            Approvals
          </Heading>
          <Text className="text-xs text-muted-foreground">
            {access?.assemblyName ?? ""}
            {list ? ` · ${list.approved} of ${list.limit} approved` : ""}
          </Text>
        </VStack>
      </HStack>

      <HStack space="sm" className="px-4 pt-3">
        {FILTERS.map((option) => {
          const selected = filter === option.status;

          return (
            <Pressable
              key={option.status}
              onPress={() => setFilter(option.status)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`h-11 flex-1 items-center justify-center rounded-full ${selected ? "bg-primary" : "bg-secondary"}`}
            >
              <Text className={`text-sm font-semibold ${selected ? "text-primary-foreground" : "text-secondary-foreground"}`}>
                {option.label} · {option.status === "approved" ? `${count("approved")}/${list?.limit ?? 5}` : count(option.status)}
              </Text>
            </Pressable>
          );
        })}
      </HStack>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24, gap: 12 }}
        refreshControl={<RefreshControl refreshing={loading && list !== null} onRefresh={() => void load()} />}
      >
        {list && !list.requireLoginApproval ? (
          <Text className="rounded-xl bg-primary-light p-3 text-sm text-primary-dark">
            {`Login approval is off: new users with a PIN get in by themselves until ${list.limit} are in. You can still remove people.`}
          </Text>
        ) : null}
        {filter === "pending" && full ? (
          <Text className="rounded-xl bg-secondary p-3 text-sm text-secondary-foreground">
            {`${list?.limit ?? 5} users are already approved, the limit here. Remove one to approve someone new, or ask a super admin to raise the limit.`}
          </Text>
        ) : null}

        {error ? <Text className="text-sm text-destructive">{error}</Text> : null}

        {loading && !list ? (
          <HStack space="sm" className="items-center justify-center pt-10">
            <Spinner />
            <Text className="text-muted-foreground">Loading…</Text>
          </HStack>
        ) : users.length === 0 ? (
          <Text className="pt-10 text-center text-muted-foreground">
            {filter === "pending" ? "Nobody is waiting." : filter === "approved" ? "Nobody approved yet." : "Nobody removed."}
          </Text>
        ) : (
          users.map((user) => {
            const self = user.mobileNumber === mobileNumber;
            const locked = self || user.isMayor || (user.isAdmin && !meMayor);
            const lockedWhy = self
              ? "You cannot change your own access."
              : user.isMayor
                ? "The Mayor is changed on the dashboard."
                : "Only the Mayor can change admins.";

            return (
              <VStack key={user.mobileNumber} space="sm" className="rounded-2xl border border-border bg-card p-4">
                <HStack className="items-center justify-between">
                  <VStack className="flex-1">
                    <Text className="text-base font-semibold text-foreground">
                      {user.fullName}
                      {self ? " (you)" : ""}
                    </Text>
                    <Text className="text-sm text-muted-foreground">{user.mobileNumber}</Text>
                  </VStack>
                  {user.isAdmin ? (
                    <Box className="rounded-full bg-primary-light px-2 py-1">
                      <Text className="text-xs font-semibold text-primary-dark">{user.isMayor ? "Mayor" : "Admin"}</Text>
                    </Box>
                  ) : null}
                </HStack>
                {hasWards && user.status === "approved" ? (
                  <Text className="text-sm font-medium text-foreground">{wardLabel(user.wardNos)}</Text>
                ) : null}
                <Text className="text-xs text-muted-foreground">
                  {user.status === "pending"
                    ? `Asked ${when(user.requestedAt)}`
                    : `${user.status === "approved" ? "Approved" : "Removed"} ${when(user.decidedAt)}${user.decidedBy ? ` by ${user.decidedBy}` : ""}`}
                </Text>

                {locked ? (
                  <Text className="text-xs text-muted-foreground">{lockedWhy}</Text>
                ) : (
                  <HStack space="sm">
                    {user.status === "pending"
                      ? [
                          button(
                            hasWards ? "Approve…" : "Approve",
                            () => approve(user.fullName, user.mobileNumber),
                            "primary",
                            `${user.mobileNumber}:approve`,
                            full,
                          ),
                          button("Remove", () => confirmRemove(user.fullName, user.mobileNumber), "danger", `${user.mobileNumber}:remove`),
                        ]
                      : user.status === "approved"
                        ? [
                            ...(hasWards
                              ? [
                                  button(
                                    "Change wards",
                                    () =>
                                      setPicking({
                                        mobile: user.mobileNumber,
                                        name: user.fullName,
                                        action: "set-wards",
                                        wardNos: user.wardNos,
                                      }),
                                    "plain",
                                    `${user.mobileNumber}:set-wards`,
                                  ),
                                ]
                              : []),
                            ...(meMayor
                              ? [
                                  user.isAdmin
                                    ? button("Not admin", () => void act(user.mobileNumber, "unmake-admin"), "plain", `${user.mobileNumber}:unmake-admin`)
                                    : button("Make admin", () => void act(user.mobileNumber, "make-admin"), "plain", `${user.mobileNumber}:make-admin`),
                                ]
                              : []),
                            button("Remove", () => confirmRemove(user.fullName, user.mobileNumber), "danger", `${user.mobileNumber}:remove`),
                          ]
                        : [button("Allow again", () => void act(user.mobileNumber, "allow"), "plain", `${user.mobileNumber}:allow`)]}
                  </HStack>
                )}
              </VStack>
            );
          })
        )}
      </ScrollView>

      <WardPicker
        picking={picking}
        wards={list?.wards ?? []}
        onCancel={() => setPicking(null)}
        onDone={(wardNos) => {
          const target = picking;

          setPicking(null);
          if (target) void act(target.mobile, target.action, wardNos);
        }}
      />
    </Box>
  );
}

/**
 * Which wards the person may download: some of them, or all. Nothing is
 * chosen to begin with when approving, so the choice is always made.
 */
function WardPicker({
  picking,
  wards,
  onCancel,
  onDone,
}: {
  picking: { name: string; action: "approve" | "set-wards"; wardNos: number[] } | null;
  wards: { wardNo: number; voters: number }[];
  onCancel: () => void;
  onDone: (wardNos: number[]) => void;
}) {
  const insets = useSafeAreaInsets();
  const [all, setAll] = useState(false);
  const [chosen, setChosen] = useState<Set<number>>(new Set());
  const [openFor, setOpenFor] = useState<typeof picking>(null);

  // Starts from the person's current wards each time it opens.
  if (picking !== openFor) {
    setOpenFor(picking);
    setAll(picking?.action === "set-wards" && picking.wardNos.length === 0);
    setChosen(new Set(picking?.wardNos ?? []));
  }

  const toggle = (wardNo: number) => {
    setAll(false);
    setChosen((prev) => {
      const next = new Set(prev);

      if (next.has(wardNo)) next.delete(wardNo);
      else next.add(wardNo);

      return next;
    });
  };

  const voters = all
    ? wards.reduce((sum, ward) => sum + ward.voters, 0)
    : wards.filter((ward) => chosen.has(ward.wardNo)).reduce((sum, ward) => sum + ward.voters, 0);
  const ready = all || chosen.size > 0;

  return (
    <Modal visible={picking !== null} animationType="slide" transparent onRequestClose={onCancel}>
      <Box className="flex-1 justify-end bg-black/40">
        <VStack
          space="md"
          className="max-h-[85%] rounded-t-3xl bg-background px-4 pt-5"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <VStack>
            <Heading size="md" className="text-foreground">
              {picking?.action === "approve" ? `Approve ${picking?.name ?? ""}` : `Wards for ${picking?.name ?? ""}`}
            </Heading>
            <Text className="text-sm text-muted-foreground">
              Choose the wards they may download. They see only those voters.
            </Text>
          </VStack>

          <Pressable
            onPress={() => {
              setAll((prev) => !prev);
              setChosen(new Set());
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: all }}
            className={`h-12 items-center justify-center rounded-xl border ${all ? "border-primary bg-primary" : "border-border bg-card"}`}
          >
            <Text className={`font-semibold ${all ? "text-primary-foreground" : "text-foreground"}`}>
              All wards ({wards.length})
            </Text>
          </Pressable>

          <ScrollView contentContainerStyle={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {wards.map((ward) => {
              const on = !all && chosen.has(ward.wardNo);

              return (
                <Pressable
                  key={ward.wardNo}
                  onPress={() => toggle(ward.wardNo)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`Ward ${ward.wardNo}, ${ward.voters} voters`}
                  className={`min-w-[30%] flex-1 items-center rounded-xl border px-2 py-2 ${on ? "border-primary bg-primary-light" : "border-border bg-card"}`}
                >
                  <Text className={`font-semibold ${on ? "text-primary-dark" : "text-foreground"}`}>Ward {ward.wardNo}</Text>
                  <Text className="text-xs text-muted-foreground">{ward.voters.toLocaleString()} voters</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <Text className="text-sm text-muted-foreground">
            {ready
              ? `${all ? "All wards" : `${chosen.size} ward${chosen.size === 1 ? "" : "s"}`} · ${voters.toLocaleString()} voters`
              : "Choose at least one ward."}
          </Text>

          <HStack space="sm">
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              className="h-12 flex-1 items-center justify-center rounded-xl border border-border bg-card"
            >
              <Text className="font-semibold text-foreground">Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onDone(all ? [] : [...chosen].sort((a, b) => a - b))}
              disabled={!ready}
              accessibilityRole="button"
              className={`h-12 flex-1 items-center justify-center rounded-xl bg-primary ${ready ? "" : "opacity-50"}`}
            >
              <Text className="font-semibold text-primary-foreground">
                {picking?.action === "approve" ? "Approve" : "Save"}
              </Text>
            </Pressable>
          </HStack>
        </VStack>
      </Box>
    </Modal>
  );
}
