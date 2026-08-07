import type { DiscoveryConfig } from '../config/schema.js';
import type { TokenCandidate, FilterOutcome } from './types.js';

/**
 * Cheap pre-filters applied before any enrichment I/O.
 *
 * Order matters: the goal is to reject 95% of a feed's firehose using data the
 * feed already gave us, so that the expensive stages (holder distribution,
 * security probes, socials) only run on plausible candidates.
 */
export class CandidateFilter {
  private readonly deniedTokens: Set<string>;
  private readonly deniedDevs: Set<string>;

  constructor(private readonly config: DiscoveryConfig) {
    this.deniedTokens = new Set(config.denyListTokens.map((v) => v.toLowerCase()));
    this.deniedDevs = new Set(config.denyListDevWallets.map((v) => v.toLowerCase()));
  }

  apply(candidate: TokenCandidate, now = Date.now()): FilterOutcome {
    const { config } = this;
    const address = candidate.ref.address.toLowerCase();

    if (this.deniedTokens.has(address)) return reject('token is deny-listed');
    if (candidate.developer?.wallet && this.deniedDevs.has(candidate.developer.wallet.toLowerCase())) {
      return reject('developer wallet is deny-listed');
    }

    const ageMs = now - candidate.metadata.createdAt;
    if (ageMs < config.minTokenAgeSeconds * 1_000) {
      // Sub-minute tokens are still in the bundle/snipe window; the holder
      // distribution at this age tells us nothing.
      return reject(`token too young (${Math.round(ageMs / 1000)}s)`);
    }
    if (ageMs > config.maxTokenAgeMinutes * 60_000) {
      return reject(`token too old (${Math.round(ageMs / 60_000)}m)`);
    }

    const { market } = candidate;
    if (market.liquidityUsd < config.minLiquidityUsd) {
      return reject(`liquidity $${Math.round(market.liquidityUsd)} below floor`);
    }
    if (market.liquidityUsd > config.maxLiquidityUsd) {
      return reject(`liquidity $${Math.round(market.liquidityUsd)} above ceiling`);
    }
    if (market.marketCapUsd < config.minMarketCapUsd) {
      return reject(`market cap $${Math.round(market.marketCapUsd)} below floor`);
    }
    if (market.marketCapUsd > config.maxMarketCapUsd) {
      return reject(`market cap $${Math.round(market.marketCapUsd)} above ceiling`);
    }
    if (market.volume5mUsd < config.minVolume5mUsd) {
      return reject(`5m volume $${Math.round(market.volume5mUsd)} below floor`);
    }
    if (market.priceUsd <= 0) return reject('no valid price');

    const holders = candidate.holders?.count;
    if (holders !== undefined && holders < config.minHolders) {
      return reject(`only ${holders} holders`);
    }

    // A pool with no trades in the last 5 minutes is not tradable, whatever
    // its headline liquidity says.
    const txns = market.txns5m;
    if (txns.buys + txns.sells === 0) return reject('no transactions in the last 5m');

    return { passed: true };
  }
}

function reject(reason: string): FilterOutcome {
  return { passed: false, reason };
}
