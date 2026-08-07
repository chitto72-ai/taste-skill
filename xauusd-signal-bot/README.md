# XAUUSD Signal Bot

Bot di analisi e segnali per **XAUUSD (oro/dollaro)** pensato per conti con leva
**100x–250x**. Scarica i dati, analizza il mercato su due timeframe, calcola
entry/stop/target, **dimensiona la posizione in modo che la leva non possa
liquidarti prima dello stop** e invia il segnale su console, file, Telegram o
webhook.

> **Il bot non invia ordini e non si collega al tuo conto.** Produce segnali che
> resti tu a valutare ed eseguire. Non è consulenza finanziaria.

---

## La cosa importante sulla leva

Con leva 100x–250x il rischio **non** dipende dal moltiplicatore. Dipende da
**quanto grande è la posizione** e **quanto è distante lo stop**. La leva
determina solo il margine bloccato — e, di riflesso, quanto margine libero ti
resta prima dello stop-out del broker.

```
$ python3 -m bot levels --entry 4400 --stop 12 --balance 5000 --risk-pct 1

  leva   lotti    margine  %conto  rischio%  dist.liq  liq/stop  stato
----------------------------------------------------------------------
  100x    0.04     176.00    3.5%     0.96%   1228.00   102.33x  ok
  150x    0.04     117.33    2.3%     0.96%   1235.33   102.94x  ok
  200x    0.04      88.00    1.8%     0.96%   1239.00   103.25x  ok
  250x    0.04      70.40    1.4%     0.96%   1241.20   103.43x  ok
```

Stessa size, stesso rischio in dollari a tutte le leve: cambia solo il margine.
Anzi, **più leva = più margine libero = liquidazione più lontana**. Ciò che
azzera il conto è aprire 2 lotti invece di 0.04, non il numero sul contratto.

Il bot lavora esattamente in questo ordine:

1. **size dal rischio**: `once = (capitale × risk%) / distanza_stop`;
2. **taglio per il tetto di margine** (`max_margin_pct`, default 30% del conto);
3. **taglio per il buffer di liquidazione**: la liquidazione deve restare almeno
   `liquidation_buffer` volte più lontana dello stop (default 2x);
4. arrotondamento al passo di lotto e **rifiuto del segnale** se il lotto minimo
   del broker sfonderebbe comunque il budget di rischio.

Il punto 4 è quello che sorprende chi apre un conto piccolo: su XAUUSD 0.01
lotti = 1 oncia = **1 USD per ogni dollaro di movimento**. Con uno stop tipico
da 10–15$, il lotto minimo rischia 10–15$ a trade. Su un conto da 300$ è il
3–5% per operazione: il bot in quel caso scrive `⛔ SEGNALE NON OPERATIVO` e
spiega perché, invece di farti passare per un rischio che non hai scelto.

---

## Installazione

```bash
cd xauusd-signal-bot
pip install -r requirements.txt
python3 -m bot selftest          # verifica end-to-end offline, senza rete
```

