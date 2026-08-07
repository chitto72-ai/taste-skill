import type { Probabilities, SubScores } from '../core/domain/scoring.js';
import type { TokenProfile } from '../core/domain/token.js';
import { clamp01, logistic, safeDiv } from '../core/utils/math.js';

interface Term {
  readonly label: string;
  readonly value: number;
  readonly coefficient: number;
}

/**
 * Calibrated logistic models over interpretable features.
 *
 * These are hand-set coefficients, not a fitted black box, and that is a
 * deliberate trade-off: with a few hundred trades of history there is not
 * enough data to fit 62 weights without overfitting, and an operator can
 * reason about — and override — a linear model at 3am. The coefficients and
 * midpoints are the parts worth re-fitting once the trade table is large
 * enough; `explain()` exists so that re-fit can be done against real logs.
 */

/**
 * Each model is a weighted average of its terms mapped through a logistic.
 *
 * Normalizing by total weight before the logistic is what keeps these
 * calibrated: summing a dozen unnormalized terms saturates the sigmoid, and a
 * probability that reads 1.00 for every token is not a probability, it is a
 * constant. `MIDPOINT` is the weighted score at which each model reads 50%,
 * and `STEEPNESS` controls how sharply it separates.
 */
const STEEPNESS = 8;
const RUG_MIDPOINT = 0.45;
const PUMP_MIDPOINT = 0.55;
const DUMP_MIDPOINT = 0.5;

export function rugTerms(profile: TokenProfile): Term[] {
  const { security, developer, holders, pool } = profile;
  const liquidityTrend = liquiditySlope(profile);
  return [
    { label: 'lp_unsecured', value: security.lpBurned ? 0 : security.lpLocked ? 0.3 : 1, coefficient: 2.4 },
    { label: 'mint_authority_live', value: security.mintAuthorityRevoked ? 0 : 1, coefficient: 1.9 },
    { label: 'freeze_authority_live', value: security.freezeAuthorityRevoked ? 0 : 1, coefficient: 1.2 },
    { label: 'honeypot', value: security.isHoneypot ? 1 : 0, coefficient: 4.0 },
    { label: 'blacklist_fn', value: security.hasBlacklistFn ? 1 : 0, coefficient: 1.3 },
    { label: 'sell_tax', value: clamp01(security.sellTaxPct / 25), coefficient: 1.8 },
    { label: 'dev_rug_history', value: clamp01(safeDiv(developer.ruggedTokens, Math.max(1, developer.tokensLaunched))), coefficient: 3.0 },
    { label: 'dev_wallet_fresh', value: developer.walletAgeDays < 3 ? 1 : developer.walletAgeDays < 14 ? 0.4 : 0, coefficient: 1.1 },
    { label: 'dev_balance', value: clamp01(developer.devBalancePct / 0.2), coefficient: 1.4 },
    { label: 'bundled', value: clamp01(holders.bundledPct / 0.2), coefficient: 1.7 },
    { label: 'concentration', value: clamp01((holders.top10Pct - 0.2) / 0.4), coefficient: 1.5 },
    { label: 'liquidity_draining', value: liquidityTrend < 0 ? clamp01(-liquidityTrend / 0.05) : 0, coefficient: 2.6 },
    { label: 'lp_thin', value: clamp01(1 - safeDiv(pool.liquidityUsd, 100_000)), coefficient: 0.8 },
  ];
}

export function pumpTerms(profile: TokenProfile, sub: SubScores): Term[] {
  const { market, holders, smartMoney } = profile;
  return [
    { label: 'momentum_score', value: sub.momentum / 100, coefficient: 2.1 },
    { label: 'smart_buyers', value: clamp01(smartMoney.smartWalletsBuying5m / 5), coefficient: 2.4 },
    { label: 'smart_net_flow', value: clamp01(safeDiv(smartMoney.smartNetFlowUsd5m, Math.max(market.liquidityUsd, 1)) / 0.15), coefficient: 1.6 },
    { label: 'holder_growth', value: clamp01(holders.growth5m / 0.15), coefficient: 1.9 },
    { label: 'volume_surge', value: clamp01(safeDiv(market.volume5mUsd, Math.max(market.volume1hUsd / 12, 1)) / 3), coefficient: 1.7 },
    { label: 'buy_pressure', value: clamp01((safeDiv(market.txns5m.buys, Math.max(market.txns5m.sells, 1), 1) - 1) / 2), coefficient: 1.3 },
    { label: 'liquidity_quality', value: sub.liquidity / 100, coefficient: 1.0 },
    { label: 'room_to_run', value: clamp01(1 - safeDiv(market.marketCapUsd, 5_000_000)), coefficient: 0.9 },
    { label: 'security_clean', value: sub.risk / 100, coefficient: 0.8 },
    { label: 'already_extended', value: -clamp01((market.priceChange1h - 1) / 3), coefficient: 1.5 },
  ];
}

