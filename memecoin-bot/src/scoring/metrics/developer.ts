import { clamp01, inverseScale, lerp, safeDiv } from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Developer reputation.
 *
 * The rug ratio is the most predictive single field the bot has before a token
 * has any price history: a wallet that has rugged twice will rug again, and it
 * costs one lookup to know. An unknown developer is treated as mildly
 * negative rather than neutral — most launches are anonymous, but "we have no
 * information" should never score the same as "verified clean history".
 */
export const DEVELOPER_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'dev.wallet_age_days',
    group: 'developer',
    label: 'Developer wallet age',
    weight: 1.3,
    requires: ['developer.walletAgeDays'],
    compute: ({ profile }) => {
      const raw = profile.developer.walletAgeDays;
      // A wallet created hours before the launch is the classic pattern.
      return { raw, normalized: clamp01(lerp(raw, 1, 0, 180, 1)) };
    },
  }),
  defineMetric({
    id: 'dev.rug_ratio',
    group: 'developer',
    label: 'Prior rug ratio',
    weight: 2.5,
    requires: ['developer.ruggedTokens'],
    compute: ({ profile }) => {
      const { ruggedTokens, tokensLaunched } = profile.developer;
      if (tokensLaunched === 0) return { raw: 0, normalized: 0.5 };
      const raw = safeDiv(ruggedTokens, tokensLaunched);
      return { raw, normalized: inverseScale(raw, 0, 0.2) };
    },
  }),
  defineMetric({
    id: 'dev.success_ratio',
    group: 'developer',
    label: 'Prior successful launches',
    weight: 1.4,
    requires: ['developer.tokensLaunched'],
    compute: ({ profile }) => {
      const { successfulTokens, tokensLaunched } = profile.developer;
      if (tokensLaunched === 0) return { raw: 0, normalized: 0.5 };
      const raw = safeDiv(successfulTokens, tokensLaunched);
      return { raw, normalized: clamp01(raw) };
    },
  }),
  defineMetric({
    id: 'dev.launch_count',
    group: 'developer',
    label: 'Launch count',
    weight: 0.8,
    compute: ({ profile }) => {
      const raw = profile.developer.tokensLaunched;
      // One or two prior launches is experience; twenty is a factory.
      const normalized = raw <= 3 ? clamp01(lerp(raw, 0, 0.55, 2, 0.9)) : clamp01(lerp(raw, 3, 0.9, 15, 0.1));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'dev.balance_pct',
    group: 'developer',
    label: 'Developer balance',
    weight: 1.8,
    compute: ({ profile }) => {
      const raw = profile.developer.devBalancePct;
      return { raw, normalized: inverseScale(raw, 0.01, 0.1) };
    },
  }),
  defineMetric({
    id: 'dev.sold_pct',
    group: 'developer',
    label: 'Developer already sold',
    weight: 1.9,
    compute: ({ profile }) => {
      const raw = profile.developer.devSoldPct;
      // Any developer selling into their own launch is a hard negative.
      return { raw, normalized: inverseScale(raw, 0, 0.3) };
    },
  }),
  defineMetric({
    id: 'dev.identified',
    group: 'developer',
    label: 'Developer wallet identified',
    weight: 0.7,
    compute: ({ profile }) => {
      const raw = profile.developer.wallet ? 1 : 0;
      return { raw, normalized: raw ? 1 : 0.35 };
    },
  }),
];
