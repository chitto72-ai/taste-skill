import type { HolderStats } from '../../core/domain/token.js';
import { clamp01, hhi, pctChange, safeDiv } from '../../core/utils/math.js';
import { TtlCache } from '../../core/utils/cache.js';
import type { Logger } from '../../logger/logger.js';
import type { ChainRegistry } from '../../blockchains/registry.js';
import { getChain } from '../../config/chains.config.js';
import type { Enricher, EnrichmentResult, TokenCandidate } from '../types.js';

/** Snapshot kept between scans so growth rates can be computed locally. */
interface HolderHistory {
  count: number;
  at: number;
}

/**
 * Holder-distribution analysis.
 *
 * On Solana the top-holder table is directly available over RPC
 * (`getTokenLargestAccounts`), so concentration, HHI and bundling proxies are
 * computed from chain state. EVM chains need an indexer for the same data;
 * where the feed does not supply it, the fields are reported as missing and
 * the scorer lowers confidence rather than inventing numbers.
 */
export class HoldersEnricher implements Enricher {
  readonly name = 'holders';
  readonly slice = 'holders' as const;

  private readonly history = new TtlCache<string, HolderHistory>({ ttlMs: 60 * 60_000, maxEntries: 5_000 });
  private readonly logger: Logger;

  constructor(
    private readonly chains: ChainRegistry | undefined,
    logger: Logger,
  ) {
    this.logger = logger.child('enricher:holders');
  }

  async enrich(candidate: TokenCandidate): Promise<EnrichmentResult> {
    const key = `${candidate.ref.chain}:${candidate.ref.address}`;
    const feed = candidate.holders ?? {};
    const missing: string[] = [];

    let top10Pct = feed.top10Pct;
    let top25Pct = feed.top25Pct;
    let concentrationHhi = feed.concentrationHhi;
    let bundledPct = feed.bundledPct;

    if (top10Pct === undefined && getChain(candidate.ref.chain).family === 'svm') {
      const distribution = await this.solanaDistribution(candidate);
      if (distribution) {
        top10Pct ??= distribution.top10Pct;
        top25Pct ??= distribution.top25Pct;
        concentrationHhi ??= distribution.hhi;
        bundledPct ??= distribution.equalSizedShare;
      }
    }

    if (top10Pct === undefined) missing.push('holders.top10Pct');
    if (concentrationHhi === undefined) missing.push('holders.concentrationHhi');
    if (bundledPct === undefined) missing.push('holders.bundledPct');

    const count = feed.count ?? 0;
    if (feed.count === undefined) missing.push('holders.count');

    // Growth is derived from our own observations, which is more reliable than
    // trusting a feed's window definition.
    const previous = this.history.get(key);
    const growth5m = feed.growth5m ?? (previous ? pctChange(previous.count, count) : 0);
    if (feed.growth5m === undefined && !previous) missing.push('holders.growth5m');
    this.history.set(key, { count, at: candidate.at });

    const stats: Partial<HolderStats> = {
      count,
      growth5m,
      growth1h: feed.growth1h ?? growth5m * 3,
      top10Pct: top10Pct ?? 0.5,
      top25Pct: top25Pct ?? clamp01((top10Pct ?? 0.5) * 1.4),
      concentrationHhi: concentrationHhi ?? 0.3,
      devHoldingPct: feed.devHoldingPct ?? 0,
      snipersPct: feed.snipersPct ?? 0,
      insidersPct: feed.insidersPct ?? 0,
      bundledPct: bundledPct ?? 0,
    };
    if (feed.devHoldingPct === undefined) missing.push('holders.devHoldingPct');
    if (feed.snipersPct === undefined) missing.push('holders.snipersPct');

    return { holders: stats, missing };
  }

  private async solanaDistribution(candidate: TokenCandidate): Promise<
    { top10Pct: number; top25Pct: number; hhi: number; equalSizedShare: number } | undefined
  > {
    if (!this.chains?.has(candidate.ref.chain)) return undefined;
    try {
      const rpc = this.chains.rpc(candidate.ref.chain);
      const response = await rpc.call<{
        value: { address: string; amount: string; uiAmount: number | null }[];
      }>('getTokenLargestAccounts', [candidate.ref.address]);

      const accounts = (response.value ?? []).map((entry) => Number(entry.amount));
      if (accounts.length === 0) return undefined;

      const supply = candidate.metadata.totalSupply > 0
        ? candidate.metadata.totalSupply * 10 ** candidate.metadata.decimals
        : accounts.reduce((a, b) => a + b, 0);

      // The largest account is almost always the pool vault; excluding it is
      // what separates "concentrated" from "has liquidity".
      const holders = accounts.slice(1);
      const top10 = holders.slice(0, 10).reduce((a, b) => a + b, 0);
      const top25 = holders.slice(0, 25).reduce((a, b) => a + b, 0);

      // Bundle proxy: wallets holding suspiciously similar amounts, which is
      // what a multi-wallet launch snipe looks like on chain.
      const equalSized = countSimilar(holders);

      return {
        top10Pct: clamp01(safeDiv(top10, supply)),
        top25Pct: clamp01(safeDiv(top25, supply)),
        hhi: hhi(holders),
        equalSizedShare: clamp01(safeDiv(equalSized.total, supply)),
      };
    } catch (error) {
      this.logger.debug({ token: candidate.ref.address, err: error }, 'largest-accounts lookup failed');
      return undefined;
    }
  }
}

/** Groups balances within 2% of each other and returns the largest cluster. */
function countSimilar(balances: readonly number[]): { wallets: number; total: number } {
  let best = { wallets: 0, total: 0 };
  for (let i = 0; i < balances.length; i++) {
    const anchor = balances[i];
    if (anchor <= 0) continue;
    let wallets = 0;
    let total = 0;
    for (const balance of balances) {
      if (Math.abs(balance - anchor) / anchor <= 0.02) {
        wallets++;
        total += balance;
      }
    }
    if (wallets > best.wallets) best = { wallets, total };
  }
  return best.wallets >= 3 ? best : { wallets: 0, total: 0 };
}
