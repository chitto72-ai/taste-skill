import type {
  ChainDescriptor,
  ChainId,
  GasQuote,
  TxReceipt,
  TxRequest,
} from '../../core/domain/chain.js';
import { AppError, RpcError } from '../../core/errors.js';
import type { HealthReport } from '../../core/lifecycle.js';
import { err, ok, type Result } from '../../core/result.js';
import { TtlCache } from '../../core/utils/cache.js';
import { sleep } from '../../core/utils/async.js';
import type { Logger } from '../../logger/logger.js';
import type { ChainRuntimeConfig } from '../../config/schema.js';
import type { ChainAdapter, SimulationResult, TxSigner } from '../types.js';
import type { GasManager } from '../gas/gas-manager.js';
import type { RpcManager } from '../rpc/rpc-manager.js';
import { decodeDecimals, decodeUint, encodeBalanceOf, encodeDecimals } from './erc20.js';

export interface EvmAdapterOptions {
  readonly descriptor: ChainDescriptor;
  readonly config: ChainRuntimeConfig;
  readonly rpc: RpcManager;
  readonly gas: GasManager;
  readonly logger: Logger;
}

/** Default gas ceiling for a memecoin router swap when estimation fails. */
const FALLBACK_SWAP_GAS = 450_000n;

export class EvmChainAdapter implements ChainAdapter {
  readonly name: string;
  readonly chainId: ChainId;
  readonly descriptor: ChainDescriptor;

  private readonly decimalsCache = new TtlCache<string, number>({ ttlMs: 60 * 60_000, maxEntries: 5_000 });
  private readonly logger: Logger;
  private nonceCache = new Map<string, number>();

  constructor(private readonly options: EvmAdapterOptions) {
    this.descriptor = options.descriptor;
    this.chainId = options.descriptor.id;
    this.name = `chain:${this.chainId}`;
    this.logger = options.logger.child(this.name);
  }

  async start(): Promise<void> {
    const blockNumber = await this.getBlockNumber();
    this.logger.info({ blockNumber }, 'evm adapter ready');
  }

  async stop(): Promise<void> {
    this.nonceCache.clear();
  }

