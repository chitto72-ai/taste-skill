import type { TokenRef } from '../core/domain/token.js';
import type { MarketDataSource } from '../exchanges/types.js';
import type { TokenScanner } from './scanner.js';

/** Optional secondary source consulted when the scanner has no profile yet. */
export interface FallbackMarketData {
  priceOf(ref: TokenRef): number | undefined;
  liquidityOf(ref: TokenRef): number | undefined;
}

/**
 * Adapts the scanner's tracked profiles into the market-data interface the
 * paper venue and the backtester consume.
 *
 * Reading fills from the same snapshot the strategy acted on is what keeps a
 * paper run honest: if the scanner's data is stale, the simulated fill is
 * stale in exactly the same way, rather than being silently better than what
 * live execution would have achieved.
 */
export class ScannerMarketData implements MarketDataSource {
  constructor(
    private readonly scanner: TokenScanner,
    private readonly fallback?: FallbackMarketData,
  ) {}

  priceOf(token: TokenRef): number | undefined {
    const profile = this.scanner.profileOf(token);
    if (profile && profile.market.priceUsd > 0) return profile.market.priceUsd;
    return this.fallback?.priceOf(token);
  }

  liquidityOf(token: TokenRef): number | undefined {
    const profile = this.scanner.profileOf(token);
    if (profile && profile.market.liquidityUsd > 0) return profile.market.liquidityUsd;
    return this.fallback?.liquidityOf(token);
  }
}
