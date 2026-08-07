import type { ChainId, GasQuote, TxRequest } from '../../core/domain/chain.js';
import { WalletError } from '../../core/errors.js';
import type { SignedTx, TxSigner } from '../../blockchains/types.js';
import { getChain } from '../../config/chains.config.js';

/**
 * EIP-1559 transaction signer.
 *
 * `viem` is imported dynamically so that a Solana-only deployment never pays
 * to load an EVM crypto stack, and so that the module graph does not require
 * it at build time.
 */
export class EvmSigner implements TxSigner {
  readonly address: string;
  readonly chain: ChainId;

  private account: { signTransaction: (tx: Record<string, unknown>) => Promise<string> } | undefined;

  constructor(
    chain: ChainId,
    address: string,
    private readonly privateKey: string,
  ) {
    this.chain = chain;
    this.address = address;
  }

  static async create(chain: ChainId, privateKey: string): Promise<EvmSigner> {
    const { privateKeyToAccount } = await import('viem/accounts');
    const normalized = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
    const account = privateKeyToAccount(normalized as `0x${string}`);
    const signer = new EvmSigner(chain, account.address, normalized);
    return signer;
  }

  async sign(tx: TxRequest, gas: GasQuote, nonce?: number): Promise<SignedTx> {
    if (nonce === undefined) {
      throw new WalletError('EVM transactions require an explicit nonce', { chain: this.chain });
    }
    const account = await this.ensureAccount();
    const descriptor = getChain(this.chain);

    const raw = await account.signTransaction({
      to: tx.to as `0x${string}`,
      data: tx.data as `0x${string}`,
      value: tx.value,
      nonce,
      gas: gas.units,
      maxFeePerGas: gas.unitPrice + gas.priorityFee,
      maxPriorityFeePerGas: gas.priorityFee,
      chainId: descriptor.evmChainId,
      type: 'eip1559',
    });

    return { raw };
  }

  private async ensureAccount(): Promise<{
    signTransaction: (tx: Record<string, unknown>) => Promise<string>;
  }> {
    if (this.account) return this.account;
    const { privateKeyToAccount } = await import('viem/accounts');
    const account = privateKeyToAccount(this.privateKey as `0x${string}`);
    this.account = {
      signTransaction: (transaction) =>
        account.signTransaction(transaction as Parameters<typeof account.signTransaction>[0]),
    };
    return this.account;
  }
}
