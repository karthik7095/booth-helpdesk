import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { colorScheme } from "react-native-css";

import { getMeta, setMeta } from "@/lib/db";

/**
 * Light or dark app colours, chosen in Settings. Light unless the user picks
 * dark: the phone's own dark mode is ignored. The styling engine reads the
 * phone's scheme when it loads and only follows system change events, so
 * asking React Native's Appearance for light was not enough on a phone in dark
 * mode; the scheme is set on it directly instead.
 */
export type ThemeMode = "light" | "dark";

const KEY = "themeMode";

// Before the first screen draws, so a dark-mode phone never flashes dark.
colorScheme.set("light");

type ThemeValue = {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => Promise<void>;
};

const ThemeContext = createContext<ThemeValue | null>(null);

export function ThemeProvider({ children }: { children: (mode: ThemeMode) => ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("light");

  useEffect(() => {
    getMeta(KEY)
      .then((stored) => {
        if (stored === "dark" || stored === "light") setModeState(stored);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    colorScheme.set(mode);
  }, [mode]);

  const setMode = useCallback(async (next: ThemeMode) => {
    // Applied to the UI first — the write is bookkeeping for the next launch.
    setModeState(next);
    await setMeta(KEY, next);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);

  return <ThemeContext.Provider value={value}>{children(mode)}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const value = useContext(ThemeContext);

  if (!value) throw new Error("useTheme must be used inside <ThemeProvider>");

  return value;
}
