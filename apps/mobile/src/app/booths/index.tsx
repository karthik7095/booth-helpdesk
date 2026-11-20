import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList, InteractionManager, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { VoterListSkeleton } from "@/components/skeletons";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, ChevronRightIcon, Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { listBooths, listWards, type BoothRow, type WardRow } from "@/lib/db";

export default function BoothsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { access } = useAuth();
  // A gram panchayat lists its wards first; its booths are a tap away.
  const panchayat = access?.isPanchayat ?? false;
  const [view, setView] = useState<"wards" | "booths">(panchayat ? "wards" : "booths");
  const [booths, setBooths] = useState<BoothRow[]>([]);
  const [wards, setWards] = useState<WardRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // After the screen has slid in: the query runs on the JS thread, and
    // starting it during the transition froze the animation half-way.
    const task = InteractionManager.runAfterInteractions(() => {
      Promise.all([listBooths(), panchayat ? listWards() : Promise.resolve([])])
        .then(([boothRows, wardRows]) => {
          if (cancelled) return;
          setBooths(boothRows);
          setWards(wardRows);
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    });

    return () => {
      cancelled = true;
      task.cancel();
    };
  }, [panchayat]);

  const showWards = panchayat && view === "wards";

  const total = booths.reduce((sum, booth) => sum + booth.total, 0);

  return (
    <Box className="flex-1 bg-background" style={{ paddingTop: insets.top }}>
      <HStack space="md" className="items-center border-b border-border bg-card px-4 py-3">
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
            {panchayat ? "Booths & Wards" : "Booths"}
          </Heading>
          <Text className="text-xs text-muted-foreground">
            {panchayat ? `${wards.length} wards · ` : ""}
            {booths.length} booths · {total.toLocaleString()} voters
          </Text>
        </VStack>
      </HStack>

      {panchayat ? (
        <HStack
          accessibilityRole="tablist"
          className="mx-4 mt-4 rounded-2xl bg-primary-light p-1"
        >
          {(["wards", "booths"] as const).map((option) => {
            const selected = view === option;

            return (
              <Pressable
                key={option}
                onPress={() => setView(option)}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                className={`h-11 flex-1 items-center justify-center rounded-xl ${selected ? "bg-card" : ""}`}
              >
                <Text className={`text-sm font-semibold ${selected ? "text-primary" : "text-foreground"}`}>
                  {option === "wards" ? `Wards · ${wards.length}` : `Booths · ${booths.length}`}
                </Text>
              </Pressable>
            );
          })}
        </HStack>
      ) : null}

      {loading ? (
        <VoterListSkeleton rows={6} />
      ) : showWards ? (
        <FlatList
          data={wards}
          keyExtractor={(ward) => String(ward.wardNo)}
          contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
          ItemSeparatorComponent={() => <Box className="h-3" />}
          ListEmptyComponent={
            <Text className="pt-10 text-center text-muted-foreground">
              No wards on this roll. It needs a WARD_NO column.
            </Text>
          }
          renderItem={({ item }) => {
            const wardBooths = item.booths.split(",").filter(Boolean);

            return (
              <Pressable
                onPress={() => router.push(`/wards/${item.wardNo}`)}
                accessibilityRole="button"
                accessibilityLabel={`Ward ${item.wardNo}, ${item.total} voters`}
              >
                <VStack space="sm" className="rounded-2xl border border-border bg-card p-4">
                  <HStack space="sm" className="items-center justify-between">
                    <Heading size="md" className="text-primary-dark">
                      Ward {item.wardNo}
                    </Heading>
                    <HStack space="sm" className="items-center">
                      <Badge className="rounded-full bg-primary-light">
                        <BadgeText className="text-primary-dark">{item.total.toLocaleString()}</BadgeText>
                      </Badge>
                      <Icon as={ChevronRightIcon} className="h-5 w-5 text-muted-foreground" />
                    </HStack>
                  </HStack>

                  <Text className="text-sm text-muted-foreground">
                    {item.male.toLocaleString()} male · {item.female.toLocaleString()} female
                  </Text>
                  <Text className="text-xs text-muted-foreground">
                    Serials {item.firstSr}–{item.lastSr} · booth{wardBooths.length > 1 ? "s" : ""}{" "}
                    {wardBooths.join(", ")}
                  </Text>
                </VStack>
              </Pressable>
            );
          }}
        />
      ) : (
        <FlatList
          data={booths}
          keyExtractor={(booth) => String(booth.partNo)}
          contentContainerStyle={{
            padding: 16,
            paddingBottom: insets.bottom + 24,
          }}
          ItemSeparatorComponent={() => <Box className="h-3" />}
          ListEmptyComponent={
            <Text className="pt-10 text-center text-muted-foreground">
              No voters on this phone yet.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push(`/booths/${item.partNo}`)}
              accessibilityRole="button"
              accessibilityLabel={`Booth ${item.partNo}, ${item.total} voters`}
            >
              <VStack space="sm" className="rounded-2xl border border-border bg-card p-4">
                <HStack space="sm" className="items-center justify-between">
                  <Heading size="md" className="text-primary-dark">
                    Booth {item.partNo}
                  </Heading>
                  <HStack space="sm" className="items-center">
                    <Badge className="rounded-full bg-primary-light">
                      <BadgeText className="text-primary-dark">
                        {item.total.toLocaleString()}
                      </BadgeText>
                    </Badge>
                    <Icon as={ChevronRightIcon} className="h-5 w-5 text-muted-foreground" />
                  </HStack>
                </HStack>

                <Text className="text-sm text-muted-foreground">
                  {item.male.toLocaleString()} male · {item.female.toLocaleString()} female
                </Text>

                {item.boothAddress ? (
                  <Text className="text-xs text-muted-foreground" numberOfLines={2}>
                    {item.boothAddress}
                  </Text>
                ) : null}
              </VStack>
            </Pressable>
          )}
        />
      )}
    </Box>
  );
}
