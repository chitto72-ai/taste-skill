# Usage

## Commands

```
memecoin-bot <command> [options]

  run                 Start the trading engine and the dashboard
  scan                Run discovery passes and print the candidates
  backtest            Replay historical data through the full strategy stack
  optimize            Grid search + walk-forward validation
  generate-data       Write a synthetic dataset for the backtester
  report              Print performance from the stored trade history
  doctor              Validate configuration and report anything suspect
  wallet:import       Seal a private key into the encrypted keystore
  wallet:list         List keystore entries
  help                Show usage
```

Common options: `--mode`, `--chains`, `--capital`, `--min-score`, `--config`,
`--log`, `--no-api`.

---

### `run`

```bash
npm run dev                                  # paper, with dashboard
npx tsx src/cli.ts run --log debug
npx tsx src/cli.ts run --mode live --chains solana,base
node dist/cli.js run                         # production, after npm run build
```

Starts every service in dependency order, restores any positions left open by a
previous session, and begins both loops. `SIGINT`/`SIGTERM` shut down cleanly:
the API stops accepting requests, a final exit pass runs, services stop in
reverse order, and the database is flushed.

**Restart safety.** Open positions are persisted with a full snapshot, so a
restart resumes managing them — trailing state, executed take-profit levels and
all. It does not re-enter anything.

---

### `scan`

```bash
npx tsx src/cli.ts scan --passes 5
```

Runs discovery without trading and prints what cleared the threshold:

```
Discovery — 5 scans, 47 candidates, 31 filtered, 3 accepted
SYMBOL      CHAIN     SCORE  RUG   PUMP  DUMP  CONF   LIQUIDITY   MCAP        HOLDERS
BONKMOG     solana       84    3%   56%    2%  100%     $184,203   $1,204,000  912
```

The fastest way to answer "why is it not trading?". Zero accepted with many
filtered means the pre-filters are doing their job; zero accepted with many
scored means the threshold or a veto is binding.

---

### `backtest`

```bash
# Against a generated dataset — validates the machinery
npx tsx src/cli.ts backtest --generate --tokens 40 --bars 240 --seed 42

# Against your own exported data
npx tsx src/cli.ts backtest --data ./data/historical
```

Prints performance, an equity curve summary and an ASCII sparkline, plus
attribution by strategy, chain, exit reason and entry-score bucket. The
score-bucket table is the one to watch: it tells you whether the threshold is in
the right place.

