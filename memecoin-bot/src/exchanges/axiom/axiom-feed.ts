import type { ChainId } from '../../core/domain/chain.js';
import type { MarketSnapshot, TokenRef } from '../../core/domain/token.js';
import { tokenKey } from '../../core/domain/token.js';
import type { Logger } from '../../logger/logger.js';
import type { TokenCandidate, TokenFeed } from '../../discovery/types.js';
import type { AxiomClient } from './axiom-client.js';

/** Venue listing payload; every field is optional because feeds drift. */
interface AxiomTokenPayload {
  chain?: string;
  address?: string;
  mint?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  createdAt?: number;
  totalSupply?: number;
  imageUrl?: string;
  website?: string;
  twitter?: string;
  telegram?: string;

  poolAddress?: string;
  dex?: string;
  liquidityUsd?: number;
  poolCreatedAt?: number;
  lpLockedPct?: number;
  lpBurned?: boolean;

  priceUsd?: number;
  marketCapUsd?: number;
  volume5mUsd?: number;
  volume1hUsd?: number;
  volume24hUsd?: number;
  buys5m?: number;
  sells5m?: number;
  buys1h?: number;
  sells1h?: number;
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange24h?: number;

  holders?: number;
  top10HolderPct?: number;
  devHoldingPct?: number;
  sniperPct?: number;
  insiderPct?: number;
  bundledPct?: number;

  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  renounced?: boolean;
  isHoneypot?: boolean;
  buyTaxPct?: number;
  sellTaxPct?: number;

  smartWallets?: number;
  smartBuys5m?: number;
  smartNetFlow5m?: number;
  whales?: number;
  whaleNetFlow5m?: number;
  kolMentions?: number;

  twitterFollowers?: number;
  telegramMembers?: number;

  devWallet?: string;
  devWalletAgeDays?: number;
  devTokensLaunched?: number;
  devRugged?: number;
}

export interface AxiomFeedOptions {
  readonly client: AxiomClient;
  readonly chains: readonly ChainId[];
  readonly logger: Logger;
  /** Listings newer than this are requested on each poll. */
  readonly lookbackMs?: number;
}

/**
 * New-pair feed backed by the venue's discovery endpoint.
 *
 * Percentage fields arrive in either 0..1 or 0..100 form depending on the
 * endpoint; `ratio()` normalizes both. That sounds pedantic until a 35 that
 * should have been 0.35 silently turns every token into a concentration veto.
 */
export class AxiomTokenFeed implements TokenFeed {
  readonly name = 'axiom';
  readonly chains: readonly ChainId[];

  private lastPollAt = 0;
  private readonly logger: Logger;

  constructor(private readonly options: AxiomFeedOptions) {
    this.chains = options.chains;
    this.logger = options.logger.child('feed:axiom');
  }

  async poll(): Promise<TokenCandidate[]> {
    const since = this.lastPollAt || Date.now() - (this.options.lookbackMs ?? 10 * 60_000);
    this.lastPollAt = Date.now();

    const results = await Promise.all(
      this.chains.map(async (chain) => {
        try {
          const response = await this.options.client.request<{ tokens?: AxiomTokenPayload[] }>({
            method: 'GET',
            path: '/v1/tokens/new',
            query: { chain: String(chain), since },
          });
          return (response.tokens ?? []).map((payload) => this.toCandidate(payload, chain));
        } catch (error) {
          this.logger.warn({ chain, err: error }, 'new-token poll failed');
          return [];
        }
      }),
    );

    return results.flat().filter((candidate): candidate is TokenCandidate => candidate !== undefined);
  }

  async refresh(refs: readonly TokenRef[]): Promise<Map<string, MarketSnapshot>> {
    const out = new Map<string, MarketSnapshot>();
    if (refs.length === 0) return out;
    try {
      const response = await this.options.client.request<{ tokens?: AxiomTokenPayload[] }>({
        method: 'POST',
        path: '/v1/tokens/batch',
        body: { tokens: refs.map((ref) => ({ chain: String(ref.chain), address: ref.address })) },
      });
      for (const payload of response.tokens ?? []) {
        const address = payload.address ?? payload.mint;
        if (!address || !payload.chain) continue;
        const ref: TokenRef = { chain: payload.chain, address };
        out.set(tokenKey(ref), this.toMarket(payload));
      }
    } catch (error) {
      this.logger.warn({ count: refs.length, err: error }, 'batch refresh failed');
    }
    return out;
  }

