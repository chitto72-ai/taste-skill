import type { TokenScore } from '../core/domain/scoring.js';
import type { EntryCondition, EntryEvaluation, EntrySignal, StrategyContext } from '../core/domain/signal.js';
import type { TokenProfile } from '../core/domain/token.js';
import { tokenKey } from '../core/domain/token.js';
import { signalId } from '../core/utils/id.js';
import type { Strategy, StrategyStats } from './types.js';

/**
 * Shared machinery for strategies: condition bookkeeping, duplicate-position
 * guarding, and signal construction.
 *
 * Every condition is recorded whether it passes or fails, because "why did the
 * bot not buy that" is the question an operator asks most, and answering it
 * from logs after the fact is far harder than recording it at the time.
 */
export abstract class BaseStrategy implements Strategy {
  abstract readonly name: string;
  readonly priority: number = 0;

  private evaluated = 0;
  private passed = 0;
  private readonly rejections = new Map<string, number>();

  constructor(readonly enabled: boolean) {}

  evaluate(profile: TokenProfile, score: TokenScore, context: StrategyContext): EntryEvaluation {
    this.evaluated++;

    const conditions: EntryCondition[] = [];
    if (!this.enabled) {
      conditions.push({ id: 'enabled', label: 'Strategy enabled', passed: false, detail: 'strategy is disabled' });
      return this.fail(profile, conditions);
    }

    const alreadyOpen = context.openPositions.some(
      (position) => tokenKey(position.token) === tokenKey(profile.ref),
    );
    conditions.push({
      id: 'no_open_position',
      label: 'No open position in this token',
      passed: !alreadyOpen,
      detail: alreadyOpen ? 'a position is already open' : 'no existing exposure',
    });
    if (alreadyOpen) return this.fail(profile, conditions);

    conditions.push(...this.conditions(profile, score, context));
    const failed = conditions.filter((condition) => !condition.passed);
    if (failed.length > 0) return this.fail(profile, conditions);

    this.passed++;
    const signal = this.buildSignal(profile, score, conditions);
    return { token: profile.ref, conditions, passed: true, signal };
  }

  stats(): StrategyStats {
    return {
      name: this.name,
      evaluated: this.evaluated,
      passed: this.passed,
      rejectionsByCondition: Object.fromEntries(this.rejections),
    };
  }

  /** Strategy-specific entry gates. */
  protected abstract conditions(
    profile: TokenProfile,
    score: TokenScore,
    context: StrategyContext,
  ): EntryCondition[];

  /** 0..1 conviction, which the sizer uses to damp Kelly. */
  protected abstract conviction(profile: TokenProfile, score: TokenScore): number;

  /** Expected win rate and payoff ratio; these drive Kelly directly. */
  protected abstract expectations(
    profile: TokenProfile,
    score: TokenScore,
  ): { winRate: number; payoffRatio: number; stopPct: number; maxHoldMs: number };

  protected buildSignal(
    profile: TokenProfile,
    score: TokenScore,
    conditions: readonly EntryCondition[],
  ): EntrySignal {
    const expectations = this.expectations(profile, score);
    return {
      id: signalId(),
      strategy: this.name,
      token: profile.ref,
      profile,
      score,
      conviction: this.conviction(profile, score),
      expectedWinRate: expectations.winRate,
      expectedPayoffRatio: expectations.payoffRatio,
      suggestedStopPct: expectations.stopPct,
      maxHoldMs: expectations.maxHoldMs,
      reasons: conditions.filter((c) => c.passed).map((c) => `${c.label}: ${c.detail}`),
      at: profile.updatedAt,
    };
  }

  protected condition(id: string, label: string, passed: boolean, detail: string): EntryCondition {
    return { id, label, passed, detail };
  }

  private fail(profile: TokenProfile, conditions: EntryCondition[]): EntryEvaluation {
    for (const condition of conditions) {
      if (condition.passed) continue;
      this.rejections.set(condition.id, (this.rejections.get(condition.id) ?? 0) + 1);
    }
    return { token: profile.ref, conditions, passed: false };
  }
}
