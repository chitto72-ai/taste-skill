import type { MetricGroup, MetricValue, SubScores, TokenScore } from '../core/domain/scoring.js';
import type { TokenProfile } from '../core/domain/token.js';
import { clamp01, safeDiv } from '../core/utils/math.js';
import type { ScoringConfig } from '../config/schema.js';
import { ALL_METRICS, METRICS_BY_GROUP, assertUniqueMetricIds } from './metrics/index.js';
import { NEUTRAL_PRIOR, type MetricDefinition } from './metric-definition.js';
import { estimateProbabilities, explain } from './probabilities.js';

export interface ScorerOptions {
  readonly config: ScoringConfig;
  readonly metrics?: readonly MetricDefinition[];
}

const GROUPS: readonly MetricGroup[] = [
  'liquidity',
  'momentum',
  'holders',
  'whales',
  'community',
  'developer',
  'security',
];

/**
 * The composite scoring engine.
 *
 * Design decisions worth stating, because they are what stop this from being
 * an arbitrary number:
 *
 *  1. **Vetoes are separate from weights.** No amount of momentum should be
 *     able to outvote "this token cannot be sold". Vetoes zero the score
 *     outright rather than subtracting from it.
 *  2. **Missing data is not neutral.** Imputed metrics score at 0.45, below
 *     the midpoint, and drag `confidence` down. A token we know nothing about
 *     should not clear an 80 threshold on the strength of what we do know.
 *  3. **Groups are normalized independently**, so adding a metric to one group
 *     does not silently re-weight the others.
 */
export class TokenScorer {
  private readonly metrics: readonly MetricDefinition[];
  private readonly groupWeights: Record<MetricGroup, number>;

  constructor(private readonly options: ScorerOptions) {
    assertUniqueMetricIds();
    this.metrics = options.metrics ?? ALL_METRICS;
    this.groupWeights = { ...options.config.weights };
  }

  get metricCount(): number {
    return this.metrics.length;
  }

  /**
   * @param missingFields field paths the discovery pipeline could not resolve
   */
  score(profile: TokenProfile, missingFields: readonly string[] = [], now = Date.now()): TokenScore {
    const missing = new Set(missingFields);
    const values: MetricValue[] = [];

    for (const metric of this.metrics) {
      const imputed = (metric.requires ?? []).some((field) => missing.has(field) || missing.has(wildcardOf(field)));
      let normalized: number;
      let raw: number;
      if (imputed) {
        normalized = NEUTRAL_PRIOR;
        raw = Number.NaN;
      } else {
        try {
          const computed = metric.compute({ profile, now });
          raw = computed.raw;
          normalized = clamp01(computed.normalized);
        } catch {
          // A metric that throws is a bug, but it must not take down a scan.
          raw = Number.NaN;
          normalized = NEUTRAL_PRIOR;
        }
      }
      values.push({
        id: metric.id,
        group: metric.group,
        raw: Number.isFinite(raw) ? raw : 0,
        normalized,
        weight: metric.weight,
        imputed,
      });
    }

    const groups = this.groupScores(values);
    const sub = this.subScores(groups);
    const probabilities = estimateProbabilities(profile, sub);
    const confidence = this.confidence(values);
    const vetoes = this.vetoes(profile, probabilities, confidence);

    const weighted = this.composite(groups);
    // Confidence tapers the score rather than gating it: a strong but poorly
    // observed token lands just under the threshold instead of at zero.
    const confidenceAdjusted = weighted * (0.75 + 0.25 * confidence);
    const total = vetoes.length > 0 ? 0 : Math.round(clamp01(confidenceAdjusted / 100) * 100);

    return {
      token: profile.ref,
      total,
      sub,
      probabilities,
      metrics: values,
      vetoes,
      confidence,
      at: now,
    };
  }

