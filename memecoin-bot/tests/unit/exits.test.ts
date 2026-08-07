import { describe, expect, it } from 'vitest';
import { StopLossEngine, type MarketState } from '../../src/strategies/exits/stop-loss.js';
import { TakeProfitEngine } from '../../src/strategies/exits/take-profit.js';
import { ExitManager } from '../../src/strategies/exits/exit-manager.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { openPosition, TEST_NOW } from '../helpers/factories.js';

const config = createDefaultConfig().exit;

function market(overrides: Partial<MarketState> = {}): MarketState {
  return {
    price: 0.001,
    liquidityUsd: 120_000,
    volatility: 0.05,
    sellTaxPct: 0,
    entryLiquidityUsd: 120_000,
    now: TEST_NOW + 60_000,
    ...overrides,
  };
}

describe('StopLossEngine', () => {
  const stops = new StopLossEngine(config);

  it('places the initial stop below entry by the requested distance', () => {
    expect(stops.initialStop(100, 0.25)).toBeCloseTo(75, 6);
  });

  it('does nothing while price sits between the stop and the triggers', () => {
    const position = openPosition();
    expect(stops.evaluate(position, market({ price: 0.00105 }))).toBeUndefined();
  });

  it('fires a stop loss when price trades through the stop', () => {
    const position = openPosition();
    const signal = stops.evaluate(position, market({ price: position.stopPrice * 0.99 }));
    expect(signal?.reason).toBe('stop_loss');
    expect(signal?.fraction).toBe(1);
  });

  it('arms break-even once the trigger gain is reached', () => {
    const position = openPosition();
    stops.evaluate(position, market({ price: 0.00125 }));
    expect(position.breakEvenArmed).toBe(true);
    expect(position.stopPrice).toBeGreaterThan(position.entryPrice);
  });

  it('arms the trailing stop and ratchets it upward only', () => {
    const position = openPosition();
    stops.evaluate(position, market({ price: 0.0015 }));
    expect(position.trailingArmed).toBe(true);
    const armedStop = position.stopPrice;

    stops.evaluate(position, market({ price: 0.002 }));
    expect(position.stopPrice).toBeGreaterThan(armedStop);
    const raisedStop = position.stopPrice;

    // A pullback must never widen the stop.
    stops.evaluate(position, market({ price: 0.0017 }));
    expect(position.stopPrice).toBe(raisedStop);
  });

  it('reports a trailing exit rather than a plain stop once trailing is armed', () => {
    const position = openPosition();
    stops.evaluate(position, market({ price: 0.002 }));
    const signal = stops.evaluate(position, market({ price: position.stopPrice * 0.99 }));
    expect(signal?.reason).toBe('trailing_stop');
  });

  it('triggers an emergency exit when liquidity drains', () => {
    const position = openPosition();
    const signal = stops.evaluate(
      position,
      market({ price: 0.00099, liquidityUsd: 40_000, entryLiquidityUsd: 120_000 }),
    );
    expect(signal?.reason).toBe('emergency_exit');
    expect(signal?.urgency).toBe('turbo');
    expect(signal?.note).toContain('liquidity down');
  });

  it('triggers an emergency exit when a sell tax appears after entry', () => {
    const position = openPosition();
    const signal = stops.evaluate(position, market({ price: 0.00101, sellTaxPct: 30 }));
    expect(signal?.reason).toBe('emergency_exit');
    expect(signal?.note).toContain('sell tax');
  });

  it('closes the position at the hard time limit', () => {
    const position = openPosition();
    const signal = stops.evaluate(position, market({ price: 0.00101, now: position.maxHoldUntil + 1 }));
    expect(signal?.reason).toBe('time_stop');
  });

  it('recycles capital from a flat position at half-time', () => {
    const position = openPosition();
    const halfway = position.openedAt + (position.maxHoldUntil - position.openedAt) / 2 + 1;
    const signal = stops.evaluate(position, market({ price: 0.001005, now: halfway }));
    expect(signal?.reason).toBe('time_stop');
    expect(signal?.urgency).toBe('economy');
  });
});

describe('TakeProfitEngine', () => {
  const takeProfits = new TakeProfitEngine(config);

  it('builds the configured four-step ladder', () => {
    const levels = takeProfits.buildLevels();
    expect(levels).toHaveLength(4);
    expect(levels.map((l) => l.sellFraction)).toEqual([0.25, 0.25, 0.25, 0.25]);
    expect(levels.every((l) => !l.executed)).toBe(true);
  });

  it('sells a quarter of the original position at the first level', () => {
    const position = openPosition();
    const signal = takeProfits.evaluate(position, position.entryPrice * 1.6, TEST_NOW);
    expect(signal?.reason).toBe('take_profit');
    expect(signal?.fraction).toBeCloseTo(0.25, 6);
  });

  it('collapses multiple levels crossed in one move into a single order', () => {
    const position = openPosition();
    const signal = takeProfits.evaluate(position, position.entryPrice * 3.2, TEST_NOW);
    // tp1 + tp2 + tp3 = 75% of the original position.
    expect(signal?.fraction).toBeCloseTo(0.75, 6);
    expect(signal?.note).toContain('tp1+tp2+tp3');
  });

  it('does not re-fire a level once executed', () => {
    const position = openPosition();
    takeProfits.markExecuted(position, position.entryPrice * 1.6, TEST_NOW);
    position.qty = position.initialQty * 0.75;
    expect(takeProfits.evaluate(position, position.entryPrice * 1.6, TEST_NOW)).toBeUndefined();
  });

  it('reports the ladder as complete after the final level', () => {
    const position = openPosition();
    takeProfits.markExecuted(position, position.entryPrice * 6, TEST_NOW);
    expect(takeProfits.isLadderComplete(position)).toBe(true);
  });

  it('never emits a fraction above one', () => {
    const position = openPosition();
    position.qty = position.initialQty * 0.1;
    const signal = takeProfits.evaluate(position, position.entryPrice * 6, TEST_NOW);
    expect(signal?.fraction).toBeLessThanOrEqual(1);
  });
});

describe('ExitManager precedence', () => {
  const exits = new ExitManager({ config, logger: createNullLogger() });

  it('prefers a protective exit over a take-profit on the same tick', () => {
    const position = openPosition();
    // Run up so the trailing stop arms, then spike through a TP level while
    // simultaneously collapsing back through the trail.
    exits.evaluate(position, market({ price: 0.003 }));
    const signal = exits.evaluate(position, market({ price: position.stopPrice * 0.98 }));
    expect(signal?.reason).toBe('trailing_stop');
    expect(signal?.fraction).toBe(1);
  });

  it('hands the runner to the final trailing stop once the ladder completes', () => {
    const position = openPosition();
    exits.confirmTakeProfit(position, position.entryPrice * 6, TEST_NOW);
    expect(position.trailingArmed).toBe(true);
    expect(position.stopPrice).toBeCloseTo(
      position.entryPrice * 6 * (1 - config.finalTrailingDistancePct / 100),
      6,
    );
  });

  it('produces a forced exit for a risk halt', () => {
    const position = openPosition();
    const signal = exits.forceExit(position, 'risk_halt', 'halted', TEST_NOW);
    expect(signal.fraction).toBe(1);
    expect(signal.urgency).toBe('turbo');
  });
});
