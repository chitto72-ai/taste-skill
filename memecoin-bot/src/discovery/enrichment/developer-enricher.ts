import type { DeveloperStats } from '../../core/domain/token.js';
import { TtlCache } from '../../core/utils/cache.js';
import { clamp01 } from '../../core/utils/math.js';
import type { Logger } from '../../logger/logger.js';
import type { Enricher, EnrichmentResult, TokenCandidate } from '../types.js';

export interface DeveloperHistory {
  readonly wallet: string;
  readonly walletAgeDays: number;
  readonly tokensLaunched: number;
  readonly ruggedTokens: number;
  readonly successfulTokens: number;
}

/** Backed by the bot's own token history plus, optionally, an external index. */
export interface DeveloperHistorySource {
  lookup(chain: string, wallet: string): Promise<DeveloperHistory | undefined>;
  /** Called after each scan so the local history grows over time. */
  observe(chain: string, wallet: string, tokenAddress: string, rugged: boolean): Promise<void>;
}

/**
 * Developer reputation.
 *
 * A serial rugger is the single most predictive negative signal available
 * before a launch has any price history, and it is cheap to check because the
 * bot has already seen most of these wallets. The local history source is
 * seeded from our own token table, so reputation compounds the longer the bot
 * runs.
 */
export class DeveloperEnricher implements Enricher {
  readonly name = 'developer';
  readonly slice = 'developer' as const;

  private readonly cache = new TtlCache<string, DeveloperHistory>({ ttlMs: 30 * 60_000, maxEntries: 5_000 });
  private readonly logger: Logger;

  constructor(
    private readonly source: DeveloperHistorySource | undefined,
    logger: Logger,
  ) {
    this.logger = logger.child('enricher:developer');
  }

  async enrich(candidate: TokenCandidate): Promise<EnrichmentResult> {
    const feed = candidate.developer ?? {};
    const wallet = feed.wallet ?? '';
    const missing: string[] = [];

    let history: DeveloperHistory | undefined;
    if (wallet && this.source) {
      const key = `${candidate.ref.chain}:${wallet.toLowerCase()}`;
      history = this.cache.get(key);
      if (!history) {
        try {
          history = await this.source.lookup(String(candidate.ref.chain), wallet);
          if (history) this.cache.set(key, history);
        } catch (error) {
          this.logger.debug({ wallet, err: error }, 'developer history lookup failed');
        }
      }
    }

    // A field is only "missing" when neither the feed nor our own history
    // supplied it; an unknown developer is different from an unqueried one.
    if (!wallet) missing.push('developer.wallet');
    if (feed.tokensLaunched === undefined && !history) missing.push('developer.tokensLaunched');
    if (feed.ruggedTokens === undefined && !history) missing.push('developer.ruggedTokens');
    if (feed.walletAgeDays === undefined && !history) missing.push('developer.walletAgeDays');

    const stats: Partial<DeveloperStats> = {
      wallet,
      walletAgeDays: feed.walletAgeDays ?? history?.walletAgeDays ?? 0,
      tokensLaunched: feed.tokensLaunched ?? history?.tokensLaunched ?? 0,
      ruggedTokens: feed.ruggedTokens ?? history?.ruggedTokens ?? 0,
      successfulTokens: feed.successfulTokens ?? history?.successfulTokens ?? 0,
      devSoldPct: clamp01(feed.devSoldPct ?? 0),
      devBalancePct: clamp01(feed.devBalancePct ?? candidate.holders?.devHoldingPct ?? 0),
    };

    return { developer: stats, missing };
  }
}
