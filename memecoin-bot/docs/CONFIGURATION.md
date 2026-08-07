# Configuration

Every field, type and default is in the generated
[configuration reference](reference/configuration.md). This document covers how
configuration resolves, what is worth tuning, and which settings will hurt you.

## How configuration resolves

```
defaults → mode preset → config.json → environment → CLI flags
```

Later sources win. Arrays **replace** rather than merge: setting
`enabledChains: ["solana"]` means *only* Solana, not "Solana plus the defaults".

- **`config.json`** in the working directory (or `--config <path>`) carries the
  bulk of the tuning.
- **Environment variables** override it, because that is what orchestrators and
  CI can set. See `.env.example` for the supported subset.
- **CLI flags** (`--mode`, `--chains`, `--capital`, `--min-score`, `--log`,
  `--no-api`) override everything.

Mode presets apply before the file, so you can still relax a preset deliberately.
`live` tightens the score threshold and rug-probability ceiling; `backtest`
disables discovery and the API and switches to in-memory storage.

Run `npm run doctor` to see the resolved result and its provenance.

---

## Validation

Two layers. The schema checks types and ranges per field. A second pass checks
invariants a per-field schema cannot express — the ones that would otherwise be
discovered with capital at risk:

- take-profit fractions summing past 100%, or non-increasing triggers;
- a daily drawdown limit at or above the total limit;
- live mode without credentials, a keystore passphrase, or durable storage;
- live mode pointed at the paper venue;
- a dashboard on a non-loopback interface with no token;
- a chain enabled with no RPC endpoint.

Errors block startup. Warnings are printed once and the bot continues — a single
RPC endpoint per chain, a score threshold below 80, a break-even trigger that is
redundant against the trailing stop.

---

## The settings that matter

### Risk — start here

```jsonc
{
  "risk": {
    "baseCapital": 10000,
    "riskPerTradePct": 0.5,        // hard ceiling on loss per trade
    "maxConcurrentPositions": 5,
    "kellyFraction": 0.25,         // fractional Kelly damping
    "kellyCap": 0.1,               // hard cap on position % of equity
    "maxConsecutiveStops": 3,      // circuit breaker
    "maxDailyDrawdownPct": 5,      // circuit breaker
    "maxTotalDrawdownPct": 20,
    "maxEquityVolatility": 0.08,   // circuit breaker
    "haltCooldownMs": 3600000,
    "maxExposurePerChainPct": 0.5,
    "maxDailyTrades": 60
  }
}
```

`riskPerTradePct` is the number to think hardest about. It combines with the
stop distance to determine size: a 0.5% budget and a 25% stop produces a
position of 2% of equity. Raising it raises *every* position proportionally.

`kellyFraction` above 0.5 is aggressive for model-estimated edges — the sizer
warns above that. Full Kelly on an overstated win rate is a losing strategy, not
an aggressive one.

### Scoring

```jsonc
{
  "scoring": {
    "minScore": 80,
    "maxRugProbability": 0.2,
    "minPumpProbability": 0.35,
    "maxDumpProbability": 0.55,
    "minConfidence": 0.6,
    "weights": {
      "security": 1.6, "momentum": 1.2, "whales": 1.1,
      "liquidity": 1.0, "holders": 1.0, "developer": 0.9, "community": 0.6
    }
  }
}
```

Weights are relative — they are normalized internally, so only their ratios
matter. Security carries the most because contract risk is the one category
where being wrong costs the whole position rather than part of it. Community
carries the least because follower counts are the easiest thing in crypto to
fake.

Lowering `minScore` below 80 admits materially riskier tokens and is warned
about. `minConfidence` is the guard against trading on absent data.

### Entry conditions

Every `require*` flag is a hard gate, ANDed together. Turning one off does not
soften the entry — it removes the condition entirely.

