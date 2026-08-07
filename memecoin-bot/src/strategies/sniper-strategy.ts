import type { TokenScore } from '../core/domain/scoring.js';
import type { EntryCondition, StrategyContext } from '../core/domain/signal.js';
import type { TokenProfile } from '../core/domain/token.js';
import { clamp, clamp01, realizedVolatility, safeDiv } from '../core/utils/math.js';
import type { EntryConfig, ExitConfig, ScoringConfig } from '../config/schema.js';
import { BaseStrategy } from './base-strategy.js';

export interface SniperStrategyOptions {
  readonly entry: EntryConfig;
  readonly exit: ExitConfig;
  readonly scoring: ScoringConfig;
  readonly enabled?: boolean;
}

/**
 * The primary entry strategy: an early, quality-gated entry into a token that
 * is already working.
 *
 * The gate is a conjunction, not a score. Every condition below must hold
 * simultaneously — score above threshold, volume expanding, holders growing,
 * smart money and whales net buyers, liquidity sufficient, distribution
 * healthy, no bundle, no blacklist, momentum positive. That is stricter than
 * a weighted average, and deliberately so: a weighted score lets a single
 * spectacular dimension carry a token past six mediocre ones, and in this
 * market the mediocre dimensions are usually the ones that end up mattering.
 *
 * The expected win rate handed to the Kelly sizer is intentionally
 * conservative (capped at 45%) because memecoin strategies are payoff-driven,
 * not accuracy-driven: most positions are small losses and the edge lives in
 * the few that run.
 */
export class SniperStrategy extends BaseStrategy {
  readonly name = 'sniper';
  override readonly priority = 10;

  constructor(private readonly options: SniperStrategyOptions) {
    super(options.enabled ?? true);
  }

  protected conditions(profile: TokenProfile, score: TokenScore, context: StrategyContext): EntryCondition[] {
    const { entry, scoring } = this.options;
    const { market, holders, smartMoney, security } = profile;
    const conditions: EntryCondition[] = [];

    conditions.push(
      this.condition(
        'score',
        'Composite score above threshold',
        score.total >= scoring.minScore,
        `score ${score.total} vs threshold ${scoring.minScore}`,
      ),
    );

    conditions.push(
      this.condition(
        'no_vetoes',
        'No disqualifying flags',
        score.vetoes.length === 0,
        score.vetoes.length === 0 ? 'clean' : score.vetoes.join('; '),
      ),
    );

    const expectedVolume = market.volume1hUsd / 12;
    const volumeGrowth = safeDiv(market.volume5mUsd, Math.max(expectedVolume, 1), 1) - 1;
    conditions.push(
      this.condition(
        'volume_growth',
        'Volume expanding',
        !entry.requireVolumeGrowth || volumeGrowth >= entry.minVolumeGrowth5m,
        `5m volume ${(volumeGrowth * 100).toFixed(0)}% vs the hourly run rate`,
      ),
    );

    conditions.push(
      this.condition(
        'holder_growth',
        'Holder count growing',
        !entry.requireHolderGrowth || holders.growth5m >= entry.minHolderGrowth5m,
        `holders +${(holders.growth5m * 100).toFixed(1)}% over 5m`,
      ),
    );

    conditions.push(
      this.condition(
        'smart_money',
        'Smart money buying',
        !entry.requireSmartMoney || smartMoney.smartWalletsBuying5m >= entry.minSmartWalletsBuying,
        `${smartMoney.smartWalletsBuying5m} smart wallets bought in the last 5m`,
      ),
    );

    conditions.push(
      this.condition(
        'whale_flow',
        'Whales net buyers',
        !entry.requireWhaleBuying || smartMoney.whaleNetFlowUsd5m >= entry.minWhaleNetFlowUsd,
        `whale net flow $${Math.round(smartMoney.whaleNetFlowUsd5m)}`,
      ),
    );

    conditions.push(
      this.condition(
        'liquidity',
        'Sufficient liquidity',
        market.liquidityUsd >= entry.minLiquidityUsd,
        `$${Math.round(market.liquidityUsd)} in the pool`,
      ),
    );

    conditions.push(
      this.condition(
        'distribution',
        'Healthy holder distribution',
        holders.top10Pct <= entry.maxTop10HolderPct && holders.devHoldingPct <= entry.maxDevHoldingPct,
        `top-10 ${(holders.top10Pct * 100).toFixed(1)}%, dev ${(holders.devHoldingPct * 100).toFixed(1)}%`,
      ),
    );

    conditions.push(
      this.condition(
        'no_bundle',
        'No suspicious bundling',
        !security.bundleDetected && holders.bundledPct <= entry.maxBundledPct,
        security.bundleDetected
          ? `bundle of ${security.bundleWallets} wallets detected`
          : `bundled supply ${(holders.bundledPct * 100).toFixed(1)}%`,
      ),
    );

    conditions.push(
      this.condition(
        'no_blacklist',
        'No blacklist or punitive taxes',
        !security.hasBlacklistFn &&
          security.buyTaxPct <= entry.maxBuyTaxPct &&
          security.sellTaxPct <= entry.maxSellTaxPct,
        `buy tax ${security.buyTaxPct}%, sell tax ${security.sellTaxPct}%, blacklist=${security.hasBlacklistFn}`,
      ),
    );

    const buySellRatio = safeDiv(market.txns5m.buys, Math.max(market.txns5m.sells, 1), 1);
    conditions.push(
      this.condition(
        'momentum',
        'Positive momentum',
        !entry.requirePositiveMomentum ||
          (market.priceChange5m > 0 && buySellRatio >= entry.minBuySellRatio),
        `5m ${(market.priceChange5m * 100).toFixed(1)}%, buy/sell ${buySellRatio.toFixed(2)}`,
      ),
    );

    conditions.push(
      this.condition(
        'pump_probability',
        'Model favours upside',
        score.probabilities.pump >= this.options.scoring.minPumpProbability,
        `pump ${(score.probabilities.pump * 100).toFixed(0)}%, dump ${(score.probabilities.dump * 100).toFixed(0)}%`,
      ),
    );

    // Sizing may still shrink the position, but an entry that cannot be taken
    // at a sane share of the pool should not generate a signal at all.
    const maxClip = market.liquidityUsd * entry.maxPoolImpactPct;
    conditions.push(
      this.condition(
        'tradable_size',
        'Position size is executable',
        maxClip >= 20 && context.availableCapital > 0,
        `max clip $${maxClip.toFixed(0)}, available $${context.availableCapital.toFixed(0)}`,
      ),
    );

    return conditions;
  }

