import type { ExitSignal } from '../../core/domain/signal.js';
import type { Position } from '../../core/domain/trading.js';
import { clamp, safeDiv } from '../../core/utils/math.js';
import type { ExitConfig } from '../../config/schema.js';

export interface MarketState {
  readonly price: number;
  readonly liquidityUsd: number;
  /** Realized volatility of the recent price series. */
  readonly volatility: number;
  readonly sellTaxPct: number;
  /** Liquidity at entry, for the emergency drain check. */
  readonly entryLiquidityUsd: number;
  readonly now: number;
}

/**
 * Stop management: dynamic stop, break-even, trailing, time stop and
 * emergency exit.
 *
 * The ordering in `evaluate` is the whole design. Emergency conditions are
 * checked first and bypass every other rule, because the scenarios they cover
 * — liquidity being pulled, a sell tax appearing after entry, a vertical
 * collapse — are precisely the ones where a normal stop will not fill. Then
 * the hard stop, then trailing, then time. A position can only exit once per
 * evaluation, and it exits for the most urgent reason that applies.
 *
 * Stops only ever move up. A stop that widens on an adverse move is not a
 * stop, it is a hope.
 */
export class StopLossEngine {
  constructor(private readonly config: ExitConfig) {}

  /** Initial stop price for a new position. */
  initialStop(entryPrice: number, stopPct: number): number {
    return entryPrice * (1 - clamp(stopPct, 0.01, 0.95));
  }

  /**
   * Updates trailing state and returns an exit signal when one is triggered.
   * Mutates `position`'s stop/trailing fields — the caller persists it.
   */
  evaluate(position: Position, market: MarketState): ExitSignal | undefined {
    const { price, now } = market;
    if (price <= 0) return undefined;

    position.currentPrice = price;
    if (price > position.highWaterPrice) position.highWaterPrice = price;
    if (price < position.lowWaterPrice || position.lowWaterPrice === 0) position.lowWaterPrice = price;

    const gain = safeDiv(price - position.entryPrice, position.entryPrice);

    const emergency = this.emergency(position, market, gain);
    if (emergency) return emergency;

    this.armBreakEven(position, gain);
    this.armTrailing(position, gain, price);
    this.tightenDynamicStop(position, market, gain);

    if (price <= position.stopPrice) {
      const reason = position.trailingArmed
        ? 'trailing_stop'
        : position.breakEvenArmed && position.stopPrice >= position.entryPrice
          ? 'break_even'
          : 'stop_loss';
      return {
        positionId: position.id,
        reason,
        fraction: 1,
        urgency: 'fast',
        note: `price ${price.toExponential(4)} hit ${reason} at ${position.stopPrice.toExponential(4)} (${(gain * 100).toFixed(1)}%)`,
        at: now,
      };
    }

    return this.timeStop(position, gain, now);
  }

  /**
   * Conditions where the exit cannot wait for the stop price to be touched.
   * Each one describes a state in which the stop would likely not fill at all.
   */
  private emergency(position: Position, market: MarketState, gain: number): ExitSignal | undefined {
    const drops: string[] = [];

    const liquidityDrop = safeDiv(
      market.entryLiquidityUsd - market.liquidityUsd,
      Math.max(market.entryLiquidityUsd, 1),
    );
    if (liquidityDrop >= this.config.emergencyLiquidityDropPct) {
      drops.push(`liquidity down ${(liquidityDrop * 100).toFixed(0)}% since entry`);
    }

    const dropFromHigh = safeDiv(position.highWaterPrice - market.price, Math.max(position.highWaterPrice, 1e-18));
    if (dropFromHigh >= this.config.emergencyPriceDropPct) {
      drops.push(`price down ${(dropFromHigh * 100).toFixed(0)}% from the high`);
    }

    if (market.sellTaxPct >= this.config.emergencySellTaxPct) {
      drops.push(`sell tax rose to ${market.sellTaxPct}%`);
    }

    if (drops.length === 0) return undefined;

    return {
      positionId: position.id,
      reason: 'emergency_exit',
      fraction: 1,
      // Turbo: pay whatever the network asks, this is the exit that matters.
      urgency: 'turbo',
      note: `${drops.join('; ')} (position ${(gain * 100).toFixed(1)}%)`,
      at: market.now,
    };
  }

  private armBreakEven(position: Position, gain: number): void {
    if (position.breakEvenArmed) return;
    if (gain * 100 < this.config.breakEvenTriggerPct) return;

    const target = position.entryPrice * (1 + this.config.breakEvenOffsetPct / 100);
    if (target > position.stopPrice) position.stopPrice = target;
    position.breakEvenArmed = true;
  }

  private armTrailing(position: Position, gain: number, price: number): void {
    const allTakeProfitsDone = position.takeProfits.every((level) => level.executed);
    const distancePct = allTakeProfitsDone
      ? this.config.finalTrailingDistancePct
      : this.config.trailingDistancePct;

    if (!position.trailingArmed) {
      if (gain * 100 < this.config.trailingActivationPct && !allTakeProfitsDone) return;
      position.trailingArmed = true;
      position.trailingPeakPrice = price;
    }

    if (price > position.trailingPeakPrice) position.trailingPeakPrice = price;
    const trailStop = position.trailingPeakPrice * (1 - distancePct / 100);
    // Ratchet only.
    if (trailStop > position.stopPrice) position.stopPrice = trailStop;
  }

  /**
   * Volatility-aware stop tightening. As a position matures without moving,
   * the case for giving it room weakens; the stop converges toward break-even.
   */
  private tightenDynamicStop(position: Position, market: MarketState, gain: number): void {
    if (!this.config.useDynamicStop || position.trailingArmed) return;

    const elapsed = market.now - position.openedAt;
    const maturity = clamp(safeDiv(elapsed, this.config.timeStopMs), 0, 1);
    if (maturity < 0.25 || gain < 0) return;

    const volatilityStop = market.price * (1 - clamp(market.volatility * this.config.atrStopMultiplier, 0.05, 0.5));
    const maturityStop = position.entryPrice * (1 - (this.config.stopLossPct / 100) * (1 - maturity));
    const candidate = Math.max(volatilityStop, maturityStop);
    if (candidate > position.stopPrice && candidate < market.price) position.stopPrice = candidate;
  }

  /**
   * Time stop. Two triggers: the hard deadline, and a half-time check that
   * closes positions which have gone nowhere — capital sitting in a dead token
   * is capital not available for the next signal.
   */
  private timeStop(position: Position, gain: number, now: number): ExitSignal | undefined {
    const elapsed = now - position.openedAt;

    if (now >= position.maxHoldUntil) {
      return {
        positionId: position.id,
        reason: 'time_stop',
        fraction: 1,
        urgency: 'standard',
        note: `held ${Math.round(elapsed / 60_000)}m, reached the maximum hold (${(gain * 100).toFixed(1)}%)`,
        at: now,
      };
    }

    const halfTime = position.openedAt + (position.maxHoldUntil - position.openedAt) / 2;
    if (now >= halfTime && Math.abs(gain * 100) < this.config.timeStopMinProgressPct) {
      return {
        positionId: position.id,
        reason: 'time_stop',
        fraction: 1,
        urgency: 'economy',
        note: `flat at ${(gain * 100).toFixed(1)}% past half of the hold window — recycling capital`,
        at: now,
      };
    }

    return undefined;
  }
}
