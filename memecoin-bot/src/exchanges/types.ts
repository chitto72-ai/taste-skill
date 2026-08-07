import type { ChainId } from '../core/domain/chain.js';
import type { TokenRef } from '../core/domain/token.js';
import type { Balance, OrderRequest, OrderResult } from '../core/domain/trading.js';
import type { HealthCheckable, Service } from '../core/lifecycle.js';

export interface QuoteRequest {
  readonly token: TokenRef;
  readonly side: 'buy' | 'sell';
  /** Quote-currency notional for buys, token amount for sells. */
  readonly amount: number;
  readonly slippageBps: number;
}

export interface Quote {
  readonly token: TokenRef;
  readonly side: 'buy' | 'sell';
  readonly inAmount: number;
  readonly outAmount: number;
  readonly price: number;
  readonly priceImpactBps: number;
  readonly feeBps: number;
  readonly estimatedGasUsd: number;
  readonly route: string;
  readonly validUntil: number;
}

/**
 * An execution venue. Axiom Pro is one implementation; the paper venue is
 * another; a direct on-chain router would be a third. Strategies and the risk
 * layer only ever see this interface.
 */
export interface ExchangeAdapter extends Service, HealthCheckable {
  readonly venue: string;
  supports(chain: ChainId): boolean;
  quote(request: QuoteRequest): Promise<Quote>;
  execute(order: OrderRequest): Promise<OrderResult>;
  balances(): Promise<Balance[]>;
  /** Latest mid price in quote currency, if the venue can supply one. */
  price(token: TokenRef): Promise<number | undefined>;
  /** Cancels a resting order where the venue supports it. */
  cancel?(clientOrderId: string): Promise<boolean>;
}

/** Minimal market data a venue simulator needs. */
export interface MarketDataSource {
  priceOf(token: TokenRef): number | undefined;
  liquidityOf(token: TokenRef): number | undefined;
}

export interface ExecutionOutcome {
  readonly result: OrderResult;
  readonly venue: string;
  readonly attempts: number;
}
