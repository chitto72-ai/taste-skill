import type { ChainId } from '../core/domain/chain.js';
import { clamp01 } from '../core/utils/math.js';
import type { HistoricalBar, HistoricalSeries } from './types.js';

export interface GeneratorOptions {
  readonly tokens?: number;
  readonly barsPerToken?: number;
  readonly barIntervalMs?: number;
  readonly chains?: readonly ChainId[];
  readonly seed?: number;
  readonly startAt?: number;
}

/**
 * Generates a plausible synthetic dataset.
 *
 * This is for exercising the machinery — validating that the engine, costs and
 * risk limits behave — not for evaluating edge. Results on synthetic data say
 * nothing about whether the strategy works, and the CLI says so when it prints
 * them. Real evaluation needs exported market data.
 *
 * The generator is still built carefully: token "quality" is a latent variable
 * that consistently drives price drift, liquidity behaviour, holder growth and
 * security flags together, so the scorer sees the same kind of correlated
 * structure it would see live rather than independent noise.
 */
export function generateDataset(options: GeneratorOptions = {}): HistoricalSeries[] {
  const tokens = options.tokens ?? 40;
  const bars = options.barsPerToken ?? 240;
  const interval = options.barIntervalMs ?? 60_000;
  const chains = options.chains ?? ['solana', 'base'];
  const startAt = options.startAt ?? Date.now() - bars * interval;

  let seed = options.seed ?? 0x5eed1234;
  const random = (): number => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return seed / 0xffffffff;
  };

  const series: HistoricalSeries[] = [];

  for (let i = 0; i < tokens; i++) {
    const quality = random();
    const clean = quality > 0.55;
    const chain = chains[Math.floor(random() * chains.length)];
    const symbol = `T${i.toString().padStart(3, '0')}`;
    const createdAt = startAt + Math.floor(random() * bars * 0.2) * interval;

    let price = 10 ** (-6 + random() * 3);
    let liquidity = 20_000 + quality * 350_000;
    let holders = Math.round(80 + quality * 700);
    const supply = 1_000_000_000;

    // A minority of tokens rug outright partway through the series.
    const rugsAt = quality < 0.25 ? Math.floor(bars * (0.3 + random() * 0.5)) : -1;

    const barsOut: HistoricalBar[] = [];
    for (let b = 0; b < bars; b++) {
      const t = createdAt + b * interval;
      const rugged = rugsAt >= 0 && b >= rugsAt;

      if (rugged) {
        price *= 0.55 + random() * 0.2;
        liquidity *= 0.5;
        holders = Math.max(5, Math.round(holders * 0.97));
      } else {
        const drift = (quality - 0.5) * 0.012;
        const vol = 0.015 + 0.12 * (1 - clamp01(liquidity / 300_000));
        price = Math.max(1e-12, price * (1 + drift + (random() - 0.5) * 2 * vol));
        liquidity = Math.max(1_000, liquidity * (1 + (random() - 0.48) * 0.02));
        holders = Math.max(10, Math.round(holders * (1 + (quality > 0.6 ? random() * 0.02 : (random() - 0.6) * 0.01))));
      }

      const volume5m = liquidity * (0.05 + quality * 0.35) * (0.4 + random());
      const buys = Math.round(8 + quality * 60 * random());
      const sells = Math.round(5 + (1 - quality) * 55 * random());

      barsOut.push({
        t,
        priceUsd: price,
        liquidityUsd: liquidity,
        marketCapUsd: price * supply,
        volume5mUsd: volume5m,
        volume1hUsd: volume5m * 12 * (0.7 + random() * 0.6),
        buys5m: rugged ? Math.round(buys * 0.2) : buys,
        sells5m: rugged ? sells * 3 : sells,
        holders,
        smartBuys5m: rugged ? 0 : Math.round(quality * 5 * random()),
        smartNetFlowUsd: rugged ? -liquidity * 0.1 : (quality - 0.4) * liquidity * 0.15,
        whaleNetFlowUsd: rugged ? -liquidity * 0.15 : (quality - 0.45) * liquidity * 0.2,
      });
    }

    series.push({
      chain,
      address: chain === 'solana' ? `Gen${i.toString().padStart(41, '1')}` : `0x${i.toString(16).padStart(40, '0')}`,
      metadata: {
        name: `${symbol} Token`,
        symbol,
        decimals: chain === 'solana' ? 9 : 18,
        createdAt,
        totalSupply: supply,
        twitter: clean ? `https://x.com/${symbol}` : undefined,
        telegram: clean ? `https://t.me/${symbol}` : undefined,
      },
      pool: {
        address: `pool-${symbol}`,
        dex: chain === 'solana' ? 'raydium' : 'uniswap_v2',
        createdAt,
        lpLockedPct: clean ? 0.95 + random() * 0.05 : quality * 0.6,
      },
      security: {
        mintAuthorityRevoked: clean,
        freezeAuthorityRevoked: clean,
        ownershipRenounced: clean,
        lpLocked: clean,
        lpBurned: quality > 0.8,
        isHoneypot: false,
        hasTransferTax: quality < 0.4,
        buyTaxPct: quality < 0.4 ? Math.round((1 - quality) * 10) : 0,
        sellTaxPct: quality < 0.4 ? Math.round((1 - quality) * 14) : 0,
        hasBlacklistFn: quality < 0.2,
        isProxyUpgradable: quality < 0.3,
        bundleDetected: quality < 0.35,
        bundleWallets: quality < 0.35 ? Math.round((1 - quality) * 10) : 0,
        onDenyList: false,
      },
      developer: {
        wallet: `dev-${symbol}`,
        walletAgeDays: Math.round(quality * 365),
        tokensLaunched: Math.round((1 - quality) * 10),
        ruggedTokens: Math.round((1 - quality) ** 2 * 8),
        successfulTokens: Math.round(quality * 4),
        devSoldPct: (1 - quality) * 0.4,
        devBalancePct: (1 - quality) * 0.12,
      },
      social: {
        twitterFollowers: Math.round(quality * 30_000),
        twitterMentions1h: Math.round(quality * 400),
        twitterGrowth1h: quality * 0.4,
        telegramMembers: Math.round(quality * 9_000),
        telegramGrowth1h: quality * 0.3,
        hasVerifiedSocials: clean,
        sentiment: Math.round(quality * 100),
      },
      holdersBase: {
        top10Pct: 0.45 - quality * 0.3,
        top25Pct: 0.65 - quality * 0.3,
        concentrationHhi: 0.32 - quality * 0.25,
        devHoldingPct: (1 - quality) * 0.1,
        snipersPct: (1 - quality) * 0.2,
        insidersPct: (1 - quality) * 0.15,
        bundledPct: (1 - quality) * 0.18,
      },
      smartMoneyBase: {
        smartWalletsHolding: Math.round(quality * 8),
        whalesHolding: Math.round(quality * 5),
        kolMentions: Math.round(quality * 5),
        insiderWallets: Math.round((1 - quality) * 6),
      },
      bars: barsOut,
    });
  }

  return series;
}
