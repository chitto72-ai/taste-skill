# Examples

Every snippet below is written against the same interfaces the bot itself uses,
so they compile against the exported API in `src/index.ts`.

---

## Embed the bot in another process

```ts
import { buildApplication, loadConfig } from '@quant/memecoin-bot';

const { config } = loadConfig({ overrides: { mode: 'paper', api: { enabled: false } } });
const app = await buildApplication(config);

app.events.on('position.opened', ({ position }) => {
  console.log(`opened ${position.symbol} for $${position.costBasis.toFixed(0)}`);
});

app.events.on('position.closed', ({ trade }) => {
  console.log(`closed ${trade.symbol}: $${trade.pnl.toFixed(2)} (${trade.closeReason})`);
});

await app.engine.start();

process.on('SIGINT', async () => {
  await app.engine.stop('SIGINT');
  await app.dispose();
  process.exit(0);
});
```

`app` exposes the engine, scanner, risk manager, position manager, router,
analytics, database and event bus — enough to build your own control surface
without touching internals.

---

## React to signals without modifying the bot

The event bus is the supported extension point. Nothing here requires changing a
line of the trading logic.

```ts
app.events.on('token.scored', async ({ profile, score }) => {
  if (score.total < 90) return;
  await notifySlack(
    `${profile.metadata.symbol} scored ${score.total} on ${profile.ref.chain} · ` +
      `rug ${(score.probabilities.rug * 100).toFixed(0)}% · ` +
      `liquidity $${Math.round(profile.market.liquidityUsd).toLocaleString()}`,
  );
});

app.events.on('risk.halted', ({ reason, until }) => {
  pageOnCall(`Trading halted: ${reason}. Resumes ${new Date(until).toISOString()}`);
});

// The line worth alerting on: an exit that did not fill.
app.events.on('order.rejected', ({ order, result }) => {
  if (order.side === 'sell') pageOnCall(`EXIT REJECTED ${order.token.address}: ${result.error}`);
});
```

---

## Add a scoring metric

A metric normalizes one raw measurement to `0..1`, where 1 is favourable.
Declaring `requires` is what lets the scorer mark it imputed rather than invent a
value when the data is missing.

```ts
// src/scoring/metrics/custom.ts
import { defineMetric } from '../metric-definition.js';
import { clamp01, lerp, safeDiv } from '../../core/utils/math.js';

export const VOLUME_PER_HOLDER = defineMetric({
  id: 'mom.volume_per_holder',
  group: 'momentum',
  label: '5m volume per holder',
  weight: 1.2,
  requires: ['holders.count'],
  compute: ({ profile }) => {
    const raw = safeDiv(profile.market.volume5mUsd, Math.max(1, profile.holders.count));
    // $20/holder is healthy participation; $500/holder is a handful of wallets
    // churning, which reads as volume but is not demand.
    const normalized = raw <= 200 ? clamp01(lerp(raw, 5, 0, 200, 1)) : clamp01(lerp(raw, 200, 1, 800, 0.2));
    return { raw, normalized };
  },
});
```

Register it in `src/scoring/metrics/index.ts`, then `npm run docs` to add it to
the catalogue. `assertUniqueMetricIds()` fails at startup on a duplicate id.

---

## Write a strategy

Strategies are pure — no I/O, no orders. They return an evaluation and the engine
decides. That is what makes them backtestable without stubbing a venue.

```ts
import { BaseStrategy } from '@quant/memecoin-bot';
import type { EntryCondition, StrategyContext, TokenProfile, TokenScore } from '@quant/memecoin-bot';

export class DipBuyerStrategy extends BaseStrategy {
  readonly name = 'dip-buyer';
  override readonly priority = 3;

  constructor() {
    super(true);
  }

  protected conditions(profile: TokenProfile, score: TokenScore, ctx: StrategyContext): EntryCondition[] {
    const prices = profile.priceHistory.map((p) => p.priceUsd);
    const high = Math.max(...prices);
    const drawdown = (high - profile.market.priceUsd) / high;

    return [
      this.condition('score', 'Quality bar', score.total >= 82, `score ${score.total}`),
      this.condition('clean', 'No vetoes', score.vetoes.length === 0, score.vetoes.join('; ') || 'clean'),
      this.condition('dip', 'Meaningful pullback', drawdown > 0.2 && drawdown < 0.45, `${(drawdown * 100).toFixed(0)}% off the high`),
      this.condition('holders', 'Holders still growing', profile.holders.growth5m > 0, `${(profile.holders.growth5m * 100).toFixed(1)}%/5m`),
      this.condition('smart', 'Smart money accumulating', profile.smartMoney.smartNetFlowUsd5m > 0, `net $${Math.round(profile.smartMoney.smartNetFlowUsd5m)}`),
      this.condition('capital', 'Capital available', ctx.availableCapital > 0, `$${ctx.availableCapital.toFixed(0)}`),
    ];
  }

  protected conviction(_profile: TokenProfile, score: TokenScore): number {
    return Math.min(0.75, 0.3 + score.probabilities.pump * 0.6);
  }

  protected expectations() {
    // Conservative win rate: Kelly punishes optimism far harder than pessimism.
    return { winRate: 0.3, payoffRatio: 3, stopPct: 0.2, maxHoldMs: 2 * 60 * 60_000 };
  }
}
```

