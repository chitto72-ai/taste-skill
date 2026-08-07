import type { CloseReason, PositionStatus, Side } from '../core/domain/trading.js';
import type { MetricGroup } from '../core/domain/scoring.js';
import type { WalletTag } from '../core/domain/wallet.js';

/** Every persisted row carries a string id and a millisecond timestamp. */
export interface BaseRow {
  readonly id: string;
  readonly ts: number;
}

export interface TradeRow extends BaseRow {
  readonly positionId: string;
  readonly chain: string;
  readonly tokenAddress: string;
  readonly symbol: string;
  readonly strategy: string;
  readonly entryScore: number;
  readonly entryPrice: number;
  readonly exitPrice: number;
  readonly qty: number;
  readonly quoteIn: number;
  readonly quoteOut: number;
  readonly pnl: number;
  readonly pnlPct: number;
  readonly fees: number;
  readonly gas: number;
  readonly holdMs: number;
  readonly maxFavorableExcursion: number;
  readonly maxAdverseExcursion: number;
  readonly closeReason: CloseReason;
  readonly openedAt: number;
  readonly closedAt: number;
}

export interface PositionRow extends BaseRow {
  readonly chain: string;
  readonly tokenAddress: string;
  readonly symbol: string;
  readonly strategy: string;
  status: PositionStatus;
  readonly entryPrice: number;
  qty: number;
  costBasis: number;
  realizedPnl: number;
  unrealizedPnl: number;
  currentPrice: number;
  stopPrice: number;
  readonly openedAt: number;
  closedAt?: number;
  closeReason?: CloseReason;
  /** Full domain object, so a restart can rehydrate exactly. */
  snapshot: string;
}

export interface OrderRow extends BaseRow {
  readonly clientOrderId: string;
  readonly positionId?: string;
  readonly chain: string;
  readonly tokenAddress: string;
  readonly side: Side;
  readonly status: string;
  readonly requestedAmount: number;
  readonly filledQty: number;
  readonly filledQuote: number;
  readonly avgPrice: number;
  readonly feeQuote: number;
  readonly gasUsd: number;
  readonly slippageBps: number;
  readonly txHash?: string;
  readonly venue: string;
  readonly reason: string;
  readonly error?: string;
}

export interface TokenRow extends BaseRow {
  readonly chain: string;
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly poolAddress: string;
  readonly dex: string;
  firstSeenAt: number;
  lastSeenAt: number;
  score: number;
  rugProbability: number;
  pumpProbability: number;
  liquidityUsd: number;
  marketCapUsd: number;
  holders: number;
  traded: boolean;
  /** Latest full profile, JSON-encoded. */
  profile: string;
}

export interface MetricRow extends BaseRow {
  readonly chain: string;
  readonly tokenAddress: string;
  readonly metricId: string;
  readonly group: MetricGroup;
  readonly raw: number;
  readonly normalized: number;
  readonly weight: number;
  readonly imputed: boolean;
  readonly scoreTotal: number;
}

export interface WalletRow extends BaseRow {
  readonly address: string;
  readonly chain: string;
  label: string;
  tags: string;
  trades: number;
  wins: number;
  winRate: number;
  roi: number;
  pnlUsd: number;
  walletAgeDays: number;
  rugRate: number;
  copyEnabled: boolean;
  lastTradeAt: number;
}

export interface PerformanceRow extends BaseRow {
  /** ISO date (UTC) this row aggregates. */
  readonly day: string;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  fees: number;
  gas: number;
  maxDrawdownPct: number;
  peakEquity: number;
}

export interface EquityPointRow extends BaseRow {
  readonly equity: number;
  readonly realizedPnl: number;
  readonly unrealizedPnl: number;
  readonly openPositions: number;
  readonly drawdownPct: number;
}

export interface ErrorRow extends BaseRow {
  readonly code: string;
  readonly category: string;
  readonly component: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly context: string;
  readonly stack?: string;
}

export interface LogRow extends BaseRow {
  readonly level: string;
  readonly component: string;
  readonly msg: string;
  readonly context: string;
}

export type TableName =
  | 'trades'
  | 'positions'
  | 'orders'
  | 'tokens'
  | 'metrics'
  | 'wallets'
  | 'performance'
  | 'equity'
  | 'errors'
  | 'logs';

export const TABLES: readonly TableName[] = [
  'trades',
  'positions',
  'orders',
  'tokens',
  'metrics',
  'wallets',
  'performance',
  'equity',
  'errors',
  'logs',
];

export type FilterOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'contains';

export interface QueryFilter {
  readonly field: string;
  readonly op: FilterOp;
  readonly value: unknown;
}

export interface QueryOptions {
  readonly where?: readonly QueryFilter[];
  readonly orderBy?: { readonly field: string; readonly dir: 'asc' | 'desc' };
  readonly limit?: number;
  readonly offset?: number;
}

export const eq = (field: string, value: unknown): QueryFilter => ({ field, op: 'eq', value });
export const gte = (field: string, value: unknown): QueryFilter => ({ field, op: 'gte', value });
export const lte = (field: string, value: unknown): QueryFilter => ({ field, op: 'lte', value });
export const inList = (field: string, value: readonly unknown[]): QueryFilter => ({
  field,
  op: 'in',
  value,
});

export type WalletTagList = readonly WalletTag[];
