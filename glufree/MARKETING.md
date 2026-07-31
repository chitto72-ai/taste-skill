# 📣 Glufree — Strategia di marketing & crescita

Documento operativo per portare Glufree davanti alle persone celiache, ai
gluten-sensitive e ai ristoratori. Pensato per un lancio a budget zero/basso,
sfruttando community, passaparola e SEO.

---

## 1. Posizionamento

**Una frase:** *"La mappa che dice quanto è sicuro un locale gluten free,
non solo dove si trova."*

**Il problema reale:** chi è celiaco non cerca "un posto che ha qualcosa senza
glutine" — cerca un posto **sicuro** (cucina dedicata, certificazione AIC,
zero contaminazione). Google Maps mostra tutto mescolato; le liste sono
disperse. Glufree filtra e classifica per **livello di sicurezza**.

**Differenziatori da ripetere ovunque:**
1. Badge chiaro di sicurezza: `100% Gluten Free` · `Certificato AIC` · `Menu GF dedicato`
2. Locali **verificati uno a uno** (Partita IVA + documentazione)
3. Mappa mondiale, utile anche in viaggio (l'ansia del celiaco fuori casa)
4. Gratis per chi cerca **e** per i ristoratori

**Tono di voce:** empatico, competente, rassicurante. Mai medicale o
allarmista. Parla "da celiaco a celiaco".

---

## 2. Pubblici (in ordine di priorità)

| # | Target | Dove vive online | Leva |
|---|--------|------------------|------|
| 1 | Persone celiache IT | Gruppi FB "Celiaci", r/glutenfree, Instagram #senzaglutine | Sicurezza + viaggi |
| 2 | Genitori di bimbi celiaci | Gruppi FB genitori, forum AIC | Fiducia, verifica |
| 3 | Gluten-sensitive / lifestyle | TikTok/IG "glutenfree food" | Estetica, scoperta |
| 4 | Ristoratori GF | Google, associazioni di categoria | Visibilità gratuita + clienti |
| 5 | Travel blogger celiaci | Blog, newsletter di nicchia | Mappa mondiale |

---

## 3. Canali e tattiche

### 3.1 Community (il canale #1 per i celiaci)
- **Gruppi Facebook celiaci** (IT: "Celiaci Italia", per città): NON spammare.
  Partecipa, rispondi a "dove mangio a Roma senza glutine?" con un link diretto
  al filtro città di Glufree. Valore prima, link dopo.
- **Reddit**: r/glutenfree, r/Celiac (EN) — post "I built a free map of dedicated
  gluten-free places worldwide" con screenshot. La community premia gli strumenti utili.
- **AIC (Associazione Italiana Celiachia)** e sezioni regionali: proponi Glufree
  come strumento complementare, non concorrente (loro hanno l'elenco AFC ufficiale).

### 3.2 SEO (già implementato in codice — vedi §5)
- Pagine indicizzabili per ogni locale (`/mappa?locale=...`) → long-tail
  "[nome locale] gluten free", "gluten free [città]".
- Target keyword: *ristoranti gluten free [città]*, *pizzeria senza glutine [città]*,
  *dove mangiare senza glutine [città/paese]*.
- Prossimo step consigliato: pagine città dedicate (`/citta/roma`) con testo
  editoriale + lista — fortissime per la SEO locale.

### 3.3 Social organico
- **Instagram/TikTok @glufree**: format ripetibili:
  - "3 locali 100% gluten free a [città]" (carosello/reel)
  - "POV: sei celiaco e trovi una pizzeria con forno dedicato" (emozionale)
  - Before/after dell'ansia "posso mangiare qui?" → apri Glufree
- **Hashtag**: #senzaglutine #celiachia #glutenfree #glutenfreeitalia #celiacsafe
- 1 reel "scoperta locale" + 1 carosello "guida città" a settimana.

### 3.4 Passaparola / referral (già nel prodotto)
- Pulsanti **Condividi** su ogni scheda e inviti **WhatsApp/email** in home.
- Ogni scheda condivisa è un mini-annuncio con anteprima social (OG image).
- Spingi il loop: "Hai trovato un posto buono? Condividilo con un amico celiaco."

### 3.5 Ristoratori (offerta + outreach)
- **Pitch**: "Sei davanti a migliaia di persone che ti stanno *cercando
  apposta*. Gratis. Con un badge che ti distingue dai locali che 'hanno qualcosa
  senza glutine'."
- Outreach: email/DM ai locali 100% GF non ancora verificati, invitandoli a
  reclamare la scheda. Lo strumento di invito è già in-app
  (`/registra-locale?invito=...`).
- Quando un locale si verifica, daglielo da condividere ("Ora siamo su Glufree!")
  → loro stessi fanno marketing a te presso i loro clienti celiaci.

### 3.6 PR & partnership
- Pitch a blog/newsletter celiache e travel-celiac (lista in LAUNCH-KIT.md).
- Product Hunt / Hacker News "Show HN" per la nicchia tech-celiaca e i maker.
- Co-marketing con brand gluten free (farine, birre GF) e b&b celiac-friendly.

---

## 4. Piano di lancio (4 settimane)

**Settimana 0 — Pre-lancio**
- [ ] Verifica finale prodotto (fatta ✅), dominio custom (es. glufree.app),
      account social @glufree, Google Search Console + invio sitemap.
- [ ] Prepara 10 città "complete" e ben curate (Roma, Milano, Napoli, Londra,
      Parigi, NYC…) per fare bella figura alla prima visita.

**Settimana 1 — Soft launch (community ristretta)**
- [ ] Condividi con 20-30 amici/contatti celiaci → primi feedback + primi share.
- [ ] Post nei gruppi FB più caldi (1-2, con tatto). Misura clic e reazioni.

**Settimana 2 — Lancio social**
- [ ] Apri IG/TikTok, pubblica i primi 3 contenuti (guida città + reel emozionale).
- [ ] Reddit r/glutenfree + r/Celiac (EN).

**Settimana 3 — PR & ristoratori**
- [ ] Email a 10 blog/newsletter celiache (template in LAUNCH-KIT.md).
- [ ] Prima ondata di outreach a 50 ristoratori 100% GF.
- [ ] Show HN / Product Hunt.

**Settimana 4 — Consolidamento**
- [ ] Raccogli testimonianze, ripubblica i contenuti migliori.
- [ ] Attiva il loop referral con i primi utenti attivi.

---

## 5. Cosa è GIÀ implementato per la crescita (in questo repo)

| Funzione | File | Effetto marketing |
|----------|------|-------------------|
| Sitemap dinamica (116 URL) | `src/app/sitemap.ts` | Ogni locale indicizzabile su Google |
| robots.txt | `src/app/robots.ts` | Crawling pulito, blocco /api |
| JSON-LD locali (Restaurant/Bakery) | `src/app/mappa/page.tsx` | Rich result + Google Maps/Search |
| JSON-LD Organization + SearchAction | `src/app/page.tsx` | Sitelinks searchbox |
| OG/Twitter image 1200×630 | `public/og-image.png` | Anteprime social accattivanti |
| Deep link per locale + preview | `/mappa?locale=...` | Condivisioni che convertono |
| Ricerca da URL `?q=` | `MapExplorer.tsx` | Link "gluten free [città]" pronti |
| Condividi + inviti WhatsApp/email | `ShareButton.tsx`, home | Loop di passaparola |
| Referral tracking ristoratori | `/registra-locale?invito=` | Misura le fonti di crescita |
| PWA installabile | `manifest` + `sw.js` | "App" senza store, ritenzione |

---

## 5b. Modello di ricavo (monetizzazione)

Il sito è gratuito per gli utenti; i ricavi arrivano da due canali complementari,
entrambi già implementati nel prodotto:

1. **Pubblicità (Google AdSense)** — annunci in-content sulla home e nella lista
   dei risultati, con consenso GDPR. Rende su volume di traffico → cresce con la
   SEO e la community. Vedi README → *Monetizzazione con Google AdSense*.
2. **Inserzioni "In evidenza"** (sponsored listings) — i ristoratori **verificati**
   pagano per apparire in cima ai risultati con badge dedicato. Rende su valore
   per-cliente e non dipende dal volume. È il canale a margine più alto e il più
   coerente con una mappa di scoperta. Vedi README → *Inserzioni "In evidenza"*.

Sequenza consigliata: prima costruisci traffico e locali verificati (gratis),
poi attiva AdSense (serve traffico per l'approvazione) e proponi le inserzioni in
evidenza ai ristoratori che già ricevono clienti dalla mappa. Terza leva futura:
affiliazioni (prenotazioni, e-shop di prodotti gluten free) e un piano "Plus".

**Regola d'oro:** la sicurezza non è mai in vendita. Solo i locali verificati
possono essere sponsorizzati, e i contenuti a pagamento sono sempre etichettati.

## 6. Metriche da seguire (North Star + supporto)

- **North Star:** ricerche di locali completate / settimana (= valore reale erogato).
- Visitatori unici, % che apre la mappa, % che usa "vicino a me".
- Condivisioni generate (clic sui pulsanti share/invito).
- Nuove candidature ristoratori / settimana + tasso di approvazione.
- Posizionamento Google su 10 keyword città (Search Console).

---

## 7. Avvertenze etiche (importanti per la fiducia, che è il nostro brand)

- **Mai promettere sicurezza assoluta.** Disclaimer sempre visibile: in caso di
  celiachia severa, verificare con il locale. Già presente nel footer.
- I dati community vanno verificati: non gonfiare i numeri, non inventare
  certificazioni. La credibilità è l'unico vero asset di un'app per celiaci.
- Nessuno scraping di massa da Google Maps (vietato dai ToS): ricerca live +
  database verificato. Comunicarlo è un punto di forza, non un limite.
