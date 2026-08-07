import { describe, expect, it } from 'vitest';
import { TokenScorer } from '../../src/scoring/scorer.js';
import { ALL_METRICS, METRIC_COUNT, assertUniqueMetricIds } from '../../src/scoring/metrics/index.js';
import { estimateProbabilities } from '../../src/scoring/probabilities.js';
import { createDefaultConfig } from '../../src/config/default.config.js';
import { healthyProfile, TEST_NOW } from '../helpers/factories.js';

const config = createDefaultConfig().scoring;
const scorer = new TokenScorer({ config });

describe('metric registry', () => {
  it('exposes more than fifty metrics across seven groups', () => {
    expect(METRIC_COUNT).toBeGreaterThan(50);
    const groups = new Set(ALL_METRICS.map((m) => m.group));
    expect(groups.size).toBe(7);
  });

  it('has no duplicate metric ids', () => {
    expect(() => assertUniqueMetricIds()).not.toThrow();
  });

  it('produces normalized values inside 0..1 for a healthy profile', () => {
    const score = scorer.score(healthyProfile(), [], TEST_NOW);
    for (const metric of score.metrics) {
      expect(metric.normalized).toBeGreaterThanOrEqual(0);
      expect(metric.normalized).toBeLessThanOrEqual(1);
    }
  });
});

describe('TokenScorer', () => {
  it('scores a healthy token above the default threshold', () => {
    const score = scorer.score(healthyProfile(), [], TEST_NOW);
    expect(score.vetoes).toEqual([]);
    expect(score.total).toBeGreaterThanOrEqual(config.minScore);
    expect(score.confidence).toBeGreaterThan(0.95);
  });

  it('vetoes a honeypot outright regardless of every other dimension', () => {
    const profile = healthyProfile({ security: { isHoneypot: true } });
    const score = scorer.score(profile, [], TEST_NOW);
    expect(score.total).toBe(0);
    expect(score.vetoes.join(' ')).toContain('honeypot');
  });

  it('vetoes unlocked liquidity', () => {
    const profile = healthyProfile({
      pool: { lpLockedPct: 0 },
      security: { lpLocked: false, lpBurned: false },
    });
    expect(scorer.score(profile, [], TEST_NOW).vetoes.join(' ')).toContain('locked');
  });

  it('vetoes extreme holder concentration', () => {
    const profile = healthyProfile({ holders: { top10Pct: 0.75 } });
    expect(scorer.score(profile, [], TEST_NOW).vetoes.join(' ')).toContain('top-10');
  });

  it('penalises missing data through confidence rather than pretending', () => {
    const full = scorer.score(healthyProfile(), [], TEST_NOW);
    const partial = scorer.score(
      healthyProfile(),
      ['holders.top10Pct', 'security.mintAuthorityRevoked', 'smartMoney.smartWalletsBuying5m'],
      TEST_NOW,
    );
    expect(partial.confidence).toBeLessThan(full.confidence);
    expect(partial.total).toBeLessThan(full.total);
    expect(partial.metrics.filter((m) => m.imputed).length).toBeGreaterThan(0);
  });

  it('vetoes when confidence falls below the configured minimum', () => {
    const missing = ALL_METRICS.flatMap((m) => m.requires ?? []);
    const score = scorer.score(healthyProfile(), missing, TEST_NOW);
    expect(score.vetoes.join(' ')).toContain('confidence');
    expect(score.total).toBe(0);
  });

  it('ranks a weak token below a strong one', () => {
    const strong = scorer.score(healthyProfile(), [], TEST_NOW);
    const weak = scorer.score(
      healthyProfile({
        market: { volume5mUsd: 16_000, priceChange5m: -0.02, txns5m: { buys: 20, sells: 30 } },
        holders: { growth5m: -0.01, top10Pct: 0.4 },
        smartMoney: { smartWalletsBuying5m: 0, whaleNetFlowUsd5m: -5_000, smartNetFlowUsd5m: -2_000 },
        social: { twitterFollowers: 50, telegramMembers: 20, sentiment: 10 },
      }),
      [],
      TEST_NOW,
    );
    expect(weak.total).toBeLessThan(strong.total);
  });

  it('explains contributions per metric', () => {
    const { contributions, probabilityTerms } = scorer.breakdown(healthyProfile());
    expect(Object.keys(contributions).length).toBe(METRIC_COUNT);
    expect(Object.keys(probabilityTerms)).toEqual(['rug', 'pump', 'dump']);
  });
});

describe('probability models', () => {
  const sub = { risk: 90, momentum: 70, liquidity: 80, community: 60, whale: 70, developer: 80 };

  it('stays strictly inside 0..1 and away from saturation for a healthy token', () => {
    const p = estimateProbabilities(healthyProfile(), sub);
    for (const value of [p.rug, p.pump, p.dump]) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1);
    }
    expect(p.rug).toBeLessThan(0.2);
  });

  it('raises rug probability when liquidity is unlocked and the dev has rugged before', () => {
    const clean = estimateProbabilities(healthyProfile(), sub).rug;
    const dirty = estimateProbabilities(
      healthyProfile({
        security: { lpLocked: false, lpBurned: false, mintAuthorityRevoked: false },
        developer: { tokensLaunched: 8, ruggedTokens: 6, walletAgeDays: 1 },
      }),
      sub,
    ).rug;
    expect(dirty).toBeGreaterThan(clean + 0.2);
  });

  it('raises dump probability when whales are selling into a concentrated float', () => {
    const calm = estimateProbabilities(healthyProfile(), sub).dump;
    const distributing = estimateProbabilities(
      healthyProfile({
        holders: { top10Pct: 0.45, snipersPct: 0.18 },
        smartMoney: { whaleNetFlowUsd5m: -40_000, smartNetFlowUsd5m: -25_000 },
        market: { txns5m: { buys: 20, sells: 80 } },
      }),
      sub,
    ).dump;
    expect(distributing).toBeGreaterThan(calm + 0.15);
  });
});
