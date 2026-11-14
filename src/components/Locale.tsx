"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Locale = "en" | "es";

type LocaleContextValue = {
  locale: Locale;
  t: (english: string, spanish: string) => string;
  setLocale: (locale: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);
const STORAGE_KEY = "cuadra-locale";

export function LocaleProvider({ children }: { children: ReactNode }) {
  // Spanish by default: the people at the table pay with CoDi, in Mexico.
  const [locale, setLocaleState] = useState<Locale>("es");

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY) === "en") setLocaleState("en");
    } catch {
      // No storage: stay in Spanish.
    }
  }, []);

  const setLocale = (next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Remembered for this visit only.
    }
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t: (english, spanish) => locale === "es" ? spanish : english }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}

export function LanguageToggle() {
  const { locale, setLocale } = useLocale();

  return (
    <div className="language-toggle" role="group" aria-label="Language">
      <button type="button" className={locale === "en" ? "language-option active" : "language-option"} aria-pressed={locale === "en"} onClick={() => setLocale("en")}>
        EN
      </button>
      <button type="button" className={locale === "es" ? "language-option active" : "language-option"} aria-pressed={locale === "es"} onClick={() => setLocale("es")}>
        ES
      </button>
    </div>
  );
}
