import type { ChainId } from '../../core/domain/chain.js';
import type { TokenRef } from '../../core/domain/token.js';
import type { Balance, OrderRequest, OrderResult } from '../../core/domain/trading.js';
import { ExchangeError } from '../../core/errors.js';
import type { HealthReport } from '../../core/lifecycle.js';
import { TtlCache } from '../../core/utils/cache.js';
import type { Logger } from '../../logger/logger.js';
import type { ExchangeConfig } from '../../config/schema.js';
import type { ExchangeAdapter, Quote, QuoteRequest } from '../types.js';
import { AxiomClient } from './axiom-client.js';
import { AxiomStream } from './axiom-stream.js';

/** Wire shapes, isolated here so the rest of the bot never sees venue JSON. */
interface AxiomQuoteResponse {
  inAmount?: string | number;
  outAmount?: string | number;
  price?: string | number;
  priceImpactBps?: number;
  feeBps?: number;
  gasUsd?: number;
  route?: string;
  expiresAt?: number;
}

interface AxiomOrderResponse {
  orderId?: string;
  status?: string;
  filledAmount?: string | number;
  filledQuote?: string | number;
  avgPrice?: string | number;
  fee?: string | number;
  gasUsd?: number;
  slippageBps?: number;
  txHash?: string;
  error?: string;
}

interface AxiomBalanceResponse {
  balances?: { chain?: string; asset?: string; free?: string | number; locked?: string | number; usdValue?: number }[];
}

const STATUS_MAP: Record<string, OrderResult['status']> = {
  filled: 'filled',
  complete: 'filled',
  success: 'filled',
  partial: 'partial',
  partially_filled: 'partial',
  pending: 'submitted',
  submitted: 'submitted',
  open: 'submitted',
  rejected: 'rejected',
  failed: 'rejected',
  cancelled: 'expired',
  expired: 'expired',
};

export interface AxiomExchangeOptions {
  readonly config: ExchangeConfig['axiom'];
  readonly chains: readonly ChainId[];
  readonly logger: Logger;
}

/**
 * Axiom Pro venue adapter.
 *
 * The venue owns routing and execution; this adapter owns translation and
 * defensive handling. Two behaviours are deliberate:
 *
 *  - Every order carries an idempotency key equal to its client order id, so a
 *    retry after a timeout cannot produce a second fill. In this market a
 *    duplicated buy is a real, expensive failure mode.
 *  - Prices are served from the websocket cache when it is fresh and fall back
 *    to REST otherwise, because exits must not depend on a healthy socket.
 */
export class AxiomExchange implements ExchangeAdapter {
  readonly name = 'exchange:axiom';
  readonly venue = 'axiom';

  private readonly client: AxiomClient;
  private readonly stream: AxiomStream;
  private readonly prices = new TtlCache<string, number>({ ttlMs: 5_000, maxEntries: 5_000 });
  private readonly logger: Logger;
  private unsubscribe: (() => void) | undefined;
  private submitted = 0;
  private failed = 0;

  constructor(private readonly options: AxiomExchangeOptions) {
    this.logger = options.logger.child(this.name);
    this.client = new AxiomClient(options.config, options.logger);
    this.stream = new AxiomStream(options.config, options.logger);
  }

  async start(): Promise<void> {
    if (!this.options.config.enabled) {
      throw new ExchangeError('Axiom venue selected but disabled in configuration', false);
    }
    this.unsubscribe = this.stream.onMessage((channel, payload) => this.onStreamMessage(channel, payload));
    await this.stream.connect();
    this.stream.subscribe('prices');
    this.logger.info({ chains: this.options.chains }, 'axiom venue ready');
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    await this.stream.close();
  }

  supports(chain: ChainId): boolean {
    return this.options.chains.includes(chain);
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    const response = await this.client.request<AxiomQuoteResponse>({
      method: 'GET',
      path: '/v1/quote',
      query: {
        chain: String(request.token.chain),
        token: request.token.address,
        side: request.side,
        amount: request.amount,
        slippageBps: request.slippageBps,
      },
    });

    const price = num(response.price);
    if (price <= 0) throw new ExchangeError('Venue returned an unusable quote', true, { token: request.token.address });

    return {
      token: request.token,
      side: request.side,
      inAmount: num(response.inAmount, request.amount),
      outAmount: num(response.outAmount),
      price,
      priceImpactBps: response.priceImpactBps ?? 0,
      feeBps: response.feeBps ?? 0,
      estimatedGasUsd: response.gasUsd ?? 0,
      route: response.route ?? 'axiom',
      validUntil: response.expiresAt ?? Date.now() + 10_000,
    };
  }

