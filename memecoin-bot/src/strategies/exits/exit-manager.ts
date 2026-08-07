import type { ExitSignal } from '../../core/domain/signal.js';
import type { Position } from '../../core/domain/trading.js';
import { safeDiv } from '../../core/utils/math.js';
import type { ExitConfig } from '../../config/schema.js';
import type { Logger } from '../../logger/logger.js';
import { StopLossEngine, type MarketState } from './stop-loss.js';
import { TakeProfitEngine } from './take-profit.js';

export interface ExitManagerOptions {
  readonly config: ExitConfig;
  readonly logger: Logger;
}

/**
 * Single entry point for exit decisions.
 *
 * Precedence is explicit: protective exits (stop, trailing, time, emergency)
 * outrank profit-taking. If a position simultaneously crosses a take-profit
 * level and its trailing stop — which happens on a spike-and-reverse candle,
 * the most common shape in this market — the protective exit wins and the
 * whole position is closed rather than a quarter of it.
 */
export class ExitManager {
  readonly stops: StopLossEngine;
  readonly takeProfits: TakeProfitEngine;
  private readonly logger: Logger;

  constructor(private readonly options: ExitManagerOptions) {
    this.stops = new StopLossEngine(options.config);
    this.takeProfits = new TakeProfitEngine(options.config);
    this.logger = options.logger.child('exit-manager');
  }

  /**
   * Evaluates one position against current market state. Mutates the
   * position's trailing/stop bookkeeping and returns at most one signal.
   */
  evaluate(position: Position, market: MarketState): ExitSignal | undefined {
    if (position.status !== 'open' || position.qty <= 0) return undefined;

    position.unrealizedPnl = (market.price - position.entryPrice) * position.qty;

    const protective = this.stops.evaluate(position, market);
    if (protective) {
      this.logger.info(
        {
          position: position.id,
          symbol: position.symbol,
          reason: protective.reason,
          pnlPct: Number((safeDiv(market.price - position.entryPrice, position.entryPrice) * 100).toFixed(2)),
        },
        'protective exit triggered',
      );
      return protective;
    }

    const takeProfit = this.takeProfits.evaluate(position, market.price, market.now);
    if (takeProfit) {
      this.logger.info(
        { position: position.id, symbol: position.symbol, note: takeProfit.note },
        'take-profit level reached',
      );
      return takeProfit;
    }

    return undefined;
  }

  /** Applied after a partial fill so the ladder does not re-trigger. */
  confirmTakeProfit(position: Position, executedPrice: number, now: number): void {
    const executed = this.takeProfits.markExecuted(position, executedPrice, now);
    if (executed.length === 0) return;

    // Once the ladder completes, hand the remainder to the wider final trail.
    if (this.takeProfits.isLadderComplete(position)) {
      position.trailingArmed = true;
      position.trailingPeakPrice = Math.max(position.trailingPeakPrice, executedPrice);
      const finalStop = position.trailingPeakPrice * (1 - this.options.config.finalTrailingDistancePct / 100);
      if (finalStop > position.stopPrice) position.stopPrice = finalStop;
      this.logger.info(
        { position: position.id, stop: position.stopPrice },
        'take-profit ladder complete, runner on the final trailing stop',
      );
    }
  }

  /** Forced liquidation used by the risk halt and by shutdown. */
  forceExit(position: Position, reason: 'risk_halt' | 'manual' | 'strategy_exit', note: string, now: number): ExitSignal {
    return {
      positionId: position.id,
      reason,
      fraction: 1,
      urgency: reason === 'risk_halt' ? 'turbo' : 'fast',
      note,
      at: now,
    };
  }
}

export type { MarketState };
