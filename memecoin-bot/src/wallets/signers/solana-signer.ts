import type { ChainId, GasQuote, TxRequest } from '../../core/domain/chain.js';
import { WalletError } from '../../core/errors.js';
import type { SignedTx, TxSigner } from '../../blockchains/types.js';

/**
 * Solana signer.
 *
 * The venue adapter hands over a fully-built, base64-encoded transaction; this
 * signer's job is to attach the compute-budget instructions implied by the gas
 * quote and sign. Both legacy and versioned transactions are supported,
 * because routers on Solana emit either depending on the route.
 */
export class SolanaSigner implements TxSigner {
  readonly address: string;
  readonly chain: ChainId;

  private keypair: unknown;

  private constructor(
    chain: ChainId,
    address: string,
    private readonly secret: Uint8Array,
  ) {
    this.chain = chain;
    this.address = address;
  }

  /** Accepts a base58 secret key (Phantom export) or a JSON byte array. */
  static async create(chain: ChainId, privateKey: string): Promise<SolanaSigner> {
    const { Keypair } = await import('@solana/web3.js');
    const secret = decodeSecret(privateKey);
    const keypair = Keypair.fromSecretKey(secret);
    const signer = new SolanaSigner(chain, keypair.publicKey.toBase58(), secret);
    signer.keypair = keypair;
    return signer;
  }

  async sign(tx: TxRequest, gas: GasQuote): Promise<SignedTx> {
    const web3 = await import('@solana/web3.js');
    const { ComputeBudgetProgram, Keypair, Transaction, VersionedTransaction } = web3;
    const keypair = (this.keypair as InstanceType<typeof Keypair>) ?? Keypair.fromSecretKey(this.secret);

    const bytes = Buffer.from(tx.data, 'base64');
    if (bytes.length === 0) {
      throw new WalletError('Solana signer received an empty transaction payload', { chain: this.chain });
    }

    // Versioned transactions start with a byte that has the high bit set.
    const isVersioned = (bytes[0] & 0x80) !== 0;

    if (isVersioned) {
      const transaction = VersionedTransaction.deserialize(bytes);
      transaction.sign([keypair]);
      return {
        raw: Buffer.from(transaction.serialize()).toString('base64'),
        hash: transaction.signatures[0] ? Buffer.from(transaction.signatures[0]).toString('base64') : undefined,
      };
    }

    const transaction = Transaction.from(bytes);
    // Priority fee: unitPrice is micro-lamports per compute unit.
    transaction.instructions.unshift(
      ComputeBudgetProgram.setComputeUnitLimit({ units: Number(gas.units) }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(gas.unitPrice) }),
    );
    transaction.sign(keypair);

    return {
      raw: transaction.serialize().toString('base64'),
      hash: transaction.signature ? transaction.signature.toString('base64') : undefined,
    };
  }
}

function decodeSecret(privateKey: string): Uint8Array {
  const trimmed = privateKey.trim();
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as number[];
    return Uint8Array.from(parsed);
  }
  return base58Decode(trimmed);
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** Minimal base58 decoder — avoids pulling in a dependency for one function. */
function base58Decode(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of value) {
    const index = BASE58_ALPHABET.indexOf(char);
    if (index === -1) throw new WalletError('Private key is not valid base58');
    let carry = index;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Preserve leading zero bytes, which base58 encodes as '1'.
  for (const char of value) {
    if (char !== '1') break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}
