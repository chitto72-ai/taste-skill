"use client";

import { useEffect } from "react";

/** Registra il service worker che rende Glufree installabile come app mobile. */
export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* la PWA è un miglioramento progressivo: nessun blocco se fallisce */
      });
    }
  }, []);
  return null;
}
