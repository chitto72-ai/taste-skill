import { clamp01, inverseScale, lerp, safeDiv } from '../../core/utils/math.js';
import { defineMetric, type MetricDefinition } from '../metric-definition.js';

/**
 * Smart-money and whale flow.
 *
 * This group carries a high weight because it is the only part of the score
 * with genuine forward-looking information: wallets with a verified track
 * record buying in the last five minutes is a leading indicator, while price
 * and volume are coincident at best.
 */
export const WHALE_METRICS: readonly MetricDefinition[] = [
  defineMetric({
    id: 'whale.smart_holding',
    group: 'whales',
    label: 'Smart wallets holding',
    weight: 1.8,
    requires: ['smartMoney.smartWalletsHolding'],
    compute: ({ profile }) => {
      const raw = profile.smartMoney.smartWalletsHolding;
      return { raw, normalized: clamp01(lerp(raw, 0, 0, 8, 1)) };
    },
  }),
  defineMetric({
    id: 'whale.smart_buying_5m',
    group: 'whales',
    label: 'Smart wallets buying (5m)',
    weight: 2.2,
    requires: ['smartMoney.smartWalletsBuying5m'],
    compute: ({ profile }) => {
      const raw = profile.smartMoney.smartWalletsBuying5m;
      return { raw, normalized: clamp01(lerp(raw, 0, 0, 5, 1)) };
    },
  }),
  defineMetric({
    id: 'whale.smart_net_flow',
    group: 'whales',
    label: 'Smart money net flow (5m)',
    weight: 1.9,
    compute: ({ profile }) => {
      const raw = profile.smartMoney.smartNetFlowUsd5m;
      // Normalized against liquidity: $10k into a $30k pool is a very
      // different signal from $10k into a $2M pool.
      const relative = safeDiv(raw, Math.max(profile.market.liquidityUsd, 1));
      return { raw, normalized: clamp01(lerp(relative, -0.05, 0, 0.15, 1)) };
    },
  }),
  defineMetric({
    id: 'whale.whales_holding',
    group: 'whales',
    label: 'Whales holding',
    weight: 1.3,
    compute: ({ profile }) => {
      const raw = profile.smartMoney.whalesHolding;
      // A couple of whales is support; a crowd of them is overhead supply.
      const normalized = raw <= 5 ? clamp01(lerp(raw, 0, 0.2, 4, 1)) : clamp01(lerp(raw, 5, 1, 15, 0.4));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'whale.whale_net_flow',
    group: 'whales',
    label: 'Whale net flow (5m)',
    weight: 1.7,
    requires: ['smartMoney.whaleNetFlowUsd5m'],
    compute: ({ profile }) => {
      const raw = profile.smartMoney.whaleNetFlowUsd5m;
      const relative = safeDiv(raw, Math.max(profile.market.liquidityUsd, 1));
      return { raw, normalized: clamp01(lerp(relative, -0.1, 0, 0.2, 1)) };
    },
  }),
  defineMetric({
    id: 'whale.kol_mentions',
    group: 'whales',
    label: 'KOL mentions',
    weight: 0.9,
    requires: ['smartMoney.kolMentions'],
    compute: ({ profile }) => {
      const raw = profile.smartMoney.kolMentions;
      // Attention helps, but a token that is already everywhere is late.
      const normalized = raw <= 4 ? clamp01(lerp(raw, 0, 0.3, 3, 1)) : clamp01(lerp(raw, 4, 1, 15, 0.45));
      return { raw, normalized };
    },
  }),
  defineMetric({
    id: 'whale.insider_wallets',
    group: 'whales',
    label: 'Insider wallets (inverse)',
    weight: 1.5,
    compute: ({ profile }) => {
      const raw = profile.smartMoney.insiderWallets;
      return { raw, normalized: inverseScale(raw, 0, 6) };
    },
  }),
];
