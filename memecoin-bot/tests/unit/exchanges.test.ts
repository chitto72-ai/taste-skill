import { describe, expect, it } from 'vitest';
import { PaperExchange } from '../../src/exchanges/paper/paper-exchange.js';
import { ExecutionRouter } from '../../src/exchanges/router.js';
import type { ExchangeAdapter, MarketDataSource } from '../../src/exchanges/types.js';
import type { OrderRequest, OrderResult } from '../../src/core/domain/trading.js';
import type { TokenRef } from '../../src/core/domain/token.js';
import { EventBus } from '../../src/core/event-bus.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';

const config = createDefaultConfig();
const TOKEN: TokenRef = { chain: 'solana', address: 'So1Test' };

function marketData(price = 0.001, liquidity = 100_000): MarketDataSource {
  return { priceOf: () => price, liquidityOf: () => liquidity };
}

function order(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    clientOrderId: 'ord_1',
    token: TOKEN,
    side: 'buy',
    type: 'market',
    amount: 500,
    slippageBps: 300,
    urgency: 'standard',
    privateTx: false,
    reason: 'test',
    ...overrides,
  };
}

function paper(overrides: Partial<typeof config.exchange.paper> = {}, market = marketData()): PaperExchange {
  return new PaperExchange({
    config: { ...config.exchange.paper, latencyMs: 0, failureRate: 0, ...overrides },
    market,
    startingCash: 10_000,
    chains: ['solana'],
    logger: createNullLogger(),
    random: () => 0.5,
  });
}

describe('PaperExchange', () => {
  it('fills a buy above mid and debits cash including gas', async () => {
    const exchange = paper();
    const result = await exchange.execute(order());

    expect(result.status).toBe('filled');
    expect(result.avgPrice).toBeGreaterThan(0.001);
    expect(result.filledQty).toBeGreaterThan(0);
    expect(exchange.availableCash).toBeCloseTo(10_000 - 500 - config.exchange.paper.gasUsdPerTrade, 6);
  });

  it('fills a sell below mid and credits proceeds', async () => {
    const exchange = paper();
    const buy = await exchange.execute(order());
    const sell = await exchange.execute(order({ clientOrderId: 'ord_2', side: 'sell', amount: buy.filledQty }));

    expect(sell.status).toBe('filled');
    expect(sell.avgPrice).toBeLessThan(0.001);
    expect(sell.filledQuote).toBeGreaterThan(0);
  });

  it('charges more slippage in a thinner pool', async () => {
    const deep = await paper({}, marketData(0.001, 10_000_000)).execute(order());
    const thin = await paper({}, marketData(0.001, 50_000)).execute(order());
    expect(thin.slippageBps).toBeGreaterThan(deep.slippageBps);
  });

  it('rejects a fill that would exceed the slippage tolerance', async () => {
    const exchange = paper({}, marketData(0.001, 20_000));
    const result = await exchange.execute(order({ amount: 5_000, slippageBps: 50 }));
    expect(result.status).toBe('rejected');
    expect(result.error).toContain('slippage');
  });

  it('rejects a buy it cannot fund', async () => {
    // Deep pool so the order clears slippage and fails purely on cash.
    const exchange = paper({}, marketData(0.001, 500_000_000));
    const result = await exchange.execute(order({ amount: 50_000 }));
    expect(result.status).toBe('rejected');
    expect(result.error).toContain('cash');
  });

  it('rejects a sell with no inventory', async () => {
    const result = await paper().execute(order({ side: 'sell', amount: 100 }));
    expect(result.status).toBe('rejected');
    expect(result.error).toContain('inventory');
  });

  it('rejects when there is no price at all', async () => {
    const exchange = paper({}, { priceOf: () => undefined, liquidityOf: () => 0 });
    const result = await exchange.execute(order());
    expect(result.status).toBe('rejected');
    expect(result.error).toContain('price');
  });

  it('simulates transaction failures at the configured rate', async () => {
    const exchange = new PaperExchange({
      config: { ...config.exchange.paper, latencyMs: 0, failureRate: 1 },
      market: marketData(),
      startingCash: 10_000,
      chains: ['solana'],
      logger: createNullLogger(),
      random: () => 0,
    });
    const result = await exchange.execute(order());
    expect(result.status).toBe('rejected');
    expect(result.error).toContain('simulated');
  });

  it('quotes both sides around mid', async () => {
    const exchange = paper();
    const buy = await exchange.quote({ token: TOKEN, side: 'buy', amount: 500, slippageBps: 200 });
    const sell = await exchange.quote({ token: TOKEN, side: 'sell', amount: 500_000, slippageBps: 200 });
    expect(buy.price).toBeGreaterThan(sell.price);
    expect(buy.outAmount).toBeGreaterThan(0);
  });
});

