"use client";

import { Cookie } from "lucide-react";
import { adsEnabled } from "@/lib/ads";
import { useConsent } from "./ConsentProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

/**
 * Banner di consenso ai cookie pubblicitari. Appare solo se la monetizzazione
 * è configurata e l'utente non ha ancora scelto.
 */
export default function ConsentBanner() {
  const { consent, setConsent } = useConsent();
  const { t } = useTranslation();

  if (!adsEnabled() || consent !== null) return null;

  return (
    <div
      role="dialog"
      aria-label={t.consent.title}
      className="fixed inset-x-3 bottom-3 z-[1200] mx-auto max-w-2xl animate-fade-up rounded-2xl border border-line bg-white/95 p-4 shadow-card backdrop-blur sm:inset-x-auto sm:left-1/2 sm:w-[42rem] sm:-translate-x-1/2"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-muted text-primary">
          <Cookie className="h-5 w-5" aria-hidden />
        </span>
        <p className="flex-1 text-sm leading-relaxed text-slate-600">{t.consent.message}</p>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setConsent("denied")}
            className="min-h-11 cursor-pointer rounded-xl border border-line bg-white px-4 py-2 text-sm font-bold text-ink transition-colors duration-200 hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t.consent.reject}
          </button>
          <button
            type="button"
            onClick={() => setConsent("granted")}
            className="min-h-11 cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white transition-colors duration-200 hover:bg-primary-dark focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            {t.consent.accept}
          </button>
        </div>
      </div>
    </div>
  );
}
