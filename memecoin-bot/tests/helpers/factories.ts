import type { TokenProfile, PricePoint } from '../../src/core/domain/token.js';
import type { Position } from '../../src/core/domain/trading.js';
import type { TradeRow } from '../../src/database/types.js';
import type { TokenCandidate } from '../../src/discovery/types.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import type { BotConfig } from '../../src/config/schema.js';
import { deepMerge, type DeepPartial } from '../../src/config/merge.js';

const NOW = 1_700_000_000_000;

/**
 * Builders for test fixtures.
 *
 * The defaults describe a *good* token — one that should pass every gate — so
 * each test can express exactly one deviation from healthy and assert on it.
 * That keeps the tests readable and stops them from accidentally depending on
 * three unrelated things being wrong at once.
 */
export function healthyProfile(overrides: DeepPartial<TokenProfile> = {}, now = NOW): TokenProfile {
  const history: PricePoint[] = [];
  for (let i = 20; i >= 0; i--) {
    history.push({
      t: now - i * 60_000,
      // A steady, believable uptrend.
      priceUsd: 0.001 * (1 + (20 - i) * 0.02),
      volumeUsd: 40_000,
      liquidityUsd: 120_000,
      holders: 500 + (20 - i) * 15,
    });
  }

  const base: TokenProfile = {
    ref: { chain: 'solana', address: 'So1TestToken1111111111111111111111111111111' },
    metadata: {
      name: 'Test Token',
      symbol: 'TEST',
      decimals: 9,
      createdAt: now - 30 * 60_000,
      totalSupply: 1_000_000_000,
      twitter: 'https://x.com/test',
      telegram: 'https://t.me/test',
    },
    pool: {
      address: 'pool111',
      dex: 'raydium',
      baseToken: 'So1TestToken1111111111111111111111111111111',
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
      wallet: 'DevWallet1111',
      walletAgeDays: 300,
      tokensLaunched: 3,
      ruggedTokens: 0,
      successfulTokens: 2,
      devSoldPct: 0,
      devBalancePct: 0.01,
    },
    priceHistory: history,
    discoveredAt: now - 25 * 60_000,
    updatedAt: now,
  };

  return deepMerge(base, overrides);
}

export function candidateFrom(profile: TokenProfile, source = 'test'): TokenCandidate {
  return {
    ref: profile.ref,
    metadata: profile.metadata,
    pool: profile.pool,
    market: profile.market,
    holders: profile.holders,
    security: profile.security,
    smartMoney: profile.smartMoney,
    social: profile.social,
    developer: profile.developer,
    source,
    at: profile.updatedAt,
  };
}

export function testConfig(overrides: DeepPartial<BotConfig> = {}): BotConfig {
  return deepMerge(createDefaultConfig(), overrides);
}

export function openPosition(overrides: Partial<Position> = {}, now = NOW): Position {
  const entryPrice = 0.001;
  return {
    id: 'pos_test',
    token: { chain: 'solana', address: 'So1TestToken1111111111111111111111111111111' },
    chain: 'solana',
    symbol: 'TEST',
    status: 'open',
    strategy: 'sniper',
    entryScore: 85,
    entryPrice,
    qty: 1_000_000,
    initialQty: 1_000_000,
    costBasis: 1_000,
    initialCost: 1_000,
    realizedPnl: 0,
    unrealizedPnl: 0,
    feesPaid: 0,
    gasPaid: 0,
    highWaterPrice: entryPrice,
    lowWaterPrice: entryPrice,
    currentPrice: entryPrice,
    stopPrice: entryPrice * 0.75,
    initialStopPrice: entryPrice * 0.75,
    breakEvenArmed: false,
    trailingArmed: false,
    trailingPeakPrice: entryPrice,
    takeProfits: [
      { id: 'tp1', triggerMultiple: 1.5, sellFraction: 0.25, executed: false },
      { id: 'tp2', triggerMultiple: 2.0, sellFraction: 0.25, executed: false },
      { id: 'tp3', triggerMultiple: 3.0, sellFraction: 0.25, executed: false },
      { id: 'tp4', triggerMultiple: 5.0, sellFraction: 0.25, executed: false },
    ],
    legs: [],
    openedAt: now,
    maxHoldUntil: now + 4 * 60 * 60_000,
    meta: { entryLiquidityUsd: 120_000 },
    ...overrides,
  };
}

export function tradeRow(overrides: Partial<TradeRow> = {}, index = 0): TradeRow {
  const pnl = overrides.pnl ?? 100;
  return {
    id: `trd_${index}`,
    ts: NOW + index * 60_000,
    positionId: `pos_${index}`,
    chain: 'solana',
    tokenAddress: `token${index}`,
    symbol: `T${index}`,
    strategy: 'sniper',
    entryScore: 85,
    entryPrice: 0.001,
    exitPrice: 0.0012,
    qty: 1_000_000,
    quoteIn: 1_000,
    quoteOut: 1_000 + pnl,
    pnl,
    pnlPct: pnl / 1_000,
    fees: 10,
    gas: 1,
    holdMs: 30 * 60_000,
    maxFavorableExcursion: 0.3,
    maxAdverseExcursion: -0.05,
    closeReason: pnl >= 0 ? 'take_profit' : 'stop_loss',
    openedAt: NOW + index * 60_000 - 30 * 60_000,
    closedAt: NOW + index * 60_000,
    ...overrides,
  };
}

export const TEST_NOW = NOW;
