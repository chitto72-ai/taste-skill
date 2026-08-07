import type { ChainId } from '../core/domain/chain.js';

export interface RiskDecision {
  readonly allowed: boolean;
  readonly reason: string;
  readonly context?: Record<string, unknown>;
}

export interface SizingInput {
  readonly equity: number;
  readonly availableCapital: number;
  /** 0..1 estimated probability the trade wins. */
  readonly winProbability: number;
  /** Expected win size divided by expected loss size. */
  readonly payoffRatio: number;
  /** Stop distance as a fraction of entry price, e.g. 0.25 for -25%. */
  readonly stopPct: number;
  readonly liquidityUsd: number;
  readonly conviction: number;
  readonly openPositions: number;
}

export interface SizingResult {
  readonly sizeUsd: number;
  readonly kellyFraction: number;
  readonly riskUsd: number;
  readonly cappedBy: SizingCap;
  readonly rationale: string;
}

export type SizingCap =
  | 'kelly'
  | 'risk_per_trade'
  | 'max_position_pct'
  | 'available_capital'
  | 'pool_liquidity'
  | 'below_minimum'
  | 'negative_edge';

export interface RiskState {
  readonly equity: number;
  readonly peakEquity: number;
  readonly startOfDayEquity: number;
  readonly dailyPnl: number;
  readonly dailyDrawdownPct: number;
  readonly totalDrawdownPct: number;
  readonly consecutiveStops: number;
  readonly openPositions: number;
  readonly dailyTrades: number;
  readonly exposureByChain: Readonly<Record<string, number>>;
  readonly halted: boolean;
  readonly haltReason?: string;
  readonly haltUntil?: number;
  readonly equityVolatility: number;
}

export interface ExposureEntry {
  readonly chain: ChainId;
  readonly usd: number;
  readonly positions: number;
}
