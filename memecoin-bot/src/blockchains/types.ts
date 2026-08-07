import type { ChainDescriptor, ChainId, GasQuote, GasUrgency, TxReceipt, TxRequest } from '../core/domain/chain.js';
import type { HealthCheckable, Service } from '../core/lifecycle.js';
import type { Result } from '../core/result.js';

export interface SignedTx {
  /** Serialized, ready to broadcast. */
  readonly raw: string;
  readonly hash?: string;
}

/** Chain-agnostic signing surface implemented by the wallets module. */
export interface TxSigner {
  readonly address: string;
  readonly chain: ChainId;
  sign(tx: TxRequest, gas: GasQuote, nonce?: number): Promise<SignedTx>;
}

export interface SimulationResult {
  readonly willSucceed: boolean;
  readonly gasUsed?: bigint;
  readonly revertReason?: string;
  /** Tokens the simulation says we receive; used for honeypot detection. */
  readonly outputAmount?: bigint;
}

/**
 * What every chain must provide for the execution layer to be chain-agnostic.
 *
 * Deliberately narrow: swaps are routed by the exchange adapter (Axiom or an
 * on-chain router), so the chain adapter only has to know about balances,
 * gas, broadcasting and confirmation.
 */
export interface ChainAdapter extends Service, HealthCheckable {
  readonly chainId: ChainId;
  readonly descriptor: ChainDescriptor;

  getBlockNumber(): Promise<number>;
  getNativeBalance(address: string): Promise<bigint>;
  getTokenBalance(tokenAddress: string, owner: string): Promise<bigint>;
  getTokenDecimals(tokenAddress: string): Promise<number>;

  estimateGas(tx: TxRequest): Promise<GasQuote>;
  simulate(tx: TxRequest): Promise<Result<SimulationResult>>;
  sendTransaction(tx: TxRequest, signer: TxSigner): Promise<string>;
  waitForReceipt(hash: string, timeoutMs?: number): Promise<TxReceipt>;

  /** Human units -> smallest units and back. */
  toBaseUnits(amount: number, decimals: number): bigint;
  fromBaseUnits(amount: bigint, decimals: number): number;

  explorerTx(hash: string): string;
  explorerToken(address: string): string;
}

export interface RpcEndpointStats {
  readonly url: string;
  readonly healthy: boolean;
  readonly breakerState: string;
  readonly requests: number;
  readonly failures: number;
  readonly avgLatencyMs: number;
  readonly lastErrorAt?: number;
  readonly lastError?: string;
  readonly consecutiveFailures: number;
}

export interface RpcCallOptions {
  /** Overrides the chain-level timeout for one call. */
  readonly timeoutMs?: number;
  /** Endpoints to try before giving up. */
  readonly maxEndpoints?: number;
  /** Skip the token bucket (exit orders should not queue behind scans). */
  readonly bypassRateLimit?: boolean;
  readonly label?: string;
}

export interface GasStrategy {
  quote(chain: ChainId, urgency: GasUrgency, units: bigint): Promise<GasQuote>;
}

/** Native-currency price feed, used to express gas costs in USD. */
export interface PriceOracle {
  nativeUsd(chain: ChainId): Promise<number>;
  tokenUsd(chain: ChainId, tokenAddress: string): Promise<number | undefined>;
}
