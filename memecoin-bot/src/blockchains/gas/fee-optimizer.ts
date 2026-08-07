import type { ChainId, GasQuote, GasUrgency } from '../../core/domain/chain.js';
import { clamp } from '../../core/utils/math.js';
import type { EntryConfig, RiskConfig } from '../../config/schema.js';

export interface FeeDecisionInput {
  readonly chain: ChainId;
  /** Notional of the trade in quote currency. */
  readonly positionUsd: number;
  /** 0..1 — how strongly the strategy wants this fill. */
  readonly conviction: number;
  /** True for exits; exits are never allowed to be cheap-and-slow. */
  readonly isExit: boolean;
  readonly emergency?: boolean;
  /** Pool liquidity, used to bound price impact. */
  readonly liquidityUsd: number;
  /** Realized volatility of the token, 0..1+. */
  readonly volatility: number;
}

export interface FeeDecision {
  readonly urgency: GasUrgency;
  readonly slippageBps: number;
  readonly usePrivateTx: boolean;
  readonly maxGasUsd: number;
  readonly rationale: string;
}

export interface FeeOptimizerOptions {
  readonly entry: EntryConfig;
  readonly risk: RiskConfig;
}

/**
 * Chooses urgency and slippage per order.
 *
 * The asymmetry is intentional. Overpaying gas on an entry is a small,
 * bounded cost and can be declined; underpaying on an exit means the stop
 * does not land, which is unbounded. So exits escalate and entries are the
 * only side allowed to be rejected on cost.
 */
export class FeeOptimizer {
  constructor(private readonly options: FeeOptimizerOptions) {}

  decide(input: FeeDecisionInput): FeeDecision {
    const urgency = this.pickUrgency(input);
    const slippageBps = this.pickSlippage(input);
    const maxGasUsd = input.isExit
      ? Number.POSITIVE_INFINITY
      : input.positionUsd * this.options.risk.maxGasPctOfPosition;

    const rationale = input.emergency
      ? 'emergency exit: maximum urgency, wide slippage'
      : input.isExit
        ? 'exit: prioritise landing the transaction over fee cost'
        : `entry: conviction ${input.conviction.toFixed(2)}, volatility ${input.volatility.toFixed(3)}`;

    return {
      urgency,
      slippageBps,
      // Private relays protect entries from sandwiching; on exits, inclusion
      // speed usually matters more than MEV protection.
      usePrivateTx: !input.emergency && !input.isExit,
      maxGasUsd,
      rationale,
    };
  }

  /** Rejects an entry whose gas eats too much of the position. */
  isGasAcceptable(quote: GasQuote, decision: FeeDecision): boolean {
    return quote.estimatedUsd <= decision.maxGasUsd;
  }

  private pickUrgency(input: FeeDecisionInput): GasUrgency {
    if (input.emergency) return 'turbo';
    if (input.isExit) return input.volatility > 0.15 ? 'turbo' : 'fast';
    if (input.conviction >= 0.8) return 'fast';
    if (input.conviction >= 0.5) return 'standard';
    return 'economy';
  }

  private pickSlippage(input: FeeDecisionInput): number {
    if (input.emergency) return Math.max(this.options.entry.maxSlippageBps, 1_500);

    // Base tolerance scales with realized volatility: a token moving 20% per
    // minute cannot be filled at a 0.5% tolerance.
    const volatilityBps = clamp(input.volatility * 10_000 * 0.5, 30, 900);

    // Price impact from consuming pool depth, using the constant-product
    // approximation impact ≈ 2 * (size / liquidity).
    const share = input.liquidityUsd > 0 ? input.positionUsd / input.liquidityUsd : 1;
    const impactBps = clamp(share * 2 * 10_000, 0, 2_000);

    const total = volatilityBps + impactBps + (input.isExit ? 150 : 0);
    const ceiling = input.isExit ? this.options.entry.maxSlippageBps * 3 : this.options.entry.maxSlippageBps;
    return Math.round(clamp(total, 30, ceiling));
  }
}
