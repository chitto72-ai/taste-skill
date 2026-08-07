import type { ChainId } from './chain.js';

/** Stable identity of a tradable asset: chain + mint/contract address. */
export interface TokenRef {
  readonly chain: ChainId;
  readonly address: string;
}

export function tokenKey(ref: TokenRef): string {
  return `${ref.chain}:${ref.address.toLowerCase()}`;
}

export interface TokenMetadata {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  /** Unix ms of the first observed liquidity event. */
  readonly createdAt: number;
  readonly totalSupply: number;
  readonly imageUrl?: string;
  readonly website?: string;
  readonly twitter?: string;
  readonly telegram?: string;
}

export interface PoolInfo {
  readonly address: string;
  readonly dex: string;
  readonly baseToken: string;
  readonly quoteToken: string;
  readonly liquidityUsd: number;
  readonly createdAt: number;
  /** Fraction of LP supply provably locked or burned, 0..1. */
  readonly lpLockedPct: number;
  readonly lpLockExpiry?: number;
}

export interface MarketSnapshot {
  readonly priceUsd: number;
  readonly priceNative: number;
  readonly marketCapUsd: number;
  readonly fdvUsd: number;
  readonly liquidityUsd: number;
  readonly volume5mUsd: number;
  readonly volume1hUsd: number;
  readonly volume24hUsd: number;
  readonly txns5m: { buys: number; sells: number };
  readonly txns1h: { buys: number; sells: number };
  readonly priceChange5m: number;
  readonly priceChange1h: number;
  readonly priceChange24h: number;
  readonly at: number;
}

export interface HolderStats {
  readonly count: number;
  /** Growth over the last 5 minutes, as a ratio (0.2 == +20%). */
  readonly growth5m: number;
  readonly growth1h: number;
  /** Share of supply held by the top 10 wallets excluding pools, 0..1. */
  readonly top10Pct: number;
  readonly top25Pct: number;
  /** Herfindahl-Hirschman index of the holder distribution, 0..1. */
  readonly concentrationHhi: number;
  readonly devHoldingPct: number;
  readonly snipersPct: number;
  readonly insidersPct: number;
  readonly bundledPct: number;
}

export interface SecurityFlags {
  readonly mintAuthorityRevoked: boolean;
  readonly freezeAuthorityRevoked: boolean;
  readonly ownershipRenounced: boolean;
  readonly lpLocked: boolean;
  readonly lpBurned: boolean;
  readonly isHoneypot: boolean;
  readonly hasTransferTax: boolean;
  readonly buyTaxPct: number;
  readonly sellTaxPct: number;
  readonly hasBlacklistFn: boolean;
  readonly isProxyUpgradable: boolean;
  readonly bundleDetected: boolean;
  readonly bundleWallets: number;
  readonly onDenyList: boolean;
}

export interface SmartMoneyStats {
  readonly smartWalletsHolding: number;
  readonly smartWalletsBuying5m: number;
  readonly smartNetFlowUsd5m: number;
  readonly whalesHolding: number;
  readonly whaleNetFlowUsd5m: number;
  readonly kolMentions: number;
  readonly insiderWallets: number;
}

export interface SocialStats {
  readonly twitterFollowers: number;
  readonly twitterMentions1h: number;
  readonly twitterGrowth1h: number;
  readonly telegramMembers: number;
  readonly telegramGrowth1h: number;
  readonly hasVerifiedSocials: boolean;
  /** Composite 0..100 supplied by upstream social providers. */
  readonly sentiment: number;
}

export interface DeveloperStats {
  readonly wallet: string;
  readonly walletAgeDays: number;
  readonly tokensLaunched: number;
  readonly ruggedTokens: number;
  readonly successfulTokens: number;
  readonly devSoldPct: number;
  readonly devBalancePct: number;
}

/**
 * Everything the scoring engine needs about one token, assembled by the
 * discovery pipeline. Deliberately a flat aggregate: enrichment stages fill
 * slices independently and the scorer never performs I/O.
 */
export interface TokenProfile {
  readonly ref: TokenRef;
  readonly metadata: TokenMetadata;
  readonly pool: PoolInfo;
  readonly market: MarketSnapshot;
  readonly holders: HolderStats;
  readonly security: SecurityFlags;
  readonly smartMoney: SmartMoneyStats;
  readonly social: SocialStats;
  readonly developer: DeveloperStats;
  /** Recent price series (oldest first) used for momentum/volatility metrics. */
  readonly priceHistory: readonly PricePoint[];
  readonly discoveredAt: number;
  readonly updatedAt: number;
}

export interface PricePoint {
  readonly t: number;
  readonly priceUsd: number;
  readonly volumeUsd: number;
  readonly liquidityUsd: number;
  readonly holders: number;
}
