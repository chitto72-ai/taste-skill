import type { MetricGroup } from '../core/domain/scoring.js';
import type { TokenProfile } from '../core/domain/token.js';

export interface MetricContext {
  readonly profile: TokenProfile;
  readonly now: number;
}

export interface MetricComputation {
  /** Raw domain value, stored for auditing and offline re-weighting. */
  readonly raw: number;
  /** 0..1, where 1 is unambiguously favourable. */
  readonly normalized: number;
}

export interface MetricDefinition {
  readonly id: string;
  readonly group: MetricGroup;
  readonly label: string;
  /** Relative weight inside its group. */
  readonly weight: number;
  /**
   * Profile field paths this metric depends on. When the discovery pipeline
   * reports one of them as missing, the metric is marked imputed and scored
   * at the neutral prior instead of at a fabricated value.
   */
  readonly requires?: readonly string[];
  compute(ctx: MetricContext): MetricComputation;
}

/** Neutral prior used for imputed metrics — deliberately below the midpoint. */
export const NEUTRAL_PRIOR = 0.45;

export function defineMetric(definition: MetricDefinition): MetricDefinition {
  return definition;
}
