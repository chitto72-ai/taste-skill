import type { ChainId } from '../core/domain/chain.js';
import { TtlCache } from '../core/utils/cache.js';
import { SingleFlight, withTimeout } from '../core/utils/async.js';
import type { Logger } from '../logger/logger.js';
import { getChain } from '../config/chains.config.js';
import type { PriceOracle } from './types.js';

/**
 * Conservative fallbacks. They exist so gas accounting degrades to "roughly
 * right" instead of dividing by zero when the price feed is unreachable — the
 * risk layer treats a stale native price as a reason to be more cautious, not
 * a reason to stop trading.
 */
const FALLBACK_USD: Record<string, number> = {
  solana: 150,
  ethereum: 3_000,
  binancecoin: 600,
  hyperliquid: 30,
};

export interface PriceOracleOptions {
  readonly logger: Logger;
  readonly ttlMs?: number;
  /** Injected for tests and for swapping the upstream provider. */
  readonly fetchPrices?: (ids: readonly string[]) => Promise<Record<string, number>>;
  readonly timeoutMs?: number;
}

export class HttpPriceOracle implements PriceOracle {
  private readonly cache: TtlCache<string, number>;
  private readonly inflight = new SingleFlight<number>();
  private readonly logger: Logger;
  private readonly fetchPrices: (ids: readonly string[]) => Promise<Record<string, number>>;
  private readonly timeoutMs: number;
  private lastSuccessAt = 0;

  constructor(options: PriceOracleOptions) {
    this.logger = options.logger.child('price-oracle');
    this.cache = new TtlCache({ ttlMs: options.ttlMs ?? 60_000, maxEntries: 500 });
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.fetchPrices = options.fetchPrices ?? ((ids) => this.fetchFromCoingecko(ids));
  }

  get lastUpdateAt(): number {
    return this.lastSuccessAt;
  }

  async nativeUsd(chain: ChainId): Promise<number> {
    const priceId = getChain(chain).nativeCurrency.priceId;
    const cached = this.cache.get(priceId);
    if (cached !== undefined) return cached;

    return this.inflight.run(priceId, async () => {
      try {
        const prices = await withTimeout(this.fetchPrices([priceId]), this.timeoutMs, 'price-fetch');
        const price = prices[priceId];
        if (typeof price === 'number' && price > 0) {
          this.cache.set(priceId, price);
          this.lastSuccessAt = Date.now();
          return price;
        }
        throw new Error(`missing price for ${priceId}`);
      } catch (error) {
        const fallback = FALLBACK_USD[priceId] ?? 1;
        this.logger.warn({ priceId, fallback, err: error }, 'native price lookup failed, using fallback');
        // Short TTL so we retry the real feed soon.
        this.cache.set(priceId, fallback, 15_000);
        return fallback;
      }
    });
  }

  /**
   * Token prices come from the discovery pipeline (pool state), not from a
   * generic price API — brand-new memecoins are not listed anywhere. This
   * returns a value only when something has explicitly primed the cache.
   */
  async tokenUsd(chain: ChainId, tokenAddress: string): Promise<number | undefined> {
    return this.cache.get(tokenKeyOf(chain, tokenAddress));
  }

  /** Called by the scanner whenever a fresh pool price is observed. */
  primeToken(chain: ChainId, tokenAddress: string, priceUsd: number, ttlMs = 30_000): void {
    if (priceUsd > 0) this.cache.set(tokenKeyOf(chain, tokenAddress), priceUsd, ttlMs);
  }

  private async fetchFromCoingecko(ids: readonly string[]): Promise<Record<string, number>> {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(',')}&vs_currencies=usd`;
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`price feed HTTP ${response.status}`);
    const json = (await response.json()) as Record<string, { usd?: number }>;
    const out: Record<string, number> = {};
    for (const id of ids) {
      const price = json[id]?.usd;
      if (typeof price === 'number') out[id] = price;
    }
    return out;
  }
}

/** Deterministic oracle for tests and backtests. */
export class StaticPriceOracle implements PriceOracle {
  constructor(private readonly prices: Record<string, number> = FALLBACK_USD) {}

  async nativeUsd(chain: ChainId): Promise<number> {
    return this.prices[getChain(chain).nativeCurrency.priceId] ?? 1;
  }

  async tokenUsd(chain: ChainId, tokenAddress: string): Promise<number | undefined> {
    return this.prices[tokenKeyOf(chain, tokenAddress)];
  }
}

function tokenKeyOf(chain: ChainId, address: string): string {
  return `token:${chain}:${address.toLowerCase()}`;
}
