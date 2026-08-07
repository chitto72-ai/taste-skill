import type { ChainId } from '../core/domain/chain.js';
import type { ManagedWallet } from '../core/domain/wallet.js';
import { WalletError } from '../core/errors.js';
import type { HealthReport, Service } from '../core/lifecycle.js';
import { TtlCache } from '../core/utils/cache.js';
import type { Logger } from '../logger/logger.js';
import type { WalletsConfig } from '../config/schema.js';
import { getChain } from '../config/chains.config.js';
import type { ChainRegistry } from '../blockchains/registry.js';
import type { PriceOracle } from '../blockchains/types.js';
import type { TxSigner } from '../blockchains/types.js';
import { Keystore } from './keystore.js';
import { EvmSigner } from './signers/evm-signer.js';
import { SolanaSigner } from './signers/solana-signer.js';

export interface WalletManagerOptions {
  readonly config: WalletsConfig;
  readonly chains: ChainRegistry;
  readonly priceOracle: PriceOracle;
  readonly logger: Logger;
  /** Live mode requires real signers; paper mode never signs anything. */
  readonly requireSigners: boolean;
}

/**
 * Owns the bot's own signing accounts.
 *
 * Signers are constructed once at startup, from sealed keystore entries, and
 * the plaintext key never leaves that call. Two operational guardrails live
 * here: a per-chain gas reserve (so the wallet can always afford the exit
 * transaction) and a hot-wallet value ceiling (so a compromised key bounds the
 * loss).
 */
export class WalletManager implements Service {
  readonly name = 'wallet-manager';

  private readonly keystore: Keystore;
  private readonly signers = new Map<ChainId, TxSigner>();
  private readonly wallets = new Map<ChainId, ManagedWallet>();
  private readonly balances = new TtlCache<string, number>({ ttlMs: 15_000, maxEntries: 100 });
  private readonly logger: Logger;

  constructor(private readonly options: WalletManagerOptions) {
    this.logger = options.logger.child(this.name);
    this.keystore = new Keystore(options.config.keystoreDir, options.config.passphrase);
  }

  async start(): Promise<void> {
    await this.keystore.init();
    const entries = await this.keystore.list();

    if (entries.length === 0) {
      if (this.options.requireSigners) {
        throw new WalletError(
          `No wallets found in ${this.options.config.keystoreDir}. ` +
            'Import one with `memecoin-bot wallet:import` before running in live mode.',
        );
      }
      this.logger.warn('no wallets in keystore — paper mode will not sign transactions');
      return;
    }

    for (const entry of entries) {
      if (!this.options.chains.has(entry.chain)) {
        this.logger.debug({ chain: entry.chain, id: entry.id }, 'keystore entry for a disabled chain, skipping');
        continue;
      }
      try {
        const { privateKey } = await this.keystore.unseal(entry.id);
        const signer =
          entry.family === 'evm'
            ? await EvmSigner.create(entry.chain, privateKey)
            : await SolanaSigner.create(entry.chain, privateKey);

        if (signer.address.toLowerCase() !== entry.address.toLowerCase()) {
          throw new WalletError(
            `Keystore entry "${entry.id}" address mismatch: sealed ${entry.address}, derived ${signer.address}`,
            { id: entry.id },
          );
        }

        this.signers.set(entry.chain, signer);
        this.wallets.set(entry.chain, {
          id: entry.id,
          chain: entry.chain,
          address: signer.address,
          family: entry.family,
          label: entry.label,
        });
        this.logger.info({ chain: entry.chain, address: signer.address, label: entry.label }, 'wallet loaded');
      } catch (error) {
        if (this.options.requireSigners) throw error;
        this.logger.error({ id: entry.id, err: error }, 'failed to load wallet');
      }
    }

    await this.enforceHotWalletCeiling();
  }

  async stop(): Promise<void> {
    this.signers.clear();
    this.wallets.clear();
    this.balances.clear();
  }

  signerFor(chain: ChainId): TxSigner {
    const signer = this.signers.get(chain);
    if (!signer) {
      throw new WalletError(`No signer loaded for chain "${chain}"`, {
        chain,
        available: [...this.signers.keys()],
      });
    }
    return signer;
  }

  hasSigner(chain: ChainId): boolean {
    return this.signers.has(chain);
  }

  addressFor(chain: ChainId): string | undefined {
    return this.wallets.get(chain)?.address;
  }

  list(): ManagedWallet[] {
    return [...this.wallets.values()];
  }

  /** Native balance in USD, cached briefly to avoid per-order RPC calls. */
  async nativeBalanceUsd(chain: ChainId): Promise<number> {
    const address = this.addressFor(chain);
    if (!address) return 0;
    const key = `native:${chain}`;
    const cached = this.balances.get(key);
    if (cached !== undefined) return cached;

    const adapter = this.options.chains.adapter(chain);
    const descriptor = getChain(chain);
    const [raw, priceUsd] = await Promise.all([
      adapter.getNativeBalance(address),
      this.options.priceOracle.nativeUsd(chain),
    ]);
    const usd = adapter.fromBaseUnits(raw, descriptor.nativeCurrency.decimals) * priceUsd;
    this.balances.set(key, usd);
    return usd;
  }

  /**
   * True when the wallet still has enough native currency to pay for exits.
   * Entries are blocked below the reserve; exits never are.
   */
  async hasGasReserve(chain: ChainId): Promise<boolean> {
    try {
      return (await this.nativeBalanceUsd(chain)) >= this.options.config.gasReserveUsd;
    } catch (error) {
      this.logger.warn({ chain, err: error }, 'gas reserve check failed');
      // Fail open on the check itself: a flaky RPC should not stop trading,
      // the order will fail on its own if gas is genuinely missing.
      return true;
    }
  }

  async health(): Promise<HealthReport> {
    const chains = [...this.signers.keys()];
    const reserves = await Promise.all(
      chains.map(async (chain) => ({ chain, ok: await this.hasGasReserve(chain) })),
    );
    const starved = reserves.filter((r) => !r.ok).map((r) => r.chain);
    return {
      component: this.name,
      healthy: starved.length === 0,
      detail: starved.length === 0 ? `${chains.length} wallets funded` : `low gas on: ${starved.join(', ')}`,
      checkedAt: Date.now(),
      metrics: { wallets: chains.length, starved: starved.length },
    };
  }

  private async enforceHotWalletCeiling(): Promise<void> {
    for (const chain of this.signers.keys()) {
      try {
        const usd = await this.nativeBalanceUsd(chain);
        if (usd > this.options.config.maxHotWalletUsd) {
          this.logger.error(
            { chain, usd: Math.round(usd), ceiling: this.options.config.maxHotWalletUsd },
            'hot wallet balance exceeds the configured ceiling — move funds to cold storage',
          );
        }
      } catch {
        // Balance checks are best-effort at startup.
      }
    }
  }
}
