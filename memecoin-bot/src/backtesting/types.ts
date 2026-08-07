import type { ChainId } from '../core/domain/chain.js';
import type {
  DeveloperStats,
  HolderStats,
  SecurityFlags,
  SmartMoneyStats,
  SocialStats,
  TokenMetadata,
} from '../core/domain/token.js';
import type { TradeRecord } from '../core/domain/trading.js';
import type { PerformanceMetrics } from '../analytics/performance.js';
import type { EquityPoint } from '../analytics/equity-curve.js';

/** One observation of a token at a point in time. */
export interface HistoricalBar {
  readonly t: number;
  readonly priceUsd: number;
  readonly liquidityUsd: number;
  readonly marketCapUsd: number;
  readonly volume5mUsd: number;
  readonly volume1hUsd: number;
  readonly buys5m: number;
  readonly sells5m: number;
  readonly holders: number;
  /** Optional per-bar overrides; anything omitted uses the series defaults. */
  readonly smartBuys5m?: number;
  readonly smartNetFlowUsd?: number;
  readonly whaleNetFlowUsd?: number;
  readonly holderGrowth5m?: number;
}

/** A full historical series for one token, plus its static attributes. */
export interface HistoricalSeries {
  readonly chain: ChainId;
  readonly address: string;
  readonly metadata: TokenMetadata;
  readonly pool: {
    readonly address: string;
    readonly dex: string;
    readonly createdAt: number;
    readonly lpLockedPct: number;
  };
  readonly security: SecurityFlags;
  readonly developer: DeveloperStats;
  readonly social: SocialStats;
  readonly holdersBase: Pick<HolderStats, 'top10Pct' | 'top25Pct' | 'concentrationHhi' | 'devHoldingPct' | 'snipersPct' | 'insidersPct' | 'bundledPct'>;
  readonly smartMoneyBase: Pick<SmartMoneyStats, 'smartWalletsHolding' | 'whalesHolding' | 'kolMentions' | 'insiderWallets'>;
  readonly bars: readonly HistoricalBar[];
}

export interface BacktestOptions {
  readonly startingCapital?: number;
  readonly slippageBps?: number;
  readonly feeBps?: number;
  readonly gasUsdPerTrade?: number;
  /** Fills happen this many ms after the signal bar — models latency. */
  readonly latencyMs?: number;
  readonly barIntervalMs?: number;
  readonly warmupBars?: number;
  /** Bars are processed in timestamp order across every series. */
  readonly maxPositions?: number;
  readonly verbose?: boolean;
}

export interface BacktestResult {
  readonly trades: readonly TradeRecord[];
  readonly metrics: PerformanceMetrics;
  readonly equity: readonly EquityPoint[];
  readonly startingCapital: number;
  readonly endingCapital: number;
  readonly barsProcessed: number;
  readonly tokensEvaluated: number;
  readonly signalsGenerated: number;
  readonly entriesTaken: number;
  readonly entriesRejected: Readonly<Record<string, number>>;
  readonly durationMs: number;
  readonly from: number;
  readonly to: number;
}

export interface ParameterGrid {
  readonly [key: string]: readonly (number | string | boolean)[];
}

export interface OptimizationRun {
  readonly parameters: Record<string, number | string | boolean>;
  readonly result: BacktestResult;
  /** Objective value used for ranking, higher is better. */
  readonly score: number;
}
