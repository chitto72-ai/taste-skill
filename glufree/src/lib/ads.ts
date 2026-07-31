/**
 * Configurazione Google AdSense. La monetizzazione è opzionale e si attiva
 * solo impostando NEXT_PUBLIC_ADSENSE_CLIENT (l'ID publisher, es. ca-pub-…).
 * Senza chiave, nessuno script pubblicitario viene caricato e non compare
 * alcun annuncio: il sito resta identico ma "pulito".
 *
 * Gli slot (unità annuncio) vanno creati nella dashboard AdSense; i loro ID
 * si passano tramite le variabili NEXT_PUBLIC_ADSENSE_SLOT_*.
 */
declare global {
  interface Window {
    adsbygoogle?: unknown[];
  }
}

/** ID publisher AdSense (ca-pub-…), o undefined se la monetizzazione è disattivata. */
export function adsenseClient(): string | undefined {
  const client = process.env.NEXT_PUBLIC_ADSENSE_CLIENT;
  return client && client.startsWith("ca-pub-") ? client : undefined;
}

export function adsEnabled(): boolean {
  return Boolean(adsenseClient());
}

/** ID degli slot per le diverse posizioni. Vuoto = quella posizione non mostra annunci. */
export const AD_SLOTS = {
  home: process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME ?? "",
  list: process.env.NEXT_PUBLIC_ADSENSE_SLOT_LIST ?? "",
};
