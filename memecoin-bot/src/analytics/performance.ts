import { mean, percentile, safeDiv, stdDev, sum } from '../core/utils/math.js';
import type { TradeRow } from '../database/types.js';

export interface PerformanceMetrics {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  readonly winRate: number;
  readonly grossProfit: number;
  readonly grossLoss: number;
  readonly netPnl: number;
  readonly fees: number;
  readonly gas: number;
  /** Gross profit divided by gross loss; above 1 is profitable. */
  readonly profitFactor: number;
  /** Average PnL per trade in quote currency. */
  readonly expectancy: number;
  readonly avgWin: number;
  readonly avgLoss: number;
  readonly payoffRatio: number;
  readonly largestWin: number;
  readonly largestLoss: number;
  readonly avgHoldMs: number;
  readonly medianPnlPct: number;
  readonly sharpe: number;
  readonly sortino: number;
  readonly maxDrawdownPct: number;
  readonly maxConsecutiveLosses: number;
  readonly maxConsecutiveWins: number;
  /** Return of the whole sequence relative to starting capital. */
  readonly totalReturnPct: number;
  readonly bestTradePct: number;
  readonly worstTradePct: number;
  readonly avgMfePct: number;
  readonly avgMaePct: number;
}

export interface GroupedMetrics {
  readonly key: string;
  readonly metrics: PerformanceMetrics;
}

const EMPTY: PerformanceMetrics = {
  trades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  grossProfit: 0,
  grossLoss: 0,
  netPnl: 0,
  fees: 0,
  gas: 0,
  profitFactor: 0,
  expectancy: 0,
  avgWin: 0,
  avgLoss: 0,
  payoffRatio: 0,
  largestWin: 0,
  largestLoss: 0,
  avgHoldMs: 0,
  medianPnlPct: 0,
  sharpe: 0,
  sortino: 0,
  maxDrawdownPct: 0,
  maxConsecutiveLosses: 0,
  maxConsecutiveWins: 0,
  totalReturnPct: 0,
  bestTradePct: 0,
  worstTradePct: 0,
  avgMfePct: 0,
  avgMaePct: 0,
};

/**
 * Trade-sequence statistics.
 *
 * Sharpe is computed per-trade rather than annualized, deliberately: memecoin
 * holding periods range from minutes to hours, so an annualization factor
 * would be a fabrication. The number is comparable across strategies within
 * this system, which is what it is used for; it is not comparable to a
 * published fund Sharpe, and pretending otherwise would be the misleading
 * choice.
 *
 * Profit factor and expectancy carry more weight here than win rate, because
 * a memecoin strategy is expected to lose most of its trades.
 */
