import { useLocalSearchParams } from "expo-router";
import { useMemo } from "react";

import { VoterGroupScreen } from "@/components/voter-group-screen";

/** One gram panchayat ward: the booth screen's voters, families, follow-ups and statistics. */
export default function WardScreen() {
  const { wardNo } = useLocalSearchParams<{ wardNo: string }>();
  const ward = Number(wardNo);
  // Stable between renders: the lists reload whenever the scope changes.
  const scope = useMemo(() => ({ wardNo: ward }), [ward]);

  return <VoterGroupScreen scope={scope} title={`Ward ${ward}`} />;
}
