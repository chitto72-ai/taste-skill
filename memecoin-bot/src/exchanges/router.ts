import type { ChainId } from '../core/domain/chain.js';
import type { TokenRef } from '../core/domain/token.js';
import type { Balance, OrderRequest, OrderResult } from '../core/domain/trading.js';
import type { EventBus } from '../core/event-bus.js';
import { ExchangeError } from '../core/errors.js';
import type { HealthReport, Service } from '../core/lifecycle.js';
import { sleep } from '../core/utils/async.js';
import type { Logger } from '../logger/logger.js';
import type { Database } from '../database/database.js';
import type { ExchangeAdapter, ExecutionOutcome, Quote, QuoteRequest } from './types.js';

export interface ExecutionRouterOptions {
  readonly adapters: readonly ExchangeAdapter[];
  readonly events: EventBus;
  readonly logger: Logger;
  readonly database?: Database;
  /** Attempts per order, widening slippage each time. */
  readonly maxAttempts?: number;
}

/**
 * Routes orders to a venue and owns the retry policy.
 *
 * Retries widen slippage by 50% each attempt, because the common failure on a
 * moving memecoin is "price left the tolerance", not "venue is down". Crucially
 * the retry reuses the same `clientOrderId`, which the venue treats as an
 * idempotency key — so a retry after an ambiguous timeout cannot double-fill.
 */
export class ExecutionRouter implements Service {
  readonly name = 'execution-router';
  private readonly logger: Logger;
  private readonly maxAttempts: number;

  constructor(private readonly options: ExecutionRouterOptions) {
    this.logger = options.logger.child(this.name);
    this.maxAttempts = options.maxAttempts ?? 3;
  }

  async start(): Promise<void> {
    for (const adapter of this.options.adapters) await adapter.start();
    this.logger.info({ venues: this.options.adapters.map((a) => a.venue) }, 'execution router ready');
  }

  async stop(): Promise<void> {
    for (const adapter of this.options.adapters) {
      await adapter.stop().catch((error) => this.logger.warn({ venue: adapter.venue, err: error }, 'venue stop failed'));
    }
  }

  get venues(): string[] {
    return this.options.adapters.map((a) => a.venue);
  }

  adapterFor(chain: ChainId): ExchangeAdapter {
    const adapter = this.options.adapters.find((candidate) => candidate.supports(chain));
    if (!adapter) {
      throw new ExchangeError(`No venue configured for chain "${chain}"`, false, {
        chain,
        venues: this.venues,
      });
    }
    return adapter;
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    return this.adapterFor(request.token.chain).quote(request);
  }

  async price(token: TokenRef): Promise<number | undefined> {
    try {
      return await this.adapterFor(token.chain).price(token);
    } catch {
      return undefined;
    }
  }

  async balances(): Promise<Balance[]> {
    const all = await Promise.all(
      this.options.adapters.map((adapter) =>
        adapter.balances().catch((error) => {
          this.logger.warn({ venue: adapter.venue, err: error }, 'balance fetch failed');
          return [] as Balance[];
        }),
      ),
    );
    return all.flat();
  }

  async execute(order: OrderRequest): Promise<ExecutionOutcome> {
    const adapter = this.adapterFor(order.token.chain);
    this.options.events.emit('order.submitted', { order });

    let attempt = 0;
    let last: OrderResult | undefined;

    while (attempt < this.maxAttempts) {
      attempt++;
      const attemptOrder: OrderRequest =
        attempt === 1 ? order : { ...order, slippageBps: Math.round(order.slippageBps * 1.5 ** (attempt - 1)) };

      last = await adapter.execute(attemptOrder);
      await this.record(attemptOrder, last, adapter.venue);

      if (last.status === 'filled' || last.status === 'partial') {
        this.options.events.emit('order.filled', { order: attemptOrder, result: last });
        return { result: last, venue: adapter.venue, attempts: attempt };
      }

      // A rejection we cannot fix by widening slippage should not be retried.
      if (!isRetryableRejection(last)) break;
      if (attempt < this.maxAttempts) {
        this.logger.warn(
          { order: order.clientOrderId, attempt, error: last.error },
          'order rejected, retrying with wider slippage',
        );
        await sleep(250 * attempt);
      }
    }

    const result = last ?? failedResult(order, 'no venue response');
    this.options.events.emit('order.rejected', { order, result });
    return { result, venue: adapter.venue, attempts: attempt };
  }

  async health(): Promise<HealthReport> {
    const reports = await Promise.all(this.options.adapters.map((a) => a.health()));
    const healthy = reports.filter((r) => r.healthy).length;
    return {
      component: this.name,
      healthy: healthy > 0,
      detail: `${healthy}/${reports.length} venues healthy`,
      checkedAt: Date.now(),
      metrics: { venues: reports.length, healthy },
    };
  }

  private async record(order: OrderRequest, result: OrderResult, venue: string): Promise<void> {
    if (!this.options.database) return;
    try {
      await this.options.database.orders.record(order, result, venue);
    } catch (error) {
      this.logger.warn({ order: order.clientOrderId, err: error }, 'failed to persist order');
    }
  }
}

/** Slippage and transient venue errors are retryable; balance errors are not. */
function isRetryableRejection(result: OrderResult): boolean {
  const error = (result.error ?? '').toLowerCase();
  if (!error) return false;
  if (error.includes('insufficient') || error.includes('inventory') || error.includes('balance')) return false;
  if (error.includes('honeypot') || error.includes('not tradable')) return false;
  return (
    error.includes('slippage') ||
    error.includes('price') ||
    error.includes('timeout') ||
    error.includes('temporar') ||
    error.includes('failure') ||
    error.includes('http 5')
  );
}

function failedResult(order: OrderRequest, error: string): OrderResult {
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
    submittedAt: Date.now(),
    error,
  };
}