Serve Python 3.10+. Le uniche dipendenze sono `pandas`, `numpy` e `PyYAML`
(quest'ultima solo se usi un file di configurazione).

## Avvio rapido

```bash
# Segnale sull'ultima barra chiusa, dati reali da Yahoo Finance
python3 -m bot signal

# Con i tuoi parametri di conto
python3 -m bot signal --balance 5000 --leverage 200 --risk-pct 1

# Bot in continuo (controlla ogni 60s, notifica a ogni nuova barra utile)
python3 -m bot run -c config.yaml

# Backtest sugli ultimi ~2 mesi di barre 15m
python3 -m bot backtest --bars 2500

# Confronto delle leve sullo stesso setup
python3 -m bot levels --entry 4400 --stop 12
```

Formato del segnale (conto 5.000$, leva 200x, rischio 1%):

```
🟢 LONG  XAUUSD  [15m]  breakout di canale
Barra: 2026-08-06 09:45 UTC   Confidenza: 78/100

  Entry: 4,412.08
  SL:    4,398.04   (14.04$ = 42.12 USD = 0.84% del conto)
  TP1: 4,426.12   (+1.0R  →  +42.12 USD)
  TP2: 4,440.16   (+2.0R  →  +84.24 USD)
  TP3: 4,454.20   (+3.0R  →  +126.36 USD)

  Size: 0.03 lotti (3 oz)   1$ di movimento = 3.00 USD
  Leva 200x → margine 66.18 USD (1.3% del conto), esposizione 13,236 USD
  Liquidazione stimata: 2,756.44 (1,655.64$ = 117.9x lo stop)
  Costi stimati (spread+commissioni): 0.90 USD

Motivazioni:
  ... (elenco delle condizioni soddisfatte e non)
```

Il rischio effettivo è 0.84% invece dell'1% perché la size viene sempre
arrotondata **per difetto** al passo di lotto: il budget di rischio è un
tetto, mai un obiettivo da raggiungere.

## Comandi

| Comando | Cosa fa |
|---|---|
| `signal` | analizza l'ultima barra chiusa e mostra il segnale (`--json` per output strutturato, `--no-notify` per non inviarlo ai canali) |
| `run` | ciclo continuo con stato persistente, cooldown e limite giornaliero |
| `backtest` | esegue la strategia su storico con la stessa logica di size del live |
| `levels` | tabella comparativa delle leve 100x/150x/200x/250x su un setup dato |
| `selftest` | verifica l'intera pipeline su dati sintetici, senza rete |

Opzioni comuni: `--provider`, `--csv`, `--symbol`, `--timeframe`,
`--trend-timeframe`, `--bars`, `--balance`, `--leverage`, `--risk-pct`,
`--no-session-filter`, `--quiet`.

## La strategia

Continuazione di trend multi-timeframe. Niente magia: è una base solida e
leggibile, da tarare sui propri dati.

**1. Bias (H1)** — struttura EMA 50/200, posizione del prezzo, istogramma MACD,
DI direzionali e pendenza della EMA media. Se l'H1 non ha una direzione
dominante o l'ADX è sotto `adx_min`, non si opera.

**2. Trigger (M15)**, solo nella direzione del bias:
- *pullback in trend*: ritorno sulla EMA 20, candela di ripartenza che rompe
  l'estremo della barra precedente, RSI in zona di continuazione;
- *breakout di canale*: chiusura oltre il canale di Donchian a 20 periodi
  (calcolato sulle barre precedenti) con corpo ≥ 0.35 ATR.

**3. Punteggio e livelli** — otto condizioni pesate producono una confidenza
0–100; sotto `min_confidence` il setup viene scartato. Lo stop è il più lontano
tra `1.5 × ATR` e lo swing di struttura più un cuscinetto; i target sono a 1R,
2R e 3R.

**Filtri**: sessione operativa (default 07:00–16:00 UTC, Londra + apertura New
York), banda di volatilità ATR, cooldown fra segnali, tetto giornaliero.

Tutti i calcoli usano **solo barre chiuse**: la barra in formazione viene
scartata, e la suite di test verifica esplicitamente l'assenza di look-ahead.

## Risultati onesti del backtest

Sugli ultimi ~2 mesi di barre 15m reali (Yahoo, oro a ~4.100–4.400$), conto
2.000$, rischio 1%, spread 0.30$:

```
trades 14 | win rate 35.7% | avg R -0.09 | profit factor 0.77 | return -1.84%
```

**In perdita.** Non è un errore di implementazione: è il risultato reale di una
strategia di continuazione standard su quel campione. Va letto così:

- 14 trade sono un campione troppo piccolo per concludere alcunché;
- il backtest a barre ignora slippage, requote e allargamenti dello spread sulle
  news — nella realtà il risultato sarebbe peggiore, non migliore;
- serve per **scartare** configurazioni pessime, non per stimare un profitto.

Prima di usarlo con denaro reale: tara i parametri sul tuo storico, verifica su
demo per settimane, e considera che la maggior parte delle configurazioni non
supera i costi di transazione.

## Configurazione

Copia `config.example.yaml` in `config.yaml` e passalo con `-c config.yaml`.
Ogni chiave è commentata. I parametri che contano di più:

| Chiave | Default | Note |
|---|---|---|
| `risk.risk_pct` | 1.0 | % del conto per trade. Sopra 1–2% con questa leva la sequenza di perdite normale diventa fatale |
| `risk.leverage` | 100 | deve stare fra `min_leverage` e `max_leverage` (100–250), altrimenti la configurazione viene rifiutata |
| `risk.liquidation_buffer` | 2.0 | quante volte la liquidazione deve essere più lontana dello stop |
| `risk.max_margin_pct` | 30 | margine massimo impegnabile |
| `risk.stop_out_level_pct` | 50 | livello di stop-out del **tuo** broker: verificalo, cambia il calcolo della liquidazione |
| `risk.spread_usd` | 0.30 | spread reale del tuo broker sull'oro |
| `strategy.min_confidence` | 55 | alzalo a 65–70 per meno segnali ma più selettivi |

Fonti dati: `yahoo` (gratis, nessuna chiave), `twelvedata` (chiave gratuita in
`MARKET_DATA_API_KEY`), `csv` (tuo storico esportato da MT4/MT5), `synthetic`
(offline, per test).

## Telegram

```bash
export TELEGRAM_BOT_TOKEN="123456:ABC..."   # token da @BotFather
export TELEGRAM_CHAT_ID="123456789"         # il tuo chat id
```

poi in `config.yaml`: `notifier.telegram_enabled: true`. Token e chat id
vengono letti **solo** dall'ambiente, non finiscono mai nel file di
configurazione né nel repository.

## Esecuzione continua

```bash
# in background con log su file
nohup python3 -m bot run -c config.yaml >> bot.log 2>&1 &

# oppure una scansione ogni 15 minuti via cron
*/15 * * * * cd /percorso/xauusd-signal-bot && python3 -m bot signal -c config.yaml --quiet
```

Lo stato (ultima barra, cooldown, conteggio giornaliero) è in `.bot_state.json`:
il bot riparte senza duplicare i segnali già inviati.

## Test

```bash
python3 -m pytest        # 75 test: indicatori, rischio/leva, strategia, dati, engine, backtest
```

## Struttura

```
bot/
  config.py      configurazione tipizzata e validata (leva fuori range = errore)
  data.py        provider Yahoo / TwelveData / CSV / sintetico, resample, barre chiuse
  indicators.py  EMA, RSI, ATR, MACD, ADX, Bollinger, Donchian, swing
  strategy.py    bias H1 + trigger M15, punteggio di confidenza, entry/SL/TP
  risk.py        sizing, margine, distanza di liquidazione, veti di rischio
  notifier.py    console, JSONL, Telegram, webhook
  engine.py      ciclo, stato, dedup, cooldown, backoff sugli errori
  backtest.py    simulazione event-driven con uscite parziali e costi
  cli.py         interfaccia a riga di comando
```

## Limiti noti

- I dati Yahoo su XAUUSD sono spot indicativi: **non** coincidono con i prezzi
  del tuo broker (spread e sessioni diversi). Per il backtest serio esporta lo
  storico dal tuo MT4/MT5 e usa `--csv`.
- Nessun filtro sulle news macro (NFP, CPI, FOMC): sono i momenti in cui l'oro
  fa gap e lo stop può essere eseguito molto peggio del previsto. Con leva alta
  è il rischio principale che questo bot **non** copre.
- Il calcolo della liquidazione assume una sola posizione aperta e il modello di
  stop-out del broker configurato: verifica le regole del tuo.
- La strategia è una base didattica, non un sistema validato: i numeri del
  backtest qui sopra lo dicono chiaramente.

## Avvertenza

Il trading su XAUUSD con leva 100x–250x è ad altissimo rischio: un movimento
avverso dell'1% su una posizione dimensionata male azzera un conto piccolo in
pochi minuti, e l'oro fa spesso l'1% in un'ora. La maggior parte dei conti
retail con leva alta perde denaro. Usa prima un conto demo, non rischiare
capitale che non puoi permetterti di perdere, e ricorda che questo software
fornisce informazioni, non raccomandazioni di investimento.
