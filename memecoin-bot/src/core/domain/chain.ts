/**
 * Chain-level domain vocabulary.
 *
 * `ChainId` is intentionally a plain string union rather than an enum: the set
 * of venues a broker like Axiom Pro supports changes over time, and the whole
 * registry is data-driven (see config/chains.config.ts). Adding a chain means
 * adding a descriptor, not editing switch statements.
 */

export type ChainFamily = 'evm' | 'svm';

export type ChainId =
  | 'solana'
  | 'ethereum'
  | 'base'
  | 'bsc'
  | 'arbitrum'
  | 'hyperliquid'
  | (string & {});

export interface NativeCurrency {
  readonly symbol: string;
  readonly decimals: number;
  /** Coingecko-style id, used by the price oracle to value gas in USD. */
  readonly priceId: string;
}

export interface ChainDescriptor {
  readonly id: ChainId;
  readonly family: ChainFamily;
  readonly displayName: string;
  /** EVM numeric chain id; undefined for non-EVM families. */
  readonly evmChainId?: number;
  readonly nativeCurrency: NativeCurrency;
  /** Canonical quote token used for sizing and PnL (USDC-like). */
  readonly quoteToken: {
    readonly address: string;
    readonly symbol: string;
    readonly decimals: number;
  };
  /** Wrapped native token address, used by most AMM routers. */
  readonly wrappedNative: string;
  readonly blockTimeMs: number;
  /** Confirmations considered final for accounting purposes. */
  readonly confirmations: number;
  readonly explorerTxUrl: string;
  readonly explorerTokenUrl: string;
  /** DEX/aggregator identifiers this chain routes through. */
  readonly venues: readonly string[];
}

export interface GasQuote {
  readonly chain: ChainId;
  /** EVM: wei per gas. SVM: micro-lamports per compute unit. */
  readonly unitPrice: bigint;
  /** EVM: priority fee per gas. SVM: 0 (folded into unitPrice). */
  readonly priorityFee: bigint;
  /** Estimated units consumed (gas limit / compute units). */
  readonly units: bigint;
  /** Total native-currency cost in the smallest unit. */
  readonly totalNative: bigint;
  readonly estimatedUsd: number;
  readonly urgency: GasUrgency;
  readonly at: number;
}

export type GasUrgency = 'economy' | 'standard' | 'fast' | 'turbo';

export interface TxRequest {
  readonly chain: ChainId;
  readonly from: string;
  readonly to: string;
  readonly data: string;
  readonly value: bigint;
  readonly urgency: GasUrgency;
  /** Optional pre-computed gas ceiling; the gas manager fills gaps. */
  readonly gasLimit?: bigint;
  readonly deadlineMs?: number;
}

export type TxStatus = 'pending' | 'confirmed' | 'failed' | 'dropped' | 'timeout';

export interface TxReceipt {
  readonly chain: ChainId;
  readonly hash: string;
  readonly status: TxStatus;
  readonly blockNumber?: number;
  readonly gasUsed?: bigint;
  readonly effectiveGasPrice?: bigint;
  readonly feeNative?: bigint;
  readonly feeUsd?: number;
  readonly confirmedAt?: number;
  readonly error?: string;
}