Register it in the `StrategyRegistry` in `src/composition-root.ts`. The registry
consults strategies in priority order and takes the first pass — strategies are
never blended, because two strategies liking the same token would otherwise open
two positions in one asset.

---

## Add a data source

```ts
import type { MarketSnapshot, TokenRef } from '@quant/memecoin-bot';
import type { TokenCandidate, TokenFeed } from '@quant/memecoin-bot';

export class MyIndexerFeed implements TokenFeed {
  readonly name = 'my-indexer';
  readonly chains = ['solana'] as const;
  private since = Date.now();

  async poll(): Promise<TokenCandidate[]> {
    const response = await fetch(`https://indexer.example/new?since=${this.since}`);
    this.since = Date.now();
    const payload = (await response.json()) as MyPayload[];
    return payload.map(toCandidate);
  }

  async refresh(_refs: readonly TokenRef[]): Promise<Map<string, MarketSnapshot>> {
    return new Map();
  }
}
```

Add it to the `feeds` array in the composition root. Multiple feeds are polled in
parallel and de-duplicated by token, keeping the freshest observation — and a
feed that throws is logged and skipped rather than stopping the scan.

---

## Add an enrichment stage

```ts
import type { Enricher, EnrichmentResult, TokenCandidate } from '@quant/memecoin-bot';

export class HoneypotSimulationEnricher implements Enricher {
  readonly name = 'honeypot-sim';
  readonly slice = 'security' as const;

  async enrich(candidate: TokenCandidate): Promise<EnrichmentResult> {
    try {
      const result = await simulateBuyThenSell(candidate.ref);
      return {
        security: { isHoneypot: !result.canSell, sellTaxPct: result.sellTaxPct },
        missing: [],
      };
    } catch {
      // Report the gap instead of guessing: the scorer lowers confidence and
      // the entry gate stays honest about what it does not know.
      return { missing: ['security.isHoneypot', 'security.sellTaxPct'] };
    }
  }
}
```

Stages run in parallel with individual timeouts. Returning `missing` is always
better than returning a fabricated value.

---

## Run a programmatic backtest

```ts
import { BacktestEngine, HistoricalDataLoader, loadConfig, formatMetrics, createLogger } from '@quant/memecoin-bot';

const logger = createLogger({ level: 'info' });
const { config } = loadConfig({ overrides: { mode: 'backtest' } });
const dataset = await new HistoricalDataLoader('./data/historical', logger).load();

const result = await new BacktestEngine(config, { slippageBps: 120, feeBps: 100 }, logger).run(dataset);

console.log(formatMetrics(result.metrics, 'My backtest'));
console.log(`${result.entriesTaken} entries from ${result.signalsGenerated} signals`);
console.log('Blocked:', result.entriesRejected);
```

---

## Sweep parameters honestly

```ts
import { StrategyOptimizer } from '@quant/memecoin-bot';

const optimizer = new StrategyOptimizer({
  logger,
  grid: {
    'scoring.minScore': [78, 82, 86],
    'risk.kellyFraction': [0.15, 0.25],
    'exit.trailingDistancePct': [15, 20, 25],
  },
  minTrades: 30,
});

const { folds, aggregate } = await optimizer.walkForward(config, dataset, 4);
console.log(`Out-of-sample: ${aggregate.trades} trades, PF ${aggregate.profitFactor.toFixed(2)}`);
for (const fold of folds) {
  console.log(fold.train.parameters, '→ OOS PnL', fold.test.metrics.netPnl.toFixed(2));
}
```

Read the aggregate, not the best fold. A parameter set that wins in-sample and
loses out-of-sample has told you something useful — that it was noise.

---

## Refit the probability models

The models are hand-calibrated so they can be reasoned about. Once you have a
few hundred real trades, refit them against your own logs:

```ts
import { explain } from '@quant/memecoin-bot';

// Every scored token stores its metrics, so features can be replayed offline.
const rows = await app.database.metrics.find({ where: [{ field: 'ts', op: 'gte', value: since }] });
const terms = explain(profile, score.sub); // per-term contributions, normalized

// Join `terms` against the outcome of each trade to fit new coefficients, then
// edit src/scoring/probabilities.ts. Keep the model linear — an operator has to
// be able to understand it at 3am.
```

---

## Custom storage

```ts
import type { StorageDriver } from '@quant/memecoin-bot';

export class PostgresDriver implements StorageDriver {
  readonly name = 'postgres';
  async init() { /* connect, migrate */ }
  async insert(table, row) { /* … */ }
  // …the rest of the interface
}
```

Wire it in `Database.create` or construct `new Database(driver, config, logger)`
directly. Repositories and everything above them are written against the port,
so no other module changes.
