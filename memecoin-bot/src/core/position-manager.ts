import type { EntrySignal, ExitSignal } from './domain/signal.js';
import type { TokenProfile } from './domain/token.js';
import { tokenKey } from './domain/token.js';
import type { CloseReason, OrderRequest, Position, PositionLeg, TradeRecord } from './domain/trading.js';
import type { EventBus } from './event-bus.js';
import { clientOrderId, positionId, shortId, tradeId } from './utils/id.js';
import { clamp, safeDiv } from './utils/math.js';
import type { Logger } from '../logger/logger.js';
import type { Database } from '../database/database.js';
import type { ExecutionRouter } from '../exchanges/router.js';
import type { FeeOptimizer } from '../blockchains/gas/fee-optimizer.js';
import type { ExitManager } from '../strategies/exits/exit-manager.js';
import { PositionRepository } from '../database/repositories/position-repository.js';

export interface PositionManagerOptions {
  readonly router: ExecutionRouter;
  readonly exits: ExitManager;
  readonly feeOptimizer: FeeOptimizer;
  readonly database: Database;
  readonly events: EventBus;
  readonly logger: Logger;
  readonly now?: () => number;
}

/**
 * Owns the lifecycle of every position: opening, partial exits, closing, and
 * the trade record that results.
 *
 * Two invariants are enforced here rather than trusted:
 *
 *  - **Fills are authoritative.** Entry price, quantity and cost basis come
 *    from what the venue actually filled, never from the requested size. A
 *    position built from intentions rather than fills drifts out of sync with
 *    the wallet within a handful of trades.
 *  - **A failed exit leaves the position open.** If a sell is rejected the
 *    position returns to `open` with its stop intact and will be retried on
 *    the next tick, rather than being marked closed on an order that never
 *    filled.
 */
export class PositionManager {
  private readonly positions = new Map<string, Position>();
  private readonly logger: Logger;
  private readonly now: () => number;
  /** Liquidity observed at entry, for the emergency drain check. */
  private readonly entryLiquidity = new Map<string, number>();

  constructor(private readonly options: PositionManagerOptions) {
    this.logger = options.logger.child('position-manager');
    this.now = options.now ?? (() => Date.now());
  }

  /** Rehydrates open positions after a restart. */
  async restore(): Promise<Position[]> {
    const open = await this.options.database.positions.open();
    for (const position of open) {
      this.positions.set(position.id, position);
      this.entryLiquidity.set(position.id, Number(position.meta.entryLiquidityUsd ?? 0));
    }
    if (open.length > 0) {
      this.logger.warn({ positions: open.length }, 'restored open positions from the previous session');
    }
    return open;
  }

  list(): Position[] {
    return [...this.positions.values()];
  }

  get(id: string): Position | undefined {
    return this.positions.get(id);
  }

  hasPositionIn(profile: TokenProfile): boolean {
    const key = tokenKey(profile.ref);
    return [...this.positions.values()].some((position) => tokenKey(position.token) === key);
  }

  get openCount(): number {
    return [...this.positions.values()].filter((p) => p.status === 'open' || p.status === 'opening').length;
  }

  totalUnrealized(): number {
    return [...this.positions.values()].reduce((acc, position) => acc + position.unrealizedPnl, 0);
  }

