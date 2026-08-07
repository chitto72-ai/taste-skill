import type { ChainId } from './chain.js';
import type { TokenRef } from './token.js';

export type Side = 'buy' | 'sell';

export type OrderType = 'market' | 'limit';

export interface OrderRequest {
  readonly clientOrderId: string;
  readonly token: TokenRef;
  readonly side: Side;
  readonly type: OrderType;
  /** Quote-currency notional for buys, token amount for sells. */
  readonly amount: number;
  readonly limitPrice?: number;
  readonly slippageBps: number;
  readonly urgency: 'economy' | 'standard' | 'fast' | 'turbo';
  /** Anti-MEV private relay when the venue supports it. */
  readonly privateTx: boolean;
  readonly reason: string;
  readonly positionId?: string;
}

export type OrderStatus = 'pending' | 'submitted' | 'filled' | 'partial' | 'rejected' | 'expired';

export interface OrderResult {
  readonly clientOrderId: string;
  readonly venueOrderId?: string;
  readonly status: OrderStatus;
  readonly token: TokenRef;
  readonly side: Side;
  /** Tokens actually received (buy) or sold (sell). */
  readonly filledQty: number;
  /** Quote currency actually spent (buy) or received (sell). */
  readonly filledQuote: number;
  readonly avgPrice: number;
  readonly feeQuote: number;
  readonly gasUsd: number;
  readonly slippageBps: number;
  readonly txHash?: string;
  readonly submittedAt: number;
  readonly filledAt?: number;
  readonly error?: string;
}

export type PositionStatus = 'opening' | 'open' | 'closing' | 'closed' | 'failed';

export interface PositionLeg {
  readonly id: string;
  readonly side: Side;
  readonly qty: number;
  readonly quote: number;
  readonly price: number;
  readonly feeQuote: number;
  readonly gasUsd: number;
  readonly txHash?: string;
  readonly reason: string;
  readonly at: number;
}

export interface TakeProfitLevel {
  readonly id: string;
  /** Multiple of entry price that arms this level (2 == +100%). */
  readonly triggerMultiple: number;
  /** Fraction of the ORIGINAL quantity to sell, 0..1. */
  readonly sellFraction: number;
  executed: boolean;
  executedAt?: number;
  executedPrice?: number;
}

export interface Position {
  readonly id: string;
  readonly token: TokenRef;
  readonly chain: ChainId;
  readonly symbol: string;
  status: PositionStatus;
  readonly strategy: string;
  /** Score at entry — kept for post-trade attribution. */
  readonly entryScore: number;
  entryPrice: number;
  /** Tokens currently held. */
  qty: number;
  /** Tokens bought in total (immutable base for TP fractions). */
  initialQty: number;
  /** Quote currency deployed net of partial exits. */
  costBasis: number;
  readonly initialCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  feesPaid: number;
  gasPaid: number;
  highWaterPrice: number;
  lowWaterPrice: number;
  currentPrice: number;
  stopPrice: number;
  readonly initialStopPrice: number;
  breakEvenArmed: boolean;
  trailingArmed: boolean;
  trailingPeakPrice: number;
  takeProfits: TakeProfitLevel[];
  readonly legs: PositionLeg[];
  readonly openedAt: number;
  closedAt?: number;
  /** Deadline for the time-stop rule. */
  readonly maxHoldUntil: number;
  closeReason?: CloseReason;
  readonly meta: Record<string, unknown>;
}

export type CloseReason =
  | 'take_profit'
  | 'stop_loss'
  | 'trailing_stop'
  | 'break_even'
  | 'time_stop'
  | 'emergency_exit'
  | 'risk_halt'
  | 'manual'
  | 'strategy_exit';

/** Immutable record written once a position is fully closed. */
export interface TradeRecord {
  readonly id: string;
  readonly positionId: string;
  readonly chain: ChainId;
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

export interface Balance {
  readonly chain: ChainId;
  readonly asset: string;
  readonly free: number;
  readonly locked: number;
  readonly usdValue: number;
}
