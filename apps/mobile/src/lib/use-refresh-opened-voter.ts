import { useFocusEffect } from "expo-router";
import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";

import { getVoter, type LocalVoter } from "@/lib/db";

/**
 * Wraps a list's "open voter" so that, back on the list, the voter just opened
 * is read again and swapped in place — a found mark, vote or remark made on the
 * voter screen shows in the card's colour at once. Only that one row is read:
 * re-querying the whole list on every return is what made going back slow.
 */
export function useRefreshOpenedVoter(
  setVoters: Dispatch<SetStateAction<LocalVoter[]>>,
  open: (id: string) => void,
): (id: string) => void {
  const opened = useRef<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const id = opened.current;

      if (!id) return;

      opened.current = null;
      getVoter(id)
        .then((fresh) => {
          if (fresh) setVoters((list) => list.map((voter) => (voter.id === id ? fresh : voter)));
        })
        .catch(() => undefined);
    }, [setVoters]),
  );

  return useCallback(
    (id: string) => {
      opened.current = id;
      open(id);
    },
    [open],
  );
}
