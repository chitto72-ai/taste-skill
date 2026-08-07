import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BacktestEngine } from '../../src/backtesting/backtest-engine.js';
import { HistoricalDataLoader } from '../../src/backtesting/data-loader.js';
import { generateDataset } from '../../src/backtesting/dataset-generator.js';
import { StrategyOptimizer, expandGrid, applyParameters } from '../../src/backtesting/optimizer.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { deepMerge } from '../../src/config/merge.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { computeMetrics } from '../../src/analytics/performance.js';
import { TradeRepository } from '../../src/database/repositories/trade-repository.js';

const config = deepMerge(createDefaultConfig(), {
  mode: 'backtest',
  enabledChains: ['solana', 'base'],
  logging: { level: 'silent' },
} as never);

const dataset = generateDataset({ tokens: 25, barsPerToken: 180, seed: 20_240_101 });

describe('BacktestEngine', () => {
  it('replays a dataset and produces a coherent result', async () => {
    const result = await new BacktestEngine(config, {}, createNullLogger()).run(dataset);

    expect(result.barsProcessed).toBe(25 * 180);
    expect(result.tokensEvaluated).toBe(25);
    expect(result.from).toBeLessThan(result.to);
    expect(result.startingCapital).toBe(config.backtest.startingCapital);
    // Ending capital must equal starting capital plus realized PnL exactly.
    expect(result.endingCapital).toBeCloseTo(result.startingCapital + result.metrics.netPnl, 6);
  });

  it('is deterministic for the same dataset and configuration', async () => {
    const a = await new BacktestEngine(config, {}, createNullLogger()).run(dataset);
    const b = await new BacktestEngine(config, {}, createNullLogger()).run(dataset);

    expect(b.metrics.trades).toBe(a.metrics.trades);
    expect(b.metrics.netPnl).toBeCloseTo(a.metrics.netPnl, 9);
    expect(b.entriesTaken).toBe(a.entriesTaken);
  });

  it('charges fees and gas on every trade', async () => {
    const result = await new BacktestEngine(config, {}, createNullLogger()).run(dataset);
    if (result.metrics.trades === 0) return;

    expect(result.metrics.fees).toBeGreaterThan(0);
    expect(result.metrics.gas).toBeGreaterThan(0);
    for (const trade of result.trades) {
      expect(trade.gas).toBeGreaterThan(0);
      expect(trade.holdMs).toBeGreaterThan(0);
      expect(trade.entryPrice).toBeGreaterThan(0);
    }
  });

  it('produces worse results as costs rise', async () => {
    const cheap = await new BacktestEngine(config, { slippageBps: 10, feeBps: 10, gasUsdPerTrade: 0.1 }, createNullLogger()).run(dataset);
    const expensive = await new BacktestEngine(config, { slippageBps: 400, feeBps: 200, gasUsdPerTrade: 5 }, createNullLogger()).run(dataset);

    if (cheap.metrics.trades === 0) return;
    expect(expensive.metrics.netPnl).toBeLessThan(cheap.metrics.netPnl);
  });

  it('respects the concurrent position limit throughout the run', async () => {
    const limited = deepMerge(config, { risk: { maxConcurrentPositions: 1 } } as never);
    const result = await new BacktestEngine(limited, {}, createNullLogger()).run(dataset);

    // With one slot, no two trades may overlap in time.
    const sorted = [...result.trades].sort((a, b) => a.openedAt - b.openedAt);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].openedAt).toBeGreaterThanOrEqual(sorted[i - 1].closedAt);
    }
  });

  it('never enters at the price that produced the signal', async () => {
    const result = await new BacktestEngine(config, {}, createNullLogger()).run(dataset);
    // Latency is modelled by filling on the following bar, so an entry price
    // exactly equal to a bar close would indicate the model was bypassed.
    for (const trade of result.trades) {
      const series = dataset.find((s) => s.address === trade.tokenAddress);
      const exactMatch = series?.bars.some((bar) => bar.priceUsd === trade.entryPrice);
      expect(exactMatch ?? false).toBe(false);
    }
  });

  it('agrees with the analytics module on its own trades', async () => {
    const result = await new BacktestEngine(config, {}, createNullLogger()).run(dataset);
    const recomputed = computeMetrics(result.trades.map(TradeRepository.toRow), result.startingCapital);
    expect(recomputed.netPnl).toBeCloseTo(result.metrics.netPnl, 6);
    expect(recomputed.winRate).toBeCloseTo(result.metrics.winRate, 6);
  });

  it('rejects an empty dataset instead of reporting a vacuous result', async () => {
    await expect(new BacktestEngine(config, {}, createNullLogger()).run([])).rejects.toThrow(/no bars/i);
  });
});

describe('HistoricalDataLoader', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bot-data-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('round-trips a dataset through disk', async () => {
    const loader = new HistoricalDataLoader(directory, createNullLogger());
    const small = generateDataset({ tokens: 3, barsPerToken: 20, seed: 1 });
    await loader.save(small);

    const loaded = await loader.load();
    expect(loaded).toHaveLength(3);
    expect(loaded[0].bars.length).toBe(20);
    expect(loaded[0].metadata.symbol).toBeTruthy();
  });

  it('explains a missing data directory', async () => {
    const loader = new HistoricalDataLoader(join(directory, 'missing'), createNullLogger());
    await expect(loader.load()).rejects.toThrow(/not found/i);
  });
});

describe('StrategyOptimizer', () => {
  it('expands a parameter grid exhaustively', () => {
    const combinations = expandGrid({ a: [1, 2], b: ['x', 'y', 'z'] });
    expect(combinations).toHaveLength(6);
  });

  it('applies dotted parameter paths to a config', () => {
    const patched = applyParameters(config, { 'risk.kellyFraction': 0.4, 'scoring.minScore': 90 });
    expect(patched.risk.kellyFraction).toBe(0.4);
    expect(patched.scoring.minScore).toBe(90);
    // Untouched branches must survive intact.
    expect(patched.exit.takeProfitLevels).toHaveLength(4);
  });

  it('ranks grid-search runs and discards undersized samples', async () => {
    const optimizer = new StrategyOptimizer({
      logger: createNullLogger(),
      grid: { 'scoring.minScore': [70, 80], 'risk.kellyFraction': [0.15, 0.3] },
      minTrades: 1,
    });
    const runs = await optimizer.gridSearch(config, dataset);

    expect(runs).toHaveLength(4);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i - 1].score).toBeGreaterThanOrEqual(runs[i].score);
    }
  });

  it('reports out-of-sample results from walk-forward folds', async () => {
    const optimizer = new StrategyOptimizer({
      logger: createNullLogger(),
      grid: { 'scoring.minScore': [70, 80] },
      minTrades: 1,
    });
    const { folds, aggregate } = await optimizer.walkForward(config, dataset, 2);

    expect(folds.length).toBeGreaterThan(0);
    expect(Number.isFinite(aggregate.netPnl)).toBe(true);
    expect(aggregate.trades).toBe(folds.reduce((acc, f) => acc + f.test.metrics.trades, 0));
  });
});
