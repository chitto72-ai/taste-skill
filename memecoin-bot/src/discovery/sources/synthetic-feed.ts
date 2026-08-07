import type { ChainId } from '../../core/domain/chain.js';
import type { MarketSnapshot, TokenRef } from '../../core/domain/token.js';
import { tokenKey } from '../../core/domain/token.js';
import { clamp01 } from '../../core/utils/math.js';
import type { TokenCandidate, TokenFeed } from '../types.js';

export interface SyntheticFeedOptions {
  readonly chains: readonly ChainId[];
  /** Deterministic when set — the whole feed replays identically. */
  readonly seed?: number;
  /** New tokens created per poll, on average. */
  readonly spawnRate?: number;
  readonly maxTracked?: number;
  readonly now?: () => number;
}

interface SyntheticToken {
  ref: TokenRef;
  symbol: string;
  name: string;
  createdAt: number;
  price: number;
  basePrice: number;
  liquidity: number;
  supply: number;
  holders: number;
  /** Latent quality in 0..1; drives whether this token behaves well or rugs. */
  quality: number;
  /** Top-decile tokens run hard, the way real winners do. */
  runner: boolean;
  /** Rolling price memory so 5m/1h changes are real rather than invented. */
  prevPrice: number;
  priceTrail: { t: number; price: number }[];
  devWallet: string;
  poolAddress: string;
  lastUpdate: number;
}

/**
 * Deterministic synthetic token feed.
 *
 * This is what makes the whole system runnable — and testable — without API
 * keys: `npm start` in paper mode exercises discovery, scoring, sizing, entry,
 * exits and the dashboard against a market that behaves plausibly. Quality is
 * drawn per token and then *consistently* expressed across every dimension, so
 * a token that is going to rug also has thin liquidity, bundled holders and a
 * fresh dev wallet — otherwise the scorer would learn nothing from it.
 */
export class SyntheticTokenFeed implements TokenFeed {
  readonly name = 'synthetic';
  readonly chains: readonly ChainId[];

  private readonly tokens = new Map<string, SyntheticToken>();
  private readonly now: () => number;
  private readonly spawnRate: number;
  private readonly maxTracked: number;
  private seed: number;
  private counter = 0;

  constructor(options: SyntheticFeedOptions) {
    this.chains = options.chains.length > 0 ? options.chains : ['solana'];
    this.seed = options.seed ?? 0x2f6e2b1;
    this.spawnRate = options.spawnRate ?? 2;
    this.maxTracked = options.maxTracked ?? 60;
    this.now = options.now ?? (() => Date.now());
  }

  async poll(): Promise<TokenCandidate[]> {
    const now = this.now();
    const spawn = Math.max(0, Math.round(this.spawnRate + this.randomInt(-1, 1)));
    for (let i = 0; i < spawn && this.tokens.size < this.maxTracked; i++) this.spawn(now);

    const candidates: TokenCandidate[] = [];
    for (const token of this.tokens.values()) {
      this.advance(token, now);
      candidates.push(this.toCandidate(token, now));
    }

    // Retire tokens that have gone to zero or gone quiet.
    for (const [key, token] of this.tokens) {
      if (token.price <= token.basePrice * 0.02 || now - token.createdAt > 6 * 60 * 60_000) {
        this.tokens.delete(key);
      }
    }
    return candidates;
  }

  async refresh(refs: readonly TokenRef[]): Promise<Map<string, MarketSnapshot>> {
    const now = this.now();
    const out = new Map<string, MarketSnapshot>();
    for (const ref of refs) {
      const token = this.tokens.get(tokenKey(ref));
      if (!token) continue;
      this.advance(token, now);
      out.set(tokenKey(ref), this.marketOf(token, now));
    }
    return out;
  }

  /** Current mid price, used by the paper venue to fill orders. */
  priceOf(ref: TokenRef): number | undefined {
    return this.tokens.get(tokenKey(ref))?.price;
  }

  liquidityOf(ref: TokenRef): number | undefined {
    return this.tokens.get(tokenKey(ref))?.liquidity;
  }

