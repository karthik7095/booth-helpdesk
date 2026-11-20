import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { getMeta, setMeta } from "@/lib/db";

/**
 * Which spelling of a voter's name the app shows. Every roll carries each name
 * twice — the `e*` columns in English and the `l*` columns in the script the
 * sheet was published in — so "native" is Telugu on a Telangana roll and Hindi
 * on a Hindi-belt one. It is whatever came down with the data, not one fixed
 * language, which is why the setting is not named after a language.
 */
export type NameLanguage = "english" | "native";

const KEY = "nameLanguage";

type LanguageValue = {
  language: NameLanguage;
  setLanguage: (language: NameLanguage) => Promise<void>;
};

const LanguageContext = createContext<LanguageValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<NameLanguage>("english");

  useEffect(() => {
    getMeta(KEY)
      .then((stored) => {
        if (stored === "native" || stored === "english") setLanguageState(stored);
      })
      .catch(() => undefined);
  }, []);

  const setLanguage = useCallback(async (next: NameLanguage) => {
    // Applied to the UI first — the write is bookkeeping for the next launch.
    setLanguageState(next);
    await setMeta(KEY, next);
  }, []);

  const value = useMemo(() => ({ language, setLanguage }), [language, setLanguage]);

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage(): LanguageValue {
  const value = useContext(LanguageContext);

  if (!value) throw new Error("useLanguage must be used inside <LanguageProvider>");

  return value;
}
