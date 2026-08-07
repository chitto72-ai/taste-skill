import type { PricePoint, TokenProfile } from '../src/core/domain/token.js';

/**
 * A healthy reference token used to render sample metric values in the docs.
 *
 * Kept next to the generator rather than imported from the test helpers so
 * that documentation output never depends on test fixtures drifting.
 */
export function healthyProfileForDocs(now = Date.now()): TokenProfile {
  const priceHistory: PricePoint[] = Array.from({ length: 21 }, (_, index) => ({
    t: now - (20 - index) * 60_000,
    priceUsd: 0.001 * (1 + index * 0.02),
    volumeUsd: 40_000,
    liquidityUsd: 120_000,
    holders: 500 + index * 15,
  }));

  return {
    ref: { chain: 'solana', address: 'So1DocsReferenceToken111111111111111111111' },
    metadata: {
      name: 'Reference Token',
      symbol: 'REF',
      decimals: 9,
      createdAt: now - 30 * 60_000,
      totalSupply: 1_000_000_000,
      twitter: 'https://x.com/reference',
      telegram: 'https://t.me/reference',
    },
    pool: {
      address: 'poolReference',
      dex: 'raydium',
      baseToken: 'So1DocsReferenceToken111111111111111111111',
      quoteToken: 'USDC',
      liquidityUsd: 120_000,
      createdAt: now - 30 * 60_000,
      lpLockedPct: 1,
    },
    market: {
      priceUsd: 0.0014,
      priceNative: 0.00001,
      marketCapUsd: 1_400_000,
      fdvUsd: 1_400_000,
      liquidityUsd: 120_000,
      volume5mUsd: 90_000,
      volume1hUsd: 600_000,
      volume24hUsd: 4_000_000,
      txns5m: { buys: 90, sells: 30 },
      txns1h: { buys: 700, sells: 320 },
      priceChange5m: 0.08,
      priceChange1h: 0.35,
      priceChange24h: 0.9,
      at: now,
    },
    holders: {
      count: 800,
      growth5m: 0.09,
      growth1h: 0.4,
      top10Pct: 0.18,
      top25Pct: 0.3,
      concentrationHhi: 0.06,
      devHoldingPct: 0.01,
      snipersPct: 0.02,
      insidersPct: 0.01,
      bundledPct: 0.01,
    },
    security: {
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      ownershipRenounced: true,
      lpLocked: true,
      lpBurned: true,
      isHoneypot: false,
      hasTransferTax: false,
      buyTaxPct: 0,
      sellTaxPct: 0,
      hasBlacklistFn: false,
      isProxyUpgradable: false,
      bundleDetected: false,
      bundleWallets: 0,
      onDenyList: false,
    },
    smartMoney: {
      smartWalletsHolding: 6,
      smartWalletsBuying5m: 4,
      smartNetFlowUsd5m: 18_000,
      whalesHolding: 3,
      whaleNetFlowUsd5m: 25_000,
      kolMentions: 3,
      insiderWallets: 0,
    },
    social: {
      twitterFollowers: 12_000,
      twitterMentions1h: 300,
      twitterGrowth1h: 0.3,
      telegramMembers: 5_000,
      telegramGrowth1h: 0.25,
      hasVerifiedSocials: true,
      sentiment: 82,
    },
    developer: {
      wallet: 'DevWalletReference',
      walletAgeDays: 300,
      tokensLaunched: 3,
      ruggedTokens: 0,
      successfulTokens: 2,
      devSoldPct: 0,
      devBalancePct: 0.01,
    },
    priceHistory,
    discoveredAt: now - 25 * 60_000,
    updatedAt: now,
  };
}
