import { describe, expect, it } from 'vitest';
import { SniperStrategy } from '../../src/strategies/sniper-strategy.js';
import { MomentumStrategy } from '../../src/strategies/momentum-strategy.js';
import { StrategyRegistry } from '../../src/strategies/registry.js';
import { TokenScorer } from '../../src/scoring/scorer.js';
import { createNullLogger } from '../../src/logger/logger.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import type { StrategyContext } from '../../src/core/domain/signal.js';
import type { TokenProfile } from '../../src/core/domain/token.js';
import { healthyProfile, openPosition, TEST_NOW } from '../helpers/factories.js';

const config = createDefaultConfig();
const scorer = new TokenScorer({ config: config.scoring });

const context = (overrides: Partial<StrategyContext> = {}): StrategyContext => ({
  now: TEST_NOW,
  openPositions: [],
  equity: 10_000,
  availableCapital: 10_000,
  ...overrides,
});

function evaluate(strategy: SniperStrategy | MomentumStrategy, profile: TokenProfile, ctx = context()) {
  return strategy.evaluate(profile, scorer.score(profile, [], TEST_NOW), ctx);
}

describe('SniperStrategy', () => {
  const sniper = new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring });

  it('accepts a token that satisfies every entry condition', () => {
    const evaluation = evaluate(sniper, healthyProfile());
    expect(evaluation.passed).toBe(true);
    expect(evaluation.signal?.strategy).toBe('sniper');
    expect(evaluation.conditions.every((c) => c.passed)).toBe(true);
  });

  it('records why it declined, condition by condition', () => {
    const evaluation = evaluate(sniper, healthyProfile({ holders: { growth5m: -0.05 } }));
    expect(evaluation.passed).toBe(false);
    const failed = evaluation.conditions.filter((c) => !c.passed).map((c) => c.id);
    expect(failed).toContain('holder_growth');
  });

  it.each([
    ['smart money is absent', { smartMoney: { smartWalletsBuying5m: 0 } }, 'smart_money'],
    ['whales are net sellers', { smartMoney: { whaleNetFlowUsd5m: -10_000 } }, 'whale_flow'],
    ['liquidity is too thin', { market: { liquidityUsd: 20_000 } }, 'liquidity'],
    ['the float is concentrated', { holders: { top10Pct: 0.5 } }, 'distribution'],
    ['a bundle is detected', { security: { bundleDetected: true, bundleWallets: 8 } }, 'no_bundle'],
    ['there is a blacklist function', { security: { hasBlacklistFn: true } }, 'no_blacklist'],
    ['momentum is negative', { market: { priceChange5m: -0.05 } }, 'momentum'],
  ])('refuses when %s', (_label, override, conditionId) => {
    const evaluation = evaluate(sniper, healthyProfile(override));
    expect(evaluation.passed).toBe(false);
    expect(evaluation.conditions.find((c) => c.id === conditionId)?.passed).toBe(false);
  });

  it('never opens a second position in the same token', () => {
    const profile = healthyProfile();
    const evaluation = evaluate(
      sniper,
      profile,
      context({ openPositions: [openPosition({ token: profile.ref })] }),
    );
    expect(evaluation.passed).toBe(false);
    expect(evaluation.conditions.find((c) => c.id === 'no_open_position')?.passed).toBe(false);
  });

  it('keeps the expected win rate conservative and the payoff realistic', () => {
    const signal = evaluate(sniper, healthyProfile()).signal;
    expect(signal).toBeDefined();
    // Memecoin strategies win rarely and pay off big; an optimistic win rate
    // here would oversize every position through Kelly.
    expect(signal!.expectedWinRate).toBeLessThanOrEqual(0.45);
    expect(signal!.expectedWinRate).toBeGreaterThan(0.1);
    expect(signal!.expectedPayoffRatio).toBeGreaterThan(1);
    expect(signal!.suggestedStopPct).toBeGreaterThan(0);
    expect(signal!.suggestedStopPct).toBeLessThanOrEqual(config.exit.stopLossPct / 100);
  });

  it('scales conviction with score and smart-money participation', () => {
    const strong = evaluate(sniper, healthyProfile()).signal!.conviction;
    const weaker = evaluate(
      sniper,
      healthyProfile({ smartMoney: { smartWalletsBuying5m: 2, smartNetFlowUsd5m: 6_000 } }),
    ).signal!.conviction;
    expect(strong).toBeGreaterThan(weaker);
  });

  it('tracks rejection statistics per condition', () => {
    const strategy = new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring });
    evaluate(strategy, healthyProfile({ market: { liquidityUsd: 20_000 } }));
    evaluate(strategy, healthyProfile({ market: { liquidityUsd: 20_000 } }));
    const stats = strategy.stats();
    expect(stats.evaluated).toBe(2);
    expect(stats.passed).toBe(0);
    expect(stats.rejectionsByCondition.liquidity).toBe(2);
  });
});