  protected conviction(profile: TokenProfile, score: TokenScore): number {
    // Score above the threshold, smart-money participation and model
    // confidence, blended. Kept in 0..1 for the sizer.
    const scoreEdge = clamp01((score.total - this.options.scoring.minScore) / (100 - this.options.scoring.minScore));
    const smart = clamp01(profile.smartMoney.smartWalletsBuying5m / 5);
    const model = clamp01(score.probabilities.pump - score.probabilities.dump + 0.5);
    return clamp(0.35 + 0.3 * scoreEdge + 0.2 * smart + 0.15 * model, 0.2, 1);
  }

  protected expectations(profile: TokenProfile, score: TokenScore): {
    winRate: number;
    payoffRatio: number;
    stopPct: number;
    maxHoldMs: number;
  } {
    const volatility = realizedVolatility(profile.priceHistory.map((p) => p.priceUsd));

    // Volatility-scaled stop, bounded by the configured maximum. A fixed 25%
    // stop is far too tight for a token realizing 15% per bar and far too wide
    // for one realizing 2%.
    const dynamicStop = this.options.exit.useDynamicStop
      ? clamp(volatility * this.options.exit.atrStopMultiplier, 0.08, this.options.exit.stopLossPct / 100)
      : this.options.exit.stopLossPct / 100;

    // Payoff is derived from the take-profit ladder: the weighted average
    // multiple, minus one, is the expected gross win.
    const ladder = this.options.exit.takeProfitLevels;
    const weightedMultiple = ladder.reduce((acc, level) => acc + level.triggerMultiple * level.sellFraction, 0);
    const payoffRatio = clamp(safeDiv(weightedMultiple - 1, dynamicStop), 1.2, 8);

    // Win rate estimate: anchored low and nudged by the model's pump/dump
    // spread. Overstating this is the fastest way to oversize with Kelly.
    const modelEdge = score.probabilities.pump - score.probabilities.dump;
    const winRate = clamp(0.28 + 0.25 * modelEdge + 0.1 * (score.total - 80) / 20, 0.15, 0.45);

    return {
      winRate,
      payoffRatio,
      stopPct: dynamicStop,
      maxHoldMs: this.options.exit.timeStopMs,
    };
  }
}
