import type { ExitSignal } from '../../core/domain/signal.js';
import type { Position, TakeProfitLevel } from '../../core/domain/trading.js';
import { safeDiv } from '../../core/utils/math.js';
import type { ExitConfig } from '../../config/schema.js';

/**
 * Scaled exits.
 *
 * The ladder sells a quarter of the *original* position at each of four
 * multiples, so realized size does not shrink as the position does — selling
 * 25% of a 25%-depleted position at each level would leave a long tail of
 * dust. The remainder after the last level rides the final trailing stop,
 * which is where the distribution's right tail actually pays.
 *
 * Fractions are expressed against `initialQty` and converted to a fraction of
 * the *current* holding at execution time, because that is what the venue
 * order needs.
 */
export class TakeProfitEngine {
  constructor(private readonly config: ExitConfig) {}

  /** Builds the ladder for a new position from configuration. */
  buildLevels(): TakeProfitLevel[] {
    return this.config.takeProfitLevels.map((level, index) => ({
      id: `tp${index + 1}`,
      triggerMultiple: level.triggerMultiple,
      sellFraction: level.sellFraction,
      executed: false,
    }));
  }

  /**
   * Returns an exit signal for the highest level newly crossed. Only one level
   * fires per evaluation: a vertical candle through three levels should not
   * produce three simultaneous orders competing for the same liquidity.
   */
  evaluate(position: Position, price: number, now: number): ExitSignal | undefined {
    if (price <= 0 || position.entryPrice <= 0 || position.qty <= 0) return undefined;

    const multiple = price / position.entryPrice;
    const pending = position.takeProfits.filter((level) => !level.executed && multiple >= level.triggerMultiple);
    if (pending.length === 0) return undefined;

    // Everything crossed in one move is sold in one order; lower levels are
    // marked executed alongside the highest by `markExecuted`, since the
    // market has already passed them.
    const totalFraction = pending.reduce((acc, entry) => acc + entry.sellFraction, 0);
    const qtyToSell = Math.min(position.qty, position.initialQty * totalFraction);
    const fractionOfCurrent = safeDiv(qtyToSell, position.qty, 0);
    if (fractionOfCurrent <= 0) return undefined;

    const isFinal = position.takeProfits.every((entry) => entry.executed || pending.includes(entry));

    return {
      positionId: position.id,
      reason: 'take_profit',
      // Never emit a fraction above 1; the last level may round marginally over.
      fraction: Math.min(1, fractionOfCurrent),
      urgency: 'fast',
      note:
        `${pending.map((p) => p.id).join('+')} at ${multiple.toFixed(2)}x ` +
        `(selling ${(totalFraction * 100).toFixed(0)}% of the original position)` +
        (isFinal ? ' — remainder rides the final trailing stop' : ''),
      at: now,
    };
  }

  /** Marks every level at or below `price` as executed. */
  markExecuted(position: Position, price: number, now: number): TakeProfitLevel[] {
    const multiple = price / position.entryPrice;
    const executed: TakeProfitLevel[] = [];
    for (const level of position.takeProfits) {
      if (level.executed || multiple < level.triggerMultiple) continue;
      level.executed = true;
      level.executedAt = now;
      level.executedPrice = price;
      executed.push(level);
    }
    return executed;
  }

  /** True once every ladder level has filled — the runner phase. */
  isLadderComplete(position: Position): boolean {
    return position.takeProfits.every((level) => level.executed);
  }

  /** Fraction of the original position still held. */
  remainingFraction(position: Position): number {
    return safeDiv(position.qty, position.initialQty, 0);
  }
}
