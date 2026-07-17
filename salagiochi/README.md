# 🕹️ Sala Giochi

Piattaforma web di mini-giochi arcade **retro**, costruita in **HTML/CSS/JS puro**:
nessun framework, nessuna dipendenza esterna, nessun asset scaricato (tutta la
grafica è generata via `<canvas>`, CSS e SVG inline). Ogni gioco è un singolo
file autonomo, giocabile da **tastiera** e da **touch** (funziona su mobile).

## 📂 Struttura

```
salagiochi/
├── index.html        # home: griglia dei giochi, generata leggendo games.json
├── games.json        # catalogo (slug, titolo, descrizione, data, emoji)
├── style.css         # tema arcade notturno condiviso dalla home
├── vercel.json       # configurazione deploy statico
└── games/
    ├── snake.html          🐍 Serpente
    ├── breakout.html       🧱 Rompimuro
    ├── memory.html         🃏 Memoria
    ├── 2048.html           🔢 2048
    ├── flappy.html         🐦 Ali di Pixel
    ├── blocchi.html        🟦 Blocchi (tetris-like)
    ├── pong.html           🏓 Ping Pong
    ├── difensore.html      🚀 Difensore Stellare
    ├── campominato.html    💣 Campo Minato
    └── talpe.html          🔨 Acchiappa la Talpa
```

Ogni gioco include: punteggio, game over, restart e **record salvato in
`localStorage`**.

## ▶️ Provare in locale

Serve un piccolo server web (la home legge `games.json` via `fetch`, che non
funziona aprendo il file con `file://`):

```bash
cd salagiochi
python3 -m http.server 8000
# poi apri http://localhost:8000
```

## 💰 Attivare Google AdSense

Ogni pagina di gioco contiene **due slot AdSense** (uno sopra e uno sotto il
gioco). Al momento usano il placeholder `ca-pub-XXXXXXXXXXXXXXXX`, segnalato in
ogni file con il commento `SOSTITUISCI CON IL TUO ID`.

Per attivarli:

1. Crea un account su <https://www.google.com/adsense> e fatti approvare il sito
   (serve un dominio pubblico raggiungibile — l'URL del deploy va bene).
2. Copia il tuo **Publisher ID**, nel formato `ca-pub-1234567890123456`.
3. Sostituisci **tutte** le occorrenze di `ca-pub-XXXXXXXXXXXXXXXX` con il tuo ID.
   Da riga di comando, dentro `salagiochi/`:

   ```bash
   grep -rl 'ca-pub-XXXXXXXXXXXXXXXX' . | xargs sed -i 's/ca-pub-XXXXXXXXXXXXXXXX/ca-pub-1234567890123456/g'
   ```

4. In AdSense crea le **unità annuncio** (una per slot) e sostituisci i
   `data-ad-slot` placeholder (`1111111111`, `2222222222`) con gli ID reali
   delle tue unità.
5. Ridistribuisci il sito. Gli annunci compaiono solo su dominio approvato:
   in locale gli slot restano vuoti (è normale).

## 🚀 Deploy

Sito 100% statico: si pubblica su qualsiasi hosting statico.

- **Vercel**: `vercel --prod` dalla cartella `salagiochi/` (config in `vercel.json`).
- **Netlify**: trascina la cartella su <https://app.netlify.com/drop> oppure
  `netlify deploy --prod --dir=salagiochi`.

---

Fatto con ❤ e tanti pixel.
