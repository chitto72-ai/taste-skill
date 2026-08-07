import type { TokenRef } from './token.js';

/** A single normalized measurement produced by one metric function. */
export interface MetricValue {
  readonly id: string;
  readonly group: MetricGroup;
  /** Raw domain value, kept for auditing and backtest re-scoring. */
  readonly raw: number;
  /** Normalized to 0..1 where 1 is unambiguously favourable. */
  readonly normalized: number;
  readonly weight: number;
  /** True when upstream data was missing and a neutral prior was used. */
  readonly imputed: boolean;
}

export type MetricGroup =
  | 'liquidity'
  | 'momentum'
  | 'holders'
  | 'whales'
  | 'community'
  | 'developer'
  | 'security';

export interface SubScores {
  readonly risk: number;
  readonly momentum: number;
  readonly liquidity: number;
  readonly community: number;
  readonly whale: number;
  readonly developer: number;
}

export interface Probabilities {
  readonly rug: number;
  readonly pump: number;
  readonly dump: number;
}

export interface TokenScore {
  readonly token: TokenRef;
  /** Composite 0..100. The entry gate compares against config.minTokenScore. */
  readonly total: number;
  readonly sub: SubScores;
  readonly probabilities: Probabilities;
  readonly metrics: readonly MetricValue[];
  /** Hard disqualifiers; a non-empty list forces `total` to 0. */
  readonly vetoes: readonly string[];
  /** Fraction of metrics backed by real data, 0..1. */
  readonly confidence: number;
  readonly at: number;
}

export function metricById(score: TokenScore, id: string): MetricValue | undefined {
  return score.metrics.find((m) => m.id === id);
}
