"use client";

import { useEffect, useRef } from "react";
import { adsenseClient } from "@/lib/ads";
import { useConsent } from "./ConsentProvider";
import { useTranslation } from "@/lib/i18n/LanguageProvider";

interface AdSlotProps {
  /** ID unità annuncio creato nella dashboard AdSense. */
  slot: string;
  format?: string;
  className?: string;
}

/**
 * Unità pubblicitaria responsive. Non renderizza nulla se la monetizzazione
 * è disattivata, se manca lo slot o se non c'è consenso: così in sviluppo o
 * senza configurazione non compaiono riquadri vuoti.
 */
export default function AdSlot({ slot, format = "auto", className = "" }: AdSlotProps) {
  const client = adsenseClient();
  const { consent } = useConsent();
  const { t } = useTranslation();
  const pushed = useRef(false);

  const active = Boolean(client) && Boolean(slot) && consent === "granted";

  useEffect(() => {
    if (!active || pushed.current) return;
    try {
      (window.adsbygoogle = window.adsbygoogle || []).push({});
      pushed.current = true;
    } catch {
      /* lo script non è ancora pronto: AdSense processerà la coda al load */
    }
  }, [active]);

  if (!active) return null;

  return (
    <aside
      className={`my-4 overflow-hidden rounded-2xl border border-line bg-white/60 ${className}`}
      aria-label={t.ads.label}
    >
      <p className="px-3 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {t.ads.label}
      </p>
      <ins
        className="adsbygoogle"
        style={{ display: "block", minHeight: 90 }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format={format}
        data-full-width-responsive="true"
      />
    </aside>
  );
}
