import type { ChainId } from '../core/domain/chain.js';
import type {
  DeveloperStats,
  HolderStats,
  MarketSnapshot,
  PoolInfo,
  SecurityFlags,
  SmartMoneyStats,
  SocialStats,
  TokenMetadata,
  TokenProfile,
  TokenRef,
} from '../core/domain/token.js';

/** Raw listing straight off a feed, before enrichment. */
export interface TokenCandidate {
  readonly ref: TokenRef;
  readonly metadata: TokenMetadata;
  readonly pool: PoolInfo;
  readonly market: MarketSnapshot;
  /** Fields a feed may already provide; enrichers fill the rest. */
  readonly holders?: Partial<HolderStats>;
  readonly security?: Partial<SecurityFlags>;
  readonly smartMoney?: Partial<SmartMoneyStats>;
  readonly social?: Partial<SocialStats>;
  readonly developer?: Partial<DeveloperStats>;
  readonly source: string;
  readonly at: number;
}

/**
 * A stream of newly-listed tokens / pools. Implemented by the venue adapter
 * (Axiom), by on-chain log watchers, or by the synthetic feed used in paper
 * mode and tests.
 */
export interface TokenFeed {
  readonly name: string;
  readonly chains: readonly ChainId[];
  /** Candidates observed since the previous poll. */
  poll(): Promise<TokenCandidate[]>;
  /** Refreshes market data for tokens already being tracked. */
  refresh(refs: readonly TokenRef[]): Promise<Map<string, MarketSnapshot>>;
  start?(): Promise<void>;
  stop?(): Promise<void>;
}

/**
 * One enrichment stage. Stages run concurrently against the same candidate and
 * each returns only the slice it owns, so a slow or failing provider degrades
 * one dimension of the score instead of dropping the token.
 */
export interface Enricher {
  readonly name: string;
  readonly slice: 'holders' | 'security' | 'smartMoney' | 'social' | 'developer';
  enrich(candidate: TokenCandidate): Promise<EnrichmentResult>;
}

export interface EnrichmentResult {
  readonly holders?: Partial<HolderStats>;
  readonly security?: Partial<SecurityFlags>;
  readonly smartMoney?: Partial<SmartMoneyStats>;
  readonly social?: Partial<SocialStats>;
  readonly developer?: Partial<DeveloperStats>;
  /** Fields this stage could not determine; they count against confidence. */
  readonly missing: readonly string[];
}

export interface DiscoveryStats {
  readonly scans: number;
  readonly candidates: number;
  readonly filtered: number;
  readonly enriched: number;
  readonly scored: number;
  readonly accepted: number;
  readonly errors: number;
  readonly lastScanAt: number;
  readonly avgScanMs: number;
  readonly trackedTokens: number;
}

export interface FilterOutcome {
  readonly passed: boolean;
  readonly reason?: string;
}

export type { TokenProfile };
