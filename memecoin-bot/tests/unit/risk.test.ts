import { beforeEach, describe, expect, it } from 'vitest';
import { PositionSizer } from '../../src/risk/position-sizer.js';
import { RiskManager } from '../../src/risk/risk-manager.js';
import { DrawdownTracker } from '../../src/risk/drawdown.js';
import { EventBus } from '../../src/core/event-bus.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import type { EntrySignal } from '../../src/core/domain/signal.js';
import type { TradeRecord } from '../../src/core/domain/trading.js';
import { healthyProfile, openPosition, TEST_NOW } from '../helpers/factories.js';

const config = createDefaultConfig();

function signal(overrides: Partial<EntrySignal> = {}): EntrySignal {
  const profile = healthyProfile();
  return {
    id: 'sig_1',
    strategy: 'sniper',
    token: profile.ref,
    profile,
    score: {
      token: profile.ref,
      total: 88,
      sub: { risk: 90, momentum: 75, liquidity: 80, community: 60, whale: 70, developer: 80 },
      probabilities: { rug: 0.05, pump: 0.55, dump: 0.2 },
      metrics: [],
      vetoes: [],
      confidence: 1,
      at: TEST_NOW,
    },
    conviction: 0.8,
    expectedWinRate: 0.35,
    expectedPayoffRatio: 3,
    suggestedStopPct: 0.25,
    maxHoldMs: 4 * 60 * 60_000,
    reasons: [],
    at: TEST_NOW,
    ...overrides,
  };
}

function trade(pnl: number, closeReason: TradeRecord['closeReason'] = 'stop_loss'): TradeRecord {
  return {
    id: 'trd',
    positionId: 'pos_test',
    chain: 'solana',
    tokenAddress: 'token',
    symbol: 'TEST',
    strategy: 'sniper',
    entryScore: 88,
    entryPrice: 0.001,
    exitPrice: 0.0008,
    qty: 1_000,
    quoteIn: 1_000,
    quoteOut: 1_000 + pnl,
    pnl,
    pnlPct: pnl / 1_000,
    fees: 0,
    gas: 0,
    holdMs: 60_000,
    maxFavorableExcursion: 0.1,
    maxAdverseExcursion: -0.2,
    closeReason,
    openedAt: TEST_NOW,
    closedAt: TEST_NOW + 60_000,
  };
}

describe('PositionSizer', () => {
  const sizer = new PositionSizer(config.risk, config.entry);

  it('computes the Kelly fraction from win rate and payoff', () => {
    // p=0.4, b=3 -> (0.4*3 - 0.6)/3 = 0.2
    expect(sizer.kelly(0.4, 3)).toBeCloseTo(0.2, 6);
  });

  it('returns zero size when the edge is negative', () => {
    const result = sizer.size({
      equity: 10_000,
      availableCapital: 10_000,
      winProbability: 0.1,
      payoffRatio: 1.2,
      stopPct: 0.25,
      liquidityUsd: 500_000,
      conviction: 0.9,
      openPositions: 0,
    });
    expect(result.sizeUsd).toBe(0);
    expect(result.cappedBy).toBe('negative_edge');
  });

  it('never risks more than the configured percentage of equity', () => {
    // A wildly optimistic edge must still respect the fixed-risk ceiling.
    const equity = 10_000;
    const stopPct = 0.25;
    const result = sizer.size({
      equity,
      availableCapital: equity,
      winProbability: 0.9,
      payoffRatio: 8,
      stopPct,
      liquidityUsd: 10_000_000,
      conviction: 1,
      openPositions: 0,
    });
    const riskPct = ((result.sizeUsd * stopPct) / equity) * 100;
    expect(riskPct).toBeLessThanOrEqual(config.risk.riskPerTradePct + 1e-9);
    expect(result.cappedBy).toBe('risk_per_trade');
  });

  it('caps size at a fraction of pool liquidity', () => {
    const result = sizer.size({
      equity: 1_000_000,
      availableCapital: 1_000_000,
      winProbability: 0.5,
      payoffRatio: 4,
      stopPct: 0.25,
      liquidityUsd: 50_000,
      conviction: 1,
      openPositions: 0,
    });
    expect(result.cappedBy).toBe('pool_liquidity');
    expect(result.sizeUsd).toBeLessThanOrEqual(50_000 * config.entry.maxPoolImpactPct);
  });

  it('sizes a lower-conviction signal below a higher-conviction one', () => {
    const base = {
      equity: 10_000,
      availableCapital: 10_000,
      winProbability: 0.35,
      payoffRatio: 3,
      stopPct: 0.4,
      liquidityUsd: 5_000_000,
      openPositions: 0,
    };
    const high = sizer.size({ ...base, conviction: 1 });
    const low = sizer.size({ ...base, conviction: 0.3 });
    expect(low.sizeUsd).toBeLessThan(high.sizeUsd);
  });

  it('rejects sizes below the configured minimum', () => {
    const result = sizer.size({
      equity: 100,
      availableCapital: 5,
      winProbability: 0.4,
      payoffRatio: 3,
      stopPct: 0.25,
      liquidityUsd: 100_000,
      conviction: 0.5,
      openPositions: 0,
    });
    expect(result.sizeUsd).toBe(0);
    expect(result.cappedBy).toBe('below_minimum');
  });
});

