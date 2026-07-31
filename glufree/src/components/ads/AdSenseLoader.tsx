"use client";

import Script from "next/script";
import { adsenseClient } from "@/lib/ads";
import { useConsent } from "./ConsentProvider";

/**
 * Carica lo script AdSense una sola volta, ma solo se la monetizzazione è
 * configurata E l'utente ha dato il consenso. Prima del consenso non parte
 * alcuna richiesta a Google.
 */
export default function AdSenseLoader() {
  const client = adsenseClient();
  const { consent } = useConsent();

  if (!client || consent !== "granted") return null;

  return (
    <Script
      id="adsbygoogle-init"
      async
      strategy="afterInteractive"
      crossOrigin="anonymous"
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${client}`}
    />
  );
}
