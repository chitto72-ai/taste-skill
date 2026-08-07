import { clamp01, inverseScale, lerp, linearSlope, logScale, safeDiv } from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Liquidity metrics answer one question: can we get out?
 *
 * Depth is scored on a log scale because the practical difference between
 * $20k and $200k of liquidity is enormous, while $2M vs $2.2M is noise. The
 * liquidity-to-market-cap ratio is the sharpest single number here — a token
 * with a $5M cap sitting on $20k of liquidity cannot be exited at anything
 * near its quoted price.
 */
export const LIQUIDITY_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'liq.depth_usd',
    group: 'liquidity',
    label: 'Pool liquidity (USD)',
    weight: 2.0,
    compute: ({ profile }) => {
      const raw = profile.market.liquidityUsd;
      return { raw, normalized: logScale(raw, 10_000, 1_000_000) };
    },
  }),
  defineMetric({
    id: 'liq.to_marketcap',
    group: 'liquidity',
    label: 'Liquidity / market cap',
    weight: 1.8,
    compute: ({ profile }) => {
      const raw = safeDiv(profile.market.liquidityUsd, profile.market.marketCapUsd);
      // Below 3% is a trap; above 25% is healthy for a young token.
      return { raw, normalized: clamp01(lerp(raw, 0.03, 0, 0.25, 1)) };
    },
  }),
  defineMetric({
    id: 'liq.lp_locked_pct',
    group: 'liquidity',
    label: 'LP locked or burned',
    weight: 2.2,
    compute: ({ profile }) => {
      const raw = profile.pool.lpLockedPct;
      return { raw, normalized: clamp01(raw) };
    },
  }),
  defineMetric({
    id: 'liq.lock_duration',
    group: 'liquidity',
    label: 'LP lock remaining',
    weight: 0.8,
    compute: ({ profile, now }) => {
      if (profile.security.lpBurned) return { raw: Number.POSITIVE_INFINITY, normalized: 1 };
      const expiry = profile.pool.lpLockExpiry;
      if (!expiry) return { raw: 0, normalized: profile.security.lpLocked ? 0.6 : 0 };
      const days = Math.max(0, (expiry - now) / 86_400_000);
      return { raw: days, normalized: clamp01(lerp(days, 0, 0, 90, 1)) };
    },
  }),
  defineMetric({
    id: 'liq.pool_age_minutes',
    group: 'liquidity',
    label: 'Pool age',
    weight: 0.9,
    compute: ({ profile, now }) => {
      const raw = (now - profile.pool.createdAt) / 60_000;
      // Too new means the bundle window is still open; too old means the move
      // has usually already happened.
      const normalized = raw < 3 ? 0.15 : raw < 15 ? lerp(raw, 3, 0.5, 15, 1) : clamp01(lerp(raw, 15, 1, 720, 0.35));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'liq.trend',
    group: 'liquidity',
    label: 'Liquidity trend',
    weight: 1.4,
    requires: ['market.liquidity_history'],
    compute: ({ profile }) => {
      const series = profile.priceHistory.map((p) => p.liquidityUsd);
      if (series.length < 3) return { raw: 0, normalized: 0.5 };
      const slope = linearSlope(series);
      const raw = safeDiv(slope, series[series.length - 1]);
      // Liquidity being pulled is the earliest visible sign of a rug.
      return { raw, normalized: clamp01(lerp(raw, -0.02, 0, 0.01, 1)) };
    },
  }),
  defineMetric({
    id: 'liq.volume_to_liquidity',
    group: 'liquidity',
    label: '5m volume / liquidity',
    weight: 1.2,
    compute: ({ profile }) => {
      const raw = safeDiv(profile.market.volume5mUsd, profile.market.liquidityUsd);
      // Healthy churn sits around 0.2-2x; beyond 5x the pool is being farmed.
      const normalized = raw <= 2 ? clamp01(lerp(raw, 0, 0.2, 2, 1)) : clamp01(lerp(raw, 2, 1, 8, 0.2));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'liq.entry_impact',
    group: 'liquidity',
    label: 'Estimated entry price impact',
    weight: 1.3,
    compute: ({ profile }) => {
      // Impact of a nominal $1k clip under the constant-product approximation.
      const share = safeDiv(1_000, profile.market.liquidityUsd, 1);
      const raw = clamp01(share * 2);
      return { raw, normalized: inverseScale(raw, 0.005, 0.05) };
    },
  }),
];
