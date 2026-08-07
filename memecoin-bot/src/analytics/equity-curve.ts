import { safeDiv } from '../core/utils/math.js';
import type { EquityPointRow, TradeRow } from '../database/types.js';

export interface EquityPoint {
  readonly t: number;
  readonly equity: number;
  readonly drawdownPct: number;
  readonly realizedPnl: number;
}

/** Replays closed trades into an equity curve, oldest first. */
export function equityFromTrades(trades: readonly TradeRow[], startingCapital: number): EquityPoint[] {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const points: EquityPoint[] = [];
  let equity = startingCapital;
  let peak = startingCapital;
  let realized = 0;

  points.push({ t: sorted[0]?.openedAt ?? Date.now(), equity, drawdownPct: 0, realizedPnl: 0 });

  for (const trade of sorted) {
    equity += trade.pnl;
    realized += trade.pnl;
    if (equity > peak) peak = equity;
    points.push({
      t: trade.closedAt,
      equity,
      drawdownPct: peak > 0 ? ((peak - equity) / peak) * 100 : 0,
      realizedPnl: realized,
    });
  }
  return points;
}

/** Converts stored equity samples (which include open PnL) to chart points. */
export function equityFromSamples(rows: readonly EquityPointRow[]): EquityPoint[] {
  return rows.map((row) => ({
    t: row.ts,
    equity: row.equity,
    drawdownPct: row.drawdownPct,
    realizedPnl: row.realizedPnl,
  }));
}

export interface CurveStats {
  readonly start: number;
  readonly end: number;
  readonly peak: number;
  readonly trough: number;
  readonly maxDrawdownPct: number;
  readonly returnPct: number;
  /** Longest stretch, in ms, spent below a previous peak. */
  readonly longestDrawdownMs: number;
  readonly timeInDrawdownPct: number;
}

export function curveStats(points: readonly EquityPoint[]): CurveStats {
  if (points.length === 0) {
    return {
      start: 0,
      end: 0,
      peak: 0,
      trough: 0,
      maxDrawdownPct: 0,
      returnPct: 0,
      longestDrawdownMs: 0,
      timeInDrawdownPct: 0,
    };
  }

  let peak = points[0].equity;
  let trough = points[0].equity;
  let maxDrawdown = 0;
  let longestDrawdown = 0;
  let drawdownStart: number | undefined;
  let timeInDrawdown = 0;

  for (const point of points) {
    if (point.equity > peak) {
      peak = point.equity;
      if (drawdownStart !== undefined) {
        const duration = point.t - drawdownStart;
        timeInDrawdown += duration;
        longestDrawdown = Math.max(longestDrawdown, duration);
        drawdownStart = undefined;
      }
    } else if (drawdownStart === undefined && point.equity < peak) {
      drawdownStart = point.t;
    }
    trough = Math.min(trough, point.equity);
    maxDrawdown = Math.max(maxDrawdown, point.drawdownPct);
  }

  const last = points[points.length - 1];
  if (drawdownStart !== undefined) {
    const duration = last.t - drawdownStart;
    timeInDrawdown += duration;
    longestDrawdown = Math.max(longestDrawdown, duration);
  }

  const span = Math.max(1, last.t - points[0].t);
  return {
    start: points[0].equity,
    end: last.equity,
    peak,
    trough,
    maxDrawdownPct: maxDrawdown,
    returnPct: safeDiv(last.equity - points[0].equity, points[0].equity) * 100,
    longestDrawdownMs: longestDrawdown,
    timeInDrawdownPct: safeDiv(timeInDrawdown, span) * 100,
  };
}

/** Uniform down-sampling that always keeps the first and last points. */
export function downsample(points: readonly EquityPoint[], max: number): EquityPoint[] {
  if (points.length <= max) return [...points];
  const step = Math.ceil(points.length / max);
  const out = points.filter((_, index) => index % step === 0);
  const last = points[points.length - 1];
  if (out[out.length - 1]?.t !== last.t) out.push(last);
  return out;
}
