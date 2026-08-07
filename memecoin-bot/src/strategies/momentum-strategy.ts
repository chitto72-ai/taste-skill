import type { TokenScore } from '../core/domain/scoring.js';
import type { EntryCondition, StrategyContext } from '../core/domain/signal.js';
import type { TokenProfile } from '../core/domain/token.js';
import { clamp, clamp01, ema, linearSlope, realizedVolatility, safeDiv } from '../core/utils/math.js';
import type { EntryConfig, ExitConfig, ScoringConfig } from '../config/schema.js';
import { BaseStrategy } from './base-strategy.js';

export interface MomentumStrategyOptions {
  readonly entry: EntryConfig;
  readonly exit: ExitConfig;
  readonly scoring: ScoringConfig;
  readonly enabled?: boolean;
  /** Minimum observations before the trend filter is meaningful. */
  readonly minHistory?: number;
}

/**
 * Continuation strategy for tokens that have already survived their first
 * hour.
 *
 * Where the sniper buys the ignition, this buys the trend: it requires an
 * established price series with a positive slope and fast-EMA-above-slow
 * alignment, and it accepts a lower score threshold in exchange for the extra
 * evidence that the token is not an instant rug. Because the entry is later,
 * the stop is tighter and the hold is shorter — the asymmetry has already
 * partly been paid for by whoever bought the ignition.
 */
export class MomentumStrategy extends BaseStrategy {
  readonly name = 'momentum';
  override readonly priority = 5;

  private readonly minHistory: number;

  constructor(private readonly options: MomentumStrategyOptions) {
    super(options.enabled ?? true);
    this.minHistory = options.minHistory ?? 10;
  }

  protected conditions(profile: TokenProfile, score: TokenScore, context: StrategyContext): EntryCondition[] {
    const prices = profile.priceHistory.map((p) => p.priceUsd);
    const conditions: EntryCondition[] = [];

    conditions.push(
      this.condition(
        'history',
        'Sufficient price history',
        prices.length >= this.minHistory,
        `${prices.length} observations (need ${this.minHistory})`,
      ),
    );
    if (prices.length < this.minHistory) return conditions;

    // A slightly relaxed score bar than the sniper, justified by the extra
    // survival evidence — but never below 70.
    const threshold = Math.max(70, this.options.scoring.minScore - 5);
    conditions.push(
      this.condition('score', 'Score above continuation threshold', score.total >= threshold, `score ${score.total} vs ${threshold}`),
    );

    conditions.push(
      this.condition('no_vetoes', 'No disqualifying flags', score.vetoes.length === 0, score.vetoes.join('; ') || 'clean'),
    );

    const slope = safeDiv(linearSlope(prices), prices[prices.length - 1]);
    conditions.push(
      this.condition('trend', 'Positive price trend', slope > 0.001, `normalized slope ${(slope * 100).toFixed(2)}%/bar`),
    );

    const fast = ema(prices, 5);
    const slow = ema(prices, 20);
    conditions.push(
      this.condition('ema', 'Fast EMA above slow EMA', fast > slow, `fast ${fast.toExponential(2)} vs slow ${slow.toExponential(2)}`),
    );

    const drawdownFromHigh = safeDiv(Math.max(...prices) - prices[prices.length - 1], Math.max(...prices));
    conditions.push(
      this.condition(
        'not_extended',
        'Not buying a blow-off top',
        profile.market.priceChange1h < 3 && drawdownFromHigh < 0.25,
        `1h ${(profile.market.priceChange1h * 100).toFixed(0)}%, ${(drawdownFromHigh * 100).toFixed(0)}% off the high`,
      ),
    );

    conditions.push(
      this.condition(
        'liquidity',
        'Sufficient liquidity',
        profile.market.liquidityUsd >= this.options.entry.minLiquidityUsd,
        `$${Math.round(profile.market.liquidityUsd)} in the pool`,
      ),
    );

    const liquiditySeries = profile.priceHistory.map((p) => p.liquidityUsd);
    const liquiditySlope = safeDiv(linearSlope(liquiditySeries), liquiditySeries[liquiditySeries.length - 1] || 1);
    conditions.push(
      this.condition(
        'liquidity_stable',
        'Liquidity not draining',
        liquiditySlope > -0.005,
        `liquidity slope ${(liquiditySlope * 100).toFixed(2)}%/bar`,
      ),
    );

    conditions.push(
      this.condition(
        'capital',
        'Capital available',
        context.availableCapital > 0,
        `available $${context.availableCapital.toFixed(0)}`,
      ),
    );

    return conditions;
  }

  protected conviction(profile: TokenProfile, score: TokenScore): number {
    const prices = profile.priceHistory.map((p) => p.priceUsd);
    const slope = clamp01(safeDiv(linearSlope(prices), prices[prices.length - 1] || 1) / 0.01);
    const scoreEdge = clamp01((score.total - 70) / 30);
    // Continuation entries are inherently later, so conviction is capped below
    // the sniper's ceiling.
    return clamp(0.3 + 0.35 * slope + 0.25 * scoreEdge, 0.2, 0.85);
  }

  protected expectations(profile: TokenProfile, score: TokenScore): {
    winRate: number;
    payoffRatio: number;
    stopPct: number;
    maxHoldMs: number;
  } {
    const volatility = realizedVolatility(profile.priceHistory.map((p) => p.priceUsd));
    // Tighter than the sniper: the trade thesis is "the trend continues", and
    // it is invalidated sooner.
    const stopPct = clamp(volatility * 2, 0.06, this.options.exit.stopLossPct / 100);
    const payoffRatio = clamp(safeDiv(0.9, stopPct), 1.2, 6);
    const winRate = clamp(0.33 + 0.2 * (score.probabilities.pump - score.probabilities.dump), 0.2, 0.5);
    return {
      winRate,
      payoffRatio,
      stopPct,
      maxHoldMs: Math.round(this.options.exit.timeStopMs * 0.6),
    };
  }
}
