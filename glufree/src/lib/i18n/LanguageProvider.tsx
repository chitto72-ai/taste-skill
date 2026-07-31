"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_LANG,
  RTL_LANGS,
  STORAGE_KEY,
  detectLang,
  isLang,
  type Lang,
} from "./config";
import { dictionaries, type Dict } from "./dictionaries";

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: Dict;
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Lang>(DEFAULT_LANG);

  // Al primo render lato client recupera la scelta salvata o la lingua del browser.
  useEffect(() => {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const initial = isLang(stored) ? stored : detectLang();
    setLangState(initial);
  }, []);

  // Aggiorna <html lang> e direzione (RTL per l'arabo) a ogni cambio lingua.
  useEffect(() => {
    const dir = RTL_LANGS.includes(lang) ? "rtl" : "ltr";
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
  }, [lang]);

  const setLang = (next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* localStorage non disponibile: la scelta resta valida per la sessione */
    }
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      setLang,
      t: dictionaries[lang],
      dir: RTL_LANGS.includes(lang) ? "rtl" : "ltr",
    }),
    [lang]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    // Fallback difensivo: se usato fuori dal provider, usa l'italiano.
    return { lang: DEFAULT_LANG, setLang: () => {}, t: dictionaries[DEFAULT_LANG], dir: "ltr" };
  }
  return ctx;
}