  async execute(order: OrderRequest): Promise<OrderResult> {
    const submittedAt = Date.now();
    this.submitted++;
    try {
      const response = await this.client.request<AxiomOrderResponse>({
        method: 'POST',
        path: '/v1/orders',
        // The client order id doubles as the idempotency key: a retried
        // submission after a network timeout resolves to the same order.
        idempotencyKey: order.clientOrderId,
        body: {
          clientOrderId: order.clientOrderId,
          chain: String(order.token.chain),
          token: order.token.address,
          side: order.side,
          type: order.type,
          amount: order.amount,
          limitPrice: order.limitPrice,
          slippageBps: order.slippageBps,
          priorityFee: order.urgency,
          privateTx: order.privateTx && this.options.config.privateTx,
        },
      });

      const status = STATUS_MAP[(response.status ?? '').toLowerCase()] ?? 'submitted';
      if (status === 'rejected') this.failed++;

      return {
        clientOrderId: order.clientOrderId,
        venueOrderId: response.orderId,
        status,
        token: order.token,
        side: order.side,
        filledQty: num(response.filledAmount),
        filledQuote: num(response.filledQuote),
        avgPrice: num(response.avgPrice),
        feeQuote: num(response.fee),
        gasUsd: response.gasUsd ?? 0,
        slippageBps: response.slippageBps ?? 0,
        txHash: response.txHash,
        submittedAt,
        filledAt: status === 'filled' ? Date.now() : undefined,
        error: response.error,
      };
    } catch (error) {
      this.failed++;
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ order: order.clientOrderId, err: error }, 'order submission failed');
      return {
        clientOrderId: order.clientOrderId,
        status: 'rejected',
        token: order.token,
        side: order.side,
        filledQty: 0,
        filledQuote: 0,
        avgPrice: 0,
        feeQuote: 0,
        gasUsd: 0,
        slippageBps: 0,
        submittedAt,
        error: message,
      };
    }
  }

  async cancel(clientOrderId: string): Promise<boolean> {
    try {
      await this.client.request({ method: 'DELETE', path: `/v1/orders/${clientOrderId}` });
      return true;
    } catch (error) {
      this.logger.warn({ clientOrderId, err: error }, 'cancel failed');
      return false;
    }
  }

  async balances(): Promise<Balance[]> {
    const response = await this.client.request<AxiomBalanceResponse>({ method: 'GET', path: '/v1/balances' });
    return (response.balances ?? []).map((entry) => ({
      chain: (entry.chain ?? 'unknown') as ChainId,
      asset: entry.asset ?? 'unknown',
      free: num(entry.free),
      locked: num(entry.locked),
      usdValue: entry.usdValue ?? 0,
    }));
  }

  async price(token: TokenRef): Promise<number | undefined> {
    const key = `${token.chain}:${token.address}`;
    const cached = this.prices.get(key);
    if (cached !== undefined) return cached;
    try {
      const response = await this.client.request<{ price?: string | number }>({
        method: 'GET',
        path: '/v1/price',
        query: { chain: String(token.chain), token: token.address },
      });
      const price = num(response.price);
      if (price > 0) {
        this.prices.set(key, price);
        return price;
      }
    } catch (error) {
      this.logger.debug({ token: token.address, err: error }, 'price lookup failed');
    }
    return undefined;
  }

  health(): HealthReport {
    const healthy = this.client.isAvailable;
    return {
      component: this.name,
      healthy,
      detail: healthy
        ? `stream ${this.stream.connected ? 'connected' : 'reconnecting'}`
        : 'rest circuit breaker open',
      checkedAt: Date.now(),
      metrics: {
        submitted: this.submitted,
        failed: this.failed,
        streamConnected: this.stream.connected,
        streamStaleMs: this.stream.staleMs,
        cachedPrices: this.prices.stats().size,
      },
    };
  }

  /** Exposed so the token feed can share one socket with the venue adapter. */
  get marketStream(): AxiomStream {
    return this.stream;
  }

  private onStreamMessage(channel: string, payload: unknown): void {
    if (channel !== 'prices' || typeof payload !== 'object' || payload === null) return;
    const update = payload as { chain?: string; token?: string; price?: number | string };
    if (!update.chain || !update.token) return;
    const price = num(update.price);
    if (price > 0) this.prices.set(`${update.chain}:${update.token}`, price);
  }
}

function num(value: string | number | undefined, fallback = 0): number {
  if (value === undefined || value === null) return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
