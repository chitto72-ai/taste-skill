"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Consent = "granted" | "denied" | null;

const STORAGE_KEY = "glufree-consent";

interface ConsentContextValue {
  /** null = l'utente non ha ancora scelto (mostra il banner). */
  consent: Consent;
  setConsent: (value: Exclude<Consent, null>) => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

/**
 * Gestisce il consenso ai cookie pubblicitari (GDPR). Gli annunci vengono
 * caricati solo dopo un consenso esplicito ("granted"); in caso di rifiuto
 * non viene caricato alcuno script di terze parti.
 */
export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consent, setConsentState] = useState<Consent>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "granted" || stored === "denied") setConsentState(stored);
    } catch {
      /* localStorage non disponibile: resta indeciso per la sessione */
    }
  }, []);

  const setConsent = (value: Exclude<Consent, null>) => {
    setConsentState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      /* ignora: la scelta vale comunque per la sessione */
    }
  };

  const value = useMemo(() => ({ consent, setConsent }), [consent]);

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) return { consent: null, setConsent: () => {} };
  return ctx;
}