export function computeMetrics(trades: readonly TradeRow[], startingCapital = 0): PerformanceMetrics {
  if (trades.length === 0) return EMPTY;

  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const pnls = sorted.map((t) => t.pnl);
  const returns = sorted.map((t) => t.pnlPct);

  const wins = sorted.filter((t) => t.pnl > 0);
  const losses = sorted.filter((t) => t.pnl < 0);
  const grossProfit = sum(wins.map((t) => t.pnl));
  const grossLoss = Math.abs(sum(losses.map((t) => t.pnl)));

  const returnStdDev = stdDev(returns);
  const downside = returns.filter((r) => r < 0);
  const downsideDev = downside.length > 0 ? Math.sqrt(mean(downside.map((r) => r ** 2))) : 0;
  const avgReturn = mean(returns);

  const { maxDrawdownPct, equityEnd } = drawdownOf(pnls, startingCapital);
  const streaks = streaksOf(sorted);

  return {
    trades: sorted.length,
    wins: wins.length,
    losses: losses.length,
    winRate: safeDiv(wins.length, sorted.length),
    grossProfit,
    grossLoss,
    netPnl: sum(pnls),
    fees: sum(sorted.map((t) => t.fees)),
    gas: sum(sorted.map((t) => t.gas)),
    // No losses at all: report the gross profit rather than Infinity, which
    // renders badly and compares badly.
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? grossProfit : 0) : grossProfit / grossLoss,
    expectancy: mean(pnls),
    avgWin: wins.length > 0 ? mean(wins.map((t) => t.pnl)) : 0,
    avgLoss: losses.length > 0 ? mean(losses.map((t) => t.pnl)) : 0,
    payoffRatio:
      losses.length > 0 && wins.length > 0
        ? safeDiv(mean(wins.map((t) => t.pnl)), Math.abs(mean(losses.map((t) => t.pnl))))
        : 0,
    largestWin: wins.length > 0 ? Math.max(...wins.map((t) => t.pnl)) : 0,
    largestLoss: losses.length > 0 ? Math.min(...losses.map((t) => t.pnl)) : 0,
    avgHoldMs: mean(sorted.map((t) => t.holdMs)),
    medianPnlPct: percentile(returns, 0.5),
    sharpe: returnStdDev === 0 ? 0 : safeDiv(avgReturn, returnStdDev),
    sortino: downsideDev === 0 ? 0 : safeDiv(avgReturn, downsideDev),
    maxDrawdownPct,
    maxConsecutiveLosses: streaks.maxLosses,
    maxConsecutiveWins: streaks.maxWins,
    totalReturnPct: startingCapital > 0 ? safeDiv(equityEnd - startingCapital, startingCapital) : 0,
    bestTradePct: Math.max(...returns),
    worstTradePct: Math.min(...returns),
    avgMfePct: mean(sorted.map((t) => t.maxFavorableExcursion)),
    avgMaePct: mean(sorted.map((t) => t.maxAdverseExcursion)),
  };
}

/** Splits a trade set by an arbitrary key and computes metrics per group. */
export function groupMetrics(
  trades: readonly TradeRow[],
  keyOf: (trade: TradeRow) => string,
  startingCapital = 0,
): GroupedMetrics[] {
  const groups = new Map<string, TradeRow[]>();
  for (const trade of trades) {
    const key = keyOf(trade);
    const bucket = groups.get(key) ?? [];
    bucket.push(trade);
    groups.set(key, bucket);
  }
  return [...groups]
    .map(([key, rows]) => ({ key, metrics: computeMetrics(rows, startingCapital) }))
    .sort((a, b) => b.metrics.netPnl - a.metrics.netPnl);
}

export function byStrategy(trades: readonly TradeRow[], startingCapital = 0): GroupedMetrics[] {
  return groupMetrics(trades, (t) => t.strategy, startingCapital);
}

export function byChain(trades: readonly TradeRow[], startingCapital = 0): GroupedMetrics[] {
  return groupMetrics(trades, (t) => t.chain, startingCapital);
}

export function byCloseReason(trades: readonly TradeRow[], startingCapital = 0): GroupedMetrics[] {
  return groupMetrics(trades, (t) => t.closeReason, startingCapital);
}

/** Score-bucket attribution — the feedback loop for tuning the threshold. */
export function byScoreBucket(trades: readonly TradeRow[]): GroupedMetrics[] {
  return groupMetrics(trades, (trade) => {
    const bucket = Math.floor(trade.entryScore / 5) * 5;
    return `${bucket}-${bucket + 4}`;
  });
}

function drawdownOf(pnls: readonly number[], startingCapital: number): {
  maxDrawdownPct: number;
  equityEnd: number;
} {
  let equity = startingCapital;
  let peak = startingCapital;
  let maxDrawdown = 0;
  for (const pnl of pnls) {
    equity += pnl;
    if (equity > peak) peak = equity;
    if (peak > 0) {
      const drawdown = ((peak - equity) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }
  }
  return { maxDrawdownPct: maxDrawdown, equityEnd: equity };
}

function streaksOf(trades: readonly TradeRow[]): { maxWins: number; maxLosses: number } {
  let wins = 0;
  let losses = 0;
  let maxWins = 0;
  let maxLosses = 0;
  for (const trade of trades) {
    if (trade.pnl > 0) {
      wins++;
      losses = 0;
      maxWins = Math.max(maxWins, wins);
    } else if (trade.pnl < 0) {
      losses++;
      wins = 0;
      maxLosses = Math.max(maxLosses, losses);
    }
  }
  return { maxWins, maxLosses };
}