  private spawn(now: number): void {
    const chain = this.chains[this.randomInt(0, this.chains.length - 1)];
    const id = ++this.counter;
    const quality = this.random();
    const symbol = `${SYLLABLES[this.randomInt(0, SYLLABLES.length - 1)]}${SYLLABLES[this.randomInt(0, SYLLABLES.length - 1)]}`.toUpperCase();
    const price = 10 ** (-6 + this.random() * 3);
    const liquidity = 15_000 + quality * 400_000 * (0.5 + this.random());

    const token: SyntheticToken = {
      ref: { chain, address: this.address(chain, id) },
      symbol,
      name: `${symbol} Coin`,
      // Backdate so the age filter admits it on the first or second scan.
      createdAt: now - this.randomInt(90, 900) * 1_000,
      price,
      basePrice: price,
      prevPrice: price,
      priceTrail: [{ t: now, price }],
      liquidity,
      supply: 1_000_000_000,
      holders: Math.round(60 + quality * 900 * this.random()),
      quality,
      runner: quality > 0.82,
      devWallet: this.address(chain, 900_000 + id),
      poolAddress: this.address(chain, 500_000 + id),
      lastUpdate: now,
    };
    this.tokens.set(tokenKey(token.ref), token);
  }

  private advance(token: SyntheticToken, now: number): void {
    const elapsed = Math.max(0, now - token.lastUpdate);
    if (elapsed < 500) return;
    token.prevPrice = token.price;
    const steps = Math.max(1, Math.min(10, Math.round(elapsed / 30_000)));

    for (let i = 0; i < steps; i++) {
      // Drift favours high-quality tokens; volatility is inversely related to
      // liquidity, as it is in the real thing.
      // Real winners do not drift up 1% a step; they run. Modelling that is
      // what lets the 80-score gate ever be satisfied in a demo run.
      const drift = token.runner ? 0.02 + this.random() * 0.05 : (token.quality - 0.55) * 0.02;
      const vol = 0.02 + 0.25 * (1 - clamp01(token.liquidity / 300_000));
      const shock = (this.random() - 0.5) * 2 * vol;
      token.price = Math.max(token.basePrice * 0.01, token.price * (1 + drift + shock));

      // Low-quality tokens bleed liquidity — the rug signature the scorer looks for.
      const liquidityDrift = token.quality < 0.3 ? -0.05 * this.random() : (this.random() - 0.45) * 0.03;
      token.liquidity = Math.max(500, token.liquidity * (1 + liquidityDrift));

      const holderDrift = token.runner
        ? 0.03 + this.random() * 0.08
        : token.quality > 0.6
          ? this.random() * 0.06
          : (this.random() - 0.6) * 0.03;
      token.holders = Math.max(10, Math.round(token.holders * (1 + holderDrift)));
    }
    token.priceTrail.push({ t: now, price: token.price });
    if (token.priceTrail.length > 120) token.priceTrail.shift();
    token.lastUpdate = now;
  }

  private marketOf(token: SyntheticToken, now: number): MarketSnapshot {
    const marketCap = token.price * token.supply;
    const churn = 0.05 + token.quality * 0.5;
    // Volume tracks recent price action: a token that is moving trades more.
    const recentMove = Math.abs(token.price / Math.max(token.prevPrice, 1e-18) - 1);
    const volume5m = token.liquidity * churn * (0.6 + recentMove * 4);
    const buys = Math.round(10 + token.quality * 80 * (0.4 + this.random()));
    const sells = Math.round(5 + (1 - token.quality) * 70 * (0.4 + this.random()));

    const change5m = token.price / Math.max(token.prevPrice, 1e-18) - 1;
    const hourAgo = token.priceTrail.find((p) => p.t >= now - 3_600_000) ?? token.priceTrail[0];
    const change1h = token.price / Math.max(hourAgo?.price ?? token.basePrice, 1e-18) - 1;
    const change = token.price / token.basePrice - 1;

    return {
      priceUsd: token.price,
      priceNative: token.price / 150,
      marketCapUsd: marketCap,
      fdvUsd: marketCap,
      liquidityUsd: token.liquidity,
      volume5mUsd: volume5m,
      // 1h volume is deliberately a bit under 12x the 5m clip for movers, so
      // the "volume expanding" condition means something.
      volume1hUsd: volume5m * (9 + (1 - token.quality) * 5),
      volume24hUsd: volume5m * 100,
      txns5m: { buys, sells },
      txns1h: { buys: buys * 10, sells: sells * 10 },
      priceChange5m: change5m,
      priceChange1h: change1h,
      priceChange24h: change,
      at: now,
    };
  }

