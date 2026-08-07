import { clamp, clamp01, safeDiv } from '../core/utils/math.js';
import type { EntryConfig, RiskConfig } from '../config/schema.js';
import type { SizingCap, SizingInput, SizingResult } from './types.js';

/**
 * Position sizing on a modified Kelly criterion.
 *
 * Full Kelly is the growth-optimal bet *given exact knowledge of p and b*. In
 * memecoin trading both inputs are estimates from a scoring model, and Kelly's
 * sensitivity to an overstated edge is brutal — a 2x overestimate of p can
 * make full Kelly a losing strategy. So three dampers are applied, in order:
 *
 *  1. **Fractional Kelly** (`kellyFraction`, default 0.25) — the standard
 *     defence against parameter error.
 *  2. **A hard cap** (`kellyCap`) on the fraction of equity per position.
 *  3. **A fixed-risk ceiling** — the position may never risk more than
 *     `riskPerTradePct` of equity given its stop distance. This is the binding
 *     constraint in almost every real case, and it is what makes the
 *     "max 0.5% per trade" guarantee hold regardless of what the model claims.
 *
 * Finally the size is bounded by pool liquidity, because a position that
 * cannot be exited without moving the market by more than the stop distance is
 * not really a position of that size.
 */
export class PositionSizer {
  constructor(
    private readonly risk: RiskConfig,
    private readonly entry: EntryConfig,
  ) {}

  size(input: SizingInput): SizingResult {
    const edge = this.kelly(input.winProbability, input.payoffRatio);
    if (edge <= 0) {
      return {
        sizeUsd: 0,
        kellyFraction: edge,
        riskUsd: 0,
        cappedBy: 'negative_edge',
        rationale: `no positive edge (p=${input.winProbability.toFixed(2)}, b=${input.payoffRatio.toFixed(2)})`,
      };
    }

    // Conviction scales inside the Kelly fraction rather than on top of it, so
    // a low-conviction signal can never size above a high-conviction one.
    const damped = edge * this.risk.kellyFraction * clamp(input.conviction, 0.25, 1);
    const kellyFraction = Math.min(damped, this.risk.kellyCap);

    const candidates: { cap: SizingCap; usd: number }[] = [
      { cap: 'kelly', usd: input.equity * kellyFraction },
      {
        cap: 'risk_per_trade',
        // size * stopPct = risk budget  ->  size = budget / stopPct
        usd: safeDiv(input.equity * (this.risk.riskPerTradePct / 100), Math.max(input.stopPct, 0.01)),
      },
      { cap: 'max_position_pct', usd: input.equity * this.risk.maxPositionPctOfEquity },
      { cap: 'available_capital', usd: Math.max(0, input.availableCapital) },
      { cap: 'pool_liquidity', usd: input.liquidityUsd * this.entry.maxPoolImpactPct },
    ];

    let chosen = candidates[0];
    for (const candidate of candidates) {
      if (candidate.usd < chosen.usd) chosen = candidate;
    }

    const sizeUsd = Math.max(0, chosen.usd);
    if (sizeUsd < this.risk.minPositionUsd) {
      return {
        sizeUsd: 0,
        kellyFraction,
        riskUsd: 0,
        cappedBy: 'below_minimum',
        rationale: `sized at $${sizeUsd.toFixed(2)}, below the $${this.risk.minPositionUsd} minimum (limited by ${chosen.cap})`,
      };
    }

    return {
      sizeUsd: round2(sizeUsd),
      kellyFraction,
      riskUsd: round2(sizeUsd * input.stopPct),
      cappedBy: chosen.cap,
      rationale:
        `kelly ${(kellyFraction * 100).toFixed(2)}% of equity, ` +
        `limited by ${chosen.cap}, risking $${(sizeUsd * input.stopPct).toFixed(2)} ` +
        `(${((sizeUsd * input.stopPct * 100) / input.equity).toFixed(2)}% of equity)`,
    };
  }

  /** f* = (p·b − q) / b, clamped to 0..1. */
  kelly(winProbability: number, payoffRatio: number): number {
    const p = clamp01(winProbability);
    const b = Math.max(payoffRatio, 0.01);
    return clamp01((p * b - (1 - p)) / b);
  }

  /**
   * Converts a strategy's stop percentage into the risk it represents, so
   * callers can sanity-check sizing without recomputing Kelly.
   */
  riskOf(sizeUsd: number, stopPct: number, equity: number): number {
    return safeDiv(sizeUsd * stopPct, equity);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
