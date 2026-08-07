import type { TokenScore } from '../core/domain/scoring.js';
import type { EntryCondition, StrategyContext } from '../core/domain/signal.js';
import type { TokenProfile } from '../core/domain/token.js';
import { tokenKey } from '../core/domain/token.js';
import type { WalletActivity } from '../core/domain/wallet.js';
import { clamp, clamp01, realizedVolatility, safeDiv } from '../core/utils/math.js';
import type { CopyTradingConfig, ExitConfig } from '../config/schema.js';
import type { WalletTracker } from '../wallets/tracker/wallet-tracker.js';
import { BaseStrategy } from './base-strategy.js';

export interface CopyTradingStrategyOptions {
  readonly config: CopyTradingConfig;
  readonly exit: ExitConfig;
  readonly tracker: WalletTracker;
}

interface RecentBuy {
  readonly activity: WalletActivity;
  readonly at: number;
}

/**
 * Optional mirroring module.
 *
 * Two rules make this safe enough to run alongside the primary strategies:
 *
 *  1. **Copying is not blind.** A mirrored token still has to clear a (lower)
 *     score bar and carry no vetoes. Following a good trader into a honeypot
 *     is still a honeypot.
 *  2. **Signals expire fast.** A qualifying wallet's buy is only actionable
 *     for `maxSignalAgeMs`; after that the information is priced in and we
 *     would be providing exit liquidity to the very wallet we are following.
 *
 * Positions are sized down by `sizeMultiplier` because the edge is second-hand.
 */
export class CopyTradingStrategy extends BaseStrategy {
  readonly name = 'copy-trading';
  override readonly priority = 8;

  private readonly recentBuys = new Map<string, RecentBuy>();

  constructor(private readonly options: CopyTradingStrategyOptions) {
    super(options.config.enabled);
  }

  /** Fed from `wallet.activity` events by the engine. */
  observe(activity: WalletActivity): void {
    if (activity.side !== 'buy') return;
    const wallet = this.options.tracker.get(String(activity.chain), activity.wallet);
    if (!wallet?.copyEnabled) return;

    const key = tokenKey({ chain: activity.chain, address: activity.tokenAddress });
    const existing = this.recentBuys.get(key);
    // Keep the freshest qualifying buy for each token.
    if (!existing || activity.at > existing.at) {
      this.recentBuys.set(key, { activity, at: activity.at });
    }
    this.sweep(activity.at);
  }

  /** Mirrored exit: true when every followed wallet has sold out. */
  shouldMirrorExit(profile: TokenProfile, now: number): boolean {
    if (!this.options.config.mirrorExits) return false;
    const entry = this.recentBuys.get(tokenKey(profile.ref));
    if (!entry) return false;
    return now - entry.at > this.options.config.maxSignalAgeMs * 6;
  }

  protected conditions(profile: TokenProfile, score: TokenScore, context: StrategyContext): EntryCondition[] {
    const { config } = this.options;
    const conditions: EntryCondition[] = [];
    const entry = this.recentBuys.get(tokenKey(profile.ref));

    conditions.push(
      this.condition(
        'followed_buy',
        'A qualifying wallet bought this token',
        entry !== undefined,
        entry ? `${entry.activity.wallet.slice(0, 10)}… bought $${Math.round(entry.activity.amountUsd)}` : 'no tracked buy',
      ),
    );
    if (!entry) return conditions;

    const age = context.now - entry.at;
    conditions.push(
      this.condition(
        'signal_fresh',
        'Signal still actionable',
        age <= config.maxSignalAgeMs,
        `${Math.round(age / 1000)}s old (limit ${Math.round(config.maxSignalAgeMs / 1000)}s)`,
      ),
    );

    conditions.push(
      this.condition(
        'score',
        'Token clears the copy-trading score floor',
        score.total >= config.minTokenScore,
        `score ${score.total} vs floor ${config.minTokenScore}`,
      ),
    );

    conditions.push(
      this.condition('no_vetoes', 'No disqualifying flags', score.vetoes.length === 0, score.vetoes.join('; ') || 'clean'),
    );

    const wallet = this.options.tracker.get(String(entry.activity.chain), entry.activity.wallet);
    conditions.push(
      this.condition(
        'wallet_qualified',
        'Source wallet still qualifies',
        wallet?.copyEnabled === true,
        wallet ? this.options.tracker.explain(wallet) : 'wallet no longer tracked',
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
    const entry = this.recentBuys.get(tokenKey(profile.ref));
    const wallet = entry
      ? this.options.tracker.get(String(entry.activity.chain), entry.activity.wallet)
      : undefined;

    // Conviction tracks the source wallet's track record, then is scaled down
    // by the configured multiplier because the edge is inherited, not ours.
    const walletQuality = wallet ? clamp01((wallet.stats.winRate - 0.5) / 0.4) : 0.3;
    const scoreQuality = clamp01(score.total / 100);
    return clamp((0.3 + 0.45 * walletQuality + 0.25 * scoreQuality) * this.options.config.sizeMultiplier, 0.1, 0.8);
  }

  protected expectations(profile: TokenProfile, score: TokenScore): {
    winRate: number;
    payoffRatio: number;
    stopPct: number;
    maxHoldMs: number;
  } {
    const entry = this.recentBuys.get(tokenKey(profile.ref));
    const wallet = entry
      ? this.options.tracker.get(String(entry.activity.chain), entry.activity.wallet)
      : undefined;

    const volatility = realizedVolatility(profile.priceHistory.map((p) => p.priceUsd));
    const stopPct = clamp(volatility * 2.5, 0.08, this.options.exit.stopLossPct / 100);

    // Anchor on the followed wallet's historical win rate, then haircut it:
    // we enter later than they did and pay more.
    const base = wallet ? wallet.stats.winRate * 0.75 : 0.3;
    const winRate = clamp(base + 0.1 * (score.probabilities.pump - score.probabilities.dump), 0.18, 0.5);
    const payoffRatio = clamp(safeDiv(1.2, stopPct), 1.2, 6);

    return {
      winRate,
      payoffRatio,
      stopPct,
      maxHoldMs: Math.round(this.options.exit.timeStopMs * 0.75),
    };
  }

  private sweep(now: number): void {
    const cutoff = now - this.options.config.maxSignalAgeMs * 10;
    for (const [key, entry] of this.recentBuys) {
      if (entry.at < cutoff) this.recentBuys.delete(key);
    }
  }
}