  /** Full breakdown for the dashboard's token drill-down. */
  breakdown(profile: TokenProfile, missingFields: readonly string[] = []): {
    score: TokenScore;
    contributions: Record<string, number>;
    probabilityTerms: Record<string, Record<string, number>>;
  } {
    const score = this.score(profile, missingFields);
    const contributions: Record<string, number> = {};
    for (const group of GROUPS) {
      const groupMetrics = score.metrics.filter((m) => m.group === group);
      const totalWeight = groupMetrics.reduce((acc, m) => acc + m.weight, 0);
      for (const metric of groupMetrics) {
        const share = safeDiv(metric.weight, totalWeight);
        contributions[metric.id] = Number(
          (metric.normalized * share * (this.groupWeights[group] ?? 1) * 100).toFixed(3),
        );
      }
    }
    return { score, contributions, probabilityTerms: explain(profile, score.sub) };
  }

  /** Weighted mean of each group's metrics, on a 0..100 scale. */
  private groupScores(values: readonly MetricValue[]): Record<MetricGroup, number> {
    const out = {} as Record<MetricGroup, number>;
    for (const group of GROUPS) {
      const groupValues = values.filter((v) => v.group === group);
      const totalWeight = groupValues.reduce((acc, v) => acc + v.weight, 0);
      out[group] =
        totalWeight === 0
          ? 0
          : clamp01(groupValues.reduce((acc, v) => acc + v.normalized * v.weight, 0) / totalWeight) * 100;
    }
    return out;
  }

  private subScores(groups: Record<MetricGroup, number>): SubScores {
    return {
      liquidity: groups.liquidity,
      momentum: groups.momentum,
      // "Risk" is the security group expressed as a positive: 100 = clean.
      risk: groups.security,
      community: groups.community,
      whale: groups.whales,
      developer: groups.developer,
    };
  }

  /** Group scores combined under the configured group weights. */
  private composite(groups: Record<MetricGroup, number>): number {
    let acc = 0;
    let totalWeight = 0;
    for (const group of GROUPS) {
      const weight = this.groupWeights[group] ?? 1;
      acc += groups[group] * weight;
      totalWeight += weight;
    }
    return safeDiv(acc, totalWeight);
  }

  /**
   * Hard disqualifiers. Each one describes a state where the expected value of
   * the trade is negative regardless of everything else on the page.
   */
  private vetoes(
    profile: TokenProfile,
    probabilities: { rug: number; dump: number; pump: number },
    confidence: number,
  ): string[] {
    const out: string[] = [];
    const { security, holders, market } = profile;

    if (security.isHoneypot) out.push('honeypot: token cannot be sold');
    if (security.onDenyList) out.push('token is deny-listed');
    if (security.hasBlacklistFn && !security.ownershipRenounced) {
      out.push('blacklist function with a live owner');
    }
    if (security.sellTaxPct > 20) out.push(`sell tax ${security.sellTaxPct}% is punitive`);
    if (!security.lpLocked && !security.lpBurned && profile.pool.lpLockedPct < 0.5) {
      out.push('liquidity is neither locked nor burned');
    }
    if (holders.top10Pct > 0.6) out.push(`top-10 holders control ${(holders.top10Pct * 100).toFixed(0)}%`);
    if (market.liquidityUsd <= 0) out.push('no liquidity');
    if (probabilities.rug > this.options.config.maxRugProbability) {
      out.push(`rug probability ${(probabilities.rug * 100).toFixed(0)}% exceeds limit`);
    }
    if (probabilities.dump > this.options.config.maxDumpProbability) {
      out.push(`dump probability ${(probabilities.dump * 100).toFixed(0)}% exceeds limit`);
    }
    if (confidence < this.options.config.minConfidence) {
      out.push(
        `data confidence ${(confidence * 100).toFixed(0)}% below the ${(
          this.options.config.minConfidence * 100
        ).toFixed(0)}% minimum`,
      );
    }
    return out;
  }

  private confidence(values: readonly MetricValue[]): number {
    const weightTotal = values.reduce((acc, v) => acc + v.weight, 0);
    const observed = values.filter((v) => !v.imputed).reduce((acc, v) => acc + v.weight, 0);
    return clamp01(safeDiv(observed, weightTotal));
  }
}

/** `holders.top10Pct` also matches a stage-level `holders.*` failure marker. */
function wildcardOf(field: string): string {
  const [slice] = field.split('.');
  return `${slice}.*`;
}

export { ALL_METRICS, METRICS_BY_GROUP };