export function dumpTerms(profile: TokenProfile, sub: SubScores): Term[] {
  const { market, holders, smartMoney } = profile;
  return [
    { label: 'concentration', value: clamp01((holders.top10Pct - 0.15) / 0.35), coefficient: 1.8 },
    { label: 'sniper_supply', value: clamp01(holders.snipersPct / 0.2), coefficient: 1.6 },
    { label: 'insider_supply', value: clamp01(holders.insidersPct / 0.15), coefficient: 1.4 },
    { label: 'whale_outflow', value: smartMoney.whaleNetFlowUsd5m < 0 ? clamp01(-smartMoney.whaleNetFlowUsd5m / Math.max(market.liquidityUsd * 0.1, 1)) : 0, coefficient: 2.2 },
    { label: 'smart_outflow', value: smartMoney.smartNetFlowUsd5m < 0 ? clamp01(-smartMoney.smartNetFlowUsd5m / Math.max(market.liquidityUsd * 0.1, 1)) : 0, coefficient: 1.9 },
    { label: 'sell_pressure', value: clamp01((safeDiv(market.txns5m.sells, Math.max(market.txns5m.buys, 1), 1) - 1) / 2), coefficient: 1.7 },
    { label: 'parabolic', value: clamp01((market.priceChange1h - 1.5) / 4), coefficient: 1.5 },
    { label: 'thin_liquidity', value: clamp01(1 - safeDiv(market.liquidityUsd, market.marketCapUsd) / 0.15), coefficient: 1.2 },
    { label: 'holders_stalling', value: holders.growth5m <= 0 ? 1 : clamp01(1 - holders.growth5m / 0.05), coefficient: 1.1 },
    { label: 'momentum_quality', value: -(sub.momentum / 100), coefficient: 1.4 },
  ];
}

export function estimateProbabilities(profile: TokenProfile, sub: SubScores): Probabilities {
  return {
    rug: score(rugTerms(profile), RUG_MIDPOINT),
    pump: score(pumpTerms(profile, sub), PUMP_MIDPOINT),
    dump: score(dumpTerms(profile, sub), DUMP_MIDPOINT),
  };
}

/** Weighted mean of a model's terms, before the logistic. */
export function weightedScore(terms: readonly Term[]): number {
  const totalWeight = terms.reduce((acc, term) => acc + Math.abs(term.coefficient), 0);
  if (totalWeight === 0) return 0;
  return terms.reduce((acc, term) => acc + term.value * term.coefficient, 0) / totalWeight;
}

/** Per-term contributions, for dashboards and for offline re-calibration. */
export function explain(profile: TokenProfile, sub: SubScores): Record<string, Record<string, number>> {
  const build = (terms: Term[]) => {
    const totalWeight = terms.reduce((acc, t) => acc + Math.abs(t.coefficient), 0) || 1;
    return Object.fromEntries(
      terms.map((t) => [t.label, Number(((t.value * t.coefficient) / totalWeight).toFixed(4))]),
    );
  };
  return {
    rug: build(rugTerms(profile)),
    pump: build(pumpTerms(profile, sub)),
    dump: build(dumpTerms(profile, sub)),
  };
}

function score(terms: readonly Term[], midpoint: number): number {
  return clamp01(logistic(weightedScore(terms), midpoint, STEEPNESS));
}

/** Recent liquidity slope, normalized by current liquidity. */
function liquiditySlope(profile: TokenProfile): number {
  const series = profile.priceHistory.map((p) => p.liquidityUsd).filter((v) => v > 0);
  if (series.length < 3) return 0;
  const first = series[0];
  const last = series[series.length - 1];
  return safeDiv(last - first, first);
}
