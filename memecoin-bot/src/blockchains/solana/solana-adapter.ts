import type {
  ChainDescriptor,
  ChainId,
  GasQuote,
  TxReceipt,
  TxRequest,
} from '../../core/domain/chain.js';
import { AppError } from '../../core/errors.js';
import type { HealthReport } from '../../core/lifecycle.js';
import { err, ok, type Result } from '../../core/result.js';
import { TtlCache } from '../../core/utils/cache.js';
import { sleep } from '../../core/utils/async.js';
import type { Logger } from '../../logger/logger.js';
import type { ChainRuntimeConfig } from '../../config/schema.js';
import type { ChainAdapter, SimulationResult, TxSigner } from '../types.js';
import type { GasManager } from '../gas/gas-manager.js';
import type { RpcManager } from '../rpc/rpc-manager.js';

export interface SolanaAdapterOptions {
  readonly descriptor: ChainDescriptor;
  readonly config: ChainRuntimeConfig;
  readonly rpc: RpcManager;
  readonly gas: GasManager;
  readonly logger: Logger;
}

/** Compute units a typical AMM swap consumes, used when no limit is supplied. */
const DEFAULT_COMPUTE_UNITS = 200_000n;
const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

/**
 * Solana adapter.
 *
 * `TxRequest.data` carries a base64-encoded, fully-built transaction message
 * (produced by the venue adapter, which owns route construction). This adapter
 * is responsible for fees, simulation, broadcast and confirmation only.
 */
export class SolanaChainAdapter implements ChainAdapter {
  readonly name: string;
  readonly chainId: ChainId;
  readonly descriptor: ChainDescriptor;

  private readonly decimalsCache = new TtlCache<string, number>({ ttlMs: 60 * 60_000, maxEntries: 5_000 });
  private readonly logger: Logger;

  constructor(private readonly options: SolanaAdapterOptions) {
    this.descriptor = options.descriptor;
    this.chainId = options.descriptor.id;
    this.name = `chain:${this.chainId}`;
    this.logger = options.logger.child(this.name);
  }

  async start(): Promise<void> {
    const slot = await this.getBlockNumber();
    this.logger.info({ slot }, 'solana adapter ready');
  }

  async stop(): Promise<void> {
    this.decimalsCache.clear();
  }

  async health(): Promise<HealthReport> {
    try {
      const slot = await this.getBlockNumber();
      return {
        component: this.name,
        healthy: slot > 0,
        detail: `head at slot ${slot}`,
        checkedAt: Date.now(),
        metrics: { slot },
      };
    } catch (error) {
      return {
        component: this.name,
        healthy: false,
        detail: error instanceof Error ? error.message : String(error),
        checkedAt: Date.now(),
      };
    }
  }

  async getBlockNumber(): Promise<number> {
    return this.options.rpc.call<number>('getSlot', [{ commitment: 'confirmed' }]);
  }

  async getNativeBalance(address: string): Promise<bigint> {
    const response = await this.options.rpc.call<{ value: number }>('getBalance', [address]);
    return BigInt(response.value ?? 0);
  }

  async getTokenBalance(tokenAddress: string, owner: string): Promise<bigint> {
    const response = await this.options.rpc.call<{
      value: { account: { data: { parsed: { info: { tokenAmount: { amount: string } } } } } }[];
    }>('getTokenAccountsByOwner', [owner, { mint: tokenAddress }, { encoding: 'jsonParsed' }]);

    let total = 0n;
    for (const entry of response.value ?? []) {
      const amount = entry.account?.data?.parsed?.info?.tokenAmount?.amount;
      if (amount) total += BigInt(amount);
    }
    return total;
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    const cached = this.decimalsCache.get(tokenAddress);
    if (cached !== undefined) return cached;

    const response = await this.options.rpc.call<{
      value: { data: { parsed?: { info?: { decimals?: number } } } } | null;
    }>('getAccountInfo', [tokenAddress, { encoding: 'jsonParsed' }]);

    const decimals = response.value?.data?.parsed?.info?.decimals;
    if (typeof decimals !== 'number') {
      throw new AppError(`Unable to read decimals for mint ${tokenAddress}`, {
        code: 'MINT_DECIMALS_UNKNOWN',
        category: 'rpc',
        retryable: true,
        context: { mint: tokenAddress },
      });
    }
    this.decimalsCache.set(tokenAddress, decimals);
    return decimals;
  }

