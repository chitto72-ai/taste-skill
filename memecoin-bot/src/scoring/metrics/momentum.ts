import {
  clamp01,
  ema,
  inverseScale,
  lerp,
  linearSlope,
  realizedVolatility,
  safeDiv,
} from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Momentum metrics decide *when*, not *whether*.
 *
 * The shape most of these use is deliberately non-monotonic: a token up 15% in
 * five minutes is interesting, one up 300% in five minutes is a chase, and
 * both score above one that is flat. Rewarding unbounded momentum is how a bot
 * ends up buying every top.
 */
export const MOMENTUM_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'mom.price_change_5m',
    group: 'momentum',
    label: '5m price change',
    weight: 1.8,
    compute: ({ profile }) => {
      const raw = profile.market.priceChange5m;
      const normalized =
        raw <= 0 ? clamp01(lerp(raw, -0.3, 0, 0, 0.4)) : raw <= 0.4 ? lerp(raw, 0, 0.4, 0.4, 1) : clamp01(lerp(raw, 0.4, 1, 2, 0.3));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'mom.price_change_1h',
    group: 'momentum',
    label: '1h price change',
    weight: 1.3,
    compute: ({ profile }) => {
      const raw = profile.market.priceChange1h;
      const normalized =
        raw <= 0 ? clamp01(lerp(raw, -0.5, 0, 0, 0.4)) : raw <= 1 ? lerp(raw, 0, 0.4, 1, 1) : clamp01(lerp(raw, 1, 1, 5, 0.35));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'mom.price_change_24h',
    group: 'momentum',
    label: '24h price change',
    weight: 0.6,
    compute: ({ profile }) => {
      const raw = profile.market.priceChange24h;
      return { raw, normalized: clamp01(lerp(raw, -0.6, 0.1, 2, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.volume_growth_5m',
    group: 'momentum',
    label: '5m volume growth',
    weight: 2.0,
    compute: ({ profile }) => {
      // 1h volume is a 12x window; the ratio tells us if the last 5 minutes
      // are running hot relative to the hour.
      const expected = profile.market.volume1hUsd / 12;
      const raw = safeDiv(profile.market.volume5mUsd, expected, 1) - 1;
      return { raw, normalized: clamp01(lerp(raw, -0.5, 0.1, 1.5, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.volume_5m_usd',
    group: 'momentum',
    label: '5m volume (USD)',
    weight: 1.2,
    compute: ({ profile }) => {
      const raw = profile.market.volume5mUsd;
      return { raw, normalized: clamp01(lerp(Math.log10(Math.max(raw, 1)), 3, 0, 5.5, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.buy_sell_ratio_5m',
    group: 'momentum',
    label: '5m buy/sell ratio',
    weight: 1.7,
    compute: ({ profile }) => {
      const { buys, sells } = profile.market.txns5m;
      const raw = safeDiv(buys, Math.max(sells, 1), 1);
      // Above ~4:1 usually means wash trading rather than demand.
      const normalized = raw <= 4 ? clamp01(lerp(raw, 0.6, 0, 2.5, 1)) : clamp01(lerp(raw, 4, 1, 10, 0.4));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'mom.buy_sell_ratio_1h',
    group: 'momentum',
    label: '1h buy/sell ratio',
    weight: 1.0,
    compute: ({ profile }) => {
      const { buys, sells } = profile.market.txns1h;
      const raw = safeDiv(buys, Math.max(sells, 1), 1);
      return { raw, normalized: clamp01(lerp(raw, 0.7, 0, 2, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.txn_count_5m',
    group: 'momentum',
    label: '5m transaction count',
    weight: 0.9,
    compute: ({ profile }) => {
      const raw = profile.market.txns5m.buys + profile.market.txns5m.sells;
      return { raw, normalized: clamp01(lerp(raw, 5, 0, 150, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.price_slope',
    group: 'momentum',
    label: 'Price trend slope',
    weight: 1.5,
    requires: ['market.price_history'],
    compute: ({ profile }) => {
      const prices = profile.priceHistory.map((p) => p.priceUsd);
      if (prices.length < 4) return { raw: 0, normalized: 0.5 };
      const raw = safeDiv(linearSlope(prices), prices[prices.length - 1]);
      return { raw, normalized: clamp01(lerp(raw, -0.02, 0, 0.03, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.ema_alignment',
    group: 'momentum',
    label: 'Fast/slow EMA alignment',
    weight: 1.1,
    requires: ['market.price_history'],
    compute: ({ profile }) => {
      const prices = profile.priceHistory.map((p) => p.priceUsd);
      if (prices.length < 8) return { raw: 0, normalized: 0.5 };
      const fast = ema(prices, 5);
      const slow = ema(prices, 20);
      const raw = safeDiv(fast - slow, slow);
      return { raw, normalized: clamp01(lerp(raw, -0.05, 0, 0.08, 1)) };
    },
  }),
  defineMetric({
    id: 'mom.volatility',
    group: 'momentum',
    label: 'Realized volatility (inverse)',
    weight: 1.0,
    requires: ['market.price_history'],
    compute: ({ profile }) => {
      const prices = profile.priceHistory.map((p) => p.priceUsd);
      if (prices.length < 5) return { raw: 0, normalized: 0.5 };
      const raw = realizedVolatility(prices);
      // Some volatility is the point; extreme volatility makes stops useless.
      return { raw, normalized: inverseScale(raw, 0.03, 0.35) };
    },
  }),
];
