import type { ChainId } from '../../core/domain/chain.js';
import type { TokenRef } from '../../core/domain/token.js';
import { tokenKey } from '../../core/domain/token.js';
import type { Balance, OrderRequest, OrderResult } from '../../core/domain/trading.js';
import { InsufficientLiquidityError } from '../../core/errors.js';
import type { HealthReport } from '../../core/lifecycle.js';
import { sleep } from '../../core/utils/async.js';
import { clamp01, safeDiv } from '../../core/utils/math.js';
import type { Logger } from '../../logger/logger.js';
import type { ExchangeConfig } from '../../config/schema.js';
import type { ExchangeAdapter, MarketDataSource, Quote, QuoteRequest } from '../types.js';

export interface PaperExchangeOptions {
  readonly config: ExchangeConfig['paper'];
  readonly market: MarketDataSource;
  readonly startingCash: number;
  readonly chains: readonly ChainId[];
  readonly logger: Logger;
  /** Injected for deterministic tests; defaults to Math.random. */
  readonly random?: () => number;
  readonly now?: () => number;
}

/**
 * Simulated venue.
 *
 * It models the three costs that actually decide whether a memecoin strategy
 * is profitable — price impact against pool depth, venue/LP fees, and gas —
 * plus a failure rate, because a backtest where every transaction lands
 * overstates results substantially. Fills are computed against the same
 * `MarketDataSource` the scanner sees, so paper results line up with what the
 * live path would have attempted.
 */
export class PaperExchange implements ExchangeAdapter {
  readonly name = 'exchange:paper';
  readonly venue = 'paper';

  private cash: number;
  private readonly positions = new Map<string, { qty: number; chain: ChainId }>();
  private readonly logger: Logger;
  private readonly random: () => number;
  private readonly now: () => number;
  private filled = 0;
  private rejected = 0;

  constructor(private readonly options: PaperExchangeOptions) {
    this.cash = options.startingCash;
    this.logger = options.logger.child(this.name);
    this.random = options.random ?? Math.random;
    this.now = options.now ?? (() => Date.now());
  }

  async start(): Promise<void> {
    this.logger.info({ cash: this.cash }, 'paper venue ready');
  }

  async stop(): Promise<void> {
    this.logger.info({ cash: this.cash, openTokens: this.positions.size }, 'paper venue stopped');
  }

  supports(chain: ChainId): boolean {
    return this.options.chains.length === 0 || this.options.chains.includes(chain);
  }

  async quote(request: QuoteRequest): Promise<Quote> {
    const price = this.options.market.priceOf(request.token);
    const liquidity = this.options.market.liquidityOf(request.token) ?? 0;
    if (!price || price <= 0) {
      throw new InsufficientLiquidityError({ token: request.token.address, reason: 'no price' });
    }

    const notional = request.side === 'buy' ? request.amount : request.amount * price;
    const impactBps = this.impactBps(notional, liquidity);
    const feeBps = this.options.config.feeBps;
    const effectivePrice = request.side === 'buy'
      ? price * (1 + (impactBps + feeBps) / 10_000)
      : price * (1 - (impactBps + feeBps) / 10_000);

    return {
      token: request.token,
      side: request.side,
      inAmount: request.amount,
      outAmount: request.side === 'buy' ? request.amount / effectivePrice : request.amount * effectivePrice,
      price: effectivePrice,
      priceImpactBps: impactBps,
      feeBps,
      estimatedGasUsd: this.options.config.gasUsdPerTrade,
      route: 'paper-amm',
      validUntil: this.now() + 10_000,
    };
  }

