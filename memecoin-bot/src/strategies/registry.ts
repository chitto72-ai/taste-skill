import type { TokenScore } from '../core/domain/scoring.js';
import type { EntryEvaluation, StrategyContext } from '../core/domain/signal.js';
import type { TokenProfile } from '../core/domain/token.js';
import type { Logger } from '../logger/logger.js';
import type { Strategy, StrategyStats } from './types.js';

/**
 * Holds the active strategies and picks between them.
 *
 * Strategies are consulted in priority order and the *first* pass wins. They
 * are not blended: two strategies that both like a token would otherwise
 * produce two positions in the same asset, which is a concentration bug
 * wearing a diversification costume.
 */
export class StrategyRegistry {
  private readonly strategies: Strategy[];
  private readonly logger: Logger;

  constructor(strategies: readonly Strategy[], logger: Logger) {
    this.strategies = [...strategies].sort((a, b) => b.priority - a.priority);
    this.logger = logger.child('strategies');
  }

  get active(): Strategy[] {
    return this.strategies.filter((strategy) => strategy.enabled);
  }

  names(): string[] {
    return this.strategies.map((s) => s.name);
  }

  /** Returns the first passing evaluation, plus every evaluation attempted. */
  evaluate(
    profile: TokenProfile,
    score: TokenScore,
    context: StrategyContext,
  ): { winner?: EntryEvaluation; evaluations: EntryEvaluation[] } {
    const evaluations: EntryEvaluation[] = [];
    for (const strategy of this.strategies) {
      if (!strategy.enabled) continue;
      try {
        const evaluation = strategy.evaluate(profile, score, context);
        evaluations.push(evaluation);
        if (evaluation.passed && evaluation.signal) return { winner: evaluation, evaluations };
      } catch (error) {
        this.logger.error({ strategy: strategy.name, err: error }, 'strategy evaluation threw');
      }
    }
    return { evaluations };
  }

  stats(): StrategyStats[] {
    return this.strategies
      .map((strategy) => ('stats' in strategy ? (strategy as { stats(): StrategyStats }).stats() : undefined))
      .filter((entry): entry is StrategyStats => entry !== undefined);
  }
}
