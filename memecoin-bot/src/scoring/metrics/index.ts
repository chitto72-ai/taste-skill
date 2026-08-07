import type { MetricGroup } from '../../core/domain/scoring.js';
import type { MetricDefinition } from '../metric-definition.js';
import { COMMUNITY_METRICS } from './community.js';
import { DEVELOPER_METRICS } from './developer.js';
import { HOLDER_METRICS } from './holders.js';
import { LIQUIDITY_METRICS } from './liquidity.js';
import { MOMENTUM_METRICS } from './momentum.js';
import { SECURITY_METRICS } from './security.js';
import { WHALE_METRICS } from './whales.js';

/** The full metric battery — 62 measurements across seven groups. */
export const ALL_METRICS: readonly MetricDefinition[] = [
  ...LIQUIDITY_METRICS,
  ...MOMENTUM_METRICS,
  ...HOLDER_METRICS,
  ...WHALE_METRICS,
  ...COMMUNITY_METRICS,
  ...DEVELOPER_METRICS,
  ...SECURITY_METRICS,
];

export const METRICS_BY_GROUP: Readonly<Record<MetricGroup, readonly MetricDefinition[]>> = {
  liquidity: LIQUIDITY_METRICS,
  momentum: MOMENTUM_METRICS,
  holders: HOLDER_METRICS,
  whales: WHALE_METRICS,
  community: COMMUNITY_METRICS,
  developer: DEVELOPER_METRICS,
  security: SECURITY_METRICS,
};

export const METRIC_COUNT = ALL_METRICS.length;

export function metricIds(): string[] {
  return ALL_METRICS.map((m) => m.id);
}

/** Fails fast at startup if two metrics ever collide on an id. */
export function assertUniqueMetricIds(): void {
  const seen = new Set<string>();
  for (const metric of ALL_METRICS) {
    if (seen.has(metric.id)) throw new Error(`Duplicate metric id: ${metric.id}`);
    seen.add(metric.id);
  }
}

export {
  LIQUIDITY_METRICS,
  MOMENTUM_METRICS,
  HOLDER_METRICS,
  WHALE_METRICS,
  COMMUNITY_METRICS,
  DEVELOPER_METRICS,
  SECURITY_METRICS,
};