  async health(): Promise<HealthReport> {
    try {
      const blockNumber = await this.getBlockNumber();
      return {
        component: this.name,
        healthy: blockNumber > 0,
        detail: `head at block ${blockNumber}`,
        checkedAt: Date.now(),
        metrics: { blockNumber },
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
    const hex = await this.options.rpc.call<string>('eth_blockNumber');
    return Number(BigInt(hex));
  }

  async getNativeBalance(address: string): Promise<bigint> {
    const hex = await this.options.rpc.call<string>('eth_getBalance', [address, 'latest']);
    return BigInt(hex);
  }

  async getTokenBalance(tokenAddress: string, owner: string): Promise<bigint> {
    const data = await this.options.rpc.call<string>('eth_call', [
      { to: tokenAddress, data: encodeBalanceOf(owner) },
      'latest',
    ]);
    return decodeUint(data);
  }

  async getTokenDecimals(tokenAddress: string): Promise<number> {
    const key = tokenAddress.toLowerCase();
    const cached = this.decimalsCache.get(key);
    if (cached !== undefined) return cached;
    try {
      const data = await this.options.rpc.call<string>('eth_call', [
        { to: tokenAddress, data: encodeDecimals() },
        'latest',
      ]);
      const decimals = decodeDecimals(data);
      this.decimalsCache.set(key, decimals);
      return decimals;
    } catch (error) {
      // Non-standard tokens exist; 18 is the overwhelming default on EVM.
      this.logger.debug({ token: tokenAddress, err: error }, 'decimals() call failed, assuming 18');
      this.decimalsCache.set(key, 18, 60_000);
      return 18;
    }
  }

  async estimateGas(tx: TxRequest): Promise<GasQuote> {
    let units = tx.gasLimit;
    if (units === undefined) {
      try {
        const hex = await this.options.rpc.call<string>('eth_estimateGas', [
          { from: tx.from, to: tx.to, data: tx.data, value: toHex(tx.value) },
        ]);
        // 20% headroom: memecoin routers branch on state that moves between
        // estimation and inclusion.
        units = (BigInt(hex) * 120n) / 100n;
      } catch (error) {
        this.logger.debug({ err: error }, 'eth_estimateGas failed, using fallback limit');
        units = FALLBACK_SWAP_GAS;
      }
    }
    return this.options.gas.quote(this.chainId, tx.urgency, units);
  }

  async simulate(tx: TxRequest): Promise<Result<SimulationResult>> {
    try {
      const data = await this.options.rpc.call<string>('eth_call', [
        { from: tx.from, to: tx.to, data: tx.data, value: toHex(tx.value) },
        'latest',
      ]);
      return ok({ willSucceed: true, outputAmount: data && data !== '0x' ? decodeUint(data) : undefined });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (error instanceof RpcError && !error.retryable) {
        // A revert is a valid simulation outcome, not an infrastructure failure.
        return ok({ willSucceed: false, revertReason: reason });
      }
      return err(
        new AppError(`Simulation failed: ${reason}`, {
          code: 'SIMULATION_FAILED',
          category: 'rpc',
          retryable: true,
          cause: error,
        }),
      );
    }
  }

  async sendTransaction(tx: TxRequest, signer: TxSigner): Promise<string> {
    const [gas, nonce] = await Promise.all([this.estimateGas(tx), this.nextNonce(signer.address)]);
    const signed = await signer.sign(tx, gas, nonce);
    try {
      const hash = await this.options.rpc.call<string>(
        'eth_sendRawTransaction',
        [signed.raw],
        // Broadcasts must not queue behind scanner traffic.
        { bypassRateLimit: true, label: 'sendRawTransaction' },
      );
      this.nonceCache.set(signer.address.toLowerCase(), nonce + 1);
      this.logger.info({ hash, nonce, gasUsd: gas.estimatedUsd.toFixed(4) }, 'transaction broadcast');
      return hash;
    } catch (error) {
      // Nonce state is now unknown; force a refetch on the next send.
      this.nonceCache.delete(signer.address.toLowerCase());
      throw error;
    }
  }

  async waitForReceipt(hash: string, timeoutMs = 120_000): Promise<TxReceipt> {
    const deadline = Date.now() + timeoutMs;
    const pollMs = Math.max(500, Math.floor(this.descriptor.blockTimeMs / 2));

    while (Date.now() < deadline) {
      const receipt = await this.options.rpc
        .call<EvmReceipt | null>('eth_getTransactionReceipt', [hash])
        .catch(() => null);

      if (receipt) {
        const gasUsed = BigInt(receipt.gasUsed ?? '0x0');
        const effectiveGasPrice = BigInt(receipt.effectiveGasPrice ?? '0x0');
        const feeNative = gasUsed * effectiveGasPrice;
        const confirmed = receipt.status === '0x1';
        if (this.descriptor.confirmations > 1 && confirmed) {
          const head = await this.getBlockNumber().catch(() => 0);
          const depth = head - Number(BigInt(receipt.blockNumber ?? '0x0'));
          if (depth < this.descriptor.confirmations - 1) {
            await sleep(pollMs);
            continue;
          }
        }
        return {
          chain: this.chainId,
          hash,
          status: confirmed ? 'confirmed' : 'failed',
          blockNumber: Number(BigInt(receipt.blockNumber ?? '0x0')),
          gasUsed,
          effectiveGasPrice,
          feeNative,
          confirmedAt: Date.now(),
          error: confirmed ? undefined : 'transaction reverted',
        };
      }
      await sleep(pollMs);
    }

    return { chain: this.chainId, hash, status: 'timeout', error: `not mined within ${timeoutMs}ms` };
  }

  toBaseUnits(amount: number, decimals: number): bigint {
    if (!Number.isFinite(amount) || amount <= 0) return 0n;
    // String path avoids float drift for large token amounts.
    const [whole, fraction = ''] = amount.toFixed(Math.min(decimals, 18)).split('.');
    const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
    return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || '0');
  }

  fromBaseUnits(amount: bigint, decimals: number): number {
    const divisor = 10n ** BigInt(decimals);
    const whole = amount / divisor;
    const fraction = amount % divisor;
    return Number(whole) + Number(fraction) / Number(divisor);
  }

  explorerTx(hash: string): string {
    return `${this.descriptor.explorerTxUrl}${hash}`;
  }

  explorerToken(address: string): string {
    return `${this.descriptor.explorerTokenUrl}${address}`;
  }

  private async nextNonce(address: string): Promise<number> {
    const key = address.toLowerCase();
    const cached = this.nonceCache.get(key);
    if (cached !== undefined) return cached;
    const hex = await this.options.rpc.call<string>('eth_getTransactionCount', [address, 'pending']);
    const nonce = Number(BigInt(hex));
    this.nonceCache.set(key, nonce);
    return nonce;
  }
}

interface EvmReceipt {
  status?: string;
  blockNumber?: string;
  gasUsed?: string;
  effectiveGasPrice?: string;
}

function toHex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