```jsonc
{
  "entry": {
    "requireVolumeGrowth": true,
    "requireHolderGrowth": true,
    "requireSmartMoney": true,
    "requireWhaleBuying": true,
    "requirePositiveMomentum": true,
    "minVolumeGrowth5m": 0.25,
    "minHolderGrowth5m": 0.05,
    "minSmartWalletsBuying": 2,
    "minWhaleNetFlowUsd": 5000,
    "maxTop10HolderPct": 0.35,
    "maxBundledPct": 0.15,
    "maxSlippageBps": 300,
    "maxPoolImpactPct": 0.02
  }
}
```

`maxPoolImpactPct` caps a position at 2% of pool liquidity. It is a liquidity
constraint, not a preference: a position that cannot be exited without moving
the market more than the stop distance is not really a position of that size.

### Exits

```jsonc
{
  "exit": {
    "stopLossPct": 25,
    "useDynamicStop": true,
    "atrStopMultiplier": 2.5,
    "breakEvenTriggerPct": 20,
    "trailingActivationPct": 35,
    "trailingDistancePct": 18,
    "finalTrailingDistancePct": 30,
    "timeStopMs": 14400000,
    "takeProfitLevels": [
      { "triggerMultiple": 1.5, "sellFraction": 0.25 },
      { "triggerMultiple": 2.0, "sellFraction": 0.25 },
      { "triggerMultiple": 3.0, "sellFraction": 0.25 },
      { "triggerMultiple": 5.0, "sellFraction": 0.25 }
    ]
  }
}
```

`sellFraction` is a fraction of the **original** position, so the ladder does not
decay into dust. With `useDynamicStop`, `stopLossPct` becomes a ceiling and the
actual stop scales with realized volatility — a fixed 25% is far too tight for a
token realizing 15% per bar and far too wide for one realizing 2%.

The fractions need not sum to 1. Whatever remains rides the final trailing stop,
which is where the right tail of the distribution actually pays.

### Chains

```jsonc
{
  "enabledChains": ["solana", "base", "bsc"],
  "chains": {
    "solana": {
      "rpcUrls": ["https://primary...", "https://backup..."],
      "maxRps": 40,
      "gasMultiplier": 1.5,
      "maxPriorityFee": 3000000,   // micro-lamports per compute unit
      "maxGasUsdPerTx": 1.5
    }
  }
}
```

Configure **at least two endpoints per chain**. With one, failover is
unavailable and a single degraded provider stops trading on that chain. Paid
endpoints matter more on Solana than anywhere else.

`maxPriorityFee` units differ by family: micro-lamports per compute unit on
Solana, gwei on EVM.

### Copy trading

```jsonc
{
  "copyTrading": {
    "enabled": false,
    "minWinRate": 0.7,
    "minTrades": 300,
    "minRoi": 0.5,
    "minPnlUsd": 50000,
    "minWalletAgeDays": 90,
    "maxRugRate": 0.1,
    "sizeMultiplier": 0.5,
    "maxSignalAgeMs": 20000,
    "minTokenScore": 65
  }
}
```

Every criterion is ANDed. Win rate alone is trivially gamed by a wallet taking
many tiny wins and one enormous loss, which is why ROI, absolute PnL, sample
size and age all apply — and why a high rug rate disqualifies outright, since
that pattern is an insider rather than a trader.

`maxSignalAgeMs` is the difference between following a wallet and providing its
exit liquidity.

### Dashboard

```jsonc
{
  "api": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 8080,
    "token": "",
    "corsOrigins": []
  }
}
```

The control endpoints include "close every position". Binding beyond loopback
without a token is refused at startup — this is a control plane, not a status
page.

---

## Per-environment configuration

```bash
npx tsx src/cli.ts run --config ./config/production.json
```

A workable pattern: keep a committed `config.base.json`, layer a per-environment
file on top, and pass secrets through the environment only. Nothing secret
belongs in a config file — the loader reads `AXIOM_API_KEY`, `AXIOM_API_SECRET`,
`KEYSTORE_PASSPHRASE` and `API_TOKEN` from the environment precisely so they do
not have to.
