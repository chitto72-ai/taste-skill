import type { TokenScore } from '../core/domain/scoring.js';
import type { EntryEvaluation, StrategyContext } from '../core/domain/signal.js';
import type { TokenProfile } from '../core/domain/token.js';

/**
 * An entry strategy: given an enriched, scored token and the current portfolio
 * state, decide whether to open a position and with how much conviction.
 *
 * Strategies are pure. They perform no I/O and never place orders — they
 * return an evaluation, and the engine decides what to do with it. That is
 * what makes them backtestable without stubbing a venue.
 */
export interface Strategy {
  readonly name: string;
  readonly enabled: boolean;
  /** Higher priority strategies are consulted first for the same token. */
  readonly priority: number;
  evaluate(profile: TokenProfile, score: TokenScore, context: StrategyContext): EntryEvaluation;
}

export interface StrategyStats {
  readonly name: string;
  readonly evaluated: number;
  readonly passed: number;
  readonly rejectionsByCondition: Readonly<Record<string, number>>;
}