describe('DrawdownTracker', () => {
  it('tracks peak, drawdown and daily drawdown independently', () => {
    const tracker = new DrawdownTracker(10_000);
    tracker.update(12_000);
    const snapshot = tracker.update(10_800);
    expect(snapshot.peak).toBe(12_000);
    expect(snapshot.drawdownPct).toBeCloseTo(10, 5);
    expect(snapshot.dailyDrawdownPct).toBeCloseTo(-8, 5);
  });
});

describe('RiskManager', () => {
  let events: EventBus;
  let risk: RiskManager;

  beforeEach(() => {
    events = new EventBus();
    risk = new RiskManager({
      config: config.risk,
      entry: config.entry,
      events,
      logger: createNullLogger(),
    });
  });

  it('allows an entry inside every limit', () => {
    expect(risk.canOpen(signal(), 500).allowed).toBe(true);
  });

  it('blocks entries once the concurrent position cap is reached', () => {
    for (let i = 0; i < config.risk.maxConcurrentPositions; i++) {
      risk.onPositionOpened(openPosition({ id: `pos_${i}` }));
    }
    const decision = risk.canOpen(signal(), 500);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('position limit');
  });

  it('halts after the configured number of consecutive stop-outs', () => {
    const halts: string[] = [];
    events.on('risk.halted', ({ reason }) => {
      halts.push(reason);
    });

    for (let i = 0; i < config.risk.maxConsecutiveStops; i++) {
      const position = openPosition({ id: `pos_${i}` });
      risk.onPositionOpened(position);
      risk.onPositionClosed(position, trade(-50));
    }

    expect(risk.state().halted).toBe(true);
    expect(halts[0]).toContain('consecutive stop-outs');
    expect(risk.canOpen(signal(), 500).allowed).toBe(false);
  });

  it('resets the stop streak on a winning trade', () => {
    for (let i = 0; i < config.risk.maxConsecutiveStops - 1; i++) {
      const position = openPosition({ id: `pos_${i}` });
      risk.onPositionOpened(position);
      risk.onPositionClosed(position, trade(-50));
    }
    const winner = openPosition({ id: 'pos_win' });
    risk.onPositionOpened(winner);
    risk.onPositionClosed(winner, trade(120, 'take_profit'));

    expect(risk.state().consecutiveStops).toBe(0);
    expect(risk.state().halted).toBe(false);
  });

  it('halts when the daily drawdown limit is breached', () => {
    // 6% of 10k on a 5% limit.
    const position = openPosition({ id: 'pos_dd' });
    risk.onPositionOpened(position);
    risk.onPositionClosed(position, trade(-600, 'manual'));

    expect(risk.canOpen(signal(), 100).allowed).toBe(false);
    expect(risk.state().halted).toBe(true);
    expect(risk.state().haltReason).toContain('drawdown');
  });

  it('blocks entries that would breach per-chain exposure', () => {
    const limit = config.risk.baseCapital * config.risk.maxExposurePerChainPct;
    risk.onPositionOpened(openPosition({ id: 'pos_a', costBasis: limit }));
    const decision = risk.canOpen(signal(), 100);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain('chain exposure');
  });

  it('resumes only after the cooldown, unless forced', () => {
    risk.halt('test halt');
    expect(risk.resume()).toBe(false);
    expect(risk.resume(true)).toBe(true);
    expect(risk.state().halted).toBe(false);
  });

  it('emits a halt event exactly once per halt', () => {
    let count = 0;
    events.on('risk.halted', () => {
      count++;
    });
    risk.halt('first');
    risk.halt('second');
    expect(count).toBe(1);
  });
});