  private toCandidate(token: SyntheticToken, now: number): TokenCandidate {
    const q = token.quality;
    const clean = q > 0.55;
    return {
      ref: token.ref,
      metadata: {
        name: token.name,
        symbol: token.symbol,
        decimals: 9,
        createdAt: token.createdAt,
        totalSupply: token.supply,
        twitter: clean ? `https://x.com/${token.symbol.toLowerCase()}` : undefined,
        telegram: clean ? `https://t.me/${token.symbol.toLowerCase()}` : undefined,
      },
      pool: {
        address: token.poolAddress,
        dex: 'synthetic-amm',
        baseToken: token.ref.address,
        quoteToken: 'USDC',
        liquidityUsd: token.liquidity,
        createdAt: token.createdAt,
        lpLockedPct: clean ? 0.95 + q * 0.05 : q * 0.6,
      },
      market: this.marketOf(token, now),
      holders: {
        count: token.holders,
        growth5m: q > 0.6 ? 0.02 + this.random() * 0.12 : (this.random() - 0.7) * 0.05,
        growth1h: q > 0.6 ? 0.1 + this.random() * 0.4 : (this.random() - 0.7) * 0.1,
        top10Pct: 0.45 - q * 0.3 + this.random() * 0.05,
        top25Pct: 0.65 - q * 0.3 + this.random() * 0.05,
        concentrationHhi: 0.35 - q * 0.28,
        devHoldingPct: (1 - q) * 0.12,
        snipersPct: (1 - q) * 0.25,
        insidersPct: (1 - q) * 0.18,
        bundledPct: (1 - q) * 0.22,
      },
      security: {
        mintAuthorityRevoked: clean,
        freezeAuthorityRevoked: clean,
        ownershipRenounced: clean,
        lpLocked: clean,
        lpBurned: q > 0.8,
        isHoneypot: q < 0.08,
        hasTransferTax: q < 0.4,
        buyTaxPct: q < 0.4 ? Math.round((1 - q) * 12) : 0,
        sellTaxPct: q < 0.4 ? Math.round((1 - q) * 18) : 0,
        hasBlacklistFn: q < 0.25,
        isProxyUpgradable: q < 0.3,
        bundleDetected: q < 0.35,
        bundleWallets: q < 0.35 ? Math.round((1 - q) * 12) : 0,
        onDenyList: false,
      },
      smartMoney: {
        smartWalletsHolding: Math.round(q * 9 * this.random()),
        smartWalletsBuying5m: Math.round(q * 5 * this.random()),
        smartNetFlowUsd5m: (q - 0.4) * token.liquidity * 0.2,
        whalesHolding: Math.round(q * 6 * this.random()),
        whaleNetFlowUsd5m: (q - 0.45) * token.liquidity * 0.25,
        kolMentions: Math.round(q * 6 * this.random()),
        insiderWallets: Math.round((1 - q) * 7 * this.random()),
      },
      social: {
        twitterFollowers: Math.round(q * 40_000 * this.random()),
        twitterMentions1h: Math.round(q * 600 * this.random()),
        twitterGrowth1h: q * 0.5 * this.random(),
        telegramMembers: Math.round(q * 12_000 * this.random()),
        telegramGrowth1h: q * 0.4 * this.random(),
        hasVerifiedSocials: clean,
        sentiment: Math.round(q * 100),
      },
      developer: {
        wallet: token.devWallet,
        walletAgeDays: Math.round(q * 400),
        tokensLaunched: Math.round((1 - q) * 12),
        ruggedTokens: Math.round((1 - q) ** 2 * 10),
        successfulTokens: Math.round(q * 4),
        devSoldPct: (1 - q) * 0.5,
        devBalancePct: (1 - q) * 0.15,
      },
      source: this.name,
      at: now,
    };
  }

  private address(chain: ChainId, id: number): string {
    const hex = id.toString(16).padStart(8, '0');
    if (chain === 'solana') return `Syn${hex}${'1'.repeat(32)}`.slice(0, 44);
    return `0x${hex.repeat(5)}`.slice(0, 42);
  }

  /** xorshift32 — small, fast, and deterministic for a given seed. */
  private random(): number {
    this.seed ^= this.seed << 13;
    this.seed ^= this.seed >>> 17;
    this.seed ^= this.seed << 5;
    this.seed >>>= 0;
    return this.seed / 0xffffffff;
  }

  private randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }
}

const SYLLABLES = ['pep', 'doge', 'wif', 'bonk', 'moon', 'shib', 'flok', 'giga', 'chad', 'boden', 'turbo', 'mog'];