  /** Executes the entry and, on a fill, creates and persists the position. */
  async open(signal: EntrySignal, sizeUsd: number): Promise<Position | undefined> {
    const { profile } = signal;
    const volatility = volatilityOf(profile);
    const decision = this.options.feeOptimizer.decide({
      chain: profile.ref.chain,
      positionUsd: sizeUsd,
      conviction: signal.conviction,
      isExit: false,
      liquidityUsd: profile.market.liquidityUsd,
      volatility,
    });

    const order: OrderRequest = {
      clientOrderId: clientOrderId(),
      token: profile.ref,
      side: 'buy',
      type: 'market',
      amount: sizeUsd,
      slippageBps: decision.slippageBps,
      urgency: decision.urgency,
      privateTx: decision.usePrivateTx,
      reason: `${signal.strategy}: score ${signal.score.total}`,
    };

    const outcome = await this.options.router.execute(order);
    const result = outcome.result;

    if (result.status !== 'filled' && result.status !== 'partial') {
      this.logger.warn(
        { token: profile.metadata.symbol, error: result.error, attempts: outcome.attempts },
        'entry rejected',
      );
      return undefined;
    }
    if (result.filledQty <= 0 || result.avgPrice <= 0) {
      this.logger.warn({ token: profile.metadata.symbol }, 'entry reported a fill with no quantity');
      return undefined;
    }

    const openedAt = this.now();
    const stopPrice = this.options.exits.stops.initialStop(result.avgPrice, signal.suggestedStopPct);

    const leg: PositionLeg = {
      id: shortId('leg'),
      side: 'buy',
      qty: result.filledQty,
      quote: result.filledQuote,
      price: result.avgPrice,
      feeQuote: result.feeQuote,
      gasUsd: result.gasUsd,
      txHash: result.txHash,
      reason: 'entry',
      at: openedAt,
    };

    const position: Position = {
      id: positionId(),
      token: profile.ref,
      chain: profile.ref.chain,
      symbol: profile.metadata.symbol,
      status: 'open',
      strategy: signal.strategy,
      entryScore: signal.score.total,
      entryPrice: result.avgPrice,
      qty: result.filledQty,
      initialQty: result.filledQty,
      costBasis: result.filledQuote,
      initialCost: result.filledQuote,
      realizedPnl: 0,
      unrealizedPnl: 0,
      feesPaid: result.feeQuote,
      gasPaid: result.gasUsd,
      highWaterPrice: result.avgPrice,
      lowWaterPrice: result.avgPrice,
      currentPrice: result.avgPrice,
      stopPrice,
      initialStopPrice: stopPrice,
      breakEvenArmed: false,
      trailingArmed: false,
      trailingPeakPrice: result.avgPrice,
      takeProfits: this.options.exits.takeProfits.buildLevels(),
      legs: [leg],
      openedAt,
      maxHoldUntil: openedAt + signal.maxHoldMs,
      meta: {
        entryLiquidityUsd: profile.market.liquidityUsd,
        entrySlippageBps: result.slippageBps,
        conviction: signal.conviction,
        venue: outcome.venue,
        rugProbability: signal.score.probabilities.rug,
        pumpProbability: signal.score.probabilities.pump,
      },
    };

    this.positions.set(position.id, position);
    this.entryLiquidity.set(position.id, profile.market.liquidityUsd);
    await this.options.database.positions.save(position);
    await this.options.database.tokens.markTraded(String(profile.ref.chain), profile.ref.address).catch(() => undefined);

    this.options.events.emit('position.opened', { position });
    this.logger.info(
      {
        position: position.id,
        symbol: position.symbol,
        chain: position.chain,
        size: Math.round(result.filledQuote),
        price: result.avgPrice,
        stop: stopPrice,
        strategy: signal.strategy,
      },
      'position opened',
    );
    return position;
  }

  /** Executes an exit signal; closes the position when nothing is left. */
  async exit(position: Position, signal: ExitSignal, liquidityUsd: number): Promise<void> {
    if (position.status !== 'open') return;
    const fraction = clamp(signal.fraction, 0, 1);
    const qty = position.qty * fraction;
    if (qty <= 0) return;

    position.status = 'closing';
    const notional = qty * position.currentPrice;
    const decision = this.options.feeOptimizer.decide({
      chain: position.chain,
      positionUsd: notional,
      conviction: 1,
      isExit: true,
      emergency: signal.reason === 'emergency_exit' || signal.reason === 'risk_halt',
      liquidityUsd,
      volatility: 0.1,
    });

    const order: OrderRequest = {
      clientOrderId: clientOrderId(),
      token: position.token,
      side: 'sell',
      type: 'market',
      amount: qty,
      slippageBps: decision.slippageBps,
      urgency: decision.urgency,
      privateTx: false,
      reason: `${signal.reason}: ${signal.note}`,
      positionId: position.id,
    };

    const outcome = await this.options.router.execute(order);
    const result = outcome.result;

    if (result.status !== 'filled' && result.status !== 'partial') {
      // Critical: an unfilled exit must leave the position live so the next
      // tick retries it, with its stop unchanged.
      position.status = 'open';
      await this.options.database.positions.save(position);
      this.logger.error(
        { position: position.id, symbol: position.symbol, reason: signal.reason, error: result.error },
        'EXIT FAILED — position remains open and will be retried',
      );
      return;
    }

    const proceeds = result.filledQuote;
    const soldQty = result.filledQty;
    const costPortion = position.costBasis * safeDiv(soldQty, position.qty, 1);
    const realized = proceeds - costPortion;

    position.legs.push({
      id: shortId('leg'),
      side: 'sell',
      qty: soldQty,
      quote: proceeds,
      price: result.avgPrice,
      feeQuote: result.feeQuote,
      gasUsd: result.gasUsd,
      txHash: result.txHash,
      reason: signal.reason,
      at: this.now(),
    });

    position.qty = Math.max(0, position.qty - soldQty);
    position.costBasis = Math.max(0, position.costBasis - costPortion);
    position.realizedPnl += realized;
    position.feesPaid += result.feeQuote;
    position.gasPaid += result.gasUsd;
    position.currentPrice = result.avgPrice;

    if (signal.reason === 'take_profit') {
      this.options.exits.confirmTakeProfit(position, result.avgPrice, this.now());
    }

    // Dust below 0.5% of the original size is not worth another gas payment.
    const isDust = position.qty <= position.initialQty * 0.005;
    if (position.qty <= 0 || isDust || fraction >= 1) {
      await this.close(position, signal.reason, result.avgPrice);
      return;
    }

    position.status = 'open';
    position.unrealizedPnl = (result.avgPrice - position.entryPrice) * position.qty;
    await this.options.database.positions.save(position);
    this.options.events.emit('position.partial_exit', { position, fraction, reason: signal.reason });
    this.logger.info(
      {
        position: position.id,
        symbol: position.symbol,
        sold: `${(fraction * 100).toFixed(0)}%`,
        realized: Number(realized.toFixed(2)),
        remaining: Number(this.options.exits.takeProfits.remainingFraction(position).toFixed(3)),
      },
      'partial exit filled',
    );
  }

