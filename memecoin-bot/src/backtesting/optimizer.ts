import { deepMerge, type DeepPartial } from '../config/merge.js';
import type { BotConfig } from '../config/schema.js';
import type { Logger } from '../logger/logger.js';
import { BacktestEngine } from './backtest-engine.js';
import type { BacktestResult, HistoricalSeries, OptimizationRun, ParameterGrid } from './types.js';

export interface OptimizerOptions {
  readonly grid: ParameterGrid;
  readonly logger: Logger;
  /** Ranking objective; defaults to a drawdown-penalised profit factor. */
  readonly objective?: (result: BacktestResult) => number;
  /** Discard runs with fewer trades than this — noise, not edge. */
  readonly minTrades?: number;
}

/**
 * Grid search and walk-forward validation.
 *
 * The default objective is deliberately not "net PnL": optimising raw PnL over
 * a grid reliably selects the parameter set that got luckiest on the biggest
 * winner. Instead it rewards profit factor and expectancy while penalising
 * drawdown, and it discards runs with too few trades — a 3-trade run with a
 * 100% win rate is not a result.
 *
 * Walk-forward is the part that matters. In-sample grid search on memecoin
 * data will always find something; only out-of-sample performance on a period
 * the search never saw says whether it was real.
 */
export class StrategyOptimizer {
  private readonly objective: (result: BacktestResult) => number;
  private readonly minTrades: number;

  constructor(private readonly options: OptimizerOptions) {
    this.objective = options.objective ?? defaultObjective;
    this.minTrades = options.minTrades ?? 20;
  }

  /** Exhaustive grid search over the configured parameter space. */
  async gridSearch(
    baseConfig: BotConfig,
    dataset: readonly HistoricalSeries[],
  ): Promise<OptimizationRun[]> {
    const combinations = expand(this.options.grid);
    this.options.logger.info({ combinations: combinations.length }, 'starting grid search');

    const runs: OptimizationRun[] = [];
    for (const [index, parameters] of combinations.entries()) {
      const config = applyParameters(baseConfig, parameters);
      const engine = new BacktestEngine(config, {}, this.options.logger);
      const result = await engine.run(dataset);
      const score = result.metrics.trades < this.minTrades ? Number.NEGATIVE_INFINITY : this.objective(result);

      runs.push({ parameters, result, score });
      this.options.logger.debug(
        {
          run: index + 1,
          of: combinations.length,
          trades: result.metrics.trades,
          pnl: Math.round(result.metrics.netPnl),
          score: Number.isFinite(score) ? Number(score.toFixed(3)) : 'discarded',
        },
        'grid search run complete',
      );
    }

    return runs.sort((a, b) => b.score - a.score);
  }

  /**
   * Walk-forward: optimise on a window, evaluate on the window that follows,
   * and repeat. The reported metrics are the out-of-sample ones only.
   */
  async walkForward(
    baseConfig: BotConfig,
    dataset: readonly HistoricalSeries[],
    folds = 4,
  ): Promise<{
    folds: { train: OptimizationRun; test: BacktestResult }[];
    aggregate: { trades: number; netPnl: number; winRate: number; profitFactor: number };
  }> {
    const windows = splitByTime(dataset, folds + 1);
    const results: { train: OptimizationRun; test: BacktestResult }[] = [];

    for (let i = 0; i < windows.length - 1; i++) {
      const train = windows[i];
      const test = windows[i + 1];
      if (train.length === 0 || test.length === 0) continue;

      const [best] = await this.gridSearch(baseConfig, train);
      if (!best) continue;

      const engine = new BacktestEngine(applyParameters(baseConfig, best.parameters), {}, this.options.logger);
      const testResult = await engine.run(test);
      results.push({ train: best, test: testResult });

      this.options.logger.info(
        {
          fold: i + 1,
          parameters: best.parameters,
          inSamplePnl: Math.round(best.result.metrics.netPnl),
          outOfSamplePnl: Math.round(testResult.metrics.netPnl),
        },
        'walk-forward fold complete',
      );
    }

    const trades = results.reduce((acc, r) => acc + r.test.metrics.trades, 0);
    const netPnl = results.reduce((acc, r) => acc + r.test.metrics.netPnl, 0);
    const wins = results.reduce((acc, r) => acc + r.test.metrics.wins, 0);
    const grossProfit = results.reduce((acc, r) => acc + r.test.metrics.grossProfit, 0);
    const grossLoss = results.reduce((acc, r) => acc + r.test.metrics.grossLoss, 0);

    return {
      folds: results,
      aggregate: {
        trades,
        netPnl,
        winRate: trades === 0 ? 0 : wins / trades,
        profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
      },
    };
  }
}

/** Rewards consistency, penalises drawdown, ignores tiny samples. */
function defaultObjective(result: BacktestResult): number {
  const m = result.metrics;
  if (m.trades === 0) return Number.NEGATIVE_INFINITY;
  const drawdownPenalty = 1 + m.maxDrawdownPct / 20;
  return ((m.profitFactor * 0.5 + m.expectancy * 0.01 + m.sortino * 0.5) / drawdownPenalty) * Math.log10(10 + m.trades);
}

/** Cartesian product of the grid. */
function expand(grid: ParameterGrid): Record<string, number | string | boolean>[] {
  const keys = Object.keys(grid);
  if (keys.length === 0) return [{}];

  let combinations: Record<string, number | string | boolean>[] = [{}];
  for (const key of keys) {
    const next: Record<string, number | string | boolean>[] = [];
    for (const combination of combinations) {
      for (const value of grid[key]) next.push({ ...combination, [key]: value });
    }
    combinations = next;
  }
  return combinations;
}

/** Dotted parameter paths ("risk.kellyFraction") are applied to the config. */
function applyParameters(base: BotConfig, parameters: Record<string, number | string | boolean>): BotConfig {
  let config = base;
  for (const [path, value] of Object.entries(parameters)) {
    const segments = path.split('.');
    let patch: Record<string, unknown> = {};
    const root = patch;
    segments.forEach((segment, index) => {
      if (index === segments.length - 1) patch[segment] = value;
      else {
        patch[segment] = {};
        patch = patch[segment] as Record<string, unknown>;
      }
    });
    config = deepMerge(config, root as DeepPartial<BotConfig>);
  }
  return config;
}

/** Splits every series into `count` contiguous time windows. */
function splitByTime(dataset: readonly HistoricalSeries[], count: number): HistoricalSeries[][] {
  const all = dataset.flatMap((s) => s.bars.map((b) => b.t));
  if (all.length === 0) return [];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = (max - min) / count;

  const windows: HistoricalSeries[][] = [];
  for (let i = 0; i < count; i++) {
    const from = min + i * span;
    const to = from + span;
    const window = dataset
      .map((series) => ({ ...series, bars: series.bars.filter((bar) => bar.t >= from && bar.t < to) }))
      .filter((series) => series.bars.length >= 5);
    windows.push(window);
  }
  return windows;
}

export { expand as expandGrid, applyParameters };
