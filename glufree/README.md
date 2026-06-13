# 🗺️ Glufree — La mappa dei locali gluten free

Web app + PWA mobile che mostra su una **mappa interattiva** tutti i locali dove
mangiare senza glutine: ristoranti, pizzerie, pasticcerie, gelaterie, bar e
panetterie. I dati arrivano da **Google Maps** (Places API) e dal database
Glufree dei locali **verificati**, con un design completamente personalizzato.

![stack](https://img.shields.io/badge/Next.js%2015-React%2019-EA580C) ![pwa](https://img.shields.io/badge/PWA-installabile-059669)

## Funzionalità

- **Mappa interattiva** (Leaflet + tile CARTO con tinta brand) con pin
  personalizzati colorati per livello di sicurezza gluten free
- **Ricerca live** per città, locale o piatto, con debounce e filtri per
  categoria e livello di sicurezza
- **Geolocalizzazione** "vicino a me" con distanze calcolate
- **Integrazione Google Maps**: con una chiave Places API i risultati live di
  Google per "gluten free" vengono uniti al database Glufree
- **Badge di fiducia**: `100% Gluten Free` · `Certificato AIC` · `Menu GF
  dedicato` + stato `Verificato Glufree / In verifica / Community`
- **Verifica ristoratori**: wizard in 3 step (locale → titolare con Partita
  IVA → documentazione AIC/menu/corso). Le richieste entrano in coda e un
  admin le approva via API; il locale appare in mappa con badge verificato
- **PWA installabile**: manifest + service worker → si usa come app mobile
  (Android "Aggiungi a schermata Home", iOS "Aggiungi a Home")
- **Accessibile**: focus visibili, aria-label, target touch ≥44px,
  `prefers-reduced-motion` rispettato

## Avvio rapido

```bash
npm install
npm run dev          # http://localhost:3000
```

Build di produzione:

```bash
npm run build && npm start
```

## Dati da Google Maps

Senza configurazione l'app usa il **dataset incluso**: locali gluten free
reali in decine di città nel mondo, raccolti da fonti pubbliche (siti
ufficiali, guide per celiaci, elenchi AIC) e contrassegnati come "segnalati
dalla community" — orari, indirizzi e offerta vanno sempre verificati con il
locale. Per i risultati live:

1. Crea una chiave su [Google Cloud Console](https://console.cloud.google.com)
   e abilita **Places API (New)**
2. Copia `.env.example` in `.env.local` e imposta `GOOGLE_MAPS_API_KEY`

L'endpoint `/api/places` farà Text Search di "gluten free" nell'area
richiesta (bias sulla posizione utente) e unirà i risultati al database
Glufree, deduplicando per `googlePlaceId`. I risultati Google sono marcati
"via Google Maps" e con stato *community* finché il locale non si verifica.

> Nota: i Termini di Servizio Google non consentono di scaricare e
> conservare in massa i loro dati; per questo l'integrazione è una ricerca
> live con cache breve (5 min), non un dump.

## Verifica dei ristoratori

1. Il titolare compila il wizard su `/registra-locale`
2. La richiesta è salvata in `.data/submissions.json` con stato `pending`
3. L'admin la approva:

```bash
# elenco richieste
curl -H "x-admin-key: $GLUFREE_ADMIN_KEY" http://localhost:3000/api/admin/approve

# approvazione → il locale entra in mappa come "Verificato Glufree"
curl -X POST -H "x-admin-key: $GLUFREE_ADMIN_KEY" -H "Content-Type: application/json" \
  -d '{"id":"<id-richiesta>"}' http://localhost:3000/api/admin/approve
```

La verifica si basa su: **Partita IVA** (11 cifre, incrociabile con il
registro imprese), **documentazione gluten free** (attestato AIC, menu con
procedure anti-contaminazione o attestato di formazione) ed **email** del
titolare per l'esito.

## Architettura

```
src/
├── app/
│   ├── page.tsx                  # Landing page
│   ├── mappa/page.tsx            # Mappa interattiva full-screen
│   ├── registra-locale/page.tsx  # Wizard verifica ristoratori
│   └── api/
│       ├── places/route.ts       # Ricerca: DB Glufree + Google Places
│       ├── register/route.ts     # Candidature ristoratori
│       └── admin/approve/route.ts# Approvazione (chiave admin)
├── components/
│   ├── map/MapView.tsx           # Leaflet, pin SVG custom, fly-to
│   ├── map/MapExplorer.tsx       # Ricerca, filtri, lista, bottom-sheet
│   ├── PlaceCard.tsx             # Scheda locale (compatta/dettagliata)
│   ├── RegisterWizard.tsx        # Form multi-step con validazione
│   └── VerifiedBadge.tsx         # Badge livello + verifica
├── lib/                          # Tipi, Google Places, store JSON, geo
└── data/seed-places.json         # Dataset locali (fonti pubbliche, da verificare col locale)
```

**Persistenza**: file JSON in `.data/` (zero dipendenze, perfetto per demo e
self-hosting su singolo nodo). Per il deploy serverless (Vercel ecc.)
sostituire `src/lib/store.ts` con un database (Postgres/Supabase/Turso): è
l'unico modulo da toccare.

**Design system**: arancio food `#EA580C` + blu mappa `#2563EB` + verde
sicurezza `#059669` su crema `#FFF7ED`; titoli Playfair Display, testo Karla
(generato con la skill *ui-ux-pro-max*).

## Roadmap

- [ ] Login ristoratori (magic link) e dashboard di gestione scheda
- [ ] Recensioni della community con foto
- [ ] Clustering dei pin per densità elevate
- [ ] App store nativa (Capacitor sopra questa stessa codebase)