  private toCandidate(payload: AxiomTokenPayload, chain: ChainId): TokenCandidate | undefined {
    const address = payload.address ?? payload.mint;
    if (!address) return undefined;
    const now = Date.now();
    const createdAt = payload.createdAt ?? payload.poolCreatedAt ?? now;

    return {
      ref: { chain, address },
      metadata: {
        name: payload.name ?? payload.symbol ?? address.slice(0, 8),
        symbol: payload.symbol ?? '???',
        decimals: payload.decimals ?? (chain === 'solana' ? 9 : 18),
        createdAt,
        totalSupply: payload.totalSupply ?? 0,
        imageUrl: payload.imageUrl,
        website: payload.website,
        twitter: payload.twitter,
        telegram: payload.telegram,
      },
      pool: {
        address: payload.poolAddress ?? address,
        dex: payload.dex ?? 'unknown',
        baseToken: address,
        quoteToken: 'USDC',
        liquidityUsd: payload.liquidityUsd ?? 0,
        createdAt: payload.poolCreatedAt ?? createdAt,
        lpLockedPct: payload.lpBurned ? 1 : ratio(payload.lpLockedPct) ?? 0,
      },
      market: this.toMarket(payload),
      holders: {
        count: payload.holders,
        top10Pct: ratio(payload.top10HolderPct),
        devHoldingPct: ratio(payload.devHoldingPct),
        snipersPct: ratio(payload.sniperPct),
        insidersPct: ratio(payload.insiderPct),
        bundledPct: ratio(payload.bundledPct),
      },
      security: {
        mintAuthorityRevoked: payload.mintAuthorityRevoked,
        freezeAuthorityRevoked: payload.freezeAuthorityRevoked,
        ownershipRenounced: payload.renounced,
        lpLocked: payload.lpLockedPct !== undefined ? (ratio(payload.lpLockedPct) ?? 0) >= 0.9 : undefined,
        lpBurned: payload.lpBurned,
        isHoneypot: payload.isHoneypot,
        buyTaxPct: payload.buyTaxPct,
        sellTaxPct: payload.sellTaxPct,
      },
      smartMoney: {
        smartWalletsHolding: payload.smartWallets,
        smartWalletsBuying5m: payload.smartBuys5m,
        smartNetFlowUsd5m: payload.smartNetFlow5m,
        whalesHolding: payload.whales,
        whaleNetFlowUsd5m: payload.whaleNetFlow5m,
        kolMentions: payload.kolMentions,
      },
      social: {
        twitterFollowers: payload.twitterFollowers,
        telegramMembers: payload.telegramMembers,
      },
      developer: {
        wallet: payload.devWallet,
        walletAgeDays: payload.devWalletAgeDays,
        tokensLaunched: payload.devTokensLaunched,
        ruggedTokens: payload.devRugged,
      },
      source: this.name,
      at: now,
    };
  }

  private toMarket(payload: AxiomTokenPayload): MarketSnapshot {
    const price = payload.priceUsd ?? 0;
    return {
      priceUsd: price,
      priceNative: 0,
      marketCapUsd: payload.marketCapUsd ?? 0,
      fdvUsd: payload.marketCapUsd ?? 0,
      liquidityUsd: payload.liquidityUsd ?? 0,
      volume5mUsd: payload.volume5mUsd ?? 0,
      volume1hUsd: payload.volume1hUsd ?? 0,
      volume24hUsd: payload.volume24hUsd ?? 0,
      txns5m: { buys: payload.buys5m ?? 0, sells: payload.sells5m ?? 0 },
      txns1h: { buys: payload.buys1h ?? 0, sells: payload.sells1h ?? 0 },
      priceChange5m: fraction(payload.priceChange5m),
      priceChange1h: fraction(payload.priceChange1h),
      priceChange24h: fraction(payload.priceChange24h),
      at: Date.now(),
    };
  }
}

/** Accepts 0..1 and 0..100 and always returns 0..1. */
function ratio(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value > 1 ? value / 100 : value;
}

/** Price changes may be percentages; normalize to a signed fraction. */
function fraction(value: number | undefined): number {
  if (value === undefined) return 0;
  return Math.abs(value) > 5 ? value / 100 : value;
}