Latency, price impact and costs are all modelled — see
[ARCHITECTURE.md](ARCHITECTURE.md#backtesting).

> Results on generated data say nothing about edge. The CLI prints that warning
> itself when `--generate` is used.

#### Data format

One JSON file per token in `--data`:

```jsonc
{
  "chain": "solana",
  "address": "So1...",
  "metadata": { "symbol": "TOKEN", "decimals": 9, "createdAt": 1735689600000, "totalSupply": 1000000000 },
  "pool": { "address": "pool...", "dex": "raydium", "createdAt": 1735689600000, "lpLockedPct": 1 },
  "security": { "mintAuthorityRevoked": true, "freezeAuthorityRevoked": true, "isHoneypot": false },
  "developer": { "wallet": "Dev...", "walletAgeDays": 200, "tokensLaunched": 2, "ruggedTokens": 0 },
  "bars": [
    { "t": 1735689600000, "priceUsd": 0.0001, "liquidityUsd": 80000, "marketCapUsd": 100000,
      "volume5mUsd": 25000, "volume1hUsd": 250000, "buys5m": 40, "sells5m": 15, "holders": 300 }
  ]
}
```

Missing fields get conservative defaults, and anything absent scores as imputed
— exactly as it would live.

---

### `optimize`

```bash
npx tsx src/cli.ts optimize --data ./data/historical --folds 3
```

Grid search inside each window, evaluation on the window that follows. Only the
out-of-sample numbers are reported.

The default objective rewards profit factor, expectancy and Sortino while
penalising drawdown, and discards runs below a minimum trade count. Optimising
raw PnL over a grid reliably selects whichever parameter set got luckiest on the
single biggest winner.

**In-sample parameters that do not survive the out-of-sample fold are noise.**

---

### `report`

```bash
npx tsx src/cli.ts report
```

Performance from the stored trade history, with the same attribution breakdowns
as the backtester. Reads the configured database, so point `--config` at the
environment you want to inspect.

---

### `doctor`

```bash
npx tsx src/cli.ts doctor
```

Prints the resolved configuration and its provenance, then every error and
warning. Exits non-zero on an error, so it works as a deploy gate:

```bash
npx tsx src/cli.ts doctor --config ./config/production.json && systemctl restart memecoin-bot
```

---

## The dashboard

<http://127.0.0.1:8080> (append `?token=…` if `API_TOKEN` is set).

Top row: equity, net PnL, win rate, profit factor, open positions, drawdown.
Below: equity curve, live risk state, open positions with per-position stop and
take-profit progress, trade history, a live event feed, the top-scoring
candidates the scanner is tracking, the wallet monitor, and a log tail.

Controls: **Halt** (blocks new entries, leaves exits running), **Resume**,
**Close all**, and a per-position close.

### API

| Endpoint | Returns |
| --- | --- |
| `GET /health` | Component health. Unauthenticated, suitable for a load balancer. |
| `GET /api/status` | Engine, risk and discovery state. |
| `GET /api/performance` | Full metrics, attribution and equity curve. |
| `GET /api/equity?since=` | Sampled equity curve with statistics. |
| `GET /api/positions` | Open positions with stop and ladder state. |
| `GET /api/trades?limit=&strategy=&chain=` | Closed trades. |
| `GET /api/tokens`, `/api/tokens/:chain/:address` | Scored tokens; the second includes the full profile. |
| `GET /api/candidates` | Tokens currently above the threshold. |
| `GET /api/wallets` | Tracked wallets and copy eligibility. |
| `GET /api/risk` | Risk state and configured limits. |
| `GET /api/logs`, `/api/errors` | Recent logs and error summary. |
| `GET /api/infrastructure` | Per-chain RPC health, event-bus stats. |
| `POST /api/control/halt`, `/resume`, `/close-all`, `/close/:id` | Controls. |
| `WS /ws` | Live events plus a periodic snapshot. |

All `/api/*` routes require `Authorization: Bearer <API_TOKEN>` when a token is
configured.

```bash
curl -s -H "Authorization: Bearer $API_TOKEN" localhost:8080/api/status | jq '.risk'
```

---

## Before you risk real money

1. **Run paper mode for days, not minutes.** Watch a stop fire. Watch the
   take-profit ladder execute. Watch a circuit breaker trip. If you have not
   seen those in paper, you do not know what they will do live.
2. **Backtest on real exported data**, not the generated set, and look at the
   score-bucket attribution before touching `minScore`.
3. **Fund the hot wallet with what you can lose.** Set `maxHotWalletUsd`.
4. **Configure two RPC endpoints per chain.** One is a single point of failure
   for exits.
5. **Set `API_TOKEN`** if the dashboard is reachable from anywhere but localhost.
6. **Start below your intended size.** `--capital` is the honest way to scale in.

## Operating notes

- **Drawdown halts are time-boxed.** After `haltCooldownMs` the bot resumes with
  a clean stop streak but keeps its drawdown history, so a second breach halts
  again immediately. Resume early from the dashboard if you disagree.
- **Exits are never blocked by risk state.** If exits stop happening, the
  problem is the venue or RPC, not the risk manager — check
  `/api/infrastructure`.
- **`EXIT FAILED` in the logs is the line to alert on.** It means a sell was
  rejected and the position is still open. The bot retries on the next tick,
  but repeated occurrences mean the token cannot be sold.
- **Retention runs hourly.** Metrics and logs age out fastest; trades and daily
  performance are the audit trail and are kept longest.
- **Logs redact secrets, not trading data.** A field named `token` is a tradable
  asset and is logged; keys, secrets and auth tokens are scrubbed by name and by
  shape.
