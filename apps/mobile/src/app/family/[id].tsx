import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Alert, FlatList, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { FamilyIcon, PrinterIcon, WhatsAppIcon } from "@/components/icons";
import { syncIfOnline } from "@/lib/sync";
import { VoterListSkeleton } from "@/components/skeletons";
import { Badge, BadgeText } from "@/components/ui/badge";
import { Box } from "@/components/ui/box";
import { Heading } from "@/components/ui/heading";
import { HStack } from "@/components/ui/hstack";
import { ArrowLeftIcon, Icon, MessageCircleIcon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { VStack } from "@/components/ui/vstack";
import { useAuth } from "@/lib/auth";
import { getFamilyMembers, getVoter, type FamilyScope, type LocalVoter } from "@/lib/db";
import { useLanguage } from "@/lib/language";
import {
  hasMobile,
  printVoter,
  smsVoter,
  voterFullName,
  voterRelativeName,
  shareVoterOnWhatsApp,
} from "@/lib/voter-actions";

function maskMobile(mobile: string | null): string {
  if (!mobile) return "—";

  return mobile.length > 4 ? `${"*".repeat(mobile.length - 4)}${mobile.slice(-4)}` : mobile;
}

export default function FamilyScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { language } = useLanguage();
  const { access, token } = useAuth();

  const [voter, setVoter] = useState<LocalVoter | null>(null);
  const [members, setMembers] = useState<LocalVoter[]>([]);
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const [scope, setScope] = useState<FamilyScope>({
    village: true,
    booth: true,
  });

  const runPrint = useCallback(async () => {
    if (!voter) return;

    setPrinting(true);

    const outcome = await printVoter(voter, members, language);

    if (outcome.kind === "failed") Alert.alert("Could not print", outcome.message);

    setPrinting(false);

    // The print is logged in the background once the GPS fix is in; the sync
    // waits for that so it has the record to push.
    if (outcome.kind !== "failed") void outcome.recorded.then(() => syncIfOnline(token));
  }, [voter, members, language, token]);

  useEffect(() => {
    let cancelled = false;

    void getVoter(String(id)).then((found) => {
      if (!cancelled) setVoter(found);
      if (!found) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!voter) return;

    let cancelled = false;

    void getFamilyMembers(voter, scope).then((rows) => {
      if (cancelled) return;

      setMembers(rows);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [voter, scope]);

  const filters: { key: keyof FamilyScope; label: string }[] = [
    { key: "village", label: "Same village" },
    { key: "booth", label: "Same booth" },
  ];

  const place = [scope.village && "village", scope.booth && "booth"].filter(Boolean).join(" and ");

  const reachable = voter ? hasMobile(voter) : false;

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
        <Heading size="lg" className="text-foreground">
          Family Members
        </Heading>
      </HStack>

      {loading ? (
        <VoterListSkeleton rows={4} />
      ) : !voter ? (
        <Text className="p-6 text-center text-muted-foreground">That voter is no longer here.</Text>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(member) => member.id}
          contentContainerStyle={{
            padding: 20,
            paddingBottom: insets.bottom + 24,
          }}
          ItemSeparatorComponent={() => <Box className="h-3" />}
          ListHeaderComponent={
            <VStack space="md" className="pb-4">
              <Text className="text-base font-semibold text-foreground">Family Info</Text>

              <VStack space="sm" className="rounded-2xl bg-primary-light p-5">
                <HStack className="justify-between">
                  <Text className="text-sm text-muted-foreground">FAMILY:</Text>
                  <Text className="flex-1 pl-3 text-right text-base font-medium text-primary-dark">
                    {voterFullName(voter, language)}
                  </Text>
                </HStack>
                <HStack className="justify-between">
                  <Text className="text-sm text-muted-foreground">MEMBERS:</Text>
                  <Text className="text-base font-medium text-primary-dark">
                    {members.length + 1}
                  </Text>
                </HStack>
                <HStack className="justify-between">
                  <Text className="text-sm text-muted-foreground">HOUSE #:</Text>
                  <Text className="flex-1 pl-3 text-right text-base font-medium text-primary-dark">
                    {voter.houseNo ?? "—"}
                  </Text>
                </HStack>
                <HStack className="justify-between">
                  <Text className="text-sm text-muted-foreground">VILLAGE:</Text>
                  <Text className="flex-1 pl-3 text-right text-base font-medium text-primary-dark">
                    {voter.eVillage ?? "—"}
                  </Text>
                </HStack>
                <HStack className="justify-between">
                  <Text className="text-sm text-muted-foreground">BOOTH #:</Text>
                  <Text className="text-base font-medium text-primary-dark">{voter.partNo}</Text>
                </HStack>
                <HStack className="justify-between">
                  <Text className="text-sm text-muted-foreground">MOBILE:</Text>
                  <Text className="text-base font-medium text-primary-dark">
                    {maskMobile(voter.mobileNo1)}
                  </Text>
                </HStack>
              </VStack>

              <HStack space="sm">
                <Pressable
                  onPress={() => shareVoterOnWhatsApp(voter, access)}
                  accessibilityLabel="WhatsApp the family"
                >
                  <Box className="h-12 w-14 items-center justify-center rounded-xl bg-success">
                    <Icon as={WhatsAppIcon} className="h-5 w-5 text-success-foreground" />
                  </Box>
                </Pressable>

                <Pressable
                  disabled={!reachable}
                  onPress={() => smsVoter(voter, access)}
                  accessibilityLabel="Text the family"
                >
                  <Box
                    className={`h-12 w-14 items-center justify-center rounded-xl ${
                      reachable ? "bg-primary" : "bg-secondary"
                    }`}
                  >
                    <Icon
                      as={MessageCircleIcon}
                      className={`h-5 w-5 ${reachable ? "text-primary-foreground" : "text-muted-foreground"}`}
                    />
                  </Box>
                </Pressable>

                {/* Prints the whole household on one slip. */}
                <Pressable className="flex-1" disabled={printing} onPress={runPrint}>
                  <HStack
                    space="sm"
                    className="h-12 items-center justify-center rounded-xl bg-primary"
                  >
                    <Icon as={PrinterIcon} className="h-5 w-5 text-primary-foreground" />
                    <Text className="text-base font-medium text-primary-foreground">Print</Text>
                  </HStack>
                </Pressable>
              </HStack>

              {/* House number is always matched; these narrow it, since "1-2/3" repeats across villages. */}
              <HStack space="sm" className="pt-2">
                {filters.map((filter) => {
                  const active = scope[filter.key];

                  return (
                    <Pressable
                      key={filter.key}
                      onPress={() =>
                        setScope((current) => ({
                          ...current,
                          [filter.key]: !active,
                        }))
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: active }}
                    >
                      <Badge className={`rounded-full ${active ? "bg-primary" : "bg-secondary"}`}>
                        <BadgeText
                          className={
                            active ? "text-primary-foreground" : "text-secondary-foreground"
                          }
                        >
                          {filter.label}
                        </BadgeText>
                      </Badge>
                    </Pressable>
                  );
                })}
              </HStack>

              <HStack space="xs" className="items-center">
                <Icon as={FamilyIcon} className="h-4 w-4 text-muted-foreground" />
                <Text className="text-sm text-muted-foreground">
                  {members.length === 0
                    ? `No other voters at house ${voter.houseNo ?? "—"}${place ? ` in this ${place}` : ""}`
                    : `${members.length} other voter${members.length === 1 ? "" : "s"} at house ${voter.houseNo}${place ? ` in this ${place}` : ""}`}
                </Text>
              </HStack>
            </VStack>
          }
          ListEmptyComponent={
            <Text className="pt-6 text-center text-muted-foreground">
              There is no family member to display.
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => router.push(`/voter/${item.id}`)}>
              <HStack className="overflow-hidden rounded-xl border border-border bg-card">
                <Box className="w-1.5 bg-success" />
                <HStack className="flex-1 items-center p-3">
                  <VStack className="w-16">
                    <Text className="text-base font-semibold text-foreground">{item.partNo}</Text>
                    <Text className="text-sm text-muted-foreground">{item.srNo}</Text>
                  </VStack>

                  <VStack className="flex-1 pr-2">
                    <Text
                      className="text-base font-semibold uppercase text-foreground"
                      numberOfLines={1}
                    >
                      {voterFullName(item, language)}
                    </Text>
                    <Text className="text-sm uppercase text-muted-foreground" numberOfLines={1}>
                      {voterRelativeName(item, language) ?? "—"}
                    </Text>
                  </VStack>

                  <VStack className="items-end">
                    <Text className="text-base font-semibold text-foreground">
                      {(item.sex ?? "?").toUpperCase()}/{item.age ?? "?"}
                    </Text>
                    <Text className="text-sm text-muted-foreground">
                      {item.mobileNo1 ? `..${item.mobileNo1.slice(-4)}` : "—"}
                    </Text>
                  </VStack>
                </HStack>
              </HStack>
            </Pressable>
          )}
        />
      )}
    </Box>
  );
}