  /** Mint/freeze authority and program owner — the core rug pre-checks. */
  async getMintAuthorities(mint: string): Promise<{
    mintAuthority: string | null;
    freezeAuthority: string | null;
    supply: string;
    isToken2022: boolean;
  }> {
    const response = await this.options.rpc.call<{
      value: {
        owner?: string;
        data: {
          parsed?: {
            info?: { mintAuthority?: string | null; freezeAuthority?: string | null; supply?: string };
          };
        };
      } | null;
    }>('getAccountInfo', [mint, { encoding: 'jsonParsed' }]);

    const info = response.value?.data?.parsed?.info ?? {};
    const owner = response.value?.owner ?? SPL_TOKEN_PROGRAM;
    return {
      mintAuthority: info.mintAuthority ?? null,
      freezeAuthority: info.freezeAuthority ?? null,
      supply: info.supply ?? '0',
      isToken2022: owner === TOKEN_2022_PROGRAM,
    };
  }

  async estimateGas(tx: TxRequest): Promise<GasQuote> {
    return this.options.gas.quote(this.chainId, tx.urgency, tx.gasLimit ?? DEFAULT_COMPUTE_UNITS);
  }

  async simulate(tx: TxRequest): Promise<Result<SimulationResult>> {
    try {
      const response = await this.options.rpc.call<{
        value: { err: unknown; unitsConsumed?: number; logs?: string[] };
      }>('simulateTransaction', [
        tx.data,
        { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true },
      ]);

      const value = response.value;
      if (value?.err) {
        return ok({
          willSucceed: false,
          revertReason: JSON.stringify(value.err),
          gasUsed: BigInt(value.unitsConsumed ?? 0),
        });
      }
      return ok({ willSucceed: true, gasUsed: BigInt(value?.unitsConsumed ?? 0) });
    } catch (error) {
      return err(
        new AppError(`Simulation failed: ${error instanceof Error ? error.message : String(error)}`, {
          code: 'SIMULATION_FAILED',
          category: 'rpc',
          retryable: true,
          cause: error,
        }),
      );
    }
  }

  async sendTransaction(tx: TxRequest, signer: TxSigner): Promise<string> {
    const gas = await this.estimateGas(tx);
    const signed = await signer.sign(tx, gas);
    const signature = await this.options.rpc.call<string>(
      'sendTransaction',
      [
        signed.raw,
        {
          encoding: 'base64',
          skipPreflight: true,
          maxRetries: 0,
          preflightCommitment: 'confirmed',
        },
      ],
      { bypassRateLimit: true, label: 'sendTransaction' },
    );
    this.logger.info({ signature, gasUsd: gas.estimatedUsd.toFixed(5) }, 'transaction broadcast');
    return signature;
  }

  async waitForReceipt(hash: string, timeoutMs = 60_000): Promise<TxReceipt> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const response = await this.options.rpc
        .call<{
          value: ({ slot: number; err: unknown; confirmationStatus?: string } | null)[];
        }>('getSignatureStatuses', [[hash], { searchTransactionHistory: false }])
        .catch(() => null);

      const status = response?.value?.[0];
      if (status) {
        const finalized = status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized';
        if (finalized || status.err) {
          return {
            chain: this.chainId,
            hash,
            status: status.err ? 'failed' : 'confirmed',
            blockNumber: status.slot,
            feeNative: 5_000n,
            confirmedAt: Date.now(),
            error: status.err ? JSON.stringify(status.err) : undefined,
          };
        }
      }
      await sleep(400);
    }
    // Solana drops unconfirmed transactions after the blockhash expires, so a
    // timeout here means "never landed", not "still pending".
    return { chain: this.chainId, hash, status: 'dropped', error: `not confirmed within ${timeoutMs}ms` };
  }

  toBaseUnits(amount: number, decimals: number): bigint {
    if (!Number.isFinite(amount) || amount <= 0) return 0n;
    const [whole, fraction = ''] = amount.toFixed(Math.min(decimals, 9)).split('.');
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
  }

  fromBaseUnits(amount: bigint, decimals: number): number {
    const divisor = 10n ** BigInt(decimals);
    return Number(amount / divisor) + Number(amount % divisor) / Number(divisor);
  }

  explorerTx(hash: string): string {
    return `${this.descriptor.explorerTxUrl}${hash}`;
  }

  explorerToken(address: string): string {
    return `${this.descriptor.explorerTokenUrl}${address}`;
  }
}