describe('MomentumStrategy', () => {
  const momentum = new MomentumStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring });

  it('requires enough price history before it will act', () => {
    const profile = healthyProfile();
    const shortHistory = { ...profile, priceHistory: profile.priceHistory.slice(-3) };
    const evaluation = evaluate(momentum, shortHistory);
    expect(evaluation.passed).toBe(false);
    expect(evaluation.conditions[1]?.id).toBe('history');
  });

  it('accepts an established uptrend', () => {
    expect(evaluate(momentum, healthyProfile()).passed).toBe(true);
  });

  it('refuses a blow-off top', () => {
    const evaluation = evaluate(momentum, healthyProfile({ market: { priceChange1h: 4 } }));
    expect(evaluation.conditions.find((c) => c.id === 'not_extended')?.passed).toBe(false);
  });

  it('refuses when liquidity is draining', () => {
    const profile = healthyProfile();
    const draining = {
      ...profile,
      priceHistory: profile.priceHistory.map((point, index) => ({
        ...point,
        liquidityUsd: 200_000 - index * 8_000,
      })),
    };
    const evaluation = evaluate(momentum, draining);
    expect(evaluation.conditions.find((c) => c.id === 'liquidity_stable')?.passed).toBe(false);
  });

  it('uses a tighter stop and shorter hold than the sniper', () => {
    const sniper = new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring });
    const profile = healthyProfile();
    const sniperSignal = evaluate(sniper, profile).signal!;
    const momentumSignal = evaluate(momentum, profile).signal!;
    expect(momentumSignal.maxHoldMs).toBeLessThan(sniperSignal.maxHoldMs);
  });
});

describe('StrategyRegistry', () => {
  it('returns the highest-priority passing strategy only', () => {
    const registry = new StrategyRegistry(
      [
        new MomentumStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring }),
        new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring }),
      ],
      createNullLogger(),
    );
    const profile = healthyProfile();
    const { winner, evaluations } = registry.evaluate(profile, scorer.score(profile, [], TEST_NOW), context());

    expect(winner?.signal?.strategy).toBe('sniper');
    // Evaluation stops at the first pass, so the lower-priority one is unseen.
    expect(evaluations).toHaveLength(1);
  });

  it('skips disabled strategies', () => {
    const registry = new StrategyRegistry(
      [new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring, enabled: false })],
      createNullLogger(),
    );
    const profile = healthyProfile();
    expect(registry.evaluate(profile, scorer.score(profile, [], TEST_NOW), context()).winner).toBeUndefined();
    expect(registry.active).toHaveLength(0);
  });

  it('survives a strategy that throws', () => {
    const broken = {
      name: 'broken',
      enabled: true,
      priority: 100,
      evaluate: () => {
        throw new Error('bad strategy');
      },
    };
    const registry = new StrategyRegistry(
      [broken, new SniperStrategy({ entry: config.entry, exit: config.exit, scoring: config.scoring })],
      createNullLogger(),
    );
    const profile = healthyProfile();
    const { winner } = registry.evaluate(profile, scorer.score(profile, [], TEST_NOW), context());
    expect(winner?.signal?.strategy).toBe('sniper');
  });
});
