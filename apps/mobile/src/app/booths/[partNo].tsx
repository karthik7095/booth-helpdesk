import { useLocalSearchParams } from "expo-router";

import { VoterGroupScreen } from "@/components/voter-group-screen";

export default function BoothScreen() {
  const { partNo } = useLocalSearchParams<{ partNo: string }>();
  const booth = Number(partNo);

  return <VoterGroupScreen scope={booth} title={`Booth ${booth}`} />;
}
