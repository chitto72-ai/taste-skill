import { describe, expect, it } from 'vitest';
import {
  byChain,
  byCloseReason,
  byScoreBucket,
  byStrategy,
  computeMetrics,
} from '../../src/analytics/performance.js';
import { curveStats, downsample, equityFromTrades } from '../../src/analytics/equity-curve.js';
import { formatGroups, formatMetrics, sparkline } from '../../src/analytics/reporting.js';
import { tradeRow } from '../helpers/factories.js';

describe('computeMetrics', () => {
  it('returns a zeroed result for an empty history', () => {
    const metrics = computeMetrics([], 10_000);
    expect(metrics.trades).toBe(0);
    expect(metrics.profitFactor).toBe(0);
    expect(metrics.netPnl).toBe(0);
  });

  it('computes win rate, profit factor and expectancy', () => {
    const trades = [
      tradeRow({ pnl: 300 }, 0),
      tradeRow({ pnl: -100 }, 1),
      tradeRow({ pnl: -100 }, 2),
      tradeRow({ pnl: 200 }, 3),
    ];
    const metrics = computeMetrics(trades, 10_000);

    expect(metrics.trades).toBe(4);
    expect(metrics.wins).toBe(2);
    expect(metrics.winRate).toBeCloseTo(0.5, 6);
    expect(metrics.netPnl).toBe(300);
    expect(metrics.profitFactor).toBeCloseTo(2.5, 6);
    expect(metrics.expectancy).toBeCloseTo(75, 6);
    expect(metrics.payoffRatio).toBeCloseTo(2.5, 6);
  });

  it('reports gross profit rather than Infinity when there are no losses', () => {
    const metrics = computeMetrics([tradeRow({ pnl: 100 }, 0)], 10_000);
    expect(Number.isFinite(metrics.profitFactor)).toBe(true);
    expect(metrics.profitFactor).toBe(100);
  });

  it('tracks the longest winning and losing streaks', () => {
    const trades = [
      tradeRow({ pnl: 10 }, 0),
      tradeRow({ pnl: 10 }, 1),
      tradeRow({ pnl: -10 }, 2),
      tradeRow({ pnl: -10 }, 3),
      tradeRow({ pnl: -10 }, 4),
      tradeRow({ pnl: 10 }, 5),
    ];
    const metrics = computeMetrics(trades, 10_000);
    expect(metrics.maxConsecutiveWins).toBe(2);
    expect(metrics.maxConsecutiveLosses).toBe(3);
  });

  it('computes max drawdown from the equity path, not from the worst trade', () => {
    const trades = [
      tradeRow({ pnl: 1_000 }, 0),
      tradeRow({ pnl: -600 }, 1),
      tradeRow({ pnl: -600 }, 2),
      tradeRow({ pnl: 400 }, 3),
    ];
    const metrics = computeMetrics(trades, 10_000);
    // Peak 11,000 -> trough 9,800 = 10.9%
    expect(metrics.maxDrawdownPct).toBeCloseTo(10.909, 2);
  });

  it('computes a total return relative to starting capital', () => {
    const metrics = computeMetrics([tradeRow({ pnl: 500 }, 0)], 10_000);
    expect(metrics.totalReturnPct).toBeCloseTo(0.05, 6);
  });

  it('reports sortino as zero when there is no downside', () => {
    const metrics = computeMetrics([tradeRow({ pnl: 10 }, 0), tradeRow({ pnl: 20 }, 1)], 10_000);
    expect(metrics.sortino).toBe(0);
    expect(metrics.sharpe).not.toBe(0);
  });
});

describe('grouping', () => {
  const trades = [
    tradeRow({ pnl: 200, strategy: 'sniper', chain: 'solana', entryScore: 91 }, 0),
    tradeRow({ pnl: -50, strategy: 'momentum', chain: 'base', entryScore: 82, closeReason: 'stop_loss' }, 1),
    tradeRow({ pnl: 75, strategy: 'sniper', chain: 'solana', entryScore: 84 }, 2),
  ];

  it('groups by strategy, chain, exit reason and score bucket', () => {
    expect(byStrategy(trades).map((g) => g.key)).toEqual(['sniper', 'momentum']);
    expect(byChain(trades)[0].metrics.trades).toBe(2);
    expect(byCloseReason(trades).map((g) => g.key).sort()).toEqual(['stop_loss', 'take_profit']);
    expect(byScoreBucket(trades).map((g) => g.key).sort()).toEqual(['80-84', '90-94']);
  });

  it('sorts groups by net PnL descending', () => {
    const groups = byStrategy(trades);
    expect(groups[0].metrics.netPnl).toBeGreaterThan(groups[1].metrics.netPnl);
  });
});

describe('equity curve', () => {
  const trades = [tradeRow({ pnl: 500 }, 0), tradeRow({ pnl: -200 }, 1), tradeRow({ pnl: 300 }, 2)];

  it('replays trades into a monotonic-in-time curve', () => {
    const points = equityFromTrades(trades, 10_000);
    expect(points).toHaveLength(4);
    expect(points[0].equity).toBe(10_000);
    expect(points[points.length - 1].equity).toBe(10_600);
    for (let i = 1; i < points.length; i++) expect(points[i].t).toBeGreaterThanOrEqual(points[i - 1].t);
  });

  it('summarises peak, trough, drawdown and time under water', () => {
    // 10,000 -> 10,500 -> 10,300 -> 10,600: the dip in the middle is the
    // drawdown, and the final point is the new peak.
    const stats = curveStats(equityFromTrades(trades, 10_000));
    expect(stats.peak).toBe(10_600);
    expect(stats.trough).toBe(10_000);
    expect(stats.end).toBe(10_600);
    expect(stats.maxDrawdownPct).toBeGreaterThan(0);
    expect(stats.timeInDrawdownPct).toBeGreaterThan(0);
  });

  it('down-samples while keeping the endpoints', () => {
    const points = Array.from({ length: 1_000 }, (_, i) => ({
      t: i,
      equity: 10_000 + i,
      drawdownPct: 0,
      realizedPnl: i,
    }));
    const sampled = downsample(points, 50);
    expect(sampled.length).toBeLessThanOrEqual(51);
    expect(sampled[0].t).toBe(0);
    expect(sampled[sampled.length - 1].t).toBe(999);
  });
});

describe('reporting', () => {
  it('formats metrics without throwing on an empty history', () => {
    const text = formatMetrics(computeMetrics([], 10_000), 'Empty');
    expect(text).toContain('Trades            0');
  });

  it('formats groups and an empty group set', () => {
    expect(formatGroups([], 'Nothing')).toContain('no trades');
    expect(formatGroups(byStrategy([tradeRow({}, 0)]), 'By strategy')).toContain('sniper');
  });

  it('renders a sparkline of fixed width', () => {
    const line = sparkline(Array.from({ length: 500 }, (_, i) => i), 40);
    expect(line.length).toBeLessThanOrEqual(40);
    expect(line.length).toBeGreaterThan(0);
  });
});
