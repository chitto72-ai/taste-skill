import { clamp01, inverseScale, lerp, linearSlope, logScale, safeDiv } from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Holder-distribution metrics.
 *
 * Distribution is the difference between a token that can rally and one whose
 * chart is a single wallet's exit liquidity. Concentration is scored
 * inversely and weighted heavily; growth is scored on rate, because a holder
 * count that has stopped rising is the first thing to break in a fading launch.
 */
export const HOLDER_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'hold.count',
    group: 'holders',
    label: 'Holder count',
    weight: 1.4,
    requires: ['holders.count'],
    compute: ({ profile }) => {
      const raw = profile.holders.count;
      return { raw, normalized: logScale(raw, 50, 5_000) };
    },
  }),
  defineMetric({
    id: 'hold.growth_5m',
    group: 'holders',
    label: '5m holder growth',
    weight: 1.9,
    requires: ['holders.growth5m'],
    compute: ({ profile }) => {
      const raw = profile.holders.growth5m;
      return { raw, normalized: clamp01(lerp(raw, -0.02, 0, 0.15, 1)) };
    },
  }),
  defineMetric({
    id: 'hold.growth_1h',
    group: 'holders',
    label: '1h holder growth',
    weight: 1.2,
    compute: ({ profile }) => {
      const raw = profile.holders.growth1h;
      return { raw, normalized: clamp01(lerp(raw, -0.05, 0, 0.5, 1)) };
    },
  }),
  defineMetric({
    id: 'hold.growth_trend',
    group: 'holders',
    label: 'Holder growth trend',
    weight: 1.0,
    requires: ['market.price_history'],
    compute: ({ profile }) => {
      const series = profile.priceHistory.map((p) => p.holders);
      if (series.length < 4) return { raw: 0, normalized: 0.5 };
      const raw = safeDiv(linearSlope(series), Math.max(1, series[series.length - 1]));
      return { raw, normalized: clamp01(lerp(raw, -0.01, 0, 0.02, 1)) };
    },
  }),
  defineMetric({
    id: 'hold.top10_pct',
    group: 'holders',
    label: 'Top-10 concentration',
    weight: 2.1,
    requires: ['holders.top10Pct'],
    compute: ({ profile }) => {
      const raw = profile.holders.top10Pct;
      return { raw, normalized: inverseScale(raw, 0.15, 0.45) };
    },
  }),
  defineMetric({
    id: 'hold.top25_pct',
    group: 'holders',
    label: 'Top-25 concentration',
    weight: 1.2,
    compute: ({ profile }) => {
      const raw = profile.holders.top25Pct;
      return { raw, normalized: inverseScale(raw, 0.3, 0.7) };
    },
  }),
  defineMetric({
    id: 'hold.hhi',
    group: 'holders',
    label: 'Distribution HHI',
    weight: 1.3,
    requires: ['holders.concentrationHhi'],
    compute: ({ profile }) => {
      const raw = profile.holders.concentrationHhi;
      return { raw, normalized: inverseScale(raw, 0.05, 0.3) };
    },
  }),
  defineMetric({
    id: 'hold.sniper_pct',
    group: 'holders',
    label: 'Sniper-held supply',
    weight: 1.5,
    requires: ['holders.snipersPct'],
    compute: ({ profile }) => {
      const raw = profile.holders.snipersPct;
      return { raw, normalized: inverseScale(raw, 0.02, 0.2) };
    },
  }),
  defineMetric({
    id: 'hold.insider_pct',
    group: 'holders',
    label: 'Insider-held supply',
    weight: 1.6,
    compute: ({ profile }) => {
      const raw = profile.holders.insidersPct;
      return { raw, normalized: inverseScale(raw, 0.01, 0.15) };
    },
  }),
  defineMetric({
    id: 'hold.bundled_pct',
    group: 'holders',
    label: 'Bundled supply',
    weight: 2.0,
    requires: ['holders.bundledPct'],
    compute: ({ profile }) => {
      const raw = profile.holders.bundledPct;
      // Any bundling is a negative; past 15% it is disqualifying elsewhere.
      return { raw, normalized: inverseScale(raw, 0.0, 0.15) };
    },
  }),
  defineMetric({
    id: 'hold.dev_holding_pct',
    group: 'holders',
    label: 'Developer-held supply',
    weight: 1.7,
    requires: ['holders.devHoldingPct'],
    compute: ({ profile }) => {
      const raw = profile.holders.devHoldingPct;
      return { raw, normalized: inverseScale(raw, 0.01, 0.12) };
    },
  }),
  defineMetric({
    id: 'hold.avg_position_usd',
    group: 'holders',
    label: 'Average holder position',
    weight: 0.7,
    compute: ({ profile }) => {
      const raw = safeDiv(profile.market.marketCapUsd, Math.max(1, profile.holders.count));
      // Very small average positions indicate airdrop farming, very large ones
      // indicate a handful of whales wearing the float.
      const normalized = clamp01(lerp(Math.log10(Math.max(raw, 1)), 0.7, 0.2, 3, 1)) * (raw > 50_000 ? 0.5 : 1);
      return { raw, normalized };
    },
  }),
];
