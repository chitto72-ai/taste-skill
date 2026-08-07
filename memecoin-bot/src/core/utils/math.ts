/** Numeric helpers shared by scoring, risk and analytics. */

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

export function safeDiv(numerator: number, denominator: number, fallback = 0): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return fallback;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : fallback;
}

export function sum(values: readonly number[]): number {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function stdDev(values: readonly number[], sample = true): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = sum(values.map((v) => (v - avg) ** 2)) / (values.length - (sample ? 1 : 0));
  return Math.sqrt(Math.max(0, variance));
}

export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = clamp01(p) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

/** Linear interpolation between two known points, clamped at the edges. */
export function lerp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  const t = clamp01((x - x0) / (x1 - x0));
  return y0 + t * (y1 - y0);
}

/** Logistic squash; `k` controls steepness, `x0` the midpoint. */
export function logistic(x: number, x0 = 0, k = 1): number {
  return 1 / (1 + Math.exp(-k * (x - x0)));
}

/**
 * Maps a value onto 0..1 using a log scale — the right shape for quantities
 * like liquidity or volume, where the difference between $5k and $50k matters
 * far more than between $5M and $5.05M.
 */
export function logScale(value: number, min: number, max: number): number {
  if (value <= min) return 0;
  if (value >= max) return 1;
  const lo = Math.log(Math.max(1e-9, min));
  const hi = Math.log(Math.max(1e-9, max));
  return clamp01((Math.log(value) - lo) / (hi - lo));
}

/** Falls from 1 to 0 as `value` moves from `good` to `bad` (either direction). */
export function inverseScale(value: number, good: number, bad: number): number {
  if (good === bad) return value <= good ? 1 : 0;
  return clamp01((bad - value) / (bad - good));
}

export function pctChange(from: number, to: number): number {
  return safeDiv(to - from, Math.abs(from), 0);
}

/** Simple returns series from a price series. */
export function returns(prices: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < prices.length; i++) out.push(pctChange(prices[i - 1], prices[i]));
  return out;
}

/** Annualization-free realized volatility (std-dev of simple returns). */
export function realizedVolatility(prices: readonly number[]): number {
  return stdDev(returns(prices));
}

/** Exponential moving average of a series; returns the final value. */
export function ema(values: readonly number[], period: number): number {
  if (values.length === 0) return 0;
  const alpha = 2 / (period + 1);
  let acc = values[0];
  for (let i = 1; i < values.length; i++) acc = alpha * values[i] + (1 - alpha) * acc;
  return acc;
}

/** Ordinary least squares slope of y over its own index. */
export function linearSlope(values: readonly number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return safeDiv(num, den, 0);
}

/** Herfindahl-Hirschman index of a share vector, normalized to 0..1. */
export function hhi(shares: readonly number[]): number {
  const total = sum(shares);
  if (total <= 0) return 0;
  return clamp01(sum(shares.map((s) => (s / total) ** 2)));
}

export function round(value: number, decimals = 8): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function bpsOf(value: number, bps: number): number {
  return (value * bps) / 10_000;
}
