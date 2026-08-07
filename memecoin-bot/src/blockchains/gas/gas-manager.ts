import type { ChainId, GasQuote, GasUrgency } from '../../core/domain/chain.js';
import { TtlCache } from '../../core/utils/cache.js';
import { clamp } from '../../core/utils/math.js';
import type { Logger } from '../../logger/logger.js';
import type { ChainRuntimeConfig } from '../../config/schema.js';
import { getChain } from '../../config/chains.config.js';
import type { GasStrategy, PriceOracle } from '../types.js';
import type { RpcManager } from '../rpc/rpc-manager.js';

/** Urgency -> multiplier applied on top of the network's suggestion. */
const URGENCY_MULTIPLIER: Record<GasUrgency, number> = {
  economy: 0.9,
  standard: 1.0,
  fast: 1.35,
  turbo: 2.0,
};

/** Percentile of recent fees to target, per urgency. */
const URGENCY_PERCENTILE: Record<GasUrgency, number> = {
  economy: 25,
  standard: 50,
  fast: 75,
  turbo: 95,
};

/** The part of a quote that is shared across transactions in the same block. */
type FeeBase = Pick<GasQuote, 'unitPrice' | 'priorityFee' | 'urgency'>;

export interface GasManagerOptions {
  readonly chainId: ChainId;
  readonly rpc: RpcManager;
  readonly config: ChainRuntimeConfig;
  readonly priceOracle: PriceOracle;
  readonly logger: Logger;
}

/**
 * Per-chain fee estimation.
 *
 * Two families, one contract. EVM quotes EIP-1559 base + priority fees from
 * `eth_feeHistory`; Solana quotes priority fees per compute unit from
 * `getRecentPrioritizationFees`. Both are cached for a couple of blocks —
 * re-quoting on every scan tick would triple RPC load for no benefit.
 */
export class GasManager implements GasStrategy {
  private readonly cache: TtlCache<string, FeeBase>;
  private readonly logger: Logger;
  private readonly family: 'evm' | 'svm';

  constructor(private readonly options: GasManagerOptions) {
    this.logger = options.logger.child(`gas:${options.chainId}`);
    this.family = getChain(options.chainId).family;
    // Two block times of caching, floored at 1s and capped at 10s.
    const ttl = clamp(getChain(options.chainId).blockTimeMs * 2, 1_000, 10_000);
    this.cache = new TtlCache({ ttlMs: ttl, maxEntries: 16 });
  }

  async quote(chain: ChainId, urgency: GasUrgency, units: bigint): Promise<GasQuote> {
    const cacheKey = `${chain}:${urgency}`;
    const cached = this.cache.get(cacheKey);
    const base =
      cached ??
      (this.family === 'evm' ? await this.quoteEvm(urgency) : await this.quoteSolana(urgency));
    if (!cached) this.cache.set(cacheKey, base);

    const totalNative = this.totalCost(base.unitPrice, base.priorityFee, units);
    const nativeUsd = await this.options.priceOracle.nativeUsd(chain);
    const decimals = getChain(chain).nativeCurrency.decimals;
    const estimatedUsd = (Number(totalNative) / 10 ** decimals) * nativeUsd;

    return { ...base, chain, units, totalNative, estimatedUsd, at: Date.now() };
  }

  /** True when a quote would blow the per-transaction USD ceiling. */
  exceedsBudget(quote: GasQuote): boolean {
    return quote.estimatedUsd > this.options.config.maxGasUsdPerTx;
  }

  private totalCost(unitPrice: bigint, priorityFee: bigint, units: bigint): bigint {
    if (this.family === 'evm') return (unitPrice + priorityFee) * units;
    // Solana: 5000 lamports base signature fee + priority fee per compute unit.
    const priorityLamports = (unitPrice * units) / 1_000_000n;
    return 5_000n + priorityLamports;
  }

  private async quoteEvm(urgency: GasUrgency): Promise<FeeBase> {
    const percentile = URGENCY_PERCENTILE[urgency];
    try {
      const history = await this.options.rpc.call<{
        baseFeePerGas: string[];
        reward?: string[][];
      }>('eth_feeHistory', ['0x5', 'latest', [percentile]]);

      const baseFees = (history.baseFeePerGas ?? []).map((v) => BigInt(v));
      const nextBaseFee = baseFees.length > 0 ? baseFees[baseFees.length - 1] : 0n;
      const rewards = (history.reward ?? []).map((r) => BigInt(r[0] ?? '0x0'));
      const medianTip = rewards.length > 0 ? median(rewards) : 1_000_000_000n;

      const multiplier = URGENCY_MULTIPLIER[urgency] * this.options.config.gasMultiplier;
      const priorityFee = capGwei(scale(medianTip, multiplier), this.options.config.maxPriorityFee);
      // Pad the base fee so the tx survives a couple of rising blocks.
      const unitPrice = scale(nextBaseFee, 1.25);

      return { unitPrice, priorityFee, urgency };
    } catch (error) {
      this.logger.debug({ err: error }, 'eth_feeHistory unavailable, falling back to eth_gasPrice');
      const gasPriceHex = await this.options.rpc.call<string>('eth_gasPrice', []);
      const gasPrice = BigInt(gasPriceHex);
      const multiplier = URGENCY_MULTIPLIER[urgency] * this.options.config.gasMultiplier;
      return {
        unitPrice: scale(gasPrice, multiplier),
        priorityFee: 0n,
        urgency,
      };
    }
  }

  private async quoteSolana(urgency: GasUrgency): Promise<FeeBase> {
    try {
      const fees = await this.options.rpc.call<{ slot: number; prioritizationFee: number }[]>(
        'getRecentPrioritizationFees',
        [[]],
      );
      const values = (fees ?? []).map((f) => f.prioritizationFee).filter((v) => v > 0);
      const target = values.length > 0 ? percentileOf(values, URGENCY_PERCENTILE[urgency]) : 10_000;
      const multiplier = URGENCY_MULTIPLIER[urgency] * this.options.config.gasMultiplier;
      const microLamports = BigInt(
        Math.min(Math.ceil(target * multiplier), this.options.config.maxPriorityFee),
      );
      return { unitPrice: microLamports, priorityFee: 0n, urgency };
    } catch (error) {
      this.logger.debug({ err: error }, 'prioritization fee lookup failed, using floor');
      return { unitPrice: 20_000n, priorityFee: 0n, urgency };
    }
  }
}

function scale(value: bigint, multiplier: number): bigint {
  // Fixed-point to keep bigint math exact at 4 decimal places.
  return (value * BigInt(Math.round(multiplier * 10_000))) / 10_000n;
}

function capGwei(value: bigint, maxGwei: number): bigint {
  const cap = BigInt(Math.round(maxGwei * 1e9));
  return value > cap ? cap : value;
}

function median(values: bigint[]): bigint {
  const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return sorted[Math.floor(sorted.length / 2)] ?? 0n;
}

function percentileOf(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((p / 100) * sorted.length)));
  return sorted[index];
}