  /** Marks a position closed and writes the immutable trade record. */
  async close(position: Position, reason: CloseReason, exitPrice: number): Promise<TradeRecord> {
    position.status = 'closed';
    position.closedAt = this.now();
    position.closeReason = reason;
    position.unrealizedPnl = 0;
    position.qty = 0;

    const quoteOut = position.legs
      .filter((leg) => leg.side === 'sell')
      .reduce((acc, leg) => acc + leg.quote, 0);
    const pnl = quoteOut - position.initialCost - position.gasPaid;

    const trade: TradeRecord = {
      id: tradeId(),
      positionId: position.id,
      chain: position.chain,
      tokenAddress: position.token.address,
      symbol: position.symbol,
      strategy: position.strategy,
      entryScore: position.entryScore,
      entryPrice: position.entryPrice,
      exitPrice,
      qty: position.initialQty,
      quoteIn: position.initialCost,
      quoteOut,
      pnl,
      pnlPct: safeDiv(pnl, position.initialCost),
      fees: position.feesPaid,
      gas: position.gasPaid,
      holdMs: (position.closedAt ?? this.now()) - position.openedAt,
      maxFavorableExcursion: safeDiv(position.highWaterPrice - position.entryPrice, position.entryPrice),
      maxAdverseExcursion: safeDiv(position.lowWaterPrice - position.entryPrice, position.entryPrice),
      closeReason: reason,
      openedAt: position.openedAt,
      closedAt: position.closedAt ?? this.now(),
    };

    await this.options.database.positions.save(position);
    await this.options.database.trades.record(trade);
    this.positions.delete(position.id);
    this.entryLiquidity.delete(position.id);

    this.options.events.emit('position.closed', { position, trade });
    this.logger.info(
      {
        position: position.id,
        symbol: position.symbol,
        reason,
        pnl: Number(pnl.toFixed(2)),
        pnlPct: `${(trade.pnlPct * 100).toFixed(1)}%`,
        holdMin: Math.round(trade.holdMs / 60_000),
      },
      pnl >= 0 ? 'position closed in profit' : 'position closed at a loss',
    );
    return trade;
  }

  entryLiquidityOf(positionId: string): number {
    return this.entryLiquidity.get(positionId) ?? 0;
  }

  /** Updates mark-to-market state without generating any orders. */
  mark(position: Position, price: number): void {
    if (price <= 0) return;
    position.currentPrice = price;
    position.unrealizedPnl = (price - position.entryPrice) * position.qty;
    if (price > position.highWaterPrice) position.highWaterPrice = price;
    if (price < position.lowWaterPrice) position.lowWaterPrice = price;
  }

  static toRow = PositionRepository.toRow;
}

function volatilityOf(profile: TokenProfile): number {
  const prices = profile.priceHistory.map((p) => p.priceUsd);
  if (prices.length < 3) return 0.1;
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) returns.push(safeDiv(prices[i] - prices[i - 1], prices[i - 1]));
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1);
  return Math.sqrt(Math.max(0, variance));
}
