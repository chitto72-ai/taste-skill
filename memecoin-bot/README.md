# Memecoin Trading Bot

A production-grade, multi-chain memecoin trading bot: continuous token discovery,
a 62-metric scoring engine, Kelly-based position sizing under hard risk limits,
staged exits, a full backtester, and a live dashboard.

It runs on Solana and four EVM chains through one chain-agnostic execution path,
and it ships with a simulated venue so the entire system — discovery through
exits — runs end to end with no API keys and no network access.

```bash
npm install
npm run dev            # paper trading + dashboard on http://127.0.0.1:8080
```

---

## What it does

| | |
| --- | --- |
| **Discovery** | Polls new-pair feeds continuously, applies cheap pre-filters, then enriches survivors in parallel (holders, contract security, smart money, socials, developer history). |
| **Scoring** | 62 metrics in 7 groups → sub-scores, a 0–100 composite, and calibrated rug / pump / dump probabilities. Tokens below 80 are ignored. |
| **Entry** | A conjunction of conditions, not a weighted average: score, volume growth, holder growth, smart-money buying, whale flow, liquidity, distribution, no bundle, no blacklist, positive momentum. |
| **Sizing** | Modified Kelly, damped and capped, with a hard ceiling of 0.5% equity risk per trade and 5 concurrent positions. |
| **Exits** | Dynamic stop, break-even, trailing stop, four-step take-profit ladder (25/25/25/25) with a final runner trail, time stop, and emergency exit. |
| **Risk** | Circuit breakers on 3 consecutive stops, 5% daily drawdown, and excess equity volatility. Halts block entries; exits always run. |
| **Copy trading** | Optional. Mirrors only wallets with >70% win rate, >300 trades, positive ROI, real PnL, and age — never a fresh wallet. |
| **Persistence** | Trades, positions, orders, tokens, metrics, wallets, equity, errors and logs. Memory, file or SQLite. |
| **Backtesting** | Replays historical data through the *same* strategy stack, with latency, price impact and costs modelled. Grid search and walk-forward included. |
| **Dashboard** | PnL, win rate, equity curve, open positions, trade history, wallet monitor, risk metrics, live event feed. |

---

## Quick start

```bash
# 1. Install
npm install

# 2. Check your configuration before anything runs
npm run doctor

# 3. Paper trade against the built-in simulated market
npm run dev

# 4. Backtest on a generated dataset
npx tsx src/cli.ts backtest --generate --tokens 40 --bars 240
```

Open <http://127.0.0.1:8080> for the dashboard.

Paper mode needs no keys, no RPC endpoints and no network. It exercises every
code path the live bot uses except signing and broadcasting.

---

## Going live

Live trading requires, in order:

1. **A funded hot wallet, sealed into the keystore.**
   ```bash
   export KEYSTORE_PASSPHRASE='a long passphrase'
   npx tsx src/cli.ts wallet:import --chain solana --label solana-hot
   ```
2. **Venue credentials** (`AXIOM_API_KEY` / `AXIOM_API_SECRET`) and
   `AXIOM_ENABLED=true`.
3. **Real RPC endpoints** — at least two per chain, so failover works.
4. `BOT_MODE=live`.

`npm run doctor` refuses to pass until each of those is in place; live mode also
rejects the paper venue, an in-memory database, and a dashboard bound beyond
loopback without a token.

> Read [docs/USAGE.md](docs/USAGE.md#before-you-risk-real-money) before doing
> this. The defaults are deliberately conservative, and the risk limits are the
> part of this system worth trusting least until you have watched them fire in
> paper mode.

---

## Architecture

```
src/
├── config/        Schema, validation, chain registry, env + file loading
├── core/          Domain types, event bus, DI container, engine, position manager
├── blockchains/   Chain adapters, RPC failover, gas managers, fee optimizer
├── exchanges/     Venue adapters (Axiom, paper), execution router
├── discovery/     Feeds, filters, enrichment pipeline, scanner
├── scoring/       62 metrics, composite scorer, probability models
├── strategies/    Sniper, momentum, copy trading, exit engines
├── risk/          Position sizer, drawdown tracker, risk manager
├── wallets/       Encrypted keystore, signers, smart-money tracker
├── database/      Storage drivers and repositories
├── analytics/     Performance metrics, equity curve, reporting
├── backtesting/   Backtest engine, data loader, optimizer
├── api/           Dashboard server, REST + websocket
└── logger/        Structured logging with secret redaction
```

Every module depends on interfaces only; concrete implementations are chosen in
one place (`src/composition-root.ts`). That is what lets the same engine run
live, paper and backtest configurations without branching on mode.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for diagrams and the reasoning
behind the structure.

---

## Documentation

| Document | Contents |
| --- | --- |
| [Installation](docs/INSTALLATION.md) | Requirements, install, Docker, wallet setup |
| [Configuration](docs/CONFIGURATION.md) | How configuration resolves, what to tune, safety rails |
| [Usage](docs/USAGE.md) | Every CLI command, the dashboard, going live, operating notes |
| [Examples](docs/EXAMPLES.md) | Embedding the bot, custom strategies and metrics, backtests |
| [Architecture](docs/ARCHITECTURE.md) | Module map, data flow, design decisions |
| [Config reference](docs/reference/configuration.md) | Generated: every field, type and default |
| [Metric catalogue](docs/reference/metrics.md) | Generated: all 62 metrics and the probability models |
| [Chain registry](docs/reference/chains.md) | Generated: supported chains |
| [Event catalogue](docs/reference/events.md) | Generated: the inter-module event contract |

Reference docs are generated from the code — run `npm run docs` after changing a
schema, a metric or a chain.

---

## Testing

```bash
npm test              # unit + integration (~17s)
npm run test:stress   # throughput and backpressure
npm run typecheck
npm run lint
```

243 tests across three suites. The integration suite drives the real
composition root end to end in paper mode; the stress suite asserts the system
sheds load rather than growing unbounded.

---

## Scope and honest limitations

- **The Axiom Pro integration is written against a configurable contract.**
  Axiom does not publish a stable public API, so the REST/websocket client,
  auth scheme and payload mapping live behind one adapter
  (`src/exchanges/axiom/`) with endpoints in configuration. Verify the mapping
  against your account before trading; everything else in the system is
  venue-agnostic and fully exercised by the paper venue.
- **The probability models are hand-calibrated, not fitted.** Coefficients are
  chosen for interpretability and are documented; refit them against your own
  trade history once you have a few hundred trades. `explain()` exists for
  exactly that.
- **Backtests on generated data prove the machinery, not the edge.** The
  synthetic dataset validates costs, risk limits and exit logic. Use exported
  market data to evaluate whether a strategy makes money.
- **This software takes financial risk on your behalf.** Memecoin trading loses
  money for most participants. Run it in paper mode until you understand every
  circuit breaker, and never fund a hot wallet with more than you can lose.

## License

MIT
