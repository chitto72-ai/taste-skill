import type {
  DeveloperStats,
  HolderStats,
  PricePoint,
  SecurityFlags,
  SmartMoneyStats,
  SocialStats,
  TokenProfile,
} from '../core/domain/token.js';
import { tokenKey } from '../core/domain/token.js';
import { withTimeout } from '../core/utils/async.js';
import { TtlCache } from '../core/utils/cache.js';
import type { Logger } from '../logger/logger.js';
import type { Enricher, TokenCandidate } from './types.js';

export interface PipelineOptions {
  readonly enrichers: readonly Enricher[];
  readonly logger: Logger;
  /** Per-stage budget; a slow provider must not stall the scan. */
  readonly stageTimeoutMs?: number;
  /** How many price points to retain per token. */
  readonly historyLength?: number;
  readonly historyTtlMs?: number;
}

export interface PipelineResult {
  readonly profile: TokenProfile;
  /** Field paths no stage could determine — drives the score's confidence. */
  readonly missing: readonly string[];
  readonly durationMs: number;
}

const DEFAULT_HOLDERS: HolderStats = {
  count: 0,
  growth5m: 0,
  growth1h: 0,
  top10Pct: 0.5,
  top25Pct: 0.7,
  concentrationHhi: 0.3,
  devHoldingPct: 0,
  snipersPct: 0,
  insidersPct: 0,
  bundledPct: 0,
};

const DEFAULT_SECURITY: SecurityFlags = {
  mintAuthorityRevoked: false,
  freezeAuthorityRevoked: false,
  ownershipRenounced: false,
  lpLocked: false,
  lpBurned: false,
  isHoneypot: false,
  hasTransferTax: false,
  buyTaxPct: 0,
  sellTaxPct: 0,
  hasBlacklistFn: false,
  isProxyUpgradable: false,
  bundleDetected: false,
  bundleWallets: 0,
  onDenyList: false,
};

const DEFAULT_SMART_MONEY: SmartMoneyStats = {
  smartWalletsHolding: 0,
  smartWalletsBuying5m: 0,
  smartNetFlowUsd5m: 0,
  whalesHolding: 0,
  whaleNetFlowUsd5m: 0,
  kolMentions: 0,
  insiderWallets: 0,
};

const DEFAULT_SOCIAL: SocialStats = {
  twitterFollowers: 0,
  twitterMentions1h: 0,
  twitterGrowth1h: 0,
  telegramMembers: 0,
  telegramGrowth1h: 0,
  hasVerifiedSocials: false,
  sentiment: 0,
};

const DEFAULT_DEVELOPER: DeveloperStats = {
  wallet: '',
  walletAgeDays: 0,
  tokensLaunched: 0,
  ruggedTokens: 0,
  successfulTokens: 0,
  devSoldPct: 0,
  devBalancePct: 0,
};

/**
 * Turns a raw candidate into a scored-ready `TokenProfile`.
 *
 * Stages run in parallel and are individually timed out. A stage that fails or
 * times out contributes its fields to `missing` instead of throwing, because
 * dropping a token because one social API was slow is a worse outcome than
 * scoring it with lower confidence.
 */
export class EnrichmentPipeline {
  private readonly history: TtlCache<string, PricePoint[]>;
  private readonly firstSeen: TtlCache<string, number>;
  private readonly logger: Logger;
  private readonly stageTimeoutMs: number;
  private readonly historyLength: number;

  constructor(private readonly options: PipelineOptions) {
    this.logger = options.logger.child('pipeline');
    this.stageTimeoutMs = options.stageTimeoutMs ?? 4_000;
    this.historyLength = options.historyLength ?? 60;
    const ttl = options.historyTtlMs ?? 6 * 60 * 60_000;
    this.history = new TtlCache({ ttlMs: ttl, maxEntries: 5_000 });
    this.firstSeen = new TtlCache({ ttlMs: ttl, maxEntries: 5_000 });
  }

  async run(candidate: TokenCandidate): Promise<PipelineResult> {
    const started = Date.now();
    const key = tokenKey(candidate.ref);

    const results = await Promise.all(
      this.options.enrichers.map(async (enricher) => {
        try {
          return await withTimeout(enricher.enrich(candidate), this.stageTimeoutMs, `enrich:${enricher.name}`);
        } catch (error) {
          this.logger.debug({ stage: enricher.name, token: candidate.ref.address, err: error }, 'enrichment stage failed');
          return { missing: [`${enricher.slice}.*`] };
        }
      }),
    );

    const missing = results.flatMap((r) => r.missing);
    const holders = { ...DEFAULT_HOLDERS, ...candidate.holders };
    const security = { ...DEFAULT_SECURITY, ...candidate.security };
    const smartMoney = { ...DEFAULT_SMART_MONEY, ...candidate.smartMoney };
    const social = { ...DEFAULT_SOCIAL, ...candidate.social };
    const developer = { ...DEFAULT_DEVELOPER, ...candidate.developer };

    for (const result of results) {
      Object.assign(holders, stripUndefined(result.holders));
      Object.assign(security, stripUndefined(result.security));
      Object.assign(smartMoney, stripUndefined(result.smartMoney));
      Object.assign(social, stripUndefined(result.social));
      Object.assign(developer, stripUndefined(result.developer));
    }

    const priceHistory = this.appendHistory(key, {
      t: candidate.market.at,
      priceUsd: candidate.market.priceUsd,
      volumeUsd: candidate.market.volume5mUsd,
      liquidityUsd: candidate.market.liquidityUsd,
      holders: holders.count,
    });

    let discoveredAt = this.firstSeen.get(key);
    if (discoveredAt === undefined) {
      discoveredAt = candidate.at;
      this.firstSeen.set(key, discoveredAt);
    }

    const profile: TokenProfile = {
      ref: candidate.ref,
      metadata: candidate.metadata,
      pool: candidate.pool,
      market: candidate.market,
      holders,
      security,
      smartMoney,
      social,
      developer,
      priceHistory,
      discoveredAt,
      updatedAt: candidate.at,
    };

    return { profile, missing, durationMs: Date.now() - started };
  }

  /** Exposed so the backtester can seed history without a live feed. */
  seedHistory(key: string, points: readonly PricePoint[]): void {
    this.history.set(key, points.slice(-this.historyLength));
  }

  private appendHistory(key: string, point: PricePoint): PricePoint[] {
    const series = this.history.get(key) ?? [];
    // A repeated poll within the same second is not a new observation.
    const last = series[series.length - 1];
    if (last && point.t - last.t < 1_000) return series;
    const next = [...series, point].slice(-this.historyLength);
    this.history.set(key, next);
    return next;
  }
}

function stripUndefined<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val !== undefined) out[key] = val;
  }
  return out as Partial<T>;
}