/** Venue stub whose responses the test controls exactly. */
class StubExchange implements ExchangeAdapter {
  readonly name = 'exchange:stub';
  readonly venue = 'stub';
  readonly seen: OrderRequest[] = [];

  constructor(private readonly responses: OrderResult[]) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  supports(): boolean {
    return true;
  }
  async quote(): Promise<never> {
    throw new Error('not used');
  }
  async execute(request: OrderRequest): Promise<OrderResult> {
    this.seen.push(request);
    return this.responses[Math.min(this.seen.length - 1, this.responses.length - 1)];
  }
  async balances(): Promise<[]> {
    return [];
  }
  async price(): Promise<number> {
    return 0.001;
  }
  health() {
    return { component: this.name, healthy: true, detail: 'stub', checkedAt: Date.now() };
  }
}

function rejection(error: string): OrderResult {
  return {
    clientOrderId: 'ord_1',
    status: 'rejected',
    token: TOKEN,
    side: 'buy',
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

function fill(): OrderResult {
  return { ...rejection(''), status: 'filled', filledQty: 100, filledQuote: 500, avgPrice: 5, error: undefined };
}

describe('ExecutionRouter', () => {
  it('retries a slippage rejection with a wider tolerance, reusing the order id', async () => {
    const venue = new StubExchange([rejection('slippage exceeded'), fill()]);
    const router = new ExecutionRouter({ adapters: [venue], events: new EventBus(), logger: createNullLogger() });

    const outcome = await router.execute(order({ slippageBps: 100 }));

    expect(outcome.result.status).toBe('filled');
    expect(outcome.attempts).toBe(2);
    expect(venue.seen[1].slippageBps).toBeGreaterThan(venue.seen[0].slippageBps);
    // Idempotency: the venue must see the same client order id on the retry.
    expect(venue.seen[1].clientOrderId).toBe(venue.seen[0].clientOrderId);
  });

  it('does not retry a balance rejection', async () => {
    const venue = new StubExchange([rejection('insufficient balance')]);
    const router = new ExecutionRouter({ adapters: [venue], events: new EventBus(), logger: createNullLogger() });

    const outcome = await router.execute(order());
    expect(outcome.attempts).toBe(1);
    expect(outcome.result.status).toBe('rejected');
  });

  it('gives up after the attempt limit', async () => {
    const venue = new StubExchange([rejection('slippage exceeded')]);
    const router = new ExecutionRouter({
      adapters: [venue],
      events: new EventBus(),
      logger: createNullLogger(),
      maxAttempts: 3,
    });

    const outcome = await router.execute(order());
    expect(outcome.attempts).toBe(3);
    expect(outcome.result.status).toBe('rejected');
  });

  it('emits fill and rejection events', async () => {
    const events = new EventBus();
    const seen: string[] = [];
    events.on('order.submitted', () => {
      seen.push('submitted');
    });
    events.on('order.filled', () => {
      seen.push('filled');
    });

    const router = new ExecutionRouter({
      adapters: [new StubExchange([fill()])],
      events,
      logger: createNullLogger(),
    });
    await router.execute(order());
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(seen).toEqual(['submitted', 'filled']);
  });

  it('reports a chain with no venue clearly', () => {
    const router = new ExecutionRouter({
      adapters: [
        Object.assign(new StubExchange([fill()]), { supports: () => false }) as unknown as ExchangeAdapter,
      ],
      events: new EventBus(),
      logger: createNullLogger(),
    });
    expect(() => router.adapterFor('base')).toThrow(/No venue configured/);
  });
});