  async execute(order: OrderRequest): Promise<OrderResult> {
    const submittedAt = this.now();
    // Latency is modelled because it is the dominant source of slippage on a
    // fast-moving memecoin, not an afterthought.
    if (this.options.config.latencyMs > 0) await sleep(this.options.config.latencyMs);

    const key = tokenKey(order.token);
    const price = this.options.market.priceOf(order.token);
    const liquidity = this.options.market.liquidityOf(order.token) ?? 0;

    if (!price || price <= 0) {
      return this.reject(order, submittedAt, 'no market price available');
    }
    if (this.random() < this.options.config.failureRate) {
      return this.reject(order, submittedAt, 'simulated transaction failure');
    }

    const notional = order.side === 'buy' ? order.amount : order.amount * price;
    const impactBps = this.impactBps(notional, liquidity);
    const totalBps = impactBps + this.options.config.baseSlippageBps;

    if (totalBps > order.slippageBps) {
      return this.reject(
        order,
        submittedAt,
        `slippage ${Math.round(totalBps)}bps exceeds tolerance ${order.slippageBps}bps`,
      );
    }

    const gasUsd = this.options.config.gasUsdPerTrade;
    const feeQuote = (notional * this.options.config.feeBps) / 10_000;

    if (order.side === 'buy') {
      const cost = order.amount;
      if (cost + gasUsd > this.cash) {
        return this.reject(order, submittedAt, 'insufficient simulated cash');
      }
      const fillPrice = price * (1 + totalBps / 10_000);
      const qty = (cost - feeQuote) / fillPrice;
      this.cash -= cost + gasUsd;
      const existing = this.positions.get(key);
      this.positions.set(key, { qty: (existing?.qty ?? 0) + qty, chain: order.token.chain });
      this.filled++;
      return {
        clientOrderId: order.clientOrderId,
        status: 'filled',
        token: order.token,
        side: 'buy',
        filledQty: qty,
        filledQuote: cost,
        avgPrice: fillPrice,
        feeQuote,
        gasUsd,
        slippageBps: Math.round(totalBps),
        txHash: this.fakeHash(),
        submittedAt,
        filledAt: this.now(),
      };
    }

    const held = this.positions.get(key)?.qty ?? 0;
    const qty = Math.min(order.amount, held);
    if (qty <= 0) return this.reject(order, submittedAt, 'no simulated inventory to sell');

    const fillPrice = price * (1 - totalBps / 10_000);
    const proceeds = qty * fillPrice - feeQuote;
    this.cash += proceeds - gasUsd;
    const remaining = held - qty;
    if (remaining <= 1e-12) this.positions.delete(key);
    else this.positions.set(key, { qty: remaining, chain: order.token.chain });
    this.filled++;

    return {
      clientOrderId: order.clientOrderId,
      status: 'filled',
      token: order.token,
      side: 'sell',
      filledQty: qty,
      filledQuote: proceeds,
      avgPrice: fillPrice,
      feeQuote,
      gasUsd,
      slippageBps: Math.round(totalBps),
      txHash: this.fakeHash(),
      submittedAt,
      filledAt: this.now(),
    };
  }

  async balances(): Promise<Balance[]> {
    const out: Balance[] = [
      { chain: 'paper', asset: 'USDC', free: this.cash, locked: 0, usdValue: this.cash },
    ];
    for (const [key, position] of this.positions) {
      const address = key.split(':')[1] ?? key;
      const price = this.options.market.priceOf({ chain: position.chain, address }) ?? 0;
      out.push({
        chain: position.chain,
        asset: address,
        free: position.qty,
        locked: 0,
        usdValue: position.qty * price,
      });
    }
    return out;
  }

  async price(token: TokenRef): Promise<number | undefined> {
    return this.options.market.priceOf(token);
  }

  health(): HealthReport {
    return {
      component: this.name,
      healthy: true,
      detail: 'simulated venue',
      checkedAt: this.now(),
      metrics: { cash: Math.round(this.cash), filled: this.filled, rejected: this.rejected },
    };
  }

  get availableCash(): number {
    return this.cash;
  }

  /**
   * Constant-product price impact: consuming a share `s` of the pool moves
   * price by roughly 2s. Scaled by the configured per-percent coefficient so
   * operators can calibrate against observed fills.
   */
  private impactBps(notional: number, liquidityUsd: number): number {
    if (liquidityUsd <= 0) return 10_000;
    const share = clamp01(safeDiv(notional, liquidityUsd, 1));
    return share * 100 * this.options.config.impactBpsPerPct;
  }

  private reject(order: OrderRequest, submittedAt: number, error: string): OrderResult {
    this.rejected++;
    this.logger.debug({ order: order.clientOrderId, error }, 'paper order rejected');
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
      error,
    };
  }

  private fakeHash(): string {
    return `0xpaper${Math.floor(this.random() * 1e16).toString(16).padStart(16, '0')}`;
  }
}
